// YTBox — acceso a la API interna de YouTube (la misma que usa la web) con la sesión del usuario.
// Se usa para «Ver más tarde» y «Guardar en una lista de reproducción».
const YTAPI = (() => {
  function cookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function sha1Hex(text) {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function authHeader() {
    const origin = 'https://www.youtube.com';
    const ts = Math.floor(Date.now() / 1000);
    const parts = [];
    const sapisid = cookie('SAPISID') || cookie('__Secure-3PAPISID');
    if (!sapisid) throw new Error('Inicia sesión en YouTube para usar esta opción');
    parts.push(`SAPISIDHASH ${ts}_${await sha1Hex(`${ts} ${sapisid} ${origin}`)}`);
    const p1 = cookie('__Secure-1PAPISID');
    if (p1) parts.push(`SAPISID1PHASH ${ts}_${await sha1Hex(`${ts} ${p1} ${origin}`)}`);
    const p3 = cookie('__Secure-3PAPISID');
    if (p3) parts.push(`SAPISID3PHASH ${ts}_${await sha1Hex(`${ts} ${p3} ${origin}`)}`);
    return parts.join(' ');
  }

  // Versión del cliente web: se lee de los scripts de la página (ytcfg)
  let cfg = null;
  function config() {
    if (cfg) return cfg;
    let version = null, key = null, hl = 'es', gl = 'ES';
    for (const s of document.scripts) {
      const t = s.textContent;
      if (!t || !t.includes('INNERTUBE')) continue;
      version = version || (t.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1];
      key = key || (t.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1];
      hl = (t.match(/"HL":"([^"]+)"/) || [])[1] || hl;
      gl = (t.match(/"GL":"([^"]+)"/) || [])[1] || gl;
      if (version && key) break;
    }
    cfg = { version: version || '2.20260101.00.00', key, hl, gl };
    return cfg;
  }

  async function call(endpoint, body) {
    const c = config();
    const url = `https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false` + (c.key ? `&key=${c.key}` : '');
    const res = await PG.fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': await authHeader(),
        'X-Origin': 'https://www.youtube.com',
        'X-Goog-AuthUser': '0',
        'X-Youtube-Client-Name': '1',
        'X-Youtube-Client-Version': c.version,
      },
      body: JSON.stringify(Object.assign({ context: { client: { clientName: 'WEB', clientVersion: c.version, hl: c.hl, gl: c.gl } } }, body)),
    });
    if (res.status === 401 || res.status === 403) throw new Error('YouTube no ha aceptado la sesión. Recarga la página e inténtalo de nuevo');
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json.error && json.error.message) || 'Error ' + res.status);
    return json;
  }

  async function editPlaylist(playlistId, actions) {
    const r = await call('browse/edit_playlist', { playlistId, actions });
    if (r.status && r.status !== 'STATUS_SUCCEEDED') throw new Error('YouTube respondió: ' + r.status);
    return r;
  }

  const addToPlaylist = (playlistId, videoId) => editPlaylist(playlistId, [{ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId }]);
  const removeFromPlaylist = (playlistId, videoId) => editPlaylist(playlistId, [{ action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: videoId }]);
  const watchLater = videoId => addToPlaylist('WL', videoId);
  // Añade varios vídeos de golpe (en tandas de 50). Si una tanda falla (p. ej. un vídeo ya estaba), se reintenta uno a uno.
  async function addMany(playlistId, ids, onProgress = () => {}) {
    let ok = 0, fail = 0;
    for (let i = 0; i < ids.length; i += 50) {
      const part = ids.slice(i, i + 50);
      try { await editPlaylist(playlistId, part.map(id => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: id }))); ok += part.length; }
      catch (e) {
        for (const id of part) { try { await addToPlaylist(playlistId, id); ok++; } catch { fail++; } }
      }
      onProgress(ok + fail, ids.length);
    }
    return { ok, fail };
  }

  // Listas del usuario, indicando si ya contienen el vídeo
  async function getPlaylists(videoId) {
    const r = await call('playlist/get_add_to_playlist', { videoIds: [videoId], excludeWatchLater: false });
    const out = [], seen = new Set();
    const text = t => !t ? '' : typeof t === 'string' ? t : t.simpleText || t.content || (t.runs || []).map(x => x.text).join('');
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o.playlistAddToOptionRenderer) {
        const p = o.playlistAddToOptionRenderer;
        if (!seen.has(p.playlistId)) { seen.add(p.playlistId); out.push({ id: p.playlistId, title: text(p.title), contains: p.containsSelectedVideos === 'ALL', privacy: p.privacy }); }
        return;
      }
      // Formato nuevo (view models): buscamos objetos con id de lista y título
      if (o.listItemViewModel && o.listItemViewModel.title) {
        const li = o.listItemViewModel;
        const json = JSON.stringify(li);
        const id = (json.match(/"playlistId":"([^"]+)"/) || [])[1];
        if (id && !seen.has(id)) {
          seen.add(id);
          out.push({ id, title: text(li.title), contains: /"isSelected":true|CHECK_BOX_FILLED|"selected":true/.test(json) });
        }
      }
      for (const k in o) walk(o[k]);
    })(r);
    return out;
  }

  async function createPlaylist(title, videoId) {
    const ids = Array.isArray(videoId) ? videoId : videoId ? [videoId] : [];
    const r = await call('playlist/create', { title, privacyStatus: 'PRIVATE', videoIds: ids });
    if (!r.playlistId) throw new Error('No se pudo crear la lista');
    return r.playlistId;
  }

  // Últimos ~30 vídeos de un canal (pestaña «Vídeos») con su duración. No necesita sesión.
  const AGE_UNITS = { segundo: 1e3, minuto: 6e4, hora: 36e5, día: 864e5, dia: 864e5, semana: 6048e5, mes: 2592e6, año: 31536e6, ano: 31536e6 };
  function parseAgo(txt) { // «hace 3 días», «hace 2 semanas», «Emitido hace 1 hora»…
    const m = String(txt || '').toLowerCase().match(/hace\s+(\d+)\s+([a-zñáéíóú]+)/);
    if (!m) return null;
    const unit = Object.keys(AGE_UNITS).find(u => m[2].startsWith(u));
    return unit ? Date.now() - Number(m[1]) * AGE_UNITS[unit] : null;
  }
  function parseDur(t) { const p = String(t).split(':').map(Number); return p.reduce((a, n) => a * 60 + n, 0); }

  // Peticiones que no necesitan tu cuenta. Primero con las cookies de YouTube; si YouTube las rechaza
  // (pasa con la sesión iniciada y sin firma), se repite como anónima, que siempre funciona.
  async function publicCall(endpoint, payload, anon = false) {
    const c = config();
    const url = `https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false` + (c.key ? `&key=${c.key}` : '');
    const body = JSON.stringify(Object.assign({ context: { client: { clientName: 'WEB', clientVersion: c.version, hl: 'es', gl: c.gl } } }, payload));
    let lastErr = null;
    for (const creds of anon ? ['omit'] : ['include', 'omit']) {
      try {
        const res = await PG.fetch(url, { method: 'POST', credentials: creds, headers: { 'Content-Type': 'application/json', 'X-Youtube-Client-Name': '1', 'X-Youtube-Client-Version': c.version }, body });
        if (res.ok) return await res.json();
        lastErr = new Error('YouTube respondió ' + res.status);
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Sin respuesta de YouTube');
  }

  // Últimos vídeos de un canal por su RSS (respaldo: sin duraciones)
  async function rssVideos(channelId) {
    const res = await PG.fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId, { credentials: 'include' });
    if (!res.ok) throw new Error('RSS ' + res.status);
    // Sin DOMParser: en algunos contextos YouTube lo bloquea (Trusted Types)
    const xml = await res.text();
    const tag = (e, t) => { const m = e.match(new RegExp('<' + t + '[^>]*>([\\s\\S]*?)</' + t + '>')); return m ? m[1] : ''; };
    const unesc = x => x.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    return (xml.match(/<entry>[\s\S]*?<\/entry>/g) || []).map(e => ({
      vid: tag(e, 'yt:videoId'), channelId, title: unesc(tag(e, 'title')),
      short: /<link[^>]+href="[^"]*\/shorts\//.test(e),
      published: new Date(tag(e, 'published')),
    })).filter(v => v.vid);
  }

  // Vídeos «Solo para miembros» (insignia de YouTube)
  const MEMBERS_RE = /MEMBERS_ONLY|"Solo para miembros"|"Members only"/i;
  async function channelVideos(channelId) {
    let json = await publicCall('browse', { browseId: channelId, params: 'EgZ2aWRlb3PyBgQKAjoA' });
    for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) json = await publicCall('browse', { browseId: channelId, params: 'EgZ2aWRlb3PyBgQKAjoA' }, true);
    const out = [];
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o.lockupViewModel && o.lockupViewModel.contentId) {
        const l = o.lockupViewModel, js = JSON.stringify(l);
        const dur = (js.match(/"thumbnailBadgeViewModel":\{"text":"(\d{1,2}(?::\d{2}){1,2})"/) || [])[1];
        const meta = [];
        (function w(x) { if (!x || typeof x !== 'object') return; if (Array.isArray(x)) { x.forEach(w); return; } if (typeof x.content === 'string' && x.content.length < 60) meta.push(x.content); for (const k in x) w(x[k]); })(l.metadata && l.metadata.lockupMetadataViewModel && l.metadata.lockupMetadataViewModel.metadata);
        const ago = meta.map(parseAgo).find(Boolean) || null;
        if (dur) out.push({ vid: l.contentId, channelId, title: (l.metadata && l.metadata.lockupMetadataViewModel && l.metadata.lockupMetadataViewModel.title && l.metadata.lockupMetadataViewModel.title.content) || '', seconds: parseDur(dur), published: ago,
          members: MEMBERS_RE.test(js) });
        return;
      }
      if (o.videoRenderer && o.videoRenderer.videoId) { // formato antiguo
        const r = o.videoRenderer, dur = r.lengthText && r.lengthText.simpleText;
        if (dur) out.push({ vid: r.videoId, channelId, title: (r.title && r.title.runs && r.title.runs[0] && r.title.runs[0].text) || '', seconds: parseDur(dur), published: parseAgo(r.publishedTimeText && r.publishedTimeText.simpleText),
          members: MEMBERS_RE.test(JSON.stringify(r.badges || [])) });
        return;
      }
      for (const k in o) walk(o[k]);
    })(json);
    if (out.length) return out;
    }
    return [];
  }

  // «Lo más visto» de un vídeo: la curva que YouTube dibuja sobre la barra de progreso.
  // Devuelve [{ s, d, v }] (inicio y duración en segundos, intensidad 0..1) o [] si el vídeo no la tiene.
  async function heatmap(videoId) {
    let json = await publicCall('next', { videoId });
    let markers = null;
    (function walk(o) {
      if (markers || !o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o.markersList && o.markersList.markerType === 'MARKER_TYPE_HEATMAP' && Array.isArray(o.markersList.markers)) { markers = o.markersList.markers; return; }
      if (o.markerType === 'MARKER_TYPE_HEATMAP' && Array.isArray(o.markers)) { markers = o.markers; return; }
      for (const k in o) walk(o[k]);
    })(json.frameworkUpdates || json);
    return (markers || []).map(m => ({ s: Number(m.startMillis) / 1000, d: Number(m.durationMillis) / 1000, v: Number(m.intensityScoreNormalized) || 0 }));
  }

  // Tu historial de YouTube (necesita sesión): ids de vídeos vistos y la fecha más antigua que cubre.
  const MESES = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, sept: 8, oct: 9, nov: 10, dic: 11,
    jan: 0, apr: 3, aug: 7, dec: 11 };
  function headerDate(t) {
    t = String(t || '').trim().toLowerCase();
    const now = new Date(), day = 864e5;
    if (/^(hoy|today)$/.test(t)) return now.getTime();
    if (/^(ayer|yesterday)$/.test(t)) return now.getTime() - day;
    if (/^(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.test(t)) return now.getTime() - 7 * day;
    let m = t.match(/(\d{1,2})\s+(?:de\s+)?([a-zé]{3,4})[a-z.]*(?:\s+(?:de\s+)?(\d{4}))?/);
    if (m && m[2].slice(0, 4) in MESES || (m && m[2].slice(0, 3) in MESES)) {
      const mon = MESES[m[2].slice(0, 4)] ?? MESES[m[2].slice(0, 3)];
      let y = m[3] ? Number(m[3]) : now.getFullYear();
      let d = new Date(y, mon, Number(m[1])).getTime();
      if (!m[3] && d > now.getTime() + day) d = new Date(y - 1, mon, Number(m[1])).getTime();
      return d;
    }
    m = t.match(/([a-z]{3})[a-z]*\s+(\d{1,2})(?:,\s*(\d{4}))?/); // formato inglés: «nov 15, 2025»
    if (m && m[1] in MESES) return new Date(m[3] ? Number(m[3]) : now.getFullYear(), MESES[m[1]], Number(m[2])).getTime();
    return null;
  }
  async function history(maxPages = 10) {
    const vids = new Set(), chanCounts = {}; let oldest = null, token = null, pages = 0;
    const text = t => !t ? '' : typeof t === 'string' ? t : t.simpleText || t.content || (t.runs || []).map(x => x.text).join('');
    do {
      const r = await call('browse', token ? { continuation: token } : { browseId: 'FEhistory' });
      token = null; pages++;
      (function walk(o, key) {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) { o.forEach(x => walk(x)); return; }
        if (key && /Header(Renderer|ViewModel)$/.test(key) && o.title) { const d = headerDate(text(o.title)); if (d && (!oldest || d < oldest)) oldest = d; }
        if (typeof o.videoId === 'string' && o.videoId.length === 11) vids.add(o.videoId);
        if (o.lockupViewModel && typeof o.lockupViewModel.contentId === 'string' && o.lockupViewModel.contentId.length === 11) {
          vids.add(o.lockupViewModel.contentId);
          const m = o.lockupViewModel.metadata && o.lockupViewModel.metadata.lockupMetadataViewModel;
          const ch = (JSON.stringify((m && m.image) || (m && m.metadata) || {}).match(/"browseId":"(UC[\w-]{22})"/) || [])[1];
          if (ch) chanCounts[ch] = (chanCounts[ch] || 0) + 1;
          return;
        }
        if (o.videoRenderer && o.videoRenderer.videoId) {
          const ch = (JSON.stringify(o.videoRenderer.ownerText || o.videoRenderer.longBylineText || {}).match(/"browseId":"(UC[\w-]{22})"/) || [])[1];
          if (ch) chanCounts[ch] = (chanCounts[ch] || 0) + 1;
        }
        if (o.continuationCommand && o.continuationCommand.token) token = o.continuationCommand.token;
        for (const k in o) walk(o[k], k);
      })(r);
    } while (token && pages < maxPages);
    return { vids: [...vids], oldest, pages, chanCounts };
  }

  // Vídeos relacionados de un vídeo (columna derecha de /watch) con el canal de cada uno. No necesita sesión.
  const decodeHandle = h => { if (!h) return null; try { return decodeURIComponent(h).toLowerCase(); } catch { return h.toLowerCase(); } };
  async function related(videoId) {
    for (let attempt = 0; attempt < 2; attempt++) {
    const json = await publicCall('next', { videoId }, attempt === 1);
    const sec = json.contents && json.contents.twoColumnWatchNextResults && json.contents.twoColumnWatchNextResults.secondaryResults;
    const out = [];
    const text = t => !t ? '' : typeof t === 'string' ? t : t.simpleText || t.content || (t.runs || []).map(x => x.text).join('');
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o.lockupViewModel && o.lockupViewModel.contentId) {
        const l = o.lockupViewModel, m = l.metadata && l.metadata.lockupMetadataViewModel;
        if (!m || (l.contentType && l.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO')) return;
        const js = JSON.stringify(m.image || {});
        const channelId = (js.match(/"browseId":"(UC[\w-]{22})"/) || [])[1];
        if (!channelId) return;
        const rows = (m.metadata && m.metadata.contentMetadataViewModel && m.metadata.contentMetadataViewModel.metadataRows) || [];
        const parts = rows.map(r => (r.metadataParts || []).map(p => text(p.text)));
        out.push({ vid: l.contentId, title: text(m.title), channelId,
          handle: decodeHandle((js.match(/"canonicalBaseUrl":"\/(@[^"]+)"/) || [])[1]),
          name: (parts[0] && parts[0][0]) || '',
          avatar: (js.match(/"url":"(https:\/\/yt3[^"]+)"/) || [])[1] || '',
          views: (rows[1] && rows[1].metadataParts && rows[1].metadataParts[0] && rows[1].metadataParts[0].accessibilityLabel) || '' });
        return;
      }
      if (o.compactVideoRenderer) { // formato antiguo
        const r = o.compactVideoRenderer, run = r.longBylineText && r.longBylineText.runs && r.longBylineText.runs[0];
        const be = run && run.navigationEndpoint && run.navigationEndpoint.browseEndpoint;
        if (be && be.browseId) out.push({ vid: r.videoId, title: text(r.title), channelId: be.browseId, handle: decodeHandle(((be.canonicalBaseUrl || '').match(/^\/(@.+)/) || [])[1]),
          name: run.text, avatar: (r.channelThumbnail && r.channelThumbnail.thumbnails && r.channelThumbnail.thumbnails[0] && r.channelThumbnail.thumbnails[0].url) || '', views: text(r.viewCountText) });
        return;
      }
      for (const k in o) walk(o[k]);
    })(sec || json);
    if (out.length) return out;
    }
    return [];
  }

  // @usuario → id del canal (UC…). Respuesta pequeña (~1 KB). No necesita sesión.
  async function resolveHandle(handle) {
    const json = await publicCall('navigation/resolve_url', { url: 'https://www.youtube.com/' + handle });
    return (JSON.stringify(json).match(/"browseId":"(UC[\w-]{22})"/) || [])[1] || null;
  }

  // Suscriptores de un canal: «10,1 millones de suscriptores», «345 mil», «1.234», «10.1M subscribers»…
  function parseSubs(t) {
    t = String(t || '').toLowerCase();
    const m = t.match(/([\d.,]+)\s*(millones|millón|mill|mil|m|k|b)?\b/);
    if (!m) return null;
    let num = m[1];
    if (/^\d{1,3}([.,]\d{3})+$/.test(num) && !m[2]) num = num.replace(/[.,]/g, ''); // 1.234 / 1,234
    else num = num.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
    const mult = { millones: 1e6, 'millón': 1e6, mill: 1e6, m: 1e6, mil: 1e3, k: 1e3, b: 1e9 }[m[2]] || 1;
    const n = parseFloat(num);
    return isNaN(n) ? null : Math.round(n * mult);
  }
  async function channelStats(channelId) {
    const s = JSON.stringify(await publicCall('browse', { browseId: channelId, params: 'EgZ2aWRlb3PyBgQKAjoA' }));
    const label = (s.match(/"accessibilityLabel":"([^"]*suscriptores[^"]*)"/) || s.match(/"content":"([^"]*suscriptores[^"]*)"/) || s.match(/"(?:content|accessibilityLabel)":"([^"]*subscribers[^"]*)"/) || [])[1];
    const text = (s.match(/"content":"([^"]*(?:suscriptores|subscribers)[^"]*)"/) || [])[1] || null;
    return { subs: label ? parseSubs(label) : null, subsText: text ? text.replace(/ de suscriptores| suscriptores| subscribers/i, '') : null };
  }

  async function deletePlaylist(playlistId) { return call('playlist/delete', { playlistId }); }

  return { channelVideos, rssVideos, resolveHandle, deletePlaylist, channelStats, parseSubs, heatmap, history, related, addMany, watchLater, addToPlaylist, removeFromPlaylist, getPlaylists, createPlaylist, loggedIn: () => !!(cookie('SAPISID') || cookie('__Secure-3PAPISID')) };
})();
