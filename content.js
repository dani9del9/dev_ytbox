// YTBox — script de contenido para youtube.com
(() => {
  let state = { groups: [], channels: {}, settings: {} };
  const rssCache = new Map(); // id -> { t, items }
  // Duraciones de los vídeos (el RSS no las trae): se sacan de la pestaña «Vídeos» del canal y se guardan
  const durations = {}; // vid -> segundos
  let durLoaded = chrome.storage.local.get('durations').then(r => Object.assign(durations, r.durations || {})).catch(() => {});
  const durFetched = new Map(); // channelId -> momento en que se pidió (para no repetir en 30 min)
  let durSaveTimer = null;
  const saveDurations = () => {
    clearTimeout(durSaveTimer);
    durSaveTimer = setTimeout(() => {
      const keys = Object.keys(durations);
      if (keys.length > 8000) keys.slice(0, keys.length - 8000).forEach(k => delete durations[k]);
      chrome.storage.local.set({ durations });
    }, 1500);
  };
  async function ensureDurations(channelId, items) {
    await durLoaded;
    if (!items.some(v => !v.short && !(v.vid in durations))) return false;
    const t = durFetched.get(channelId);
    if (t && Date.now() - t < 30 * 60 * 1000) return false;
    durFetched.set(channelId, Date.now());
    const list = await YTAPI.channelVideos(channelId);
    for (const v of list) durations[v.vid] = v.seconds;
    saveDurations();
    return true;
  }
  const fmtDuration = s => { s = Math.round(s); const hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60; return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0'); };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style') el.style.cssText = v;
      else el.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) el.append(k instanceof Node ? k : document.createTextNode(k));
    return el;
  };

  // Logo de YTBox con los colores elegidos por el usuario
  function appLogo(size) {
    const v = PG.themeVars(state.settings, false);
    return PG.logoEl(size, v.acc, v.acc2);
  }

  // ---------- Tema: variables de color según ajustes (claro/oscuro/automático y los 2 colores) ----------
  function applyTheme() {
    const dark = PG.isDark(state.settings, document.documentElement.hasAttribute('dark'));
    const v = PG.themeVars(state.settings, dark);
    let st = document.getElementById('pg-theme-style');
    if (!st) { st = document.createElement('style'); st.id = 'pg-theme-style'; (document.head || document.documentElement).append(st); }
    st.textContent = `html:root{--pg-bg:${v.bg};--pg-panel:${v.panel};--pg-panel2:${v.panel2};--pg-line:${v.line};--pg-txt:${v.txt};--pg-mut:${v.mut};--pg-acc:${v.acc};--pg-acc2:${v.acc2};--pg-grad:${v.grad};--pg-acc-soft:${v.accSoft};--pg-shadow:${v.shadow}}` +
      (dark ? '#pg-overlay,#pg-menu,#pg-launch-menu,#pg-vmenu,#pg-feedbar,.pg-fab-btn{color-scheme:dark}' : '');
  }
  // YouTube cambia el atributo «dark» al cambiar de tema: en modo automático lo seguimos
  new MutationObserver(() => applyTheme()).observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });

  async function refresh() { state = await PG.load(); applyTheme(); $('#pg-launcher')?.remove(); renderGuide(true); safe(updateFab); safe(decorateChannelList, true); const fb = $('#pg-feedbar'); fb && safe(drawFeedBar, fb); }
  chrome.storage.onChanged.addListener(ch => { if (ch.groups || ch.channels || ch.settings) refresh(); });
  // Si en otra pestaña se abre un grupo, se marca algo o se ve un vídeo, los números de esta pestaña también bajan
  let syncT = null;
  chrome.storage.onChanged.addListener(ch => {
    if (!(ch.seen || ch.marks || ch.watched)) return;
    clearTimeout(syncT); syncT = setTimeout(() => quickRecount().catch(() => {}), 400);
  });

  function openManager(hash = '') { chrome.runtime.sendMessage({ type: 'openManager', hash }); }

  // ---------- Barra lateral ----------
  function guideSections() {
    const s = $('ytd-guide-renderer#guide-renderer #sections') || $('ytd-guide-renderer #sections');
    return s && s.getBoundingClientRect().width > 0 && $('tp-yt-app-drawer#guide[opened]') ? s : null;
  }

  function renderGuide(force) {
    try { renderGuideInner(force); } catch (e) { console.error('[YTBox] barra lateral', e); }
    try { updateLauncher(); } catch (e) { console.error('[YTBox] botón superior', e); }
  }

  // Orden de los grupos en la barra lateral. En todos los modos los grupos con vídeos nuevos van arriba:
  // - «Vídeos nuevos» (por defecto): los que tienen más nuevos primero y, el resto, por el último vídeo subido
  // - «Nombre (A-Z / Z-A)»: por nombre (primero los que tienen nuevos)
  // - «Grupos con más canales»: por número de canales (primero los que tienen nuevos)
  // (sidebarSortV = 3: orden elegido con esta versión; los valores antiguos pasan a «Vídeos nuevos»)
  const SORTS = ['new', 'az', 'za', 'channels'];
  const sidebarSortMode = () => (state.settings.sidebarSortV === 3 && SORTS.includes(state.settings.sidebarSort) && state.settings.sidebarSort) || 'new';
  function sortedGroups() {
    const mode = sidebarSortMode();
    const nNew = g => g.muted ? 0 : (newCounts[g.id] || 0);
    const byName = (a, b) => a.g.name.localeCompare(b.g.name, T.locale(), { sensitivity: 'base', numeric: true });
    const byLatest = (a, b) => (groupLatest[b.g.id] || 0) - (groupLatest[a.g.id] || 0);
    const rest = {
      new: byLatest,
      az: byName,
      za: (a, b) => byName(b, a),
      channels: (a, b) => (b.g.channels.length - a.g.channels.length) || byName(a, b),
    }[mode];
    const list = state.groups.map((g, i) => ({ g, i, n: nNew(g) }));
    list.sort((a, b) => {
      if (!!a.n !== !!b.n) return a.n ? -1 : 1;                 // con nuevos, arriba
      if (mode === 'new' && a.n && b.n && a.n !== b.n) return b.n - a.n; // más nuevos, más arriba
      return rest(a, b) || (a.i - b.i);
    });
    // Los grupos fijados van siempre arriba (en el mismo orden entre ellos)
    return list.filter(x => x.g.pinned).concat(list.filter(x => !x.g.pinned)).map(x => x.g);
  }

  function groupRows(container, size, withMenu) {
    // Opción «Mostrar solo los grupos con vídeos nuevos» (solo en el panel lateral)
    const onlyNew = withMenu && state.settings.onlyNewGroups;
    let shown = 0;
    for (const g of sortedGroups()) {
      const n = g.muted ? 0 : (newCounts[g.id] || 0);
      if (onlyNew && !n) continue;
      shown++;
      const more = withMenu ? h('button', { class: 'pg-gmenu-btn', title: T('Opciones del grupo'), 'aria-label': T('Opciones de ') + g.name,
        onclick: e => { e.preventDefault(); e.stopPropagation(); openGroupItemMenu(e.currentTarget, g); } }, '⋮') : null;
      const preview = withMenu && state.settings.previewNewInMenu && n > 0;
      const row = h('a', { class: 'pg-guide-item' + (g.muted ? ' pg-muted' : '') + (withMenu ? ' pg-has-menu' : ''), href: '#',
        ...(preview ? {} : { title: (g.pinned ? '📌 ' : '') + g.name + (g.muted ? T(' · silenciado') : n ? TN(n, ' · {0} vídeo nuevo', ' · {0} vídeos nuevos') : '') }),
        onclick: e => { e.preventDefault(); $('#pg-launch-menu')?.remove(); openGroup(g.id); } },
        PG.iconEl(g, size), h('span', { class: 'pg-guide-name' + (n ? ' pg-has-new' : '') }, g.name),
        g.pinned ? h('span', { class: 'pg-gflag', title: T('Fijado arriba') }, PG.svgEl('chincheta', 14, 'currentColor')) : null,
        g.muted ? h('span', { class: 'pg-gflag', title: T('Silenciado: no muestra novedades') }, PG.svgEl('silencio', 14, 'currentColor')) : null,
        n ? h('span', { class: 'pg-guide-new' }, n > 99 ? '99+' : String(n)) : null,
        more);
      container.append(row);
      if (preview) {
        row.addEventListener('mouseenter', () => schedulePreview(row, g));
        row.addEventListener('mouseleave', () => schedulePreview(null));
      }
    }
    if (onlyNew && !shown && state.groups.length) container.append(h('div', { class: 'pg-guide-empty' }, T('No hay grupos con vídeos nuevos.')))
  }

  // ---------- Previsualizar los vídeos nuevos de un grupo al pasar el ratón (opción de Ajustes) ----------
  let previewT = null, previewFor = null;
  function schedulePreview(row, g) {
    clearTimeout(previewT);
    if (!row) { previewT = setTimeout(() => { if (!$('#pg-gpreview:hover')) closePreview(); }, 250); return; }
    previewT = setTimeout(() => showPreview(row, g), 280);
  }
  function closePreview() { $('#pg-gpreview')?.remove(); previewFor = null; }
  async function newVideosOf(g) {
    const { seen = {}, marks = {}, watched = {} } = await chrome.storage.local.get(['seen', 'marks', 'watched']);
    const since = seen[g.id] || 0, m = marks[g.id] || {};
    const type = state.settings.typeFilter || (state.settings.hideShorts ? 'videos' : 'all');
    const ids = [...new Set(g.channels.map(k => state.channels[k]).filter(c => c && c.id).map(c => c.id))];
    const out = [];
    await pool(ids, 6, async id => {
      let items = [];
      try { items = await fetchRss(id); } catch (e) { return; }
      for (const v of items) {
        const isN = v.vid in m ? m[v.vid] : (since > 0 && v.published.getTime() > since);
        if (isN && !watched[v.vid] && (type === 'all' || (type === 'shorts') === !!v.short)) out.push(v);
      }
    });
    const seenV = new Set();
    return out.filter(v => !seenV.has(v.vid) && seenV.add(v.vid)).sort((a, b) => b.published - a.published);
  }
  async function showPreview(row, g) {
    if (!row.isConnected) return;
    if (previewFor === g.id && $('#pg-gpreview')) return;
    closePreview(); previewFor = g.id;
    const guide = row.closest('#pg-guide') || row;
    const gr = guide.getBoundingClientRect(), rr = row.getBoundingClientRect();
    const list = h('div', { class: 'pg-gp-list' }, h('div', { class: 'pg-gp-loading' }, h('span', { class: 'pg-spin', style: 'display:inline-block' }), T('Cargando…')));
    const panel = h('div', { id: 'pg-gpreview' },
      h('div', { class: 'pg-gp-head' }, PG.iconEl(g, 22), h('b', {}, g.name),
        h('button', { class: 'pg-gp-close', title: T('Cerrar'), 'aria-label': T('Cerrar'), onclick: () => closePreview() }, '✕')),
      list,
      h('div', { class: 'pg-gp-actions' },
        h('button', { class: 'pg-gp-open', onclick: () => { closePreview(); openGroup(g.id); } }, T('Abrir grupo')),
        h('button', { class: 'pg-gp-seen', onclick: async () => { closePreview(); await markGroupSeen(g); } }, T('Marcar como visto'))));
    panel.addEventListener('mouseleave', () => schedulePreview(null));
    panel.addEventListener('mouseenter', () => clearTimeout(previewT));
    // A la derecha de la barra lateral (no tapa el nombre del grupo), a la altura de la fila
    panel.style.left = Math.round(gr.right + 8) + 'px';
    panel.style.top = Math.max(64, Math.round(rr.top - 8)) + 'px';
    document.body.append(panel);
    const fit = () => { const ph = panel.offsetHeight; if (rr.top - 8 + ph > window.innerHeight - 12) panel.style.top = Math.max(64, window.innerHeight - 12 - ph) + 'px'; };
    fit();
    const vids = await newVideosOf(g);
    if (previewFor !== g.id || !panel.isConnected) return;
    const byId = new Map(Object.values(state.channels).filter(c => c.id).map(c => [c.id, c]));
    list.replaceChildren(...(vids.length ? vids.slice(0, 12).map(v => {
      const c = byId.get(v.channelId) || {};
      const url = (v.short ? '/shorts/' : '/watch?v=') + v.vid;
      return h('a', { class: 'pg-gp-item', href: url, onclick: () => closePreview() },
        h('span', { class: 'pg-gp-thumb' }, h('img', { src: `https://i.ytimg.com/vi/${v.vid}/mqdefault.jpg`, loading: 'lazy', alt: '' }),
          v.vid in durations ? h('span', { class: 'pg-dur' }, fmtDuration(durations[v.vid])) : null),
        h('span', { class: 'pg-gp-meta' }, h('span', { class: 'pg-gp-title' }, v.title),
          h('span', { class: 'pg-gp-sub' }, (v.author || c.name || '') + ' · ' + PG.relTime(v.published))));
    }) : [h('div', { class: 'pg-gp-loading' }, T('No hay vídeos nuevos.'))]),
      vids.length > 12 ? h('div', { class: 'pg-gp-more' }, T('y {0} más…', vids.length - 12)) : '');
    fit();
  }
  window.addEventListener('scroll', e => { const p = $('#pg-gpreview'); if (p && !(e.target instanceof Node && p.contains(e.target))) closePreview(); }, true);

  // Menú ⋮ de cada grupo en la barra lateral
  async function markGroupSeen(g) {
    const { seen = {}, marks = {} } = await chrome.storage.local.get(['seen', 'marks']);
    seen[g.id] = Date.now();
    const m = marks[g.id]; if (m) for (const k of Object.keys(m)) if (m[k] === true) delete m[k];
    newCounts[g.id] = 0;
    await chrome.storage.local.set({ seen, marks });
    renderGuide(true); saveCountsCache(); quickRecount().catch(() => {});
    toast(T('«{0}» marcado como leído', g.name));
  }
  function openGroupItemMenu(btn, g) {
    const old = $('#pg-menu');
    if (old) { old.remove(); if (old.dataset.kind === 'g-' + g.id) return; }
    const setFlag = async (key, val, msg) => {
      menu.remove();
      const gg = state.groups.find(x => x.id === g.id); if (!gg) return;
      if (val) gg[key] = true; else delete gg[key];
      await PG.save({ groups: state.groups });
      quickRecount().catch(() => {});
      toast(msg);
    };
    const item = (icon, label, fn) => h('button', { class: 'pg-vitem', onclick: fn }, h('span', { class: 'pg-vicon' }, PG.svgEl(icon, 18, 'currentColor')), h('span', {}, label));
    const menu = h('div', { id: 'pg-menu', 'data-kind': 'g-' + g.id },
      h('div', { class: 'pg-vlabel' }, g.name),
      item('check', T('Marcar como leído'), async () => { menu.remove(); await markGroupSeen(g); }),
      item('chincheta', g.pinned ? T('Quitar de arriba') : T('Fijar arriba'), () => setFlag('pinned', !g.pinned, g.pinned ? T('«{0}» ya no está fijado', g.name) : T('«{0}» fijado arriba', g.name))),
      item(g.muted ? 'campana' : 'silencio', g.muted ? T('Activar novedades') : T('Silenciar'), () => setFlag('muted', !g.muted, g.muted ? T('«{0}» vuelve a mostrar novedades', g.name) : T('«{0}» silenciado: no mostrará novedades hasta que lo actives', g.name))),
      h('div', { class: 'pg-vsep' }),
      item('lapiz', T('Editar'), () => { menu.remove(); openManager('group=' + g.id); }));
    document.body.append(menu);
    const r = btn.getBoundingClientRect();
    menu.style.top = Math.min(window.innerHeight - menu.offsetHeight - 8, r.bottom + 4) + 'px';
    menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, r.right - menu.offsetWidth)) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function close(e) {
      if (!menu.contains(e.target) && e.target !== btn) { menu.remove(); document.removeEventListener('mousedown', close); }
    }), 0);
  }

  // Menú ⋮ de la cabecera de la barra lateral
  function openGuideMenu(btn) {
    const old = $('#pg-menu');
    if (old) { old.remove(); if (old.dataset.kind === 'guide') return; }
    const mode = sidebarSortMode();
    const setSort = async v => { menu.remove(); state.settings.sidebarSort = v; state.settings.sidebarSortV = 3; await PG.save({ settings: state.settings }); };
    const opt = (v, label) => h('button', { class: 'pg-vitem' + (mode === v ? ' on' : ''), onclick: () => setSort(v) },
      h('span', { class: 'pg-vcheck' }, mode === v ? '✓' : ''), h('span', {}, label));
    const menu = h('div', { id: 'pg-menu', 'data-kind': 'guide' },
      h('button', { class: 'pg-vitem', onclick: async () => { menu.remove(); await markAllSeen(); } },
        h('span', { class: 'pg-vicon' }, PG.svgEl('check', 18, 'currentColor')), h('span', {}, T('Marcar todo como visto'))),
      h('button', { class: 'pg-vitem', onclick: () => { menu.remove(); updateNewCounts(true); } },
        h('span', { class: 'pg-vicon' }, PG.svgEl('recargar', 18, 'currentColor')), h('span', {}, T('Buscar vídeos nuevos ahora'))),
      h('div', { class: 'pg-vsep' }),
      h('div', { class: 'pg-vlabel' }, T('Ordenar por')),
      opt('new', T('Vídeos nuevos')), opt('az', T('Nombre (A-Z)')), opt('za', T('Nombre (Z-A)')), opt('channels', T('Grupos con más canales')));
    document.body.append(menu);
    const r = btn.getBoundingClientRect();
    menu.style.top = (r.bottom + 6) + 'px';
    menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, r.left)) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function close(e) {
      if (!menu.contains(e.target) && e.target !== btn) { menu.remove(); document.removeEventListener('mousedown', close); }
    }), 0);
  }

  // Todos los grupos quedan al día: lo publicado hasta ahora deja de contar como nuevo
  async function markAllSeen() {
    const now = Date.now();
    const { seen = {}, marks = {} } = await chrome.storage.local.get(['seen', 'marks']);
    for (const g of state.groups) {
      seen[g.id] = now;
      const m = marks[g.id];
      if (m) for (const k of Object.keys(m)) if (m[k] === true) delete m[k];
      newCounts[g.id] = 0;
    }
    newTotal = 0;
    await chrome.storage.local.set({ seen, marks });
    renderGuide(true);
    saveCountsCache();
    toast(T('Todo marcado como visto'));
  }

  // ---------- Novedades por grupo (para la barra lateral) ----------
  const newCounts = {};
  const groupLatest = {}; // groupId -> ms del último vídeo subido por sus canales
  let countingAt = 0;
  // Los últimos números se guardan para pintarlos al instante al cargar YouTube
  const saveCountsCache = () => chrome.storage.local.set({ newCountsCache: { t: Date.now(), counts: Object.assign({}, newCounts), total: newTotal, latest: Object.assign({}, groupLatest) } }).catch(() => {});
  chrome.storage.local.get('newCountsCache').then(({ newCountsCache: c }) => {
    if (!c || Date.now() - c.t > 12 * 3600e3 || countingAt) return;
    Object.assign(newCounts, c.counts || {}); newTotal = c.total || 0; Object.assign(groupLatest, c.latest || {});
    renderGuide(true);
  }).catch(() => {});

  // Cualquier RSS leído (al abrir un grupo, «Nuevos vídeos», el recuento…) actualiza también los contadores
  const pendingLite = {};
  let feedSyncTimer = null;
  function feedUpdated(id, items) {
    lastFeed[id] = items;
    pendingLite[id] = { t: Date.now(), v: items.map(v => [v.vid, v.published.getTime(), v.short ? 1 : 0]) };
    clearTimeout(feedSyncTimer);
    feedSyncTimer = setTimeout(async () => {
      try {
        const { feedLite = {} } = await chrome.storage.local.get('feedLite');
        Object.assign(feedLite, pendingLite); for (const k in pendingLite) delete pendingLite[k];
        await chrome.storage.local.set({ feedLite });
        await quickRecount();
      } catch (e) { console.warn('[YTBox] contadores', e); }
    }, 1200);
  }

  // Cálculo de los números a partir de lo leído (sin descargar nada)
  let lastFeed = {}; // channelId -> [{ vid, published, short }]
  function computeCounts(feed, seen, marks, watched) {
    const type = state.settings.typeFilter || (state.settings.hideShorts ? 'videos' : 'all');
    const typeOk = v => type === 'all' || (type === 'shorts') === !!v.short;
    const allNew = new Set();
    for (const g of state.groups) {
      // Fecha del vídeo más reciente del grupo (para ordenar la barra lateral)
      let latest = 0;
      for (const k of g.channels) { const c = state.channels[k]; for (const v of (c && feed[c.id]) || []) if (typeOk(v)) latest = Math.max(latest, v.published.getTime()); }
      if (latest) groupLatest[g.id] = latest;
      const since = seen[g.id];
      if (!since || g.muted) { newCounts[g.id] = 0; continue; } // silenciado: sin novedades
      const m = marks[g.id] || {};
      let n = 0;
      for (const k of g.channels) {
        const c = state.channels[k];
        for (const v of (c && feed[c.id]) || []) {
          const isN = v.vid in m ? m[v.vid] : v.published.getTime() > since;
          if (isN && !watched[v.vid] && typeOk(v)) { n++; allNew.add(v.vid); }
        }
      }
      newCounts[g.id] = n;
    }
    newTotal = allNew.size;
    renderGuide(true);
  }
  const liteToFeed = feedLite => Object.fromEntries(Object.entries(feedLite || {}).map(([id, f]) => [id, (f.v || []).map(([vid, ms, short]) => ({ vid, published: new Date(ms), short: !!short }))]));
  // Recalcular ya (al entrar en un grupo, ver un vídeo, marcar…): usa lo ya leído, nunca espera descargas
  async function quickRecount() {
    const { seen = {}, marks = {}, watched = {}, feedLite = {} } = await chrome.storage.local.get(['seen', 'marks', 'watched', 'feedLite']);
    computeCounts(Object.assign(liteToFeed(feedLite), lastFeed), seen, marks, watched);
    saveCountsCache();
  }

  // Recuento completo: vuelve a leer los RSS (cada 15 min como mucho)
  let counting = null;
  function updateNewCounts(force) {
    if (counting) return counting;
    const t0 = Date.now();
    counting = updateNewCountsNow(force).catch(e => console.warn('[YTBox] contadores', e)).finally(() => {
      counting = null;
      // El icono gira al menos un momento, para que se note que ha comprobado
      setTimeout(() => document.querySelectorAll('.pg-reload').forEach(b => b.classList.remove('pg-busy')), Math.max(0, 700 - (Date.now() - t0)));
    });
    document.querySelectorAll('.pg-reload').forEach(b => b.classList.add('pg-busy'));
    return counting;
  }
  async function updateNewCountsNow(force) {
    if (!force && Date.now() - countingAt < 15 * 60 * 1000) return;
    countingAt = Date.now();
    if (force) rssCache.clear();
    const { seen = {}, feedLite = {} } = await chrome.storage.local.get(['seen', 'feedLite']);
    // Un grupo que nunca se ha abierto empieza a contar novedades desde ahora
    const unseen = state.groups.filter(g => !seen[g.id]);
    if (unseen.length) { unseen.forEach(g => seen[g.id] = Date.now()); await chrome.storage.local.set({ seen }); }
    const ids = new Set();
    for (const g of state.groups) g.channels.forEach(k => { const c = state.channels[k]; c && c.id && ids.add(c.id); });
    // Lo leído en los últimos 10 min (en esta pestaña u otra) no se vuelve a pedir
    const toFetch = [];
    for (const id of ids) {
      const f = feedLite[id];
      if (!force && f && Date.now() - f.t < 10 * 60 * 1000) lastFeed[id] = liteToFeed({ [id]: f })[id]; // con el botón recargar se vuelven a pedir todos
      else toFetch.push(id);
    }
    await quickRecount();
    // Mientras se leen los canales, los números se van actualizando (sin esperar a todos)
    let dirty = false;
    const tick = setInterval(() => { if (dirty) { dirty = false; quickRecount().catch(() => {}); } }, 1200);
    try {
      await pool(toFetch, 8, async id => {
        const items = await fetchRss(id); // fetchRss ya los apunta en lastFeed
        dirty = true;
        feedLite[id] = { t: Date.now(), v: items.map(v => [v.vid, v.published.getTime(), v.short ? 1 : 0]) };
      });
    } finally { clearInterval(tick); }
    for (const id of Object.keys(feedLite)) if (!ids.has(id)) delete feedLite[id];
    await chrome.storage.local.set({ feedLite }).catch(() => {});
    await quickRecount();
  }

  // Botón de YTBox en la barra superior de YouTube (junto a «Crear» y las notificaciones):
  // siempre visible, abre la lista de grupos. Sustituye al antiguo botón flotante.
  // Misma flechita a la derecha en Modo TV, Descubrir y Nuevos vídeos
  const goArrow = () => h('span', { class: 'pg-tv-top-go' }, PG.svgEl('chevron', 16, 'currentColor'));

  // Acceso al modo Descubrir (barra lateral y desplegable superior)
  function discoverEntry(cls, px, inGuide, close) {
    const ico = h('span', { class: 'pg-tv-top-ico pg-disc-ico' }, PG.svgEl('brujula', px, '#ffffff'));
    return h('a', { class: cls + ' pg-disc-entry', href: '#', title: T('Descubrir canales parecidos a los tuyos'), onclick: e => { e.preventDefault(); close && close(); openDiscover(); } },
      inGuide ? h('span', { class: 'pg-guide-logo' }, ico) : ico, h('span', { class: 'pg-guide-name' }, T('Descubrir')), goArrow());
  }

  // Acceso a «Nuevos vídeos» (todos los nuevos de todos los grupos)
  let newTotal = 0;
  function newVideosEntry(cls, px, inGuide, close) {
    const ico = h('span', { class: 'pg-tv-top-ico' }, PG.svgEl('nuevos', px, '#ffffff'));
    return h('a', { class: cls + ' pg-new-entry', href: '#', title: newTotal ? T('{0} vídeos nuevos en tus grupos', newTotal) : T('Todos los vídeos nuevos de tus grupos'),
      onclick: e => { e.preventDefault(); close && close(); openGroup(NEW_ID); } },
      inGuide ? h('span', { class: 'pg-guide-logo' }, ico) : ico, h('span', { class: 'pg-guide-name' }, T('Nuevos vídeos')),
      newTotal ? h('span', { class: 'pg-guide-count' }, String(newTotal)) : goArrow());
  }

  // Preconfiguraciones del Modo TV como accesos directos (un clic = ver)
  // Fila «Modo TV» + sus preconfiguraciones plegadas en un desplegable (▸ 2 / ▾ 2)
  function tvBlock(cls, px, inGuide, close) {
    const presets = YTBoxTV.presets(state);
    const ico = h('span', { class: 'pg-tv-top-ico' }, PG.svgEl('tv', px, '#ffffff'));
    const list = h('div', { class: 'pg-tv-presets-box' }, ...tvPresetRows(close));
    let open = !!state.settings.tvPresetsOpen;
    const caret = h('button', { class: 'pg-tv-caret', title: T('Mostrar u ocultar tus preconfiguraciones'), 'aria-label': T('Preconfiguraciones del Modo TV') });
    const paint = () => { list.style.display = open ? '' : 'none'; caret.textContent = `${open ? '▾' : '▸'} ${presets.length}`; caret.setAttribute('aria-expanded', String(open)); };
    caret.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      open = !open; paint();
      state.settings.tvPresetsOpen = open; PG.save({ settings: state.settings });
    });
    paint();
    const row = h('a', { class: cls, href: '#', title: T('Modo TV: lista aleatoria de tus canales'), onclick: e => { e.preventDefault(); close && close(); openTV(); } },
      inGuide ? h('span', { class: 'pg-guide-logo' }, ico) : ico, h('span', { class: 'pg-guide-name' }, T('Modo TV')),
      presets.length ? caret : goArrow());
    return presets.length ? [row, list] : [row];
  }

  function tvPresetRows(close) {
    return YTBoxTV.presets(state).map(p => h('a', { class: 'pg-guide-item pg-tv-preset-row', href: '#', title: T('Preparar la lista: ') + YTBoxTV.summary(p.cfg, state),
      onclick: e => { e.preventDefault(); close && close(); openTV(p.id, 'preview'); } },
      h('span', { class: 'pg-tv-preset-dot' }, '▶'), h('span', { class: 'pg-guide-name' }, p.name)));
  }

  function openTopMenu(btn) {
    const old = $('#pg-launch-menu'); if (old) { old.remove(); return; }
    const m = h('div', { id: 'pg-launch-menu' }, h('div', { class: 'pg-menu-head' }, appLogo(20), h('div', { class: 'pg-menu-title' }, T('YTBox · Grupos'))));
    // Acceso directo al Modo TV, arriba del todo
    m.append(...tvBlock('pg-guide-item pg-tv-top', 18, false, () => m.remove()),
      discoverEntry('pg-guide-item pg-tv-top', 18, false, () => m.remove()),
      newVideosEntry('pg-guide-item pg-tv-top', 18, false, () => m.remove()),
      h('div', { class: 'pg-vsep' }),
      h('a', { class: 'pg-guide-item', href: '#', onclick: e => { e.preventDefault(); m.remove(); openManager('settings'); } }, h('span', { class: 'pg-launch-ico' }, PG.svgEl('engranaje', 18, 'currentColor')), h('span', { class: 'pg-guide-name' }, T('Ajustes de YTBox'))),
      h('div', { class: 'pg-vsep' }));
    if (!state.groups.length) m.append(h('div', { class: 'pg-menu-empty' }, T('Aún no tienes grupos.')));
    groupRows(m, 24);
    m.append(h('div', { class: 'pg-vsep' }),
      h('a', { class: 'pg-guide-item', href: '#', onclick: e => { e.preventDefault(); m.remove(); markAllSeen(); } }, h('span', { class: 'pg-launch-ico' }, PG.svgEl('check', 18, 'currentColor')), h('span', { class: 'pg-guide-name' }, T('Marcar todo como visto'))),
      h('a', { class: 'pg-guide-item', href: '#', onclick: e => { e.preventDefault(); m.remove(); openManager('groups'); } }, h('span', { class: 'pg-launch-ico' }, PG.svgEl('engranaje', 18, 'currentColor')), h('span', { class: 'pg-guide-name' }, T('Gestionar grupos'))));
    document.body.append(m);
    const r = btn.getBoundingClientRect();
    m.style.top = (r.bottom + 8) + 'px';
    m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth)) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function close(e) {
      if (!m.contains(e.target) && !btn.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', close); }
    }), 0);
  }

  function updateLauncher() {
    const end = $('ytd-masthead #end');
    let l = $('#pg-launcher');
    if (!end) { l && l.remove(); return; }
    if (!l || !end.contains(l)) {
      l && l.remove();
      l = h('button', { id: 'pg-launcher', title: T('YTBox: tus grupos'), 'aria-label': T('YTBox: tus grupos') }, appLogo(24), h('span', { class: 'pg-launch-badge' }));
      l.addEventListener('click', e => { e.stopPropagation(); openTopMenu(l); });
      end.insertBefore(l, end.firstChild);
    }
    // Mismo número que «Nuevos vídeos»: cada vídeo nuevo cuenta una vez aunque su canal esté en varios grupos
    const total = newTotal;
    const badge = l.querySelector('.pg-launch-badge');
    badge.textContent = total ? (total > 99 ? '99+' : String(total)) : '';
    badge.style.display = total ? '' : 'none';
    l.title = total ? TN(total, 'YTBox: {0} vídeo nuevo', 'YTBox: {0} vídeos nuevos') : T('YTBox: tus grupos');
  }

  function renderGuideInner(force) {
    const sections = guideSections();
    if (!sections) return;
    let box = $('#pg-guide', sections);
    if (box && !force) return;
    if (!box) {
      box = h('div', { id: 'pg-guide' });
      const first = sections.firstElementChild;
      first ? first.after(box) : sections.prepend(box);
    }
    box.replaceChildren();
    const open = state.settings.sidebarOpen !== false;
    const moreBtn = h('button', { class: 'pg-guide-btn', title: T('Más opciones'), 'aria-label': T('Más opciones'), onclick: e => { e.stopPropagation(); openGuideMenu(moreBtn); } }, '⋮');
    box.append(h('div', { class: 'pg-guide-head' },
      h('span', { class: 'pg-guide-logo' }, appLogo(20)),
      h('button', { class: 'pg-guide-title', title: open ? T('Ocultar grupos') : T('Mostrar grupos'), onclick: async () => {
        state.settings.sidebarOpen = !open; await PG.save({ settings: state.settings });
      } }, h('span', {}, 'YTBox'), h('span', { class: 'pg-guide-caret' }, open ? '▾' : '▸')),
      h('span', { class: 'pg-guide-actions' },
        h('button', { class: 'pg-guide-btn', title: T('Nuevo grupo'), 'aria-label': T('Nuevo grupo'), onclick: () => openManager('new') }, '+'),
        h('button', { class: 'pg-guide-btn', title: T('Ajustes de YTBox'), 'aria-label': T('Ajustes de YTBox'), onclick: () => openManager('settings') }, '⚙'),
        moreBtn),
    ));
    if (!open) return;
    // Modo TV, arriba del todo (se oculta junto con la lista al plegar YTBox)
    box.append(...tvBlock('pg-guide-item pg-tv-entry', 16, true),
      discoverEntry('pg-guide-item pg-tv-entry', 16, true),
      newVideosEntry('pg-guide-item pg-tv-entry', 16, true),
      h('div', { class: 'pg-guide-sep' }));
    if (!state.groups.length) {
      box.append(h('div', { class: 'pg-guide-empty' }, T('Aún no tienes grupos. '), h('a', { href: '#', onclick: e => { e.preventDefault(); openManager('new'); } }, T('Crear uno'))));
    }
    groupRows(box, 24, true);
  }

  // ---------- Botón flotante "Añadir a grupo" ----------
  function currentChannelRef() {
    const p = location.pathname;
    if (/^\/(@[^/]+|channel\/UC[\w-]{22}|c\/[^/]+|user\/[^/]+)/.test(p)) {
      const key = PG.keyFromHref(p);
      const name = ($('yt-page-header-renderer h1, #channel-header #channel-name #text, ytd-channel-name#channel-name #text') || {}).textContent;
      return { href: p, key, name: name && name.trim() };
    }
    if (p === '/watch') {
      const a = $('ytd-watch-metadata #owner ytd-channel-name a, ytd-video-owner-renderer ytd-channel-name a, ytd-video-owner-renderer a');
      if (a) return { href: a.getAttribute('href'), key: PG.keyFromHref(a.href), name: a.textContent.trim() };
    }
    return null;
  }

  function findChannelByKey(key) {
    if (!key) return null;
    if (state.channels[key]) return state.channels[key];
    return Object.values(state.channels).find(c => c.id === key || c.handle === key) || null;
  }
  // Todas las entradas guardadas que son el mismo canal (por clave, id o @usuario): un canal importado
  // por id y otro añadido por @usuario cuentan como el mismo
  function channelAliases(key) {
    const names = new Set([key]);
    for (let round = 0; round < 2; round++) {
      for (const c of Object.values(state.channels)) {
        if ([c.key, c.id, c.handle].some(x => x && names.has(x))) [c.key, c.id, c.handle].forEach(x => x && names.add(x));
      }
    }
    return Object.values(state.channels).filter(c => [c.key, c.id, c.handle].some(x => x && names.has(x)));
  }
  function groupsOfChannel(key) {
    const keys = new Set(channelAliases(key).map(c => c.key));
    return state.groups.filter(g => g.channels.some(k => keys.has(k)));
  }
  // Si la página solo da el @usuario y no lo reconocemos, preguntamos su id a YouTube (una vez por canal)
  // y lo apuntamos en el canal guardado, así la próxima vez se reconoce al momento
  const handleLookups = new Map();
  function learnHandle(handle) {
    if (!handle || !handle.startsWith('@') || handleLookups.has(handle)) return;
    if (!Object.values(state.channels).some(c => c.id && c.handle !== handle)) return;
    handleLookups.set(handle, YTAPI.resolveHandle(handle).then(async id => {
      if (!id) return;
      const same = Object.values(state.channels).filter(c => c.id === id && c.handle !== handle);
      if (!same.length) return;
      same.forEach(c => { c.handle = handle; });
      await PG.save({ channels: state.channels });
    }).catch(e => console.warn('[YTBox] resolver', handle, e)));
  }

  // Selector de grupos junto al botón «Suscribirse» (en el vídeo y en la página del canal), como PocketTube.
  // Si YouTube cambia su página y no encontramos dónde ponerlo, se usa el botón flotante de antes.
  let fab;
  function channelButtonSlot() {
    if (location.pathname === '/watch') {
      const owner = $('ytd-watch-metadata #owner');
      const sub = owner && $('#subscribe-button', owner);
      return sub ? { parent: owner, after: sub } : null;
    }
    const actions = $('yt-page-header-view-model yt-flexible-actions-view-model, yt-page-header-renderer yt-flexible-actions-view-model, #page-header yt-flexible-actions-view-model');
    if (actions) return { parent: actions, after: null };
    const old = $('ytd-c4-tabbed-header-renderer #buttons, #channel-header #buttons');
    return old ? { parent: old, after: null } : null;
  }

  function updateFab() {
    const ref = currentChannelRef();
    const inline = $('#pg-chbtn');
    if (!ref || !ref.key) { fab && fab.remove(); fab = null; inline && inline.remove(); return; }
    const inGroups = groupsOfChannel(ref.key);
    if (!inGroups.length) learnHandle(ref.key);
    const sig = ref.key + '|' + inGroups.map(g => g.id + g.color + JSON.stringify(g.icon)).join(',');
    const slot = channelButtonSlot();
    if (slot) {
      fab && fab.remove(); fab = null;
      let btn = inline;
      const placed = btn && btn.parentElement === slot.parent && (!slot.after || btn.previousElementSibling === slot.after);
      if (!placed) {
        btn && btn.remove();
        btn = h('button', { id: 'pg-chbtn', class: 'pg-chbtn' });
        btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); toggleMenu(currentChannelRef() || ref, btn); });
        if (slot.after) slot.after.after(btn); else slot.parent.append(btn);
        btn.dataset.sig = '';
      }
      if (btn.dataset.sig !== sig) {
        btn.dataset.sig = sig;
        btn.classList.toggle('on', inGroups.length > 0);
        btn.title = inGroups.length ? T('En YTBox: ') + inGroups.map(g => g.name).join(', ') : T('Añadir este canal a un grupo de YTBox');
        btn.setAttribute('aria-label', btn.title);
        btn.replaceChildren(...(inGroups.length
          ? [h('span', { class: 'pg-chbtn-icons' }, inGroups.slice(0, 3).map(g => PG.iconEl(g, 20))), inGroups.length > 3 ? h('span', { class: 'pg-chbtn-more' }, '+' + (inGroups.length - 3)) : null]
          : [appLogo(20), h('span', { class: 'pg-chbtn-plus' }, '+')]).filter(Boolean));
      }
      return;
    }
    inline && inline.remove();
    if (!fab) { fab = h('div', { id: 'pg-fab' }); document.body.append(fab); }
    fab.replaceChildren(h('button', { class: 'pg-fab-btn', onclick: () => toggleMenu(ref) },
      inGroups.length ? h('span', { class: 'pg-fab-icons' }, inGroups.slice(0, 3).map(g => PG.iconEl(g, 18))) : appLogo(18),
      inGroups.length ? TN(inGroups.length, ' En {0} grupo', ' En {0} grupos') : T(' Añadir a grupo')));
    fab.dataset.key = ref.key;
  }

  async function ensureStoredChannel(ref) {
    let ch = findChannelByKey(ref.key);
    if (ch) return ch;
    const r = await PG.resolveChannel(ref.href);
    ch = findChannelByKey(r.key) || findChannelByKey(r.id);
    if (ch) {
      if (!ch.handle && r.handle) { ch.handle = r.handle; ch.avatar = ch.avatar || r.avatar; if (ch.name === ch.id) ch.name = r.name; await PG.save({ channels: state.channels }); }
      return ch;
    }
    ch = { key: r.key, id: r.id, handle: r.handle, name: ref.name || r.name, avatar: r.avatar };
    state.channels[ch.key] = ch;
    await PG.save({ channels: state.channels });
    return ch;
  }

  function toggleMenu(ref, anchor) {
    const old = $('#pg-menu');
    if (old) { old.remove(); return; }
    const menu = h('div', { id: 'pg-menu' });
    const host = anchor || fab;
    const r = host.getBoundingClientRect();
    menu.style.top = Math.min(window.innerHeight - 20, r.bottom + 6) + 'px';
    menu.style.left = Math.max(8, Math.min(window.innerWidth - 290, r.left)) + 'px';
    if (!anchor) { menu.style.top = ''; menu.style.bottom = (window.innerHeight - r.top + 8) + 'px'; menu.style.left = ''; menu.style.right = '24px'; }
    const aliasKeys = () => new Set(channelAliases(ref.key).map(c => c.key));
    const inNow = new Set(groupsOfChannel(ref.key).map(g => g.id));
    menu.append(h('div', { class: 'pg-menu-title' }, ref.name || ref.key));
    if (!state.groups.length) menu.append(h('div', { class: 'pg-menu-empty' }, T('No hay grupos todavía.')));
    for (const g of state.groups) {
      const cb = h('input', { type: 'checkbox' }); cb.checked = inNow.has(g.id);
      menu.append(h('label', { class: 'pg-menu-item' }, cb, PG.iconEl(g, 20), h('span', {}, g.name)));
      cb.addEventListener('change', async () => {
        cb.disabled = true;
        try {
          const c = await ensureStoredChannel(ref);
          const grp = state.groups.find(x => x.id === g.id);
          const keys = aliasKeys(); keys.add(c.key);
          if (cb.checked) { if (!grp.channels.some(k => keys.has(k))) grp.channels.push(c.key); }
          else grp.channels = grp.channels.filter(k => !keys.has(k));
          await PG.save({ groups: state.groups });
        } catch (e) { alert('YTBox: ' + e.message); cb.checked = !cb.checked; }
        cb.disabled = false;
      });
    }
    const input = h('input', { type: 'text', placeholder: T('Nuevo grupo…'), class: 'pg-menu-new' });
    input.addEventListener('keydown', async e => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      e.stopPropagation();
      const c = await ensureStoredChannel(ref);
      state.groups.push({ id: PG.uid(), name: input.value.trim(), icon: { type: 'emoji', value: '📁' }, color: '#ff6347', channels: [c.key] });
      await PG.save({ groups: state.groups });
      menu.remove();
    });
    input.addEventListener('keyup', e => e.stopPropagation());
    input.addEventListener('keypress', e => e.stopPropagation());
    menu.append(input);
    document.body.append(menu);
    // Que el menú quepa en pantalla: si no cabe debajo del botón, se abre hacia arriba
    if (anchor) {
      const ar = anchor.getBoundingClientRect(), mh = menu.offsetHeight;
      const below = window.innerHeight - ar.bottom - 12, above = ar.top - 12;
      const cap = Math.round(window.innerHeight * 0.6); // nunca más del 60 % de la pantalla: con muchos grupos, scroll propio
      if (mh > below && above > below) { const hh = Math.min(above, cap); menu.style.top = Math.max(8, ar.top - 6 - Math.min(mh, hh)) + 'px'; menu.style.maxHeight = hh + 'px'; }
      else { menu.style.top = (ar.bottom + 6) + 'px'; menu.style.maxHeight = Math.min(below, cap) + 'px'; }
    }
    setTimeout(() => document.addEventListener('mousedown', function close(e) {
      if (!menu.contains(e.target) && !host.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close); }
    }), 0);
  }

  // ---------- Página de suscripciones (/feed/channels) ----------
  function collectVisibleChannels() {
    const found = [];
    for (const r of $$('ytd-channel-renderer')) {
      const a = $('a#main-link, a.channel-link, a[href^="/@"], a[href^="/channel/"]', r);
      const key = a && PG.keyFromHref(a.href);
      if (!key) continue;
      const name = ($('#channel-title #text, ytd-channel-name #text, #text', r) || {}).textContent;
      const img = $('#avatar img, yt-img-shadow img, img', r);
      found.push({ key, handle: key.startsWith('@') ? key : null, id: key.startsWith('UC') ? key : null, name: (name || key).trim(), avatar: img && img.src && !img.src.startsWith('data:') ? img.src : '' });
    }
    // También la lista de suscripciones de la barra lateral
    for (const a of $$('ytd-guide-section-renderer ytd-guide-entry-renderer a#endpoint[href]')) {
      const key = PG.keyFromHref(a.href);
      if (!key || found.some(f => f.key === key)) continue;
      const img = $('img', a);
      found.push({ key, handle: key.startsWith('@') ? key : null, id: key.startsWith('UC') ? key : null, name: (a.getAttribute('title') || $('.title', a)?.textContent || key).trim(), avatar: img && img.src && !img.src.startsWith('data:') ? img.src : '' });
    }
    return found;
  }

  async function importChannels(list) {
    let added = 0;
    for (const c of list) {
      const ex = findChannelByKey(c.key);
      if (ex) { if (!ex.avatar && c.avatar) ex.avatar = c.avatar; continue; }
      state.channels[c.key] = c; added++;
    }
    await PG.save({ channels: state.channels });
    return added;
  }

  async function importAll(btn) {
    btn.disabled = true;
    let last = -1, same = 0;
    while (same < 4) {
      const n = $$('ytd-channel-renderer').length;
      btn.textContent = T('Cargando suscripciones… ({0})', n);
      if (n === last) same++; else { same = 0; last = n; }
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise(r => setTimeout(r, 900));
    }
    const added = await importChannels(collectVisibleChannels());
    window.scrollTo(0, 0);
    btn.textContent = T('✔ {0} canales leídos, {1} nuevos. Ve al gestor para organizarlos', last, added);
    btn.disabled = false;
    btn.onclick = () => openManager('channels');
  }

  function decorateChannelList(force) {
    if (location.pathname !== '/feed/channels') { $('#pg-import-bar')?.remove(); return; }
    if (!$('#pg-import-bar')) {
      const btn = h('button', { class: 'pg-import-btn' }, T('📥 Importar todas mis suscripciones a YTBox'));
      btn.onclick = () => importAll(btn);
      const bar = h('div', { id: 'pg-import-bar' }, btn, h('button', { class: 'pg-import-btn pg-secondary', onclick: () => openManager('channels') }, T('Abrir gestor')));
      document.body.append(bar);
    }
    for (const r of $$('ytd-channel-renderer')) {
      let b = $('.pg-ch-btn', r);
      const a = $('a#main-link, a[href^="/@"], a[href^="/channel/"]', r);
      const key = a && PG.keyFromHref(a.href);
      if (!key) continue;
      if (!b) {
        b = h('button', { class: 'pg-ch-btn', title: T('Añadir a grupo') });
        b.addEventListener('click', e => {
          e.preventDefault(); e.stopPropagation();
          const name = ($('#channel-title #text, ytd-channel-name #text', r) || {}).textContent;
          toggleMenu({ href: a.getAttribute('href'), key, name: name && name.trim() }, b);
        });
        ($('#buttons', r) || r).prepend(b);
      } else if (!force) continue;
      const gs = groupsOfChannel(key);
      b.replaceChildren(...(gs.length ? gs.slice(0, 4).map(g => PG.iconEl(g, 18)) : ['📁 +']));
    }
  }

  // ---------- Vista de grupo (feed propio vía RSS) ----------
  async function fetchRss(id) {
    const c = rssCache.get(id);
    if (c && Date.now() - c.t < 10 * 60 * 1000) return c.items;
    // Máximo 12 s: una petición colgada no puede bloquear nada
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 12000);
    let res;
    try { res = await PG.fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + id, { credentials: 'include', signal: ctrl.signal }); }
    finally { clearTimeout(to); }
    if (!res.ok || res.url.includes('consent.')) throw new Error('RSS ' + res.status);
    const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
    const items = Array.from(xml.getElementsByTagName('entry')).map(e => {
      const g = (n) => e.getElementsByTagName(n)[0];
      const vid = g('yt:videoId')?.textContent;
      const link = g('link')?.getAttribute('href') || '';
      return {
        vid, channelId: id,
        title: g('title')?.textContent || '',
        author: e.getElementsByTagName('author')[0]?.getElementsByTagName('name')[0]?.textContent || '',
        published: new Date(g('published')?.textContent),
        views: g('media:statistics')?.getAttribute('views'),
        short: link.includes('/shorts/'),
        desc: (g('media:description')?.textContent || '').trim(),
      };
    });
    rssCache.set(id, { t: Date.now(), items });
    feedUpdated(id, items);
    return items;
  }

  async function pool(list, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
      while (i < list.length) { const k = i++; try { await fn(list[k], k); } catch (e) { console.warn('[YTBox]', e); } }
    }));
  }

  let overlay, overlayGroupId, overlayUrl;
  function closeOverlay() { overlay?.remove(); overlay = null; overlayGroupId = null; document.documentElement.classList.remove('pg-noscroll'); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay) closeOverlay(); });
  // Si navegas por YouTube (Inicio, Suscripciones, un vídeo…) se cierra la vista de grupo
  document.addEventListener('yt-navigate-start', () => closeOverlay());
  window.addEventListener('popstate', () => closeOverlay());
  document.addEventListener('yt-navigate-finish', () => { if (overlay && location.href !== overlayUrl) closeOverlay(); });
  // Cualquier clic en la barra lateral o la cabecera de YouTube también la cierra
  document.addEventListener('click', e => {
    if (!overlay || overlay.contains(e.target)) return;
    if (e.target.closest('#pg-guide, #pg-launcher, #pg-launch-menu, #pg-menu, #pg-fab, #pg-chbtn')) return;
    if (e.target.closest('a[href], ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer, #logo')) closeOverlay();
  }, true);

  function positionOverlay() {
    if (!overlay) return;
    const guide = $('tp-yt-app-drawer#guide[opened] #contentContainer, ytd-mini-guide-renderer[mini-guide-visible]');
    let left = 0;
    if (guide) { const r = guide.getBoundingClientRect(); if (r.width > 0 && r.right < window.innerWidth / 2) left = r.right; }
    const mast = $('#masthead-container');
    let top = mast ? mast.getBoundingClientRect().bottom : 56;
    overlay.style.left = left + 'px';
    overlay.style.top = top + 'px';
    // Si alguna barra fija de YouTube sigue tapando la cabecera del grupo, bajamos la vista
    const w = window.innerWidth - left;
    for (const fx of [0.25, 0.5, 0.75]) {
      const el = document.elementFromPoint(left + w * fx, top + 12);
      if (!el || overlay.contains(el) || el.closest('#pg-fab, #pg-launcher, #pg-menu, #pg-launch-menu')) continue;
      let n = el;
      while (n && n !== document.body && getComputedStyle(n).position !== 'fixed' && getComputedStyle(n).position !== 'sticky') n = n.parentElement;
      const b = (n && n !== document.body ? n : el).getBoundingClientRect().bottom;
      if (b > top && b < top + 160) top = b;
    }
    overlay.style.top = top + 'px';
  }
  window.addEventListener('resize', positionOverlay);

  // since: fecha de la visita anterior al grupo (para marcar novedades). Al recargar se mantiene.
  // «Nuevos vídeos»: página que junta los nuevos de todos los grupos. No cambia las marcas de los grupos.
  const NEW_ID = '__new';
  const newPageGroup = () => {
    const keys = new Set(); state.groups.filter(gr => !gr.muted).forEach(gr => gr.channels.forEach(k => keys.add(k)));
    return { id: NEW_ID, name: T('Nuevos vídeos'), icon: { type: 'svg', value: 'nuevos', bg: true }, color: state.settings.color1 || '#ff6347', channels: [...keys] };
  };
  async function openGroup(groupId, since) {
    const virt = groupId === NEW_ID;
    const g = virt ? newPageGroup() : state.groups.find(x => x.id === groupId);
    if (!g) return;
    closeOverlay();
    overlayGroupId = groupId;
    overlayUrl = location.href;
    const seenAll = (await chrome.storage.local.get('seen')).seen || {};
    if (virt) since = 0;
    else if (since === undefined) since = seenAll[groupId] || 0;
    const st = state.settings;
    const filters = { channel: null, q: '', onlyNew: false,
      type: st.typeFilter || (st.hideShorts ? 'videos' : 'all'), // all | videos | shorts
      watch: st.watchFilter || 'all',                             // all | unwatched
      sort: st.sortBy || 'new',                                   // new | old | views | channel
      period: st.period || 'all',                                 // all | day | week | month
      day: null };                                                // «2026-11-15»: día elegido en el calendario
    let mode = state.settings.playMode || 'todos';
    let selected = []; // ids en el orden en que se marcan
    overlay = h('div', { id: 'pg-overlay', class: virt ? 'pg-virt' : '' });
    document.documentElement.classList.add('pg-noscroll');
    const status = h('span', { class: 'pg-status' }, T('Cargando…'));
    const newCount = h('button', { class: 'pg-newcount', style: 'display:none;border:0;cursor:pointer', title: T('Mostrar solo los nuevos') });
    const search = h('input', { type: 'search', class: 'pg-search', placeholder: T('Buscar en el grupo') });
    ['keydown', 'keyup', 'keypress'].forEach(t => search.addEventListener(t, e => e.stopPropagation()));
    // ---- Barra de herramientas: ordenar, periodo, tipo, vistos y diseño
    const saveSetting = async (k, v) => { state.settings[k] = v; await PG.save({ settings: state.settings }); };
    const select = (opts, value, onchange, title) => {
      const el = h('select', { class: 'pg-mode', title }, ...opts.map(([v, t]) => h('option', { value: v }, t)));
      el.value = value; el.onchange = () => onchange(el.value); return el;
    };
    const segmented = (opts, get, onpick) => {
      const box = h('div', { class: 'pg-seg' });
      const draw = () => box.replaceChildren(...opts.map(([v, label, icon]) =>
        h('button', { class: get() === v ? 'on' : '', title: icon ? label : null, onclick: () => { onpick(v); draw(); } }, icon ? PG.svgEl(icon, 18, 'currentColor') : label)));
      draw(); return box;
    };
    const sortSel = select([['new', T('↓ Más recientes')], ['old', T('↑ Más antiguos')], ['views', T('🔥 Más vistos')], ['channel', T('Canal (A-Z)')]], filters.sort,
      v => { filters.sort = v; render(); saveSetting('sortBy', v); }, T('Ordenar por'));
    const periodSel = select([['all', T('Cualquier fecha')], ['day', T('Últimas 24 horas')], ['week', T('Última semana')], ['month', T('Último mes')]], filters.period,
      v => { filters.period = v; render(); renderChips(); saveSetting('period', v); }, T('Fecha de subida'));
    const typeSeg = segmented([['all', T('Todo')], ['videos', T('Vídeos')], ['shorts', T('Shorts')]], () => filters.type,
      v => { filters.type = v; render(); renderChips(); saveSetting('typeFilter', v).then(() => quickRecount()); });
    const watchSeg = segmented([['all', T('Todos')], ['unwatched', T('No vistos')]], () => filters.watch,
      v => { filters.watch = v; render(); renderChips(); saveSetting('watchFilter', v); });
    const applyView = () => {
      const vm = state.settings.viewMode || 'grid';
      overlay.classList.toggle('pg-list', vm === 'list');
      overlay.classList.toggle('pg-compact', vm === 'compact');
    };
    const viewSeg = segmented([['grid', T('Cuadrícula'), 'cuadricula'], ['compact', T('Cuadrícula compacta'), 'capas'], ['list', T('Lista'), 'lista']], () => state.settings.viewMode || 'grid',
      v => { state.settings.viewMode = v; applyView(); saveSetting('viewMode', v); });
    const toolbar = h('div', { class: 'pg-toolbar' }, sortSel, periodSel, typeSeg, watchSeg, h('div', { class: 'pg-ov-spacer' }), viewSeg);
    // ---- Calendario de subidas
    let calOpen = !!state.settings.calOpen, calMonth = null, calTouched = false;
    const cal = h('div', { class: 'pg-cal', style: 'display:none' });
    const calBtn = h('button', { class: 'pg-btn pg-cal-btn' + (calOpen ? ' on' : ''), title: T('Calendario: qué días se subió cada vídeo'), 'aria-label': T('Calendario de subidas'), 'aria-pressed': String(calOpen) }, PG.svgEl('calendario', 18, 'currentColor'));
    calBtn.onclick = () => {
      calOpen = !calOpen; calBtn.classList.toggle('on', calOpen); calBtn.setAttribute('aria-pressed', String(calOpen));
      if (!calOpen && filters.day) { filters.day = null; render(); }
      drawCal(); saveSetting('calOpen', calOpen);
    };
    const markAllBtn = virt ? h('button', { class: 'pg-markall', title: T('Quita la etiqueta «Nuevo» de todos los vídeos en todos tus grupos'), onclick: async () => { await markAllSeen(); openGroup(NEW_ID); } }, T('✓ Marcar todos como vistos en los grupos')) : null;
    const head = h('div', { class: 'pg-ov-head' },
      PG.iconEl(g, 40), h('h2', {}, g.name), newCount, status,
      h('div', { class: 'pg-ov-spacer' }),
      search,
      calBtn,
      h('button', { class: 'pg-btn', title: T('Recargar'), onclick: () => { g.channels.forEach(k => { const c = state.channels[k]; c && c.id && rssCache.delete(c.id); }); openGroup(groupId, since); } }, '⟳'),
      virt ? null : h('button', { class: 'pg-btn', title: T('Editar grupo'), onclick: () => openManager('group=' + g.id) }, '✎'),
      h('button', { class: 'pg-btn', title: T('Cerrar (Esc)'), onclick: closeOverlay }, '✕'));
    const chips = h('div', { class: 'pg-chips' });
    // Barra de reproducción: modo + botón para lanzar la cola
    const modeSel = h('select', { class: 'pg-mode', title: T('Qué vídeos') },
      ...[['todos', T('Todos')], ['nuevos', T('Nuevos')], ['aleatorio', T('Aleatorio')], ['seleccionar', T('Seleccionar')]].map(([v, t]) => h('option', { value: v }, t)));
    modeSel.value = mode;
    // Qué hacer con esos vídeos
    let action = ['cola', 'wl', 'playlist', 'seen', 'new'].includes(state.settings.groupAction) ? state.settings.groupAction : 'cola';
    const actionSel = h('select', { class: 'pg-mode', title: T('Qué hacer con los vídeos') },
      ...[['cola', T('Añadir a la cola')], ['wl', T('Añadir a Ver más tarde')], ['playlist', T('Añadir a una playlist')], ['seen', T('Marcar como vistos')], ['new', T('Marcar como nuevos')]].map(([v, t]) => h('option', { value: v }, t)));
    actionSel.value = action;
    const playBtn = h('button', { class: 'pg-play' }, T('Aplicar'));
    const clearSel = h('button', { class: 'pg-clear', title: T('Quitar selección'), style: 'display:none' }, T('Limpiar'));
    // Cola de YTBox (vídeos añadidos uno a uno con el menú ⋮)
    const queueBtn = h('button', { class: 'pg-queue', title: T('Reproducir tu cola de YTBox') });
    const queueClear = h('button', { class: 'pg-queue-x', title: T('Vaciar la cola') }, '✕');
    const queueBox = h('div', { class: 'pg-queue-box', style: 'display:none' }, queueBtn, queueClear);
    playBtn.style.display = 'none'; modeSel.style.display = 'none'; actionSel.style.display = 'none'; // se muestran cuando hay vídeos
    const actions = h('div', { class: 'pg-actions' }, modeSel, clearSel, actionSel, playBtn);
    const grid = h('div', { class: 'pg-grid' });
    overlay.append(head, h('div', { class: 'pg-row' }, chips, actions), toolbar, cal,
      markAllBtn ? h('div', { class: 'pg-markall-row' }, markAllBtn) : null, grid);
    applyView();
    document.body.append(overlay);
    positionOverlay();

    const chans = g.channels.map(k => state.channels[k]).filter(Boolean);
    if (!chans.length) {
      // Grupo vacío: fuera la barra de reproducción, los filtros y el buscador
      status.textContent = '';
      actions.remove(); toolbar.remove(); search.remove(); chips.remove();
      grid.append(h('div', { class: 'pg-empty' },
        h('div', { style: 'font-size:40px;margin-bottom:10px' }, '📭'),
        h('div', { style: 'margin-bottom:16px' }, T('Este grupo todavía no tiene canales. Entra en un canal y pulsa «📁 Añadir a grupo», o añádelos desde el gestor.')),
        h('button', { class: 'pg-play', onclick: () => openManager('group=' + g.id) }, T('+ Añadir canales'))));
      return;
    }
    // Resolver ids que falten
    let changed = false;
    const missing = chans.filter(c => !c.id);
    if (missing.length) {
      status.textContent = T('Resolviendo {0} canales…', missing.length);
      await pool(missing, 4, async c => { await PG.ensureChannelId(c); changed = true; });
      if (changed) await PG.save({ channels: state.channels });
      if (overlayGroupId !== groupId) return;
    }
    let all = [], done = 0;
    const stored = await chrome.storage.local.get(['marks', 'queue', 'watched', 'chanViews', 'watchSince']);
    const chanViews = stored.chanViews || {}, watchSince = stored.watchSince || Date.now();
    let hist = null;
    const histP = loadHistory().then(r => { hist = r && { vids: new Set(r.vids), oldest: r.oldest, n: r.vids.length }; }).catch(e => console.warn('[YTBox] historial', e));
    const failed = new Set(); // canales cuyo RSS no ha cargado: sin datos, sin aviso
    const watched = stored.watched || {};
    const isWatched = v => !!watched[v.vid];
    const marksAll = stored.marks || {};
    const marks = virt ? {} : (marksAll[groupId] || (marksAll[groupId] = {}));
    let queue = stored.queue || [];
    // En «Nuevos vídeos», un vídeo es nuevo si lo es en alguno de los grupos de su canal (y no lo has visto)
    const groupsByChannel = new Map();
    if (virt) for (const gr of state.groups.filter(x => !x.muted)) for (const k of gr.channels) { const c = state.channels[k]; if (c && c.id) { if (!groupsByChannel.has(c.id)) groupsByChannel.set(c.id, []); groupsByChannel.get(c.id).push(gr.id); } }
    const newIn = (gid, v) => { const m = marksAll[gid] || {}; const s = seenAll[gid] || 0; return v.vid in m ? m[v.vid] : (s > 0 && v.published.getTime() > s); };
    const isNew = virt
      ? v => !watched[v.vid] && (groupsByChannel.get(v.channelId) || []).some(gid => newIn(gid, v))
      : v => v.vid in marks ? marks[v.vid] : (since > 0 && v.published.getTime() > since);
    const saveMarks = () => chrome.storage.local.set({ marks: marksAll });
    const updateQueue = () => {
      queueBox.style.display = queue.length ? '' : 'none';
      queueBtn.textContent = T('▶ Mi cola · {0}', queue.length);
    };
    const saveQueue = async () => { updateQueue(); await chrome.storage.local.set({ queue }); };
    queueBtn.onclick = async () => {
      const ids = queue.slice(0, 50).map(q => q.vid);
      if (!ids.length) return;
      queue = queue.slice(50); await chrome.storage.local.set({ queue });
      closeOverlay();
      location.href = '/watch_videos?video_ids=' + ids.join(',');
    };
    queueClear.onclick = async () => { queue = []; await saveQueue(); toast(T('Cola vaciada')); };
    updateQueue();
    const menuCtx = {
      inQueue: vid => queue.some(q => q.vid === vid),
      toggleQueue: async v => {
        if (menuCtx.inQueue(v.vid)) { queue = queue.filter(q => q.vid !== v.vid); toast(T('Quitado de tu cola')); }
        else { queue.push({ vid: v.vid, title: v.title }); toast(T('Añadido a tu cola ({0})', queue.length)); }
        await saveQueue();
      },
      isNew,
      // En «Nuevos vídeos»: los grupos donde este vídeo es nuevo (para los chips de cada tarjeta)
      groupsOf: virt ? v => (groupsByChannel.get(v.channelId) || []).filter(gid => newIn(gid, v)).map(gid => state.groups.find(x => x.id === gid)).filter(Boolean) : null,
      toggleNew: async v => {
        const val = !isNew(v);
        if (virt) for (const gid of groupsByChannel.get(v.channelId) || []) (marksAll[gid] || (marksAll[gid] = {}))[v.vid] = val;
        else marks[v.vid] = val;
        await saveMarks(); render(); renderChips(); quickRecount().catch(() => {});
      },
      opened: v => {
        if (virt) { let ch = false; for (const gid of groupsByChannel.get(v.channelId) || []) if (marksAll[gid] && marksAll[gid][v.vid] === true) { delete marksAll[gid][v.vid]; ch = true; } if (ch) saveMarks(); }
        else if (marks[v.vid] === true) { delete marks[v.vid]; saveMarks(); }
      },
      isWatched,
      toggleWatched: async v => {
        if (watched[v.vid]) delete watched[v.vid]; else watched[v.vid] = Date.now();
        await chrome.storage.local.set({ watched }); render(); renderChips(); quickRecount().catch(() => {});
      },
    };
    const PERIOD = { day: 864e5, week: 7 * 864e5, month: 30 * 864e5 };
    // Filtros comunes (sin canal ni «solo nuevos»): tipo, periodo y vistos
    const passBase = v => (filters.type === 'all' || (filters.type === 'shorts') === v.short)
      && (filters.period === 'all' || Date.now() - v.published.getTime() <= PERIOD[filters.period])
      && (filters.watch === 'all' || !isWatched(v));
    const pad2 = n => String(n).padStart(2, '0');
    const dayKey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    // Todos los filtros menos el día del calendario (el calendario cuenta con esto)
    const passNoDay = v => {
      const q = filters.q.toLowerCase();
      return passBase(v) && (!filters.channel || v.channelId === filters.channel) && (!filters.onlyNew || isNew(v)) && (!q || v.title.toLowerCase().includes(q) || v.author.toLowerCase().includes(q));
    };
    const drawCal = () => {
      cal.style.display = calOpen ? '' : 'none';
      if (!calOpen) return;
      const base = all.filter(passNoDay);
      if (!calMonth || (!calTouched && base.length)) {
        const newest = base.reduce((m, v) => (v.published > m ? v.published : m), new Date(0));
        const ref = base.length ? newest : new Date();
        calMonth = new Date(ref.getFullYear(), ref.getMonth(), 1);
      }
      const byDay = new Map();
      for (const v of base) { const k = dayKey(v.published); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(v); }
      const y = calMonth.getFullYear(), m = calMonth.getMonth();
      const days = new Date(y, m + 1, 0).getDate();
      const lead = (new Date(y, m, 1).getDay() + 6) % 7; // lunes primero
      let max = 1, monthTotal = 0;
      for (let d = 1; d <= days; d++) { const n = (byDay.get(dayKey(new Date(y, m, d))) || []).length; max = Math.max(max, n); monthTotal += n; }
      const byId = new Map(chans.map(c => [c.id, c]));
      const today = dayKey(new Date());
      const nav = delta => { calTouched = true; calMonth = new Date(y, m + delta, 1); drawCal(); };
      const cells = [];
      for (let i = 0; i < lead; i++) cells.push(h('span', { class: 'pg-cal-cell pg-cal-blank' }));
      for (let d = 1; d <= days; d++) {
        const k = dayKey(new Date(y, m, d)), list = byDay.get(k) || [];
        const authors = [...new Set(list.map(v => v.channelId))].map(id => byId.get(id)).filter(Boolean);
        const cell = h('button', { class: 'pg-cal-cell pg-cal-day' + (list.length ? ' has' : '') + (k === today ? ' today' : '') + (filters.day === k ? ' sel' : ''),
          ...(list.length ? {} : { disabled: '' }), style: `--i:${(list.length / max).toFixed(2)}`,
          title: list.length ? TN(list.length, '{1}: {0} vídeo', '{1}: {0} vídeos', T.dayMonth(d, m)) + '\n' + list.slice(0, 8).map(v => '· ' + v.author + ' — ' + v.title).join('\n') + (list.length > 8 ? T('\n… y {0} más', list.length - 8) : '') : T('{0}: sin vídeos', T.dayMonth(d, m)),
          onclick: () => { filters.day = filters.day === k ? null : k; render(); } },
          h('span', { class: 'pg-cal-num' }, String(d)),
          list.length ? h('span', { class: 'pg-cal-count' }, String(list.length)) : null,
          authors.length ? h('span', { class: 'pg-cal-avs' }, ...authors.slice(0, 3).map(c => c.avatar ? h('img', { src: c.avatar, referrerpolicy: 'no-referrer', alt: '' }) : h('i', {})), authors.length > 3 ? h('small', {}, '+' + (authors.length - 3)) : null) : null);
        cells.push(cell);
      }
      cal.replaceChildren(
        h('div', { class: 'pg-cal-head' },
          h('button', { class: 'pg-btn pg-cal-nav', title: T('Mes anterior'), 'aria-label': T('Mes anterior'), onclick: () => nav(-1) }, '‹'),
          h('b', {}, `${T.month(m)} ${y}`),
          h('button', { class: 'pg-btn pg-cal-nav', title: T('Mes siguiente'), 'aria-label': T('Mes siguiente'), onclick: () => nav(1) }, '›'),
          h('button', { class: 'pg-cal-today', onclick: () => { calTouched = true; const t = new Date(); calMonth = new Date(t.getFullYear(), t.getMonth(), 1); drawCal(); } }, T('Hoy')),
          h('span', { class: 'pg-cal-sum' }, monthTotal ? TN(monthTotal, '{0} vídeo este mes', '{0} vídeos este mes') : T('Ningún vídeo este mes')),
          filters.day ? h('button', { class: 'pg-cal-clear', title: T('Quitar el filtro de día'), onclick: () => { filters.day = null; render(); } },
            `📅 ${Number(filters.day.slice(8))} ${T.month(Number(filters.day.slice(5, 7)) - 1).slice(0, 3)} ✕`) : null),
        h('div', { class: 'pg-cal-grid' }, ...T.weekdays().map(t => h('span', { class: 'pg-cal-wd' }, t)), ...cells),
        h('div', { class: 'pg-cal-note' }, T('Pulsa un día para ver solo sus vídeos. Se cuentan los últimos 15 vídeos de cada canal (lo que da YouTube), así que los meses antiguos salen más vacíos.')));
    };
    const visible = () => {
      const q = filters.q.toLowerCase();
      const vids = all.filter(v => passNoDay(v) && (!filters.day || dayKey(v.published) === filters.day) && (!virt || isNew(v)));
      const by = {
        new: (a, b) => b.published - a.published,
        old: (a, b) => a.published - b.published,
        views: (a, b) => (Number(b.views) || 0) - (Number(a.views) || 0),
        channel: (a, b) => a.author.localeCompare(b.author) || b.published - a.published,
      }[filters.sort] || ((a, b) => b.published - a.published);
      return vids.sort(by);
    };
    const queueIds = () => {
      const vids = visible();
      if (mode === 'nuevos') return vids.filter(isNew).reverse().map(v => v.vid); // del más antiguo al más reciente
      if (mode === 'aleatorio') { const a = vids.map(v => v.vid); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
      if (mode === 'seleccionar') return selected.slice();
      return vids.map(v => v.vid);
    };
    const updatePlay = () => {
      const n = queueIds().length;
      overlay.classList.toggle('pg-selecting', mode === 'seleccionar');
      clearSel.style.display = mode === 'seleccionar' && selected.length ? '' : 'none';
      playBtn.disabled = !n || playBtn.dataset.busy === '1';
      playBtn.style.display = all.length ? '' : 'none';
      modeSel.style.display = all.length ? '' : 'none';
      actionSel.style.display = all.length ? '' : 'none';
      // El número de vídeos va en el propio selector: «Todos (15)», «Nuevos (3)»…
      const vids = visible();
      const counts = { todos: vids.length, nuevos: vids.filter(isNew).length, aleatorio: vids.length, seleccionar: selected.length };
      [...modeSel.options].forEach(o => { o.textContent = `${{ todos: T('Todos'), nuevos: T('Nuevos'), aleatorio: T('Aleatorio'), seleccionar: T('Seleccionar') }[o.value]} (${counts[o.value]})`; });
      const max = action === 'cola' ? 50 : (action === 'seen' || action === 'new') ? Infinity : 200;
      const word = n === 1 ? T('vídeo') : T('vídeos');
      playBtn.title = !n ? T('No hay vídeos') : {
        cola: T('Crea una lista con {0} {1} y empieza a verla', Math.min(n, max), word) + (n > max ? T(' (YouTube admite 50 por cola)') : ''),
        wl: T('Guarda {0} {1} en «Ver más tarde»', Math.min(n, max), word),
        playlist: T('Elige una playlist y guarda en ella {0} {1}', Math.min(n, max), word),
        seen: T('Marca como vistos {0} {1}', n, word),
        new: T('Marca como nuevos {0} {1}', n, word),
      }[action];
    };
    const toggleSelect = (vid, el) => {
      const i = selected.indexOf(vid);
      if (i >= 0) selected.splice(i, 1); else selected.push(vid);
      grid.querySelectorAll('.pg-card').forEach(c => {
        const k = selected.indexOf(c.dataset.vid);
        c.classList.toggle('pg-checked', k >= 0);
        const cb = c.querySelector('.pg-check'); if (cb) cb.checked = k >= 0;
        const num = c.querySelector('.pg-check-num'); if (num) num.textContent = k >= 0 ? String(k + 1) : '';
      });
      updatePlay();
    };
    modeSel.onchange = async () => {
      mode = modeSel.value; render();
      state.settings.playMode = mode; await PG.save({ settings: state.settings });
    };
    clearSel.onclick = () => { selected = []; render(); };
    actionSel.onchange = async () => {
      action = actionSel.value; updatePlay();
      state.settings.groupAction = action; await PG.save({ settings: state.settings });
    };
    const busy = (on, txt) => { playBtn.dataset.busy = on ? '1' : ''; playBtn.textContent = txt || T('Aplicar'); playBtn.disabled = on; };
    playBtn.onclick = async () => {
      if (action === 'cola') {
        const ids = queueIds().slice(0, 50);
        if (!ids.length) return;
        closeOverlay();
        location.href = '/watch_videos?video_ids=' + ids.join(',');
        return;
      }
      if (action === 'seen' || action === 'new') {
        const idSet = new Set(queueIds());
        const vids = all.filter(v => idSet.has(v.vid));
        if (!vids.length) return;
        const asSeen = action === 'seen';
        for (const v of vids) {
          if (asSeen) watched[v.vid] = Date.now(); else delete watched[v.vid];
          if (virt) for (const gid of groupsByChannel.get(v.channelId) || []) (marksAll[gid] || (marksAll[gid] = {}))[v.vid] = !asSeen;
          else marks[v.vid] = !asSeen;
        }
        await saveMarks();
        await chrome.storage.local.set({ watched });
        toast(asSeen
          ? TN(vids.length, '{0} vídeo marcado como visto', '{0} vídeos marcados como vistos')
          : TN(vids.length, '{0} vídeo marcado como nuevo', '{0} vídeos marcados como nuevos'));
        render(); renderChips(); quickRecount().catch(() => {});
        return;
      }
      const ids = queueIds().slice(0, 200);
      if (!ids.length) return;
      if (!YTAPI.loggedIn()) { toast(T('Inicia sesión en YouTube para guardar vídeos en tus listas'), true); return; }
      if (action === 'playlist') { showBulkPlaylists(playBtn, ids, busy); return; }
      busy(true, T('Guardando…'));
      try {
        const r = await YTAPI.addMany('WL', ids, (d, t) => { playBtn.textContent = T('Guardando… {0}/{1}', d, t); });
        toast(TN(r.ok, '{0} vídeo en «Ver más tarde»', '{0} vídeos en «Ver más tarde»') + (r.fail ? T(' · {0} no se pudieron añadir (quizá ya estaban)', r.fail) : ''), !r.ok);
      } catch (err) { toast(err.message, true); }
      busy(false); updatePlay();
    };
    const render = () => {
      const vids = visible();
      grid.replaceChildren(...vids.map(v => card(v, isNew(v), mode === 'seleccionar' ? { index: selected.indexOf(v.vid), toggle: toggleSelect } : null, menuCtx)));
      updatePlay();
      if (!vids.length && done === chans.length) grid.append(h('div', { class: 'pg-empty' }, filters.onlyNew ? T('No hay vídeos nuevos desde tu última visita.') : T('No hay vídeos con estos filtros.')));
      status.textContent = done < chans.length ? T('Cargando {0}/{1}…', done, chans.length) : T('{0} vídeos · {1} canales', vids.length, chans.length) + (filters.day ? T(' · el {0}/{1}', Number(filters.day.slice(8)), Number(filters.day.slice(5, 7))) : '') + (since ? T(' · última visita {0}', PG.relTime(new Date(since))) : '');
      drawCal();
      const n = all.filter(v => isNew(v) && passBase(v)).length;
      newCount.style.display = n ? '' : 'none';
      newCount.textContent = filters.onlyNew ? '✓ ' + TN(n, '{0} nuevo', '{0} nuevos') : TN(n, '{0} nuevo', '{0} nuevos');
      if (markAllBtn) markAllBtn.disabled = !n;
    };
    newCount.onclick = () => { if (virt) return; filters.onlyNew = !filters.onlyNew; render(); };
    // Avisos (no se borra nada): canales que llevan mucho sin subir o que hace tiempo que no ves
    const DAY = 864e5;
    const health = c => {
      if (done < chans.length || failed.has(c.id)) return null;
      const items = all.filter(v => v.channelId === c.id).sort((a, b) => b.published - a.published);
      const now = Date.now();
      if (!items.length) return { icon: 'dormido', text: T('No tiene vídeos públicos recientes') };
      const latest = items[0].published.getTime();
      if (now - latest > 90 * DAY) return { icon: 'dormido', text: T('Lleva mucho sin subir: su último vídeo es de {0}', PG.relTime(new Date(latest))) };
      const seen = v => !!watched[v.vid] || !!(hist && hist.vids.has(v.vid));
      const last = Math.max(chanViews[c.key] || 0, (c.handle && chanViews[c.handle]) || 0, (c.id && chanViews[c.id]) || 0, ...items.map(v => watched[v.vid] || 0));
      if (last && now - last < 30 * DAY) return null;
      // Desde cuándo sabemos lo que ves: lo que cubra tu historial de YouTube o, si no, el registro de YTBox
      const covered = Math.min(watchSince, hist ? (hist.oldest || (hist.n >= 200 ? now - 30 * DAY : now)) : now);
      // Racha: sus vídeos más recientes seguidos que no has visto
      const streak = [];
      for (const v of items) { if (v.short) continue; if (seen(v) || v.published.getTime() < covered) break; streak.push(v); }
      if (streak.length < 4 || now - streak[streak.length - 1].published.getTime() < 21 * DAY) return null;
      return { icon: 'ojoTachado', text: (last ? T('No ves este canal desde {0}', PG.relTime(new Date(last))) : T('Hace tiempo que no ves este canal')) + T(': te has saltado sus últimos {0} vídeos (desde {1})', streak.length, PG.relTime(streak[streak.length - 1].published)) };
    };
    const legendRow = h('div', { class: 'pg-legend-row' });
    const renderChips = () => {
      const flags = { dormido: 0, ojoTachado: 0 };
      chips.replaceChildren(
        h('button', { class: 'pg-chip' + (!filters.channel ? ' on' : ''), onclick: () => { filters.channel = null; renderChips(); render(); } }, T('Todos')),
        ...chans.filter(c => c.id && (!virt || all.some(v => v.channelId === c.id && isNew(v) && passBase(v)))).map(c => {
          const n = all.filter(v => v.channelId === c.id && isNew(v) && passBase(v)).length;
          const hl = health(c); if (hl) flags[hl.icon]++;
          return h('button', { class: 'pg-chip' + (filters.channel === c.id ? ' on' : '') + (hl ? ' pg-chip-flag' : ''), title: c.name + (hl ? ' · ' + hl.text : ''), onclick: () => { filters.channel = filters.channel === c.id ? null : c.id; renderChips(); render(); } },
            c.avatar ? h('img', { src: c.avatar, referrerpolicy: 'no-referrer' }) : null, c.name,
            hl ? h('span', { class: 'pg-chip-warn pg-warn-' + hl.icon, 'aria-label': hl.text }, PG.svgEl(hl.icon, 14, 'currentColor')) : null,
            n ? h('span', { class: 'pg-chip-new' }, String(n)) : null);
        }));
      legendRow.remove();
      if ((flags.dormido || flags.ojoTachado) && chips.parentNode) {
        legendRow.replaceChildren(h('span', { class: 'pg-chip-legend' },
          flags.dormido ? h('span', { class: 'pg-lg-dormido' }, PG.svgEl('dormido', 13, 'currentColor'), T('lleva tiempo sin subir')) : null,
          flags.ojoTachado ? h('span', { class: 'pg-lg-ojo' }, PG.svgEl('ojoTachado', 13, 'currentColor'), T('hace tiempo que no lo ves')) : null,
          h('span', {}, T('· pasa el ratón por el canal para ver el detalle'))));
        chips.parentNode.after(legendRow);
      }
    };
    renderChips();
    search.addEventListener('input', () => { filters.q = search.value; render(); });
    let timer;
    await pool(chans.filter(c => c.id), 6, async c => {
      let items = [];
      try { items = await fetchRss(c.id); all = all.concat(items); }
      catch (e) { failed.add(c.id); throw e; }
      finally {
        done++;
        status.textContent = T('Cargando {0}/{1}…', done, chans.length);
        clearTimeout(timer); timer = setTimeout(() => { render(); renderChips(); }, 120);
      }
      // Duraciones en segundo plano: cuando llegan se repinta la cuadrícula
      ensureDurations(c.id, items).then(changed => {
        if (changed && overlayGroupId === groupId) { clearTimeout(timer); timer = setTimeout(() => render(), 200); }
      }).catch(e => console.warn('[YTBox] duraciones', e));
    });
    if (overlayGroupId !== groupId) return;
    await histP;
    if (overlayGroupId !== groupId) return;
    clearTimeout(timer); render(); renderChips();
    // Guardar los avisos para que el gestor también los muestre
    chrome.storage.local.get('chanHealth').then(({ chanHealth = {} }) => {
      for (const c of chans) { if (failed.has(c.id) || !c.id) continue; const hl = health(c); if (hl) chanHealth[c.key] = Object.assign({ t: Date.now() }, hl); else delete chanHealth[c.key]; }
      chrome.storage.local.set({ chanHealth });
    });
    if (!virt) {
      // Guardar la visita: la próxima vez se marcarán los vídeos publicados después de ahora
      const seenNow = (await chrome.storage.local.get('seen')).seen || {};
      seenNow[groupId] = Date.now();
      await chrome.storage.local.set({ seen: seenNow });
      newCounts[groupId] = 0; renderGuide(true); saveCountsCache();
      quickRecount().catch(() => {}); // recalcula el total de «Nuevos vídeos» (con los datos ya guardados)
    } // «Nuevos vídeos» no toca las marcas de los grupos
    // Completar avatar, nombre y @usuario de canales que solo tienen id (p. ej. importados de PocketTube).
    // En «Nuevos vídeos», solo los canales que tienen algo nuevo
    const incomplete = chans.filter(c => c.id && (!c.avatar || !c.handle || c.name === c.id) && (!virt || all.some(v => v.channelId === c.id && isNew(v))));
    // Nombre al momento con lo que trae el RSS
    for (const c of incomplete) if (c.name === c.id) { const v = all.find(x => x.channelId === c.id && x.author); if (v) c.name = v.author; }
    if (incomplete.length) {
      await pool(incomplete, 3, async c => {
        const r = await PG.resolveChannel(c.id);
        if (!c.avatar) c.avatar = r.avatar;
        if (!c.handle) c.handle = r.handle;
        if (c.name === c.id) c.name = r.name;
      });
      await PG.save({ channels: state.channels });
      if (overlayGroupId === groupId) { renderChips(); render(); }
    }
  }

  // Botones al pasar el ratón por la miniatura: play en el centro y, a la derecha,
  // Ver más tarde, Guardar en una lista y Añadir a la cola (la cola real de YouTube)
  function hoverActions(v, ctx) {
    const act = (icon, label, fn) => {
      const b = h('button', { class: 'pg-hbtn', title: label, 'aria-label': label }, PG.svgEl(icon, 18, '#ffffff'));
      b.addEventListener('click', async e => { e.preventDefault(); e.stopPropagation(); await fn(b); });
      return b;
    };
    return h('div', { class: 'pg-hover' },
      h('span', { class: 'pg-hplay', 'aria-hidden': 'true' }, PG.svgEl('reproducir', 30, '#ffffff')),
      h('div', { class: 'pg-hbtns' },
        act('reloj', T('Ver más tarde'), async b => {
          try { await YTAPI.watchLater(v.vid); b.classList.add('on'); toast(T('Guardado en «Ver más tarde»')); } catch (err) { toast(err.message, true); }
        }),
        act('listaMas', T('Guardar en una lista de reproducción'), async b => {
          closeVideoMenu();
          const menu = h('div', { id: 'pg-vmenu', 'data-vid': v.vid });
          await showPlaylists(menu, b, v);
        }),
        act('cola', T('Añadir a la cola'), async b => { addToYTQueue(v); b.classList.add('on'); })));
  }

  // Añade el vídeo a la cola de YouTube (minirreproductor) a través de page-bridge.js
  function addToYTQueue(v) {
    window.postMessage({ source: 'ytbox', type: 'queue', vid: v.vid }, '*');
    toast(T('Añadido a la cola de YouTube'));
  }

  function card(v, fresh, sel, ctx) {
    const href = v.short ? '/shorts/' + v.vid : '/watch?v=' + v.vid;
    const ch = Object.values(state.channels).find(c => c.id === v.channelId);
    let check = null;
    if (sel) {
      check = h('label', { class: 'pg-check-wrap' }, h('input', { type: 'checkbox', class: 'pg-check' }), h('span', { class: 'pg-check-num' }, sel.index >= 0 ? String(sel.index + 1) : ''));
      check.querySelector('input').checked = sel.index >= 0;
    }
    const seenIt = ctx && ctx.isWatched(v);
    // Pulsar el nombre o el avatar del canal lleva al canal (no reproduce el vídeo). Ctrl/clic central: pestaña nueva
    const chUrl = 'https://www.youtube.com/' + (ch && ch.handle ? ch.handle : 'channel/' + (v.channelId || (ch && ch.id) || ''));
    const goChannel = e => {
      if (sel) return; // en «Seleccionar», el clic marca el vídeo
      e.preventDefault(); e.stopPropagation();
      if (e.ctrlKey || e.metaKey || e.button === 1) { window.open(chUrl, '_blank'); return; }
      closeOverlay(); location.href = chUrl;
    };
    const a = h('a', { class: 'pg-card' + (fresh ? ' pg-new' : '') + (sel && sel.index >= 0 ? ' pg-checked' : '') + (seenIt ? ' pg-watched' : ''), href, 'data-vid': v.vid },
      h('div', { class: 'pg-thumb' }, h('img', { src: `https://i.ytimg.com/vi/${v.vid}/mqdefault.jpg`, loading: 'lazy' }),
        fresh ? h('span', { class: 'pg-new-badge' }, T('Nuevo')) : null,
        seenIt ? h('span', { class: 'pg-watched-badge' }, 'VISTO') : null,
        seenIt ? h('span', { class: 'pg-watched-bar' }) : null,
        !sel && ctx ? hoverActions(v, ctx) : null,
        check,
        v.short ? h('span', { class: 'pg-badge' }, 'SHORT') : (v.vid in durations ? h('span', { class: 'pg-dur' }, fmtDuration(durations[v.vid])) : null)),
      h('div', { class: 'pg-meta' },
        ch && ch.avatar ? h('img', { class: 'pg-avatar pg-to-channel', src: ch.avatar, referrerpolicy: 'no-referrer', title: T('Ir al canal'), onclick: goChannel }) : h('span', { class: 'pg-avatar' }),
        h('div', {},
          h('div', { class: 'pg-title', title: v.title }, v.title),
          h('div', { class: 'pg-sub' }, h('span', { class: 'pg-chlink', role: 'link', tabindex: '0', title: T('Ir al canal ') + (v.author || ''), onclick: goChannel,
            onauxclick: goChannel, onkeydown: e => { if (e.key === 'Enter') goChannel(e); } }, v.author)),
          h('div', { class: 'pg-sub' }, (v.views ? PG.fmtViews(v.views) + ' · ' : '') + PG.relTime(v.published)),
          ctx && ctx.groupsOf ? h('div', { class: 'pg-card-groups' }, ...ctx.groupsOf(v).map(g => h('button', { class: 'pg-card-group', title: T('Abrir el grupo «') + g.name + '»',
            onclick: e => { e.preventDefault(); e.stopPropagation(); openGroup(g.id); } }, PG.iconEl(g, 14), g.name))) : null,
          v.desc ? h('div', { class: 'pg-desc' }, v.desc.slice(0, 300)) : null),
        !sel && ctx ? h('button', { class: 'pg-dots', title: T('Más acciones'), onclick: e => { e.preventDefault(); e.stopPropagation(); openVideoMenu(e.currentTarget, v, ctx); } }, '⋮') : null));
    if (!sel && ctx) a.addEventListener('click', () => ctx.opened(v));
    // En modo «Seleccionar», pulsar el vídeo lo marca en vez de abrirlo
    if (sel) a.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); sel.toggle(v.vid, a); });
    return a;
  }

  // ---------- Menú ⋮ de cada vídeo ----------
  function toast(msg, isErr) {
    $('#pg-toast')?.remove();
    const t = h('div', { id: 'pg-toast', class: isErr ? 'err' : '' }, msg);
    document.body.append(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3000);
  }

  function closeVideoMenu() { $('#pg-vmenu')?.remove(); }
  document.addEventListener('mousedown', e => { const m = $('#pg-vmenu'); if (m && !m.contains(e.target) && !e.target.closest('.pg-dots') && !e.target.closest('#pg-menu')) m.remove(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeVideoMenu(); }, true);

  function placeMenu(menu, btn) {
    const r = btn.getBoundingClientRect();
    menu.style.visibility = 'hidden';
    document.body.append(menu);
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = r.right - mw, top = r.bottom + 4;
    if (left < 8) left = 8;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    menu.style.left = left + 'px'; menu.style.top = top + 'px'; menu.style.visibility = '';
  }

  function openVideoMenu(btn, v, ctx) {
    const was = $('#pg-vmenu');
    closeVideoMenu();
    if (was && was.dataset.vid === v.vid) return;
    const menu = h('div', { id: 'pg-vmenu', 'data-vid': v.vid });
    const item = (icon, label, fn) => h('button', { class: 'pg-vitem', onclick: async e => { e.preventDefault(); e.stopPropagation(); await fn(); } },
      h('span', { class: 'pg-vicon' }, PG.svgEl(icon, 20, 'currentColor')), h('span', {}, label));
    // Este, a diferencia de los demás, abre un submenú que cuelga a su derecha (el vídeo sigue abierto detrás)
    const groupsItem = h('button', { class: 'pg-vitem', onclick: e => { e.preventDefault(); e.stopPropagation();
      const ch = Object.values(state.channels).find(c => c.id === v.channelId);
      openChannelGroupsMenu(groupsItem, { key: ch ? ch.key : v.channelId, name: v.author || (ch && ch.name) || '', href: 'https://www.youtube.com/channel/' + v.channelId });
    } }, h('span', { class: 'pg-vicon' }, PG.svgEl('carpeta', 20, 'currentColor')), h('span', {}, T('Cambiar los grupos del canal…')));
    menu.append(
      item('cola', T('Añadir a la cola'), async () => { closeVideoMenu(); addToYTQueue(v); }),
      item('reloj', T('Ver más tarde'), async () => {
        closeVideoMenu();
        try { await YTAPI.watchLater(v.vid); toast(T('Guardado en «Ver más tarde»')); }
        catch (err) { toast(err.message, true); }
      }),
      item('marcador', T('Guardar en una lista de reproducción'), () => showPlaylists(menu, btn, v)),
      groupsItem,
      h('div', { class: 'pg-vsep' }),
      item('estrella', ctx.isNew(v) ? T('Quitar marca de nuevo') : T('Marcar como nuevo'), async () => { closeVideoMenu(); await ctx.toggleNew(v); }),
      item('ojo', ctx.isWatched(v) ? T('Marcar como no visto') : T('Marcar como visto'), async () => { closeVideoMenu(); await ctx.toggleWatched(v); }),
    );
    placeMenu(menu, btn);
  }

  // Submenú «Cambiar los grupos del canal…»: el mismo panel que usa el botón de suscripción (toggleMenu),
  // pero anclado a la derecha del propio ítem del menú ⋮ (como un submenú), no debajo
  function openChannelGroupsMenu(anchor, ref) {
    const old = $('#pg-menu');
    if (old) { old.remove(); if (old.dataset.kind === 'chgroups-' + ref.key) return; }
    const menu = h('div', { id: 'pg-menu', 'data-kind': 'chgroups-' + ref.key });
    const aliasKeys = () => new Set(channelAliases(ref.key).map(c => c.key));
    const inNow = new Set(groupsOfChannel(ref.key).map(g => g.id));
    menu.append(h('div', { class: 'pg-menu-title' }, ref.name || ref.key));
    if (!state.groups.length) menu.append(h('div', { class: 'pg-menu-empty' }, T('No hay grupos todavía.')));
    for (const g of state.groups) {
      const cb = h('input', { type: 'checkbox' }); cb.checked = inNow.has(g.id);
      menu.append(h('label', { class: 'pg-menu-item' }, cb, PG.iconEl(g, 20), h('span', {}, g.name)));
      cb.addEventListener('change', async () => {
        cb.disabled = true;
        try {
          const c = await ensureStoredChannel(ref);
          const grp = state.groups.find(x => x.id === g.id);
          const keys = aliasKeys(); keys.add(c.key);
          if (cb.checked) { if (!grp.channels.some(k => keys.has(k))) grp.channels.push(c.key); }
          else grp.channels = grp.channels.filter(k => !keys.has(k));
          await PG.save({ groups: state.groups });
        } catch (e) { toast(e.message, true); cb.checked = !cb.checked; }
        cb.disabled = false;
      });
    }
    const input = h('input', { type: 'text', placeholder: T('Nuevo grupo…'), class: 'pg-menu-new' });
    input.addEventListener('keydown', async e => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      e.stopPropagation();
      const c = await ensureStoredChannel(ref);
      state.groups.push({ id: PG.uid(), name: input.value.trim(), icon: { type: 'emoji', value: '📁' }, color: '#ff6347', channels: [c.key] });
      await PG.save({ groups: state.groups });
      menu.remove();
    });
    input.addEventListener('keyup', e => e.stopPropagation());
    input.addEventListener('keypress', e => e.stopPropagation());
    menu.append(input);
    document.body.append(menu);
    // A la derecha del ítem del menú ⋮ (a la izquierda si no cabe), con el mismo tope de alto y scroll que el resto de #pg-menu
    const r = anchor.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = r.right + 6;
    if (left + mw > window.innerWidth - 8) left = Math.max(8, r.left - mw - 6);
    menu.style.left = left + 'px';
    const cap = Math.round(window.innerHeight * 0.6);
    menu.style.top = Math.max(8, Math.min(r.top, window.innerHeight - 8 - Math.min(mh, cap))) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function close(e) {
      if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close); }
    }), 0);
  }

  async function showPlaylists(menu, btn, v) {
    menu.classList.add('pg-vmenu-lists');
    menu.replaceChildren(h('div', { class: 'pg-vtitle' }, T('Guardar en…')), h('div', { class: 'pg-vloading' }, T('Cargando tus listas…')));
    placeMenu(menu, btn);
    let lists;
    try { lists = await YTAPI.getPlaylists(v.vid); }
    catch (err) { menu.replaceChildren(h('div', { class: 'pg-vtitle' }, T('Guardar en…')), h('div', { class: 'pg-vloading err' }, err.message)); return; }
    const rows = lists.map(pl => {
      const cb = h('input', { type: 'checkbox' }); cb.checked = pl.contains;
      cb.addEventListener('change', async () => {
        cb.disabled = true;
        try {
          if (cb.checked) { await YTAPI.addToPlaylist(pl.id, v.vid); toast(T('Guardado en «{0}»', pl.title)); }
          else { await YTAPI.removeFromPlaylist(pl.id, v.vid); toast(T('Quitado de «{0}»', pl.title)); }
        } catch (err) { cb.checked = !cb.checked; toast(err.message, true); }
        cb.disabled = false;
      });
      return h('label', { class: 'pg-vlist' }, cb, h('span', {}, pl.title || pl.id));
    });
    const name = h('input', { type: 'text', class: 'pg-vnew', placeholder: T('+ Nueva lista (privada)…') });
    ['keydown', 'keyup', 'keypress'].forEach(t => name.addEventListener(t, e => e.stopPropagation()));
    name.addEventListener('keydown', async e => {
      if (e.key !== 'Enter' || !name.value.trim()) return;
      name.disabled = true;
      try { await YTAPI.createPlaylist(name.value.trim(), v.vid); toast(T('Creada «{0}» con este vídeo', name.value.trim())); closeVideoMenu(); }
      catch (err) { toast(err.message, true); name.disabled = false; }
    });
    menu.replaceChildren(h('div', { class: 'pg-vtitle' }, T('Guardar en…')),
      h('div', { class: 'pg-vlists' }, rows.length ? rows : h('div', { class: 'pg-vloading' }, T('No tienes listas todavía.'))), name);
    placeMenu(menu, btn);
  }

  // Elegir playlist para guardar varios vídeos de golpe (botón «Aplicar» del grupo)
  async function showBulkPlaylists(btn, ids, busy) {
    closeVideoMenu();
    const n = ids.length, word = n === 1 ? T('vídeo') : T('vídeos');
    const menu = h('div', { id: 'pg-vmenu', class: 'pg-vmenu-lists', 'data-vid': '__bulk' });
    const title = h('div', { class: 'pg-vtitle' }, T('Guardar {0} {1} en…', n, word));
    menu.append(title, h('div', { class: 'pg-vloading' }, T('Cargando tus listas…')));
    placeMenu(menu, btn);
    const save = async (label, fn) => {
      closeVideoMenu(); busy(true, T('Guardando…'));
      try {
        const r = await fn();
        toast(TN(r.ok, '{0} vídeo en «{1}»', '{0} vídeos en «{1}»', label) + (r.fail ? T(' · {0} no se pudieron añadir (quizá ya estaban)', r.fail) : ''), !r.ok);
      } catch (err) { toast(err.message, true); }
      busy(false); btn.disabled = false;
    };
    let lists;
    try { lists = await YTAPI.getPlaylists(ids[0]); }
    catch (err) { menu.replaceChildren(title, h('div', { class: 'pg-vloading err' }, err.message)); return; }
    lists = lists.filter(pl => pl.id !== 'WL');
    const rows = lists.map(pl => h('button', { class: 'pg-vitem', onclick: e => { e.stopPropagation(); save(pl.title || pl.id, () => YTAPI.addMany(pl.id, ids, (d, t) => { btn.textContent = T('Guardando… {0}/{1}', d, t); })); } },
      h('span', { class: 'pg-vicon' }, PG.svgEl('lista', 18, 'currentColor')), h('span', {}, pl.title || pl.id)));
    const name = h('input', { type: 'text', class: 'pg-vnew', placeholder: T('+ Nueva lista (privada)…') });
    ['keydown', 'keyup', 'keypress'].forEach(t => name.addEventListener(t, e => e.stopPropagation()));
    name.addEventListener('keydown', e => {
      const t = name.value.trim();
      if (e.key !== 'Enter' || !t) return;
      save(t, async () => {
        const pid = await YTAPI.createPlaylist(t, ids[0]);
        const r = ids.length > 1 ? await YTAPI.addMany(pid, ids.slice(1), (d, tt) => { btn.textContent = T('Guardando… {0}/{1}', d + 1, tt + 1); }) : { ok: 0, fail: 0 };
        return { ok: r.ok + 1, fail: r.fail };
      });
    });
    menu.replaceChildren(title, h('div', { class: 'pg-vlists' }, rows.length ? rows : h('div', { class: 'pg-vloading' }, T('No tienes listas todavía.'))), name);
    placeMenu(menu, btn);
    setTimeout(() => (rows.length ? null : name.focus()), 0);
  }

  // ---------- Vídeos vistos (se apuntan al abrir /watch o /shorts) ----------
  let lastWatched = null;
  async function recordWatched() {
    let vid = null;
    if (location.pathname === '/watch') vid = new URLSearchParams(location.search).get('v');
    else { const m = location.pathname.match(/^\/shorts\/([\w-]{11})/); if (m) vid = m[1]; }
    if (!vid || vid === lastWatched) return;
    lastWatched = vid;
    const { watched = {} } = await chrome.storage.local.get('watched');
    watched[vid] = Date.now();
    const keys = Object.keys(watched);
    if (keys.length > 5000) keys.sort((a, b) => watched[a] - watched[b]).slice(0, keys.length - 5000).forEach(k => delete watched[k]);
    await chrome.storage.local.set({ watched });
    quickRecount().catch(() => {}); // si era nuevo, baja el contador
  }

  // Historial de YouTube (con sesión): se guarda 6 horas para no pedirlo cada vez
  async function loadHistory() {
    const { ytHistory } = await chrome.storage.local.get('ytHistory');
    if (ytHistory && ytHistory.chanCounts && Date.now() - ytHistory.t < 6 * 3600e3) return ytHistory;
    if (!YTAPI.loggedIn()) return ytHistory || null;
    const r = await YTAPI.history(10);
    const out = { t: Date.now(), vids: r.vids.slice(0, 3000), oldest: r.oldest, chanCounts: r.chanCounts || {} };
    await chrome.storage.local.set({ ytHistory: out });
    return out;
  }

  setTimeout(() => loadHistory().catch(() => {}), 8000);
  // Abierto desde el gestor con «Abrir Descubrir en YouTube»
  if (location.hash === '#ytbox-descubrir') {
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(() => openDiscover(), 1500);
  }

  // Reparar en segundo plano los canales que tienen un código (UC…) en vez de nombre
  async function healChannelNames() {
    const list = Object.values(state.channels).filter(c => c.id && YTAPI.needsName(c)).slice(0, 150);
    if (!list.length) return;
    let fixed = 0;
    await pool(list, 4, async c => {
      const cached = rssCache.get(c.id);
      const fromRss = cached && cached.items.find(v => v.author);
      const n = fromRss ? fromRss.author : await YTAPI.channelName(c.id);
      if (n) { c.name = n; fixed++; }
    });
    if (fixed) { await PG.save({ channels: state.channels }); console.info(`[YTBox] ${fixed} nombres de canal completados`); }
  }
  setTimeout(() => healChannelNames().catch(e => console.warn('[YTBox] nombres', e)), 12000);

  // Qué canales ves: al abrir un vídeo se apunta la fecha en chanViews[clave del canal]
  let lastChanVid = null;
  async function recordChannelView() {
    if (location.pathname !== '/watch') return;
    const vid = new URLSearchParams(location.search).get('v');
    if (!vid || vid === lastChanVid) return;
    const flexy = $('ytd-watch-flexy');
    if (!flexy || flexy.getAttribute('video-id') !== vid) return; // los datos del canal aún son del vídeo anterior
    const a = $('ytd-watch-metadata #owner ytd-channel-name a[href]') || $('ytd-watch-metadata #owner a[href^="/@"]') || $('ytd-watch-metadata #owner a[href^="/channel/"]');
    const k = a && PG.keyFromHref(a.getAttribute('href'));
    if (!k) return;
    lastChanVid = vid;
    const ch = Object.values(state.channels).find(c => c.key === k || c.handle === k || c.id === k);
    const { chanViews = {}, chanViewCount = {} } = await chrome.storage.local.get(['chanViews', 'chanViewCount']);
    const ck = ch ? ch.key : k;
    chanViews[ck] = Date.now();
    chanViewCount[ck] = (chanViewCount[ck] || 0) + 1;
    await chrome.storage.local.set({ chanViews, chanViewCount });
  }
  // Desde cuándo sabemos qué ves (para no acusar de «no lo ves» a canales antes de tener datos)
  chrome.storage.local.get(['watchSince', 'watched']).then(({ watchSince, watched = {} }) => {
    if (watchSince) return;
    const ts = Object.values(watched);
    chrome.storage.local.set({ watchSince: ts.length ? Math.min(...ts) : Date.now() });
  });

  // ---------- Página de Suscripciones: filtrar por grupo y ocultar vistos ----------
  const feedState = { group: null, hideWatched: false };
  function feedKeysFor(g) {
    const set = new Set();
    for (const k of g.channels) { const c = state.channels[k]; set.add(k); if (c) { c.id && set.add(c.id); c.handle && set.add(c.handle); } }
    return set;
  }
  function decorateFeed() {
    const onFeed = location.pathname === '/feed/subscriptions';
    const bar = $('#pg-feedbar');
    if (!onFeed) { bar && bar.remove(); return; }
    const contents = $('ytd-browse[page-subtype="subscriptions"] ytd-rich-grid-renderer #contents') || $('ytd-browse[page-subtype="subscriptions"] #contents');
    if (!contents) return;
    if (!bar || !bar.isConnected) {
      const b = h('div', { id: 'pg-feedbar' });
      contents.parentElement.insertBefore(b, contents);
      feedState.hideWatched = !!state.settings.feedHideWatched;
      drawFeedBar(b);
    }
    applyFeedFilter();
  }
  function drawFeedBar(b) {
    const hw = h('input', { type: 'checkbox' }); hw.checked = feedState.hideWatched;
    hw.onchange = async () => { feedState.hideWatched = hw.checked; state.settings.feedHideWatched = hw.checked; applyFeedFilter(); await PG.save({ settings: state.settings }); };
    b.replaceChildren(
      appLogo(20), h('span', { class: 'pg-feed-label' }, 'YTBox'),
      h('button', { class: 'pg-chip' + (!feedState.group ? ' on' : ''), onclick: () => { feedState.group = null; drawFeedBar(b); applyFeedFilter(); } }, T('Todos')),
      ...state.groups.map(g => h('button', { class: 'pg-chip' + (feedState.group === g.id ? ' on' : ''), onclick: () => { feedState.group = feedState.group === g.id ? null : g.id; drawFeedBar(b); applyFeedFilter(); } }, PG.iconEl(g, 20), g.name)),
      h('div', { class: 'pg-ov-spacer' }),
      h('label', { class: 'pg-toggle' }, hw, T('Ocultar vistos')));
  }
  let watchedCache = {};
  chrome.storage.local.get('watched').then(r => watchedCache = r.watched || {});
  chrome.storage.onChanged.addListener(ch => { if (ch.watched) watchedCache = ch.watched.newValue || {}; });
  function applyFeedFilter() {
    const g = feedState.group && state.groups.find(x => x.id === feedState.group);
    const keys = g ? feedKeysFor(g) : null;
    for (const it of $$('ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer')) {
      let hide = false;
      if (keys) {
        const a = $('a[href^="/@"], a[href^="/channel/"]', it);
        const k = a && PG.keyFromHref(a.getAttribute('href'));
        hide = !k || !keys.has(k);
      }
      if (!hide && feedState.hideWatched) {
        const link = $('a[href*="watch?v="], a[href^="/shorts/"]', it);
        const vid = link && ((link.getAttribute('href').match(/[?&]v=([\w-]{11})/) || link.getAttribute('href').match(/shorts\/([\w-]{11})/) || [])[1]);
        const bar = $('ytd-thumbnail-overlay-resume-playback-renderer, yt-thumbnail-overlay-progress-bar-view-model, .ytThumbnailOverlayProgressBarHost', it);
        hide = !!bar || !!(vid && watchedCache[vid]);
      }
      it.style.display = hide ? 'none' : '';
    }
  }

  // ---------- Modo TV: lista aleatoria de una duración aproximada ----------
  async function openTV(presetId, autoplay) {
    $('#pg-tv')?.remove();
    const cfg = Object.assign({}, YTBoxTV.DEFAULTS, state.settings.tv || {});
    const groupsSel = new Set(cfg.groups.filter(id => state.groups.some(g => g.id === id)));
    const chansSel = new Set(cfg.channels.filter(k => state.channels[k]));
    const root = h('div', { id: 'pg-tv', role: 'dialog', 'aria-modal': 'true', 'aria-label': T('Modo TV') });
    ['keydown', 'keyup', 'keypress'].forEach(t => root.addEventListener(t, e => { e.stopPropagation(); if (t === 'keydown' && e.key === 'Escape') root.remove(); }));
    root.addEventListener('mousedown', e => { if (e.target === root) root.remove(); });
    // Esc también cuando el foco se ha quedado fuera del cuadro (p. ej. tras redibujar los presets)
    const onEsc = e => { if (!root.isConnected) return window.removeEventListener('keydown', onEsc, true); if (e.key === 'Escape') { e.stopPropagation(); root.remove(); } };
    window.addEventListener('keydown', onEsc, true);
    const box = h('div', { class: 'pg-tv-box' });
    root.append(box);

    const selectedChannels = () => {
      const keys = new Set(chansSel);
      for (const gid of groupsSel) { const g = state.groups.find(x => x.id === gid); g && g.channels.forEach(k => keys.add(k)); }
      return [...keys].map(k => state.channels[k]).filter(Boolean);
    };
    const count = h('span', { class: 'pg-tv-count' });
    const updateCount = () => { const n = selectedChannels().length; count.textContent = n ? TN(n, '{0} canal seleccionado', '{0} canales seleccionados') : T('Ningún canal seleccionado'); };

    // Grupos
    const gchips = h('div', { class: 'pg-tv-chips' });
    const drawGroups = () => {
      const allOn = state.groups.length > 0 && state.groups.every(g => groupsSel.has(g.id));
      gchips.replaceChildren(
        ...(state.groups.length > 1 ? [h('button', { class: 'pg-chip pg-chip-all', title: allOn ? T('Quitar todos los grupos') : T('Elegir todos los grupos'),
          onclick: () => { if (allOn) groupsSel.clear(); else state.groups.forEach(g => groupsSel.add(g.id)); drawGroups(); updateCount(); } },
          PG.svgEl('check', 16, 'currentColor'), allOn ? T('Desmarcar todos') : T('Marcar todos'))] : []),
        ...state.groups.map(g => h('button', { class: 'pg-chip' + (groupsSel.has(g.id) ? ' on' : ''), onclick: () => { groupsSel.has(g.id) ? groupsSel.delete(g.id) : groupsSel.add(g.id); drawGroups(); updateCount(); } }, PG.iconEl(g, 20), g.name)));
    };
    drawGroups();
    // Canales sueltos
    const q = h('input', { type: 'search', class: 'pg-search', placeholder: T('Buscar canal…'), style: 'width:100%;box-sizing:border-box' });
    const clist = h('div', { class: 'pg-tv-clist' });
    const allCh = Object.values(state.channels).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    const sel = selectedChips(chansSel, () => { drawCh(); updateCount(); });
    const drawCh = () => {
      sel.draw();
      const t = q.value.toLowerCase();
      clist.replaceChildren(...allCh.filter(c => !t || c.name.toLowerCase().includes(t) || (c.handle || '').includes(t)).slice(0, 300).map(c => {
        const cb = h('input', { type: 'checkbox' }); cb.checked = chansSel.has(c.key);
        cb.addEventListener('change', () => { cb.checked ? chansSel.add(c.key) : chansSel.delete(c.key); updateCount(); sel.draw(); });
        return h('label', { class: 'pg-tv-ch' }, cb, c.avatar ? h('img', { src: c.avatar, referrerpolicy: 'no-referrer' }) : h('span', { class: 'pg-tv-av' }), h('span', {}, c.name));
      }));
    };
    q.addEventListener('input', drawCh); drawCh();
    const details = h('details', { class: 'pg-tv-details' }, h('summary', {}, T('Añadir canales sueltos')), q, clist);
    if (chansSel.size) details.open = true;

    // Qué vídeos
    const onlyNew = h('input', { type: 'checkbox' }); onlyNew.checked = !!cfg.onlyUnwatched;
    const ageSel = h('select', { class: 'pg-mode' }, ...[['all', T('Cualquier fecha')], ['day', T('Último día')], ['3days', T('Últimos 3 días')], ['week', T('Última semana')], ['month', T('Último mes')]].map(([v, t]) => h('option', { value: v }, t)));
    ageSel.value = cfg.maxAge;
    const lenSel = h('select', { class: 'pg-mode' }, ...YTBoxTV.MAXLENS.map(([v, t]) => h('option', { value: String(v) }, T(t))));
    lenSel.value = String(cfg.maxLen || 0); if (!lenSel.value) lenSel.value = '0';
    // Duración
    const amount = h('input', { type: 'number', min: '1', step: '1', class: 'pg-search pg-tv-num', value: String(cfg.amount) });
    const unit = h('select', { class: 'pg-mode' }, h('option', { value: 'min' }, T('minutos')), h('option', { value: 'h' }, T('horas')));
    unit.value = cfg.unit;
    const quick = h('div', { class: 'pg-tv-chips' }, ...[[30, 'min', '30 min'], [1, 'h', '1 h'], [2, 'h', '2 h'], [4, 'h', '4 h']].map(([n, u, t]) =>
      h('button', { class: 'pg-chip', onclick: () => { amount.value = n; unit.value = u; } }, t)));

    // Cómo: vídeos completos o picoteo (solo lo más visto de cada uno)
    let style = cfg.style === 'picoteo' ? 'picoteo' : 'full';
    const clipSel = h('select', { class: 'pg-mode' }, ...YTBoxTV.CLIPS.map(([v, t]) => h('option', { value: String(v) }, T(t))));
    clipSel.value = String(cfg.clip || 60); if (!clipSel.value) clipSel.value = '60';
    const styleBox = h('div', { class: 'pg-tv-chips' });
    const clipRow = h('div', { class: 'pg-tv-row' }, h('span', {}, T('Trozo de cada vídeo:')), clipSel);
    const styleHelp = h('p', { class: 'pg-tv-help' });
    const drawStyle = () => {
      styleBox.replaceChildren(...[['full', T('📺 Vídeos completos')], ['picoteo', T('🍿 Picoteo')]].map(([v, t]) =>
        h('button', { class: 'pg-chip' + (style === v ? ' on' : ''), onclick: () => { style = v; drawStyle(); } }, t)));
      clipRow.style.display = style === 'picoteo' ? '' : 'none';
      styleHelp.textContent = style === 'picoteo'
        ? T('Solo se reproduce el trozo más visto de cada vídeo (según la curva de «lo más visto» de YouTube) y salta solo al siguiente. Ideal para ponerte al día rápido.')
        : T('Se reproduce cada vídeo entero.');
    };
    drawStyle();

    const status = h('div', { class: 'pg-tv-status', role: 'status' });
    const go = h('button', { class: 'pg-play pg-tv-go' }, T('▶ VER'));
    const current = () => ({ groups: [...groupsSel], channels: [...chansSel], onlyUnwatched: onlyNew.checked, maxAge: ageSel.value, amount: Number(amount.value) || 0, unit: unit.value, style, clip: Number(clipSel.value) || 60, maxLen: Number(lenSel.value) || 0 });
    const applyCfg = c => {
      c = Object.assign({}, YTBoxTV.DEFAULTS, c);
      groupsSel.clear(); c.groups.forEach(id => state.groups.some(g => g.id === id) && groupsSel.add(id));
      chansSel.clear(); c.channels.forEach(k => state.channels[k] && chansSel.add(k));
      onlyNew.checked = !!c.onlyUnwatched; ageSel.value = c.maxAge; amount.value = String(c.amount); unit.value = c.unit;
      lenSel.value = String(c.maxLen || 0); if (!lenSel.value) lenSel.value = '0';
      style = c.style === 'picoteo' ? 'picoteo' : 'full'; clipSel.value = String(c.clip || 60); if (!clipSel.value) clipSel.value = '60'; drawStyle();
      drawGroups(); drawCh(); if (chansSel.size) details.open = true; updateCount();
    };

    // Preconfiguraciones guardadas
    let activeId = null;
    const nameIn = h('input', { type: 'text', class: 'pg-search pg-tv-name', placeholder: T('Nombre, p. ej. Dormir'), maxlength: '40' });
    const presetBox = h('div', { class: 'pg-tv-presets' });
    const loadPreset = p => { activeId = p.id; applyCfg(p.cfg); nameIn.value = p.name; status.className = 'pg-tv-status'; status.textContent = ''; drawPresets(); };
    const drawPresets = () => {
      const list = YTBoxTV.presets(state);
      presetBox.replaceChildren(...(list.length ? list.map(p => {
        const del = h('button', { class: 'pg-tv-preset-x', title: T('Borrar'), 'aria-label': T('Borrar ') + p.name }, '✕');
        del.onclick = () => {
          if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = T('¿Borrar?'); setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = '✕'; } }, 3000); return; }
          YTBoxTV.deletePreset(state, p.id); if (activeId === p.id) activeId = null;
          PG.save({ settings: state.settings }); drawPresets();
        };
        return h('div', { class: 'pg-tv-preset' + (p.id === activeId ? ' on' : '') },
          h('button', { class: 'pg-tv-preset-load', title: T('Cargar «{0}»\n{1}', p.name, YTBoxTV.summary(p.cfg, state)), onclick: () => loadPreset(p) }, p.name),
          h('button', { class: 'pg-tv-preset-play', title: T('Ver ya'), 'aria-label': T('Ver ') + p.name, onclick: () => { loadPreset(p); go.click(); } }, '▶'), del);
      }) : [h('span', { class: 'pg-tv-count' }, T('Aún no tienes ninguna. Configura abajo y guárdala con un nombre.'))]));
    };
    const saveBtn = h('button', { class: 'pg-btn pg-tv-save' }, T('💾 Guardar'));
    saveBtn.onclick = () => {
      const name = nameIn.value.trim();
      if (!name) { status.className = 'pg-tv-status err'; status.textContent = T('Ponle un nombre a la preconfiguración.'); nameIn.focus(); return; }
      const exists = YTBoxTV.presets(state).some(x => x.name.toLowerCase() === name.toLowerCase());
      const p = YTBoxTV.savePreset(state, name, current()); activeId = p.id;
      PG.save({ settings: state.settings }); drawPresets();
      status.className = 'pg-tv-status'; status.textContent = exists ? T('«{0}» actualizada.', p.name) : T('«{0}» guardada.', p.name);
    };
    nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn.click(); });
    drawPresets();

    // Indicador de trabajo: spinner, barra de progreso (n/m del texto de estado) y botón en «Cargando…»
    const spin = h('span', { class: 'pg-spin', 'aria-hidden': 'true' });
    const bar = h('div', { class: 'pg-tv-progress' }, h('i'));
    const progress = t => {
      status.textContent = t;
      const m = String(t).match(/(\d+)\/(\d+)/);
      bar.classList.toggle('indet', !m);
      bar.firstChild.style.width = m ? Math.round(100 * Number(m[1]) / Math.max(1, Number(m[2]))) + '%' : '';
    };
    const goLabel = () => (preview && preview.picked.length ? T('▶ VER ESTA LISTA') : T('▶ VER'));
    const setBusy = on => {
      box.classList.toggle('pg-busy', on);
      go.disabled = previewBtn.disabled = on;
      if (on) { bar.classList.add('indet'); bar.firstChild.style.width = ''; go.replaceChildren(h('span', { class: 'pg-spin pg-spin-w', 'aria-hidden': 'true' }), T('Cargando…')); }
      else go.textContent = goLabel();
    };

    // Previsualización: la lista generada, con opción de quitar vídeos antes de verla
    let preview = null; // { picked, cfg, picoteo, target }
    const previewBox = h('div', { class: 'pg-tv-preview', style: 'display:none' });
    const previewBtn = h('button', { class: 'pg-btn pg-tv-prevbtn', title: T('Ver qué vídeos se van a cargar antes de reproducirlos') }, T('👁 Previsualizar'));
    const segDur = v => preview && preview.picoteo ? v.end - v.start : v.seconds;
    const chName = id => (Object.values(state.channels).find(c => c.id === id) || {}).name || '';
    const drawPreview = () => {
      if (!preview) { previewBox.style.display = 'none'; previewBox.replaceChildren(); if (!box.classList.contains('pg-busy')) go.textContent = goLabel(); return; }
      const { picked, picoteo } = preview;
      const total = picked.reduce((a, v) => a + segDur(v), 0);
      if (!box.classList.contains('pg-busy')) go.textContent = goLabel();
      previewBox.style.display = '';
      previewBox.replaceChildren(
        h('div', { class: 'pg-tv-prevhead' },
          h('b', {}, picked.length ? T(picoteo ? '{0} trozos · {1}' : '{0} vídeos · {1}', picked.length, YTBoxTV.fmtDur(total)) : T('Has quitado todos los vídeos')),
          h('span', { class: 'pg-tv-prevtools' },
            h('button', { class: 'pg-btn pg-tv-mini', title: T('Generar otra lista distinta'), onclick: () => makePreview() }, T('🔀 Otra')),
            h('button', { class: 'pg-btn pg-tv-mini', title: T('Descartar la previsualización'), onclick: () => { preview = null; drawPreview(); } }, T('Descartar')))),
        h('ol', { class: 'pg-tv-prevlist' }, ...picked.map((v, i) => h('li', {},
          h('a', { class: 'pg-tv-prevthumb', href: '/watch?v=' + v.vid + (picoteo ? '&t=' + Math.round(v.start) + 's' : ''), target: '_blank', rel: 'noopener', title: T('Abrir en otra pestaña') },
            h('img', { src: `https://i.ytimg.com/vi/${v.vid}/mqdefault.jpg`, loading: 'lazy', alt: '' }),
            h('span', { class: 'pg-tv-prevdur' }, picoteo ? `${clock(v.start)}–${clock(v.end)}` : clock(v.seconds))),
          h('span', { class: 'pg-tv-previnfo' }, h('span', { class: 'pg-tv-prevtitle' }, v.title || v.vid), h('small', {}, chName(v.channelId) + (picoteo && v.hot ? T(' · 🔥 lo más visto') : ''))),
          h('button', { class: 'pg-tv-prevx', title: T('Quitar de la lista'), 'aria-label': T('Quitar ') + (v.title || v.vid), onclick: () => { preview.picked.splice(i, 1); drawPreview(); } }, '✕')))));
    };
    const makePreview = async () => {
      const newCfg = current();
      status.className = 'pg-tv-status';
      state.settings.tv = newCfg; PG.save({ settings: state.settings });
      setBusy(true); progress(T('Preparando…'));
      try {
        const r = await YTBoxTV.run(newCfg, state, progress);
        preview = { picked: r.picked, cfg: newCfg, picoteo: !!r.picoteo, target: r.target };
        status.textContent = r.total < r.target * 0.9 ? T('No hay más vídeos que cumplan las condiciones.') : T('Quita los que no te apetezcan y pulsa VER.');
        drawPreview();
        previewBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) { status.className += ' err'; status.textContent = e.message; }
      finally { setBusy(false); }
    };
    previewBtn.onclick = makePreview;
    const play = async (picked, cfgUsed, picoteo) => {
      const total = picked.reduce((a, v) => a + (picoteo ? v.end - v.start : v.seconds), 0);
      const what = picoteo ? `${picked.length} trozos` : T('{0} vídeos', picked.length);
      setBusy(true);
      const url = await YTBoxTV.start(picked, cfgUsed, state, progress);
      progress(T('{0} · {1}. Abriendo…', what, YTBoxTV.fmtDur(total)));
      bar.classList.remove('indet'); bar.firstChild.style.width = '100%';
      toast(T('Modo TV{0}: {1} · {2}', picoteo ? T(' · picoteo') : '', what, YTBoxTV.fmtDur(total)));
      setTimeout(() => { root.remove(); closeOverlay(); location.href = url; }, 600);
    };

    go.onclick = async () => {
      if (preview && preview.picked.length) return play(preview.picked, preview.cfg, preview.picoteo);
      const newCfg = current();
      status.className = 'pg-tv-status';
      state.settings.tv = newCfg; PG.save({ settings: state.settings });
      setBusy(true); progress(T('Preparando…'));
      try {
        const r = await YTBoxTV.run(newCfg, state, progress);
        if (r.total < r.target * 0.9) toast(T('No hay más vídeos que cumplan las condiciones'));
        await play(r.picked, newCfg, !!r.picoteo);
      } catch (e) { status.className += ' err'; status.textContent = e.message; setBusy(false); }
    };

    box.append(
      h('div', { class: 'pg-tv-head' }, h('span', { class: 'pg-tv-ico' }, PG.svgEl('tv', 26, 'currentColor')), h('h2', {}, T('Modo TV')),
        h('button', { class: 'pg-btn', title: T('Cerrar (Esc)'), 'aria-label': T('Cerrar'), onclick: () => root.remove() }, '✕')),
      h('p', { class: 'pg-tv-intro' }, T('Crea una lista con vídeos al azar de los canales que elijas y la reproduce, con la duración total que indiques.')),
      h('section', {}, h('h3', {}, T('Mis preconfiguraciones')), presetBox),
      h('section', {}, h('h3', {}, T('¿De qué canales?')), gchips, sel.box, details, count),
      h('section', {}, h('h3', {}, T('¿Qué vídeos?')),
        h('label', { class: 'pg-toggle' }, onlyNew, T('Solo vídeos que no he visto')),
        h('div', { class: 'pg-tv-row' }, h('span', {}, T('Subidos en')), ageSel),
        h('div', { class: 'pg-tv-row' }, h('span', {}, T('Duración máxima de cada vídeo')), lenSel)),
      h('section', {}, h('h3', {}, T('¿Cuánto tiempo?')),
        h('div', { class: 'pg-tv-row' }, amount, unit), quick),
      h('section', {}, h('h3', {}, T('¿Cómo lo ves?')), styleBox, clipRow, styleHelp),
      h('section', {}, h('h3', {}, T('Guardar como preconfiguración')), h('div', { class: 'pg-tv-row' }, nameIn, saveBtn)),
      h('div', { class: 'pg-tv-foot' }, spin, status, previewBtn, go),
      bar,
      previewBox);
    updateCount();
    document.body.append(root);
    const pre = presetId && YTBoxTV.presets(state).find(x => x.id === presetId);
    if (pre) loadPreset(pre);
    // Desde la barra lateral: carga la preconfiguración y deja la lista preparada (no reproduce hasta pulsar VER)
    setTimeout(() => { go.focus(); if (pre && autoplay === 'preview') makePreview(); else if (pre && autoplay) go.click(); }, 0);
  }

  // Chips con los canales sueltos elegidos (× para quitar uno, «Quitar todos») — Modo TV y Descubrir
  function selectedChips(set, onChange) {
    const box = h('div', { class: 'pg-selchips' });
    const draw = () => {
      const list = [...set].map(k => state.channels[k]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
      box.style.display = list.length ? '' : 'none';
      box.replaceChildren(
        h('span', { class: 'pg-selchips-label' }, T('Canales sueltos ({0}):', list.length)),
        ...list.map(c => h('span', { class: 'pg-selchip' },
          c.avatar ? h('img', { src: c.avatar, referrerpolicy: 'no-referrer', alt: '' }) : h('span', { class: 'pg-tv-av' }),
          h('span', { class: 'pg-selchip-name' }, c.name),
          h('button', { class: 'pg-selchip-x', title: T('Quitar'), 'aria-label': T('Quitar ') + c.name, onclick: () => { set.delete(c.key); onChange(); } }, '×'))),
        ...(list.length > 1 ? [h('button', { class: 'pg-selchip-all', onclick: () => { set.clear(); onChange(); } }, T('Quitar todos'))] : []));
    };
    return { box, draw };
  }

  // ---------- Modo Descubrir: canales parecidos que aún no tienes ----------
  function openDiscover() {
    $('#pg-tv')?.remove();
    const cfg = Object.assign({}, YTBoxDiscover.DEFAULTS, state.settings.discover || {});
    const groupsSel = new Set(cfg.groups.filter(id => state.groups.some(g => g.id === id)));
    const chansSel = new Set(cfg.channels.filter(k => state.channels[k]));
    const root = h('div', { id: 'pg-tv', class: 'pg-disc', role: 'dialog', 'aria-modal': 'true', 'aria-label': T('Descubrir canales') });
    ['keydown', 'keyup', 'keypress'].forEach(t => root.addEventListener(t, e => { e.stopPropagation(); if (t === 'keydown' && e.key === 'Escape') root.remove(); }));
    root.addEventListener('mousedown', e => { if (e.target === root) root.remove(); });
    const onEsc = e => { if (!root.isConnected) return window.removeEventListener('keydown', onEsc, true); if (e.key === 'Escape' && !$('#pg-disc-gmenu')) { e.stopPropagation(); root.remove(); } };
    window.addEventListener('keydown', onEsc, true);
    const box = h('div', { class: 'pg-tv-box pg-disc-box' });
    root.append(box);

    const count = h('span', { class: 'pg-tv-count' });
    const selected = () => YTBoxTV.selectedChannels({ groups: [...groupsSel], channels: [...chansSel] }, state);
    const updateCount = () => { const n = selected().length; count.textContent = n ? TN(n, '{0} canal seleccionado', '{0} canales seleccionados') + (n > 12 ? T(' · se mirarán 12 al azar cada vez') : '') : T('Ningún canal seleccionado'); };
    const gchips = h('div', { class: 'pg-tv-chips' });
    const drawGroups = () => {
      const allOn = state.groups.length > 0 && state.groups.every(g => groupsSel.has(g.id));
      gchips.replaceChildren(
        ...(state.groups.length > 1 ? [h('button', { class: 'pg-chip pg-chip-all', title: allOn ? T('Quitar todos los grupos') : T('Elegir todos los grupos'),
          onclick: () => { if (allOn) groupsSel.clear(); else state.groups.forEach(g => groupsSel.add(g.id)); drawGroups(); updateCount(); } },
          PG.svgEl('check', 16, 'currentColor'), allOn ? T('Desmarcar todos') : T('Marcar todos'))] : []),
        ...state.groups.map(g => h('button', { class: 'pg-chip' + (groupsSel.has(g.id) ? ' on' : ''), onclick: () => { groupsSel.has(g.id) ? groupsSel.delete(g.id) : groupsSel.add(g.id); drawGroups(); updateCount(); } }, PG.iconEl(g, 20), g.name)));
    };
    drawGroups();
    const q = h('input', { type: 'search', class: 'pg-search', placeholder: T('Buscar canal…'), style: 'width:100%;box-sizing:border-box' });
    const clist = h('div', { class: 'pg-tv-clist' });
    const allCh = Object.values(state.channels).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    const sel = selectedChips(chansSel, () => { drawCh(); updateCount(); });
    const drawCh = () => {
      sel.draw();
      const t = q.value.toLowerCase();
      clist.replaceChildren(...allCh.filter(c => !t || c.name.toLowerCase().includes(t) || (c.handle || '').includes(t)).slice(0, 300).map(c => {
        const cb = h('input', { type: 'checkbox' }); cb.checked = chansSel.has(c.key);
        cb.addEventListener('change', () => { cb.checked ? chansSel.add(c.key) : chansSel.delete(c.key); updateCount(); sel.draw(); });
        return h('label', { class: 'pg-tv-ch' }, cb, c.avatar ? h('img', { src: c.avatar, referrerpolicy: 'no-referrer' }) : h('span', { class: 'pg-tv-av' }), h('span', {}, c.name));
      }));
    };
    q.addEventListener('input', drawCh); drawCh();
    const details = h('details', { class: 'pg-tv-details' }, h('summary', {}, T('Elegir canales sueltos')), q, clist);
    if (chansSel.size) details.open = true;

    const status = h('div', { class: 'pg-tv-status', role: 'status' });
    const results = h('div', { class: 'pg-disc-results' });
    const go = h('button', { class: 'pg-play pg-tv-go' }, T('✦ Descubrir'));

    // Añadir un canal sugerido a uno de tus grupos
    const addTo = async (f, g, card) => {
      const key = f.handle || f.id;
      if (!state.channels[key]) state.channels[key] = { key, id: f.id, handle: f.handle || null, name: f.name || key, avatar: f.avatar || '' };
      if (!g.channels.includes(key)) g.channels.push(key);
      await PG.save({ channels: state.channels, groups: state.groups });
      card.classList.add('pg-disc-added');
      card.querySelector('.pg-disc-add').textContent = T('✓ En «{0}»', g.name);
      toast(T('«{0}» añadido a «{1}»', f.name, g.name));
    };
    const groupMenu = (btn, f, card) => {
      $('#pg-disc-gmenu')?.remove();
      const m = h('div', { id: 'pg-disc-gmenu' }, h('div', { class: 'pg-vtitle' }, T('Añadir a…')),
        ...state.groups.map(g => h('button', { class: 'pg-vitem', onclick: e => { e.stopPropagation(); m.remove(); addTo(f, g, card); } }, PG.iconEl(g, 20), h('span', {}, g.name))));
      if (!state.groups.length) m.append(h('div', { class: 'pg-vloading' }, T('Aún no tienes grupos.')));
      const close = e => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', close, true); } };
      document.addEventListener('mousedown', close, true);
      m.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); m.remove(); } });
      document.body.append(m);
      const r = btn.getBoundingClientRect();
      m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.left)) + 'px';
      m.style.top = (r.bottom + m.offsetHeight + 8 > window.innerHeight ? Math.max(8, r.top - m.offsetHeight - 4) : r.bottom + 4) + 'px';
    };
    const cardFor = f => {
      const url = 'https://www.youtube.com/' + (f.handle || 'channel/' + f.id);
      const card = h('div', { class: 'pg-disc-card' });
      const add = h('button', { class: 'pg-disc-add pg-play' }, T('+ Añadir a grupo'));
      add.onclick = e => { e.stopPropagation(); if (!card.classList.contains('pg-disc-added')) groupMenu(add, f, card); };
      const nope = h('button', { class: 'pg-disc-nope', title: T('No volver a sugerirlo') }, T('No me interesa'));
      nope.onclick = async () => {
        const ig = state.settings.discoverIgnored || (state.settings.discoverIgnored = []);
        if (!ig.includes(f.id)) ig.push(f.id);
        await PG.save({ settings: state.settings });
        card.remove();
      };
      card.append(
        h('a', { class: 'pg-disc-who', href: url, target: '_blank', rel: 'noopener', title: T('Abrir el canal en una pestaña nueva') },
          f.avatar ? h('img', { src: f.avatar, referrerpolicy: 'no-referrer' }) : h('span', { class: 'pg-tv-av' }),
          h('span', {}, h('b', {}, f.name || f.handle || f.id), h('small', {}, f.handle || ''))),
        h('div', { class: 'pg-disc-why' }, T('Parecido a {0}', f.sourceNames.slice(0, 3).join(', ') + (f.sourceNames.length > 3 ? T(' y {0} más', f.sourceNames.length - 3) : '')) + TN(f.hits, ' · sale {0} vez en sus relacionados', ' · sale {0} veces en sus relacionados')),
        h('ul', { class: 'pg-disc-vids' }, ...f.videos.slice(0, 2).map(v => h('li', {}, h('a', { href: 'https://www.youtube.com/watch?v=' + v.vid, target: '_blank', rel: 'noopener' }, v.title)))),
        h('div', { class: 'pg-disc-btns' }, add, nope));
      return card;
    };
    const spin = h('span', { class: 'pg-spin', 'aria-hidden': 'true' });
    const bar = h('div', { class: 'pg-tv-progress' }, h('i'));
    const progress = t => {
      status.textContent = t;
      const m = String(t).match(/(\d+)\/(\d+)/);
      bar.classList.toggle('indet', !m);
      bar.firstChild.style.width = m ? Math.round(100 * Number(m[1]) / Math.max(1, Number(m[2]))) + '%' : '';
    };
    const setBusy = on => {
      box.classList.toggle('pg-busy', on); go.disabled = on;
      if (on) go.replaceChildren(h('span', { class: 'pg-spin pg-spin-w', 'aria-hidden': 'true' }), T('Buscando…')); else go.textContent = T('✦ Descubrir');
    };
    go.onclick = async () => {
      const c = { groups: [...groupsSel], channels: [...chansSel] };
      state.settings.discover = c; PG.save({ settings: state.settings });
      status.className = 'pg-tv-status'; setBusy(true); progress(T('Preparando…')); results.replaceChildren();
      try {
        const r = await YTBoxDiscover.run(c, state, progress);
        status.textContent = r.list.length ? T('{0} canales sugeridos a partir de {1} de tus canales. Vuelve a pulsar para otra tanda.', r.list.length, r.scanned) : T('No he encontrado canales nuevos esta vez. Prueba con otros canales o vuelve a intentarlo.');
        results.append(...r.list.map(cardFor));
        results.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) { status.className += ' err'; status.textContent = e.message; }
      finally { setBusy(false); }
    };

    box.append(
      h('div', { class: 'pg-tv-head' }, h('span', { class: 'pg-tv-ico' }, PG.svgEl('brujula', 26, 'currentColor')), h('h2', {}, T('Descubrir')),
        h('button', { class: 'pg-btn', title: T('Cerrar (Esc)'), 'aria-label': T('Cerrar'), onclick: () => root.remove() }, '✕')),
      h('p', { class: 'pg-tv-intro' }, T('Elige tus canales y te sugiero canales parecidos que aún no tienes en YTBox: los que más aparecen en los vídeos relacionados de los tuyos.')),
      h('section', {}, h('h3', {}, T('¿A partir de qué canales?')), gchips, sel.box, details, count),
      h('div', { class: 'pg-tv-foot' }, spin, status, go),
      bar,
      results);
    updateCount();
    document.body.append(root);
    setTimeout(() => go.focus(), 0);
  }

  // ---------- Picoteo: en /watch, reproducir solo el trozo elegido de cada vídeo y saltar al siguiente ----------
  let tvSession = null, picoVid = null, picoSeeked = false, picoAdvancing = false;
  const picoFull = new Set();
  chrome.storage.local.get('tvSession').then(r => { tvSession = r.tvSession || null; });
  chrome.storage.onChanged.addListener(ch => { if (ch.tvSession) tvSession = ch.tvSession.newValue || null; });
  const picoActive = () => !!(tvSession && tvSession.clips && Date.now() - tvSession.t < 12 * 3600e3);
  const clock = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function endPicoteo(msg) { chrome.storage.local.remove('tvSession'); tvSession = null; $('#pg-pico')?.remove(); if (msg) toast(msg); }
  function picoNext(vid, video) {
    const order = tvSession.order || [];
    const next = order[order.indexOf(vid) + 1];
    if (!next) { video.pause(); endPicoteo(T('🍿 Fin del picoteo')); return; }
    const btn = $('#movie_player .ytp-next-button');
    if (btn && (btn.getAttribute('href') || '').includes(next)) btn.click();
    else {
      const list = new URLSearchParams(location.search).get('list');
      location.href = `/watch?v=${next}` + (list ? `&list=${list}` : '');
    }
  }
  function picoBadge(vid, video, clip, player) {
    let b = $('#pg-pico');
    if (!b || b.parentNode !== player) {
      b?.remove();
      b = h('div', { id: 'pg-pico' },
        h('span', { class: 'pg-pico-txt' }),
        h('button', { class: 'pg-pico-full', title: T('Ver este vídeo entero sin saltar'), onclick: e => { e.stopPropagation(); picoFull.add(picoVid); } }, T('Ver entero')),
        h('button', { title: T('Saltar al siguiente trozo'), onclick: e => { e.stopPropagation(); picoAdvancing = true; picoNext(picoVid, $('#movie_player video')); } }, '⏭'),
        h('button', { title: T('Salir del picoteo (seguir viendo normal)'), onclick: e => { e.stopPropagation(); endPicoteo(T('Picoteo terminado')); } }, '✕'));
      ['mousedown', 'click', 'dblclick'].forEach(t => b.addEventListener(t, e => e.stopPropagation()));
      player.append(b);
    }
    const order = tvSession.order || [];
    const full = picoFull.has(vid);
    b.querySelector('.pg-pico-txt').textContent = T('🍿 Picoteo {0}/{1} · ', order.indexOf(vid) + 1, order.length) + (full ? T('viendo entero') : T('siguiente en {0}', clock(clip[1] - video.currentTime)));
    b.querySelector('.pg-pico-full').style.display = full ? 'none' : '';
  }
  document.addEventListener('timeupdate', e => {
    const video = e.target;
    if (!(video instanceof HTMLVideoElement) || !picoActive() || location.pathname !== '/watch') return;
    const player = video.closest('#movie_player');
    if (!player) return;
    const vid = new URLSearchParams(location.search).get('v');
    const clip = vid && tvSession.clips[vid];
    if (!clip) { $('#pg-pico')?.remove(); return; }
    if (player.classList.contains('ad-showing')) return;
    if (clip[2] && Math.abs(video.duration - clip[2]) > 5) return; // el <video> aún tiene el vídeo anterior
    if (vid !== picoVid) { picoVid = vid; picoSeeked = false; picoAdvancing = false; }
    if (!picoSeeked) { picoSeeked = true; if (video.currentTime < clip[0] - 2 || video.currentTime > clip[1]) video.currentTime = clip[0]; }
    picoBadge(vid, video, clip, player);
    if (!picoAdvancing && !picoFull.has(vid) && video.currentTime >= clip[1] - 0.3) { picoAdvancing = true; picoNext(vid, video); }
  }, true);

  // ---------- Estante de YTBox en la portada de YouTube ----------
  // Cada vez que entras en la portada sale un grupo al azar (se cambia con ▾ o el botón aleatorio).
  // Muestra siempre 3 vídeos (los más recientes del grupo) y ‹ › pasan de 3 en 3.
  // Va entre las recomendaciones de YouTube, después de sus dos primeras filas.
  const HOME_N = 3;
  const home = { groupId: null, wasHome: false, page: 0, loading: false, items: [], token: 0 };
  const homeEnabled = () => state.settings.homeShelf !== false;
  const homeGroups = () => state.groups.filter(g => !g.muted && g.channels.length);
  function homeAnchor() {
    const grid = $('ytd-browse[page-subtype="home"] ytd-rich-grid-renderer');
    const contents = grid && grid.querySelector(':scope > #contents');
    if (!contents) return null;
    const perRow = parseInt(getComputedStyle(grid).getPropertyValue('--ytd-rich-grid-items-per-row')) || 3;
    const rows = contents.querySelectorAll(':scope > ytd-rich-grid-row');
    if (rows.length) return rows.length >= 2 ? { parent: contents, after: rows[1] } : null; // diseño antiguo, por filas
    const items = contents.querySelectorAll(':scope > ytd-rich-item-renderer');
    const target = items[perRow * 2 - 1];
    return target ? { parent: contents, after: target } : null;
  }
  function decorateHome() {
    const onHome = location.pathname === '/';
    let el = $('#pg-home');
    if (!onHome || !homeEnabled() || !homeGroups().length) { el && el.remove(); home.wasHome = onHome; return; }
    const spot = homeAnchor();
    if (!spot) return; // aún no ha cargado la portada
    const entering = !home.wasHome;
    home.wasHome = true;
    if (entering || !home.groupId || !state.groups.some(g => g.id === home.groupId && !g.muted)) {
      const list = homeGroups();
      home.groupId = list[Math.floor(Math.random() * list.length)].id;
      home.page = 0; home.items = [];
    }
    const fresh = !el || !el.isConnected;
    if (fresh) { el = h('div', { id: 'pg-home' }); }
    if (fresh || el.parentElement !== spot.parent) spot.after.after(el);
    if (fresh) { if (home.items.length && !entering) drawHome(); else loadHome(); }
    else if (entering) loadHome();
  }
  async function loadHome() {
    const g = state.groups.find(x => x.id === home.groupId);
    if (!g) return;
    const token = ++home.token;
    home.loading = true; home.items = []; home.page = 0; drawHome();
    const chans = g.channels.map(k => state.channels[k]).filter(c => c && c.id);
    let all = [];
    await pool(chans, 6, async c => {
      const items = await fetchRss(c.id);
      if (token !== home.token) return;
      all = all.concat(items.filter(v => !v.short));
      home.items = all.slice().sort((a, b) => b.published - a.published).slice(0, 60);
      drawHome();
      ensureDurations(c.id, items).then(ch => { if (ch && token === home.token) drawHome(); }).catch(() => {});
    });
    if (token !== home.token) return;
    home.loading = false; drawHome();
  }
  let homeDrawT = null;
  function drawHome() { clearTimeout(homeDrawT); homeDrawT = setTimeout(drawHomeNow, 60); }
  async function drawHomeNow() {
    const el = $('#pg-home');
    if (!el) return;
    const g = state.groups.find(x => x.id === home.groupId);
    if (!g) { el.remove(); return; }
    const pages = Math.max(1, Math.ceil(home.items.length / HOME_N));
    home.page = Math.min(home.page, pages - 1);
    const from = Math.max(0, Math.min(home.page * HOME_N, home.items.length - HOME_N)); // la última página también muestra 3
    const show = home.items.slice(from, from + HOME_N);
    const { seen = {}, marks = {}, watched = {} } = await chrome.storage.local.get(['seen', 'marks', 'watched']);
    const since = seen[g.id] || 0, m = marks[g.id] || {};
    const isNewV = v => v.vid in m ? m[v.vid] : (since > 0 && v.published.getTime() > since);
    // Mismas acciones que en la vista de un grupo (ver más tarde, listas, cola, ⋮)
    const homeCtx = {
      isNew: isNewV, isWatched: v => !!watched[v.vid], opened: () => {},
      toggleNew: async v => {
        const all = (await chrome.storage.local.get('marks')).marks || {};
        (all[g.id] || (all[g.id] = {}))[v.vid] = !isNewV(v);
        await chrome.storage.local.set({ marks: all }); drawHome(); quickRecount().catch(() => {});
      },
      toggleWatched: async v => {
        const w = (await chrome.storage.local.get('watched')).watched || {};
        if (w[v.vid]) delete w[v.vid]; else w[v.vid] = Date.now();
        await chrome.storage.local.set({ watched: w }); drawHome(); quickRecount().catch(() => {});
      },
    };
    const byId = new Map(Object.values(state.channels).filter(c => c.id).map(c => [c.id, c]));
    const pick = h('button', { class: 'pg-home-pick', title: T('Cambiar de grupo'), onclick: e => { e.stopPropagation(); homeGroupMenu(pick); } },
      PG.iconEl(g, 28), h('span', {}, g.name), h('span', { class: 'pg-home-caret' }, '▾'));
    const playAll = h('button', { class: 'pg-home-btn', title: T('Ver los vídeos del grupo en una lista'), onclick: () => {
      const ids = home.items.slice(0, 50).map(v => v.vid); if (ids.length) location.href = '/watch_videos?video_ids=' + ids.join(','); } }, T('▶ Reproducir todo'));
    const shuffle = h('button', { class: 'pg-home-btn pg-home-icon', title: T('Otro grupo al azar'), 'aria-label': T('Otro grupo al azar'), onclick: () => {
      const list = homeGroups().filter(x => x.id !== home.groupId); if (!list.length) return;
      home.groupId = list[Math.floor(Math.random() * list.length)].id; loadHome(); } }, PG.svgEl('aleatorio', 18, 'currentColor'));
    const open = h('button', { class: 'pg-home-btn', title: T('Abrir el grupo completo'), onclick: () => openGroup(g.id) }, T('Abrir grupo'));
    const cfg = h('button', { class: 'pg-home-btn pg-home-icon', title: T('Ajustes (activar o quitar este estante)'), 'aria-label': T('Ajustes del estante'), onclick: () => openManager('settings') }, PG.svgEl('engranaje', 18, 'currentColor'));
    const nav = (dir, label, disabled) => h('button', { class: 'pg-home-btn pg-home-icon pg-home-nav', title: label, 'aria-label': label, ...(disabled ? { disabled: '' } : {}),
      onclick: () => { home.page += dir; drawHome(); } }, PG.svgEl('chevron', 18, 'currentColor'));
    const prev = nav(-1, '3 anteriores', home.page === 0 || !home.items.length); prev.classList.add('pg-home-prev');
    const next = nav(1, '3 siguientes', home.page >= pages - 1 || !home.items.length);
    const cards = show.map(v => {
      const c = byId.get(v.channelId) || {};
      const url = '/watch?v=' + v.vid;
      const dur = v.vid in durations ? fmtDuration(durations[v.vid]) : null;
      return h('div', { class: 'pg-home-card' + (watched[v.vid] ? ' pg-home-watched' : '') },
        h('a', { class: 'pg-home-thumb', href: url },
          h('img', { src: `https://i.ytimg.com/vi/${v.vid}/mqdefault.jpg`, loading: 'lazy', alt: '' }),
          isNewV(v) && !watched[v.vid] ? h('span', { class: 'pg-home-new' }, T('Nuevo')) : null,
          watched[v.vid] ? h('span', { class: 'pg-home-seen' }, 'VISTO') : null,
          dur ? h('span', { class: 'pg-dur' }, dur) : null,
          hoverActions(v, homeCtx)),
        h('div', { class: 'pg-home-meta' },
          c.avatar ? h('img', { class: 'pg-home-av', src: c.avatar, referrerpolicy: 'no-referrer', alt: '' }) : h('span', { class: 'pg-home-av' }),
          h('div', { style: 'min-width:0' },
            h('a', { class: 'pg-home-title', href: url, title: v.title }, v.title),
            h('div', { class: 'pg-home-sub' }, h('a', { class: 'pg-chlink', href: '/' + (c.handle || 'channel/' + v.channelId), title: T('Ir al canal') }, v.author || c.name || '')),
            h('div', { class: 'pg-home-sub' }, (v.views ? PG.fmtViews(v.views) + ' · ' : '') + PG.relTime(v.published))),
          h('button', { class: 'pg-dots', title: T('Más acciones'), onclick: e => { e.preventDefault(); e.stopPropagation(); openVideoMenu(e.currentTarget, v, homeCtx); } }, '⋮')));
    });
    while (cards.length < HOME_N && cards.length) cards.push(h('div', { class: 'pg-home-card pg-home-empty' }));
    el.replaceChildren(
      h('div', { class: 'pg-home-head' }, h('span', { class: 'pg-home-brand' }, 'YTBox'), pick, playAll, h('span', { class: 'pg-home-spacer' }),
        home.items.length ? h('span', { class: 'pg-home-range' }, T('{0}–{1} de {2}', from + 1, Math.min(from + HOME_N, home.items.length), home.items.length)) : null,
        prev, next, shuffle, open, cfg),
      !show.length ? h('div', { class: 'pg-home-loading' }, home.loading ? h('span', { class: 'pg-spin', style: 'display:inline-block' }) : null,
        home.loading ? T('Cargando los vídeos de «') + g.name + '»…' : T('No hay vídeos recientes en este grupo.'))
        : h('div', { class: 'pg-home-grid' }, ...cards));
  }
  function homeGroupMenu(btn) {
    const old = $('#pg-menu');
    if (old) { old.remove(); if (old.dataset.kind === 'home') return; }
    const menu = h('div', { id: 'pg-menu', 'data-kind': 'home' },
      ...homeGroups().map(g => h('button', { class: 'pg-vitem' + (g.id === home.groupId ? ' on' : ''), onclick: () => {
        menu.remove(); if (g.id === home.groupId) return; home.groupId = g.id; home.expanded = false; loadHome(); } },
        PG.iconEl(g, 22), h('span', {}, g.name), newCounts[g.id] ? h('span', { class: 'pg-guide-new', style: 'margin-left:auto' }, String(newCounts[g.id])) : null)));
    document.body.append(menu);
    const r = btn.getBoundingClientRect();
    menu.style.maxHeight = Math.max(200, window.innerHeight - r.bottom - 20) + 'px'; menu.style.overflow = 'auto';
    menu.style.top = (r.bottom + 6) + 'px'; menu.style.left = Math.max(8, r.left) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function close(e) {
      if (!menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close); }
    }), 0);
  }

  // Con el ratón encima de un menú de YTBox, la rueda solo mueve el menú (nunca la página de detrás)
  document.addEventListener('wheel', e => {
    // El contenedor que realmente tiene scroll puede ser el propio menú (#pg-menu…) o una lista
    // interior suya (.pg-vlists, en «Guardar en una lista»): closest() ya encuentra el más cercano
    const m = e.target instanceof Element && e.target.closest('.pg-vlists, #pg-menu, #pg-launch-menu, #pg-vmenu, #pg-disc-gmenu');
    if (!m) return;
    e.preventDefault(); e.stopPropagation();
    m.scrollTop += e.deltaMode === 1 ? e.deltaY * 18 : e.deltaY;
  }, { passive: false, capture: true });

  // ---------- Ciclo ----------
  function safe(fn, ...a) { try { fn(...a); } catch (e) { console.error('[YTBox]', e); } }
  function tick() { renderGuide(false); safe(updateFab); safe(decorateChannelList, false); safe(positionOverlay); safe(decorateFeed); safe(decorateHome); recordWatched().catch(() => {}); recordChannelView().catch(() => {}); }
  document.addEventListener('yt-navigate-finish', () => { $('#pg-menu')?.remove(); setTimeout(tick, 300); setTimeout(tick, 1500); });
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg.type === 'openGroup') openGroup(msg.id);
    // El gestor pide a esta pestaña de YouTube que haga una consulta a YouTube por él
    if (msg.type === 'ytbox-fetch' && sender.id === chrome.runtime.id && /^https:\/\/www\.youtube\.com\/youtubei\//.test(msg.url)) {
      const o = msg.opts || {};
      const headers = Object.assign({}, o.headers || {});
      (async () => {
        if (o.auth && YTAPI.loggedIn()) { try { const json = await YTAPI.signedCall(msg.url, o.body); return { ok: true, status: 200, text: JSON.stringify(json) }; } catch {} }
        const r = await PG.fetch(msg.url, { method: o.method || 'GET', headers, body: o.body, credentials: o.credentials || 'include' });
        return { ok: r.ok, status: r.status, text: await r.text() };
      })().then(reply, e => reply({ error: String(e && e.message || e) }));
      return true;
    }
  });
  refresh().then(() => { setInterval(tick, 1500); setTimeout(() => updateNewCounts().catch(() => {}), 2500); setInterval(() => updateNewCounts().catch(() => {}), 5 * 60 * 1000); });

  // Abrir grupo desde URL (?pg_group=id), p. ej. desde el gestor
  const pgParam = new URLSearchParams(location.search).get('pg_group');
  if (pgParam) setTimeout(() => openGroup(pgParam), 800);
})();
