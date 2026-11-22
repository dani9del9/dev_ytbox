// YTBox — Modo TV: lógica compartida por el gestor y por YouTube.
// Crea una lista de vídeos al azar de los canales elegidos con una duración total aproximada.
const YTBoxTV = (() => {
  const AGES = { all: 0, day: 864e5, '3days': 3 * 864e5, week: 7 * 864e5, month: 30 * 864e5 };
  const DEFAULTS = { groups: [], channels: [], onlyUnwatched: false, maxAge: 'week', amount: 1, unit: 'h', style: 'full', clip: 60, maxLen: 0 };
  const MAXLENS = [[0, 'Sin límite'], [5, '5 min'], [10, '10 min'], [15, '15 min'], [20, '20 min'], [30, '30 min'], [45, '45 min'], [60, '1 hora']];
  const CLIPS = [[30, '30 s'], [60, '1 min'], [90, '1 min 30 s'], [120, '2 min'], [180, '3 min']];
  const cache = new Map(); // channelId -> { t, items }

  function fmtDur(sec) {
    const hh = Math.floor(sec / 3600), mm = Math.round((sec % 3600) / 60);
    return hh ? `${hh} h${mm ? ' ' + mm + ' min' : ''}` : `${mm} min`;
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  async function channelVideos(id) {
    const c = cache.get(id);
    if (c && Date.now() - c.t < 30 * 60 * 1000) return c.items;
    const items = await YTAPI.channelVideos(id);
    cache.set(id, { t: Date.now(), items });
    return items;
  }

  async function pool(list, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
      while (i < list.length) { const k = i++; try { await fn(list[k], k); } catch (e) { console.warn('[YTBox TV]', e); } }
    }));
  }

  // Canales elegidos: los de los grupos marcados más los sueltos
  function selectedChannels(cfg, state) {
    const keys = new Set(cfg.channels || []);
    for (const gid of cfg.groups || []) { const g = state.groups.find(x => x.id === gid); g && g.channels.forEach(k => keys.add(k)); }
    return [...keys].map(k => state.channels[k]).filter(Boolean);
  }

  // Reparte entre canales (cada canal barajado, uno de cada por turnos) y suma hasta la duración pedida
  function build(videos, targetSec, cost = v => v.seconds) {
    const byCh = new Map();
    for (const v of videos) { if (!byCh.has(v.channelId)) byCh.set(v.channelId, []); byCh.get(v.channelId).push(v); }
    const lists = shuffle([...byCh.values()].map(shuffle));
    const order = [];
    while (lists.some(l => l.length)) for (const l of lists) if (l.length) order.push(l.shift());
    const tol = Math.max(120, targetSec * 0.05);
    const picked = []; let total = 0;
    for (const v of order) {
      if (picked.length >= 50 || total >= targetSec - tol) break;
      const c = cost(v);
      if (total + c <= targetSec + tol) { picked.push(v); total += c; }
    }
    return { picked: shuffle(picked), total };
  }

  // Hace todo el proceso. onStatus(texto) informa del progreso. Devuelve { picked, total, target, candidates }
  async function run(cfg, state, onStatus = () => {}) {
    const chans = selectedChannels(cfg, state);
    const n = Math.max(0, Number(cfg.amount) || 0);
    if (!chans.length) throw new Error('Elige al menos un grupo o canal.');
    if (!n) throw new Error('Indica cuánto quieres que dure.');
    const missing = chans.filter(c => !c.id);
    if (missing.length) {
      onStatus(`Buscando ${missing.length} canales…`);
      await pool(missing, 4, c => PG.ensureChannelId(c));
      await PG.save({ channels: state.channels });
    }
    let done = 0; const all = [];
    const withId = chans.filter(c => c.id);
    await pool(withId, 4, async c => {
      try { all.push(...await channelVideos(c.id)); } finally { done++; onStatus(`Buscando vídeos… ${done}/${withId.length} canales`); }
    });
    const { watched = {} } = await chrome.storage.local.get('watched');
    const maxAge = AGES[cfg.maxAge] || 0;
    const maxLen = (Number(cfg.maxLen) || 0) * 60;
    const candidates = all.filter(v => v.seconds >= 61 && (!maxLen || v.seconds <= maxLen) && (!cfg.onlyUnwatched || !watched[v.vid]) && (!maxAge || (v.published && Date.now() - v.published <= maxAge)));
    const target = n * (cfg.unit === 'h' ? 3600 : 60);
    if (cfg.style === 'picoteo') return runPicoteo(cfg, candidates, target, onStatus);
    const { picked, total } = build(candidates, target);
    if (!picked.length) {
      throw new Error(candidates.length ? 'Los vídeos disponibles son más largos que el tiempo elegido. Prueba con más tiempo.'
        : 'No hay vídeos con estas condiciones. Prueba con más canales o una fecha más amplia.');
    }
    return { picked, total, target, candidates: candidates.length };
  }

  // ---------- Modo picoteo: solo el trozo más visto de cada vídeo ----------
  // Trozo de L segundos alrededor del momento más visto (sin contar el arranque ni el final, que siempre salen altos)
  function bestWindow(markers, seconds, L) {
    if (L >= seconds * 0.8) return { start: 0, end: seconds, hot: false };
    const ms = markers.filter(m => m.s >= seconds * 0.04 && m.s + m.d <= seconds * 0.97);
    if (!ms.length) { const s = Math.round(seconds * 0.3); return { start: s, end: Math.min(seconds, s + L), hot: false }; }
    // El pico («Lo más visto» de YouTube) queda dentro, con un poco de contexto antes
    const peak = ms.reduce((a, m) => (m.v > a.v ? m : a), ms[0]);
    let start = Math.max(0, Math.round(peak.s + peak.d / 2 - L * 0.3));
    if (start + L > seconds) start = Math.max(0, Math.round(seconds - L));
    return { start, end: Math.min(seconds, start + L), hot: true };
  }

  async function runPicoteo(cfg, candidates, target, onStatus) {
    const L = Math.max(15, Number(cfg.clip) || 60);
    const pool2 = candidates.filter(v => v.seconds >= L * 1.6);
    const { picked } = build(pool2, target, () => L);
    if (!picked.length) {
      throw new Error(candidates.length ? 'Los vídeos disponibles son demasiado cortos para el tamaño de fragmento elegido.'
        : 'No hay vídeos con estas condiciones. Prueba con más canales o una fecha más amplia.');
    }
    let done = 0;
    await pool(picked, 4, async v => {
      let markers = [];
      try { markers = await YTAPI.heatmap(v.vid); } catch (e) { console.warn('[YTBox TV] heatmap', e); }
      Object.assign(v, bestWindow(markers, v.seconds, L));
      done++; onStatus(`Buscando lo más visto… ${done}/${picked.length} vídeos`);
    });
    const total = picked.reduce((a, v) => a + (v.end - v.start), 0);
    return { picked, total, target, candidates: pool2.length, picoteo: true };
  }

  // Prepara la reproducción: en picoteo deja apuntado qué trozo ver de cada vídeo (lo usa content.js en /watch)
  async function start(picked, cfg) {
    if (cfg.style === 'picoteo') {
      const clips = {}; picked.forEach(v => { clips[v.vid] = [v.start, v.end, v.seconds]; });
      await chrome.storage.local.set({ tvSession: { t: Date.now(), order: picked.map(v => v.vid), clips, titles: Object.fromEntries(picked.map(v => [v.vid, v.title || ''])) } });
    } else await chrome.storage.local.remove('tvSession');
    return playUrl(picked);
  }

  const playUrl = picked => 'https://www.youtube.com/watch_videos?video_ids=' + picked.map(v => v.vid).join(',');

  // ---------- Preconfiguraciones guardadas (state.settings.tvPresets) ----------
  const AGE_TXT = { all: 'cualquier fecha', day: 'último día', '3days': 'últimos 3 días', week: 'última semana', month: 'último mes' };
  function presets(state) { if (!Array.isArray(state.settings.tvPresets)) state.settings.tvPresets = []; return state.settings.tvPresets; }
  function savePreset(state, name, cfg) {
    const list = presets(state); name = String(name).trim();
    let p = list.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (p) { p.name = name; p.cfg = cfg; }
    else { p = { id: 'tv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, cfg }; list.push(p); }
    return p;
  }
  function deletePreset(state, id) { state.settings.tvPresets = presets(state).filter(x => x.id !== id); }
  function summary(cfg, state) {
    cfg = Object.assign({}, DEFAULTS, cfg);
    const names = (cfg.groups || []).map(id => (state.groups.find(g => g.id === id) || {}).name).filter(Boolean);
    const nc = (cfg.channels || []).filter(k => state.channels[k]).length;
    if (nc) names.push(`${nc} canal${nc > 1 ? 'es' : ''}`);
    return `${cfg.style === 'picoteo' ? '🍿 ' : ''}${cfg.amount} ${cfg.unit === 'h' ? 'h' : 'min'} · ${AGE_TXT[cfg.maxAge] || ''}${cfg.onlyUnwatched ? ' · sin ver' : ''}${Number(cfg.maxLen) ? ' · máx. ' + cfg.maxLen + ' min/vídeo' : ''} · ${names.join(', ') || 'sin canales'}`;
  }

  return { AGES, DEFAULTS, CLIPS, MAXLENS, bestWindow, start, fmtDur, selectedChannels, build, run, playUrl, presets, savePreset, deletePreset, summary };
})();
