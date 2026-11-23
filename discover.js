// YTBox — Modo Descubrir: canales parecidos a los tuyos que todavía no tienes en YTBox.
// Mira los vídeos relacionados de los últimos vídeos de tus canales y cuenta qué otros canales aparecen más.
const YTBoxDiscover = (() => {
  const DEFAULTS = { groups: [], channels: [] };
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  async function pool(list, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
      while (i < list.length) { const k = i++; try { await fn(list[k], k); } catch (e) { console.warn('[YTBox Descubrir]', e); } }
    }));
  }
  // ¿Ya lo tienes en YTBox? (por id, @handle o clave)
  function knownSet(state) {
    const s = new Set();
    for (const c of Object.values(state.channels)) { [c.key, c.id, c.handle].forEach(x => x && s.add(String(x).toLowerCase())); }
    return s;
  }

  async function run(cfg, state, onStatus = () => {}) {
    const chans = YTBoxTV.selectedChannels(cfg, state);
    if (!chans.length) throw new Error('Elige al menos un grupo o canal.');
    const missing = chans.filter(c => !c.id);
    if (missing.length) { onStatus(`Buscando ${missing.length} canales…`); await pool(missing, 4, c => PG.ensureChannelId(c)); await PG.save({ channels: state.channels }); }
    const sample = shuffle(chans.filter(c => c.id)).slice(0, 12);
    // Nombres reales de los canales de partida que solo tienen el código (UC…)
    const unnamed = sample.filter(c => YTAPI.needsName(c));
    if (unnamed.length) {
      onStatus(`Completando nombres de ${unnamed.length} canales…`);
      await pool(unnamed, 4, async c => { const n = await YTAPI.channelName(c.id); if (n) c.name = n; });
      await PG.save({ channels: state.channels });
    }
    // De cada canal: su último vídeo y otro al azar de los recientes
    const seeds = []; let done = 0, lastErr = null;
    await pool(sample, 4, async c => {
      try {
        let vids = [];
        try { vids = (await YTAPI.channelVideos(c.id)).filter(v => v.seconds >= 61 && !v.members); } catch (e) { lastErr = e; }
        if (!vids.length) { try { vids = (await YTAPI.rssVideos(c.id)).filter(v => !v.short); } catch (e) { lastErr = e; } } // respaldo: RSS
        if (vids[0]) seeds.push({ vid: vids[0].vid, from: c });
        const rest = vids.slice(1, 15); if (rest.length) seeds.push({ vid: rest[Math.floor(Math.random() * rest.length)].vid, from: c });
      } finally { done++; onStatus(`Mirando tus canales… ${done}/${sample.length}`); }
    });
    if (!seeds.length) throw new Error('No se han podido leer los vídeos de esos canales' + (lastErr ? ` (${lastErr.message})` : '') + '. Inténtalo de nuevo.');
    const known = knownSet(state);
    const ignored = new Set((state.settings.discoverIgnored || []).map(x => String(x).toLowerCase()));
    const found = new Map(); done = 0;
    await pool(seeds, 2, async s => {
      try {
        for (const r of await YTAPI.related(s.vid)) {
          const id = r.channelId;
          if (known.has(id.toLowerCase()) || (r.handle && known.has(r.handle)) || ignored.has(id.toLowerCase())) continue;
          let f = found.get(id);
          if (!f) found.set(id, f = { id, handle: r.handle, name: r.name, avatar: r.avatar, hits: 0, sources: new Map(), videos: [] });
          f.hits++;
          f.sources.set(s.from.key, s.from.name);
          if (!f.videos.some(v => v.vid === r.vid) && f.videos.length < 3) f.videos.push({ vid: r.vid, title: r.title, views: r.views });
          if (!f.avatar && r.avatar) f.avatar = r.avatar;
        }
      } catch (e) { lastErr = e; throw e; } finally { done++; onStatus(`Buscando canales parecidos… ${done}/${seeds.length}`); }
    });
    if (!found.size && lastErr) throw new Error('YouTube no ha devuelto vídeos relacionados (' + lastErr.message + '). Inténtalo de nuevo.');
    // Puntuación: pesa más que lo sugieran varios de tus canales distintos
    const all = [...found.values()].map(f => Object.assign(f, { score: f.sources.size * 3 + f.hits, sourceNames: [...f.sources.values()] }))
      .sort((a, b) => b.score - a.score);
    // Primero los que salen varias veces; si son pocos, se completa con los que salen una vez
    const strong = all.filter(f => f.hits >= 2 || f.sources.size >= 2);
    const list = strong.length >= 12 ? strong : strong.concat(all.filter(f => !strong.includes(f)).slice(0, 12 - strong.length));
    return { list: list.slice(0, 40), seeds: seeds.length, scanned: sample.length };
  }

  return { DEFAULTS, run };
})();
