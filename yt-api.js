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
    const url = `/youtubei/v1/${endpoint}?prettyPrint=false` + (c.key ? `&key=${c.key}` : '');
    const res = await fetch(url, {
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
    const r = await call('playlist/create', { title, privacyStatus: 'PRIVATE', videoIds: videoId ? [videoId] : [] });
    if (!r.playlistId) throw new Error('No se pudo crear la lista');
    return r.playlistId;
  }

  return { watchLater, addToPlaylist, removeFromPlaylist, getPlaylists, createPlaylist, loggedIn: () => !!(cookie('SAPISID') || cookie('__Secure-3PAPISID')) };
})();
