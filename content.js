// YTBox — script de contenido para youtube.com
(() => {
  let state = { groups: [], channels: {}, settings: {} };
  const rssCache = new Map(); // id -> { t, items }

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

  async function refresh() { state = await PG.load(); applyTheme(); renderGuide(true); safe(updateFab); safe(decorateChannelList, true); const fb = $('#pg-feedbar'); fb && safe(drawFeedBar, fb); }
  chrome.storage.onChanged.addListener(ch => { if (ch.groups || ch.channels || ch.settings) refresh(); });

  function openManager(hash = '') { chrome.runtime.sendMessage({ type: 'openManager', hash }); }

  // ---------- Barra lateral ----------
  function guideSections() {
    const s = $('ytd-guide-renderer#guide-renderer #sections') || $('ytd-guide-renderer #sections');
    return s && s.getBoundingClientRect().width > 0 && $('tp-yt-app-drawer#guide[opened]') ? s : null;
  }

  function renderGuide(force) {
    try { renderGuideInner(force); } catch (e) { console.error('[YTBox] barra lateral', e); }
    updateLauncher();
  }

  function groupRows(container, size) {
    for (const g of state.groups) {
      const n = newCounts[g.id] || 0;
      container.append(h('a', { class: 'pg-guide-item', href: '#', title: n ? `${g.name} · ${n} vídeo${n > 1 ? 's' : ''} nuevo${n > 1 ? 's' : ''}` : g.name, onclick: e => { e.preventDefault(); $('#pg-launch-menu')?.remove(); openGroup(g.id); } },
        PG.iconEl(g, size), h('span', { class: 'pg-guide-name' + (n ? ' pg-has-new' : '') }, g.name),
        n ? h('span', { class: 'pg-guide-new' }, n > 99 ? '99+' : String(n)) : h('span', { class: 'pg-guide-count' }, String(g.channels.length))));
    }
  }

  // ---------- Novedades por grupo (para la barra lateral) ----------
  const newCounts = {};
  let countingAt = 0;
  async function updateNewCounts(force) {
    if (!force && Date.now() - countingAt < 15 * 60 * 1000) return;
    countingAt = Date.now();
    const { seen = {}, marks = {}, watched = {} } = await chrome.storage.local.get(['seen', 'marks', 'watched']);
    const ids = new Set();
    for (const g of state.groups) if (seen[g.id]) g.channels.forEach(k => { const c = state.channels[k]; c && c.id && ids.add(c.id); });
    const feed = {};
    await pool([...ids], 4, async id => { feed[id] = await fetchRss(id); });
    for (const g of state.groups) {
      const since = seen[g.id];
      if (!since) { newCounts[g.id] = 0; continue; }
      const m = marks[g.id] || {};
      let n = 0;
      for (const k of g.channels) {
        const c = state.channels[k];
        for (const v of (c && feed[c.id]) || []) {
          const isN = v.vid in m ? m[v.vid] : v.published.getTime() > since;
          if (isN && !watched[v.vid]) n++;
        }
      }
      newCounts[g.id] = n;
    }
    renderGuide(true);
  }

  // Botón flotante con los grupos cuando la barra lateral está plegada o en modo mini
  function updateLauncher() {
    let l = $('#pg-launcher');
    if (guideSections() && $('#pg-guide')) { l && l.remove(); $('#pg-launch-menu')?.remove(); return; }
    if (!l) {
      l = h('button', { id: 'pg-launcher', title: 'YTBox: tus grupos', onclick: () => {
        const old = $('#pg-launch-menu'); if (old) { old.remove(); return; }
        const m = h('div', { id: 'pg-launch-menu' }, h('div', { class: 'pg-menu-title' }, 'YTBox · Grupos'));
        if (!state.groups.length) m.append(h('div', { class: 'pg-menu-empty' }, 'Aún no tienes grupos.'));
        groupRows(m, 24);
        m.append(h('a', { class: 'pg-guide-item', href: '#', onclick: e => { e.preventDefault(); m.remove(); openManager(); } }, h('span', { style: 'width:24px;text-align:center' }, '⚙'), h('span', { class: 'pg-guide-name' }, 'Gestionar grupos')));
        document.body.append(m);
        setTimeout(() => document.addEventListener('mousedown', function close(e) {
          if (!m.contains(e.target) && !l.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', close); }
        }), 0);
      } }, '📦');
      document.body.append(l);
    }
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
    box.append(h('div', { class: 'pg-guide-head' },
      h('button', { class: 'pg-guide-title', title: 'Mostrar/ocultar grupos', onclick: async () => {
        state.settings.sidebarOpen = !open; await PG.save({ settings: state.settings });
      } }, (open ? '▾ ' : '▸ ') + 'YTBox'),
      h('button', { class: 'pg-guide-btn', title: 'Nuevo grupo', onclick: () => openManager('new') }, '+'),
      h('button', { class: 'pg-guide-btn', title: 'Gestionar grupos', onclick: () => openManager() }, '⚙'),
    ));
    if (!open) return;
    if (!state.groups.length) {
      box.append(h('div', { class: 'pg-guide-empty' }, 'Aún no tienes grupos. ', h('a', { href: '#', onclick: e => { e.preventDefault(); openManager('new'); } }, 'Crear uno')));
    }
    groupRows(box, 24);
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

  let fab;
  function updateFab() {
    const ref = currentChannelRef();
    if (!ref || !ref.key) { fab && fab.remove(); fab = null; return; }
    if (!fab) { fab = h('div', { id: 'pg-fab' }); document.body.append(fab); }
    const ch = findChannelByKey(ref.key);
    const inGroups = ch ? state.groups.filter(g => g.channels.includes(ch.key)) : [];
    fab.replaceChildren(h('button', { class: 'pg-fab-btn', onclick: () => toggleMenu(ref) },
      inGroups.length ? h('span', { class: 'pg-fab-icons' }, inGroups.slice(0, 3).map(g => PG.iconEl(g, 18))) : '📁',
      inGroups.length ? ` En ${inGroups.length} grupo${inGroups.length > 1 ? 's' : ''}` : ' Añadir a grupo'));
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
    const ch = findChannelByKey(ref.key);
    menu.append(h('div', { class: 'pg-menu-title' }, ref.name || ref.key));
    if (!state.groups.length) menu.append(h('div', { class: 'pg-menu-empty' }, 'No hay grupos todavía.'));
    for (const g of state.groups) {
      const checked = ch && g.channels.includes(ch.key);
      const cb = h('input', { type: 'checkbox' }); cb.checked = !!checked;
      menu.append(h('label', { class: 'pg-menu-item' }, cb, PG.iconEl(g, 20), h('span', {}, g.name)));
      cb.addEventListener('change', async () => {
        cb.disabled = true;
        try {
          const c = await ensureStoredChannel(ref);
          const grp = state.groups.find(x => x.id === g.id);
          if (cb.checked) { if (!grp.channels.includes(c.key)) grp.channels.push(c.key); }
          else grp.channels = grp.channels.filter(k => k !== c.key);
          await PG.save({ groups: state.groups });
        } catch (e) { alert('YTBox: ' + e.message); cb.checked = !cb.checked; }
        cb.disabled = false;
      });
    }
    const input = h('input', { type: 'text', placeholder: 'Nuevo grupo…', class: 'pg-menu-new' });
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
      btn.textContent = `Cargando suscripciones… (${n})`;
      if (n === last) same++; else { same = 0; last = n; }
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise(r => setTimeout(r, 900));
    }
    const added = await importChannels(collectVisibleChannels());
    window.scrollTo(0, 0);
    btn.textContent = `✔ ${last} canales leídos, ${added} nuevos. Ve al gestor para organizarlos`;
    btn.disabled = false;
    btn.onclick = () => openManager('channels');
  }

  function decorateChannelList(force) {
    if (location.pathname !== '/feed/channels') { $('#pg-import-bar')?.remove(); return; }
    if (!$('#pg-import-bar')) {
      const btn = h('button', { class: 'pg-import-btn' }, '📥 Importar todas mis suscripciones a YTBox');
      btn.onclick = () => importAll(btn);
      const bar = h('div', { id: 'pg-import-bar' }, btn, h('button', { class: 'pg-import-btn pg-secondary', onclick: () => openManager('channels') }, 'Abrir gestor'));
      document.body.append(bar);
    }
    for (const r of $$('ytd-channel-renderer')) {
      let b = $('.pg-ch-btn', r);
      const a = $('a#main-link, a[href^="/@"], a[href^="/channel/"]', r);
      const key = a && PG.keyFromHref(a.href);
      if (!key) continue;
      if (!b) {
        b = h('button', { class: 'pg-ch-btn', title: 'Añadir a grupo' });
        b.addEventListener('click', e => {
          e.preventDefault(); e.stopPropagation();
          const name = ($('#channel-title #text, ytd-channel-name #text', r) || {}).textContent;
          toggleMenu({ href: a.getAttribute('href'), key, name: name && name.trim() }, b);
        });
        ($('#buttons', r) || r).prepend(b);
      } else if (!force) continue;
      const ch = findChannelByKey(key);
      const gs = ch ? state.groups.filter(g => g.channels.includes(ch.key)) : [];
      b.replaceChildren(...(gs.length ? gs.slice(0, 4).map(g => PG.iconEl(g, 18)) : ['📁 +']));
    }
  }

  // ---------- Vista de grupo (feed propio vía RSS) ----------
  async function fetchRss(id) {
    const c = rssCache.get(id);
    if (c && Date.now() - c.t < 10 * 60 * 1000) return c.items;
    const res = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + id, { credentials: 'include' });
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
    if (e.target.closest('#pg-guide, #pg-launcher, #pg-launch-menu, #pg-menu, #pg-fab')) return;
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
  async function openGroup(groupId, since) {
    const g = state.groups.find(x => x.id === groupId);
    if (!g) return;
    closeOverlay();
    overlayGroupId = groupId;
    overlayUrl = location.href;
    const seenAll = (await chrome.storage.local.get('seen')).seen || {};
    if (since === undefined) since = seenAll[groupId] || 0;
    const st = state.settings;
    const filters = { channel: null, q: '', onlyNew: false,
      type: st.typeFilter || (st.hideShorts ? 'videos' : 'all'), // all | videos | shorts
      watch: st.watchFilter || 'all',                             // all | unwatched
      sort: st.sortBy || 'new',                                   // new | old | views | channel
      period: st.period || 'all' };                               // all | day | week | month
    let mode = state.settings.playMode || 'todos';
    let selected = []; // ids en el orden en que se marcan
    overlay = h('div', { id: 'pg-overlay' });
    document.documentElement.classList.add('pg-noscroll');
    const status = h('span', { class: 'pg-status' }, 'Cargando…');
    const newCount = h('button', { class: 'pg-newcount', style: 'display:none;border:0;cursor:pointer', title: 'Mostrar solo los nuevos' });
    const search = h('input', { type: 'search', class: 'pg-search', placeholder: 'Buscar en el grupo' });
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
    const sortSel = select([['new', '↓ Más recientes'], ['old', '↑ Más antiguos'], ['views', '🔥 Más vistos'], ['channel', 'Canal (A-Z)']], filters.sort,
      v => { filters.sort = v; render(); saveSetting('sortBy', v); }, 'Ordenar por');
    const periodSel = select([['all', 'Cualquier fecha'], ['day', 'Últimas 24 horas'], ['week', 'Última semana'], ['month', 'Último mes']], filters.period,
      v => { filters.period = v; render(); renderChips(); saveSetting('period', v); }, 'Fecha de subida');
    const typeSeg = segmented([['all', 'Todo'], ['videos', 'Vídeos'], ['shorts', 'Shorts']], () => filters.type,
      v => { filters.type = v; render(); renderChips(); saveSetting('typeFilter', v); });
    const watchSeg = segmented([['all', 'Todos'], ['unwatched', 'No vistos']], () => filters.watch,
      v => { filters.watch = v; render(); renderChips(); saveSetting('watchFilter', v); });
    const applyView = () => {
      const vm = state.settings.viewMode || 'grid';
      overlay.classList.toggle('pg-list', vm === 'list');
      overlay.classList.toggle('pg-compact', vm === 'compact');
    };
    const viewSeg = segmented([['grid', 'Cuadrícula', 'cuadricula'], ['compact', 'Cuadrícula compacta', 'capas'], ['list', 'Lista', 'lista']], () => state.settings.viewMode || 'grid',
      v => { state.settings.viewMode = v; applyView(); saveSetting('viewMode', v); });
    const toolbar = h('div', { class: 'pg-toolbar' }, sortSel, periodSel, typeSeg, watchSeg, h('div', { class: 'pg-ov-spacer' }), viewSeg);
    const head = h('div', { class: 'pg-ov-head' },
      PG.iconEl(g, 40), h('h2', {}, g.name), newCount, status,
      h('div', { class: 'pg-ov-spacer' }),
      search,
      h('button', { class: 'pg-btn', title: 'Recargar', onclick: () => { g.channels.forEach(k => { const c = state.channels[k]; c && c.id && rssCache.delete(c.id); }); openGroup(groupId, since); } }, '⟳'),
      h('button', { class: 'pg-btn', title: 'Editar grupo', onclick: () => openManager('group=' + g.id) }, '✎'),
      h('button', { class: 'pg-btn', title: 'Cerrar (Esc)', onclick: closeOverlay }, '✕'));
    const chips = h('div', { class: 'pg-chips' });
    // Barra de reproducción: modo + botón para lanzar la cola
    const modeSel = h('select', { class: 'pg-mode', title: 'Qué vídeos añadir a la cola' },
      ...[['todos', 'Todos'], ['nuevos', 'Nuevos'], ['aleatorio', 'Aleatorio'], ['seleccionar', 'Seleccionar']].map(([v, t]) => h('option', { value: v }, t)));
    modeSel.value = mode;
    const playBtn = h('button', { class: 'pg-play', title: 'Crea una lista de reproducción con estos vídeos y empieza a verla' });
    const clearSel = h('button', { class: 'pg-clear', title: 'Quitar selección', style: 'display:none' }, 'Limpiar');
    // Cola de YTBox (vídeos añadidos uno a uno con el menú ⋮)
    const queueBtn = h('button', { class: 'pg-queue', title: 'Reproducir tu cola de YTBox' });
    const queueClear = h('button', { class: 'pg-queue-x', title: 'Vaciar la cola' }, '✕');
    const queueBox = h('div', { class: 'pg-queue-box', style: 'display:none' }, queueBtn, queueClear);
    playBtn.style.display = 'none'; modeSel.style.display = 'none'; // se muestran cuando hay vídeos
    const actions = h('div', { class: 'pg-actions' }, queueBox, modeSel, clearSel, playBtn);
    const grid = h('div', { class: 'pg-grid' });
    overlay.append(head, h('div', { class: 'pg-row' }, chips, actions), toolbar, grid);
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
        h('div', { style: 'margin-bottom:16px' }, 'Este grupo todavía no tiene canales. Entra en un canal y pulsa «📁 Añadir a grupo», o añádelos desde el gestor.'),
        h('button', { class: 'pg-play', onclick: () => openManager('group=' + g.id) }, '+ Añadir canales')));
      return;
    }
    // Resolver ids que falten
    let changed = false;
    const missing = chans.filter(c => !c.id);
    if (missing.length) {
      status.textContent = `Resolviendo ${missing.length} canales…`;
      await pool(missing, 4, async c => { await PG.ensureChannelId(c); changed = true; });
      if (changed) await PG.save({ channels: state.channels });
      if (overlayGroupId !== groupId) return;
    }
    let all = [], done = 0;
    const stored = await chrome.storage.local.get(['marks', 'queue', 'watched']);
    const watched = stored.watched || {};
    const isWatched = v => !!watched[v.vid];
    const marksAll = stored.marks || {};
    const marks = marksAll[groupId] || (marksAll[groupId] = {});
    let queue = stored.queue || [];
    const isNew = v => v.vid in marks ? marks[v.vid] : (since > 0 && v.published.getTime() > since);
    const saveMarks = () => chrome.storage.local.set({ marks: marksAll });
    const updateQueue = () => {
      queueBox.style.display = queue.length ? '' : 'none';
      queueBtn.textContent = `▶ Mi cola · ${queue.length}`;
    };
    const saveQueue = async () => { updateQueue(); await chrome.storage.local.set({ queue }); };
    queueBtn.onclick = async () => {
      const ids = queue.slice(0, 50).map(q => q.vid);
      if (!ids.length) return;
      queue = queue.slice(50); await chrome.storage.local.set({ queue });
      closeOverlay();
      location.href = '/watch_videos?video_ids=' + ids.join(',');
    };
    queueClear.onclick = async () => { queue = []; await saveQueue(); toast('Cola vaciada'); };
    updateQueue();
    const menuCtx = {
      inQueue: vid => queue.some(q => q.vid === vid),
      toggleQueue: async v => {
        if (menuCtx.inQueue(v.vid)) { queue = queue.filter(q => q.vid !== v.vid); toast('Quitado de tu cola'); }
        else { queue.push({ vid: v.vid, title: v.title }); toast(`Añadido a tu cola (${queue.length})`); }
        await saveQueue();
      },
      isNew,
      toggleNew: async v => { marks[v.vid] = !isNew(v); await saveMarks(); render(); renderChips(); },
      opened: v => { if (marks[v.vid] === true) { delete marks[v.vid]; saveMarks(); } },
      isWatched,
      toggleWatched: async v => {
        if (watched[v.vid]) delete watched[v.vid]; else watched[v.vid] = Date.now();
        await chrome.storage.local.set({ watched }); render(); renderChips();
      },
    };
    const PERIOD = { day: 864e5, week: 7 * 864e5, month: 30 * 864e5 };
    // Filtros comunes (sin canal ni «solo nuevos»): tipo, periodo y vistos
    const passBase = v => (filters.type === 'all' || (filters.type === 'shorts') === v.short)
      && (filters.period === 'all' || Date.now() - v.published.getTime() <= PERIOD[filters.period])
      && (filters.watch === 'all' || !isWatched(v));
    const visible = () => {
      const q = filters.q.toLowerCase();
      const vids = all.filter(v => passBase(v) && (!filters.channel || v.channelId === filters.channel) && (!filters.onlyNew || isNew(v)) && (!q || v.title.toLowerCase().includes(q) || v.author.toLowerCase().includes(q)));
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
      playBtn.disabled = !n;
      playBtn.style.display = all.length ? '' : 'none';
      modeSel.style.display = all.length ? '' : 'none';
      const label = { todos: n === 1 ? 'vídeo' : 'vídeos', nuevos: n === 1 ? 'nuevo' : 'nuevos', aleatorio: 'en aleatorio', seleccionar: n === 1 ? 'seleccionado' : 'seleccionados' }[mode];
      playBtn.textContent = `▶ Añadir a la cola · ${Math.min(n, 50)} ${label}`;
      playBtn.title = n > 50 ? 'YouTube admite 50 vídeos por cola: se añadirán los 50 primeros' : 'Crea una lista de reproducción con estos vídeos y empieza a verla';
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
    playBtn.onclick = () => {
      const ids = queueIds().slice(0, 50);
      if (!ids.length) return;
      closeOverlay();
      location.href = '/watch_videos?video_ids=' + ids.join(',');
    };
    const render = () => {
      const vids = visible();
      grid.replaceChildren(...vids.map(v => card(v, isNew(v), mode === 'seleccionar' ? { index: selected.indexOf(v.vid), toggle: toggleSelect } : null, menuCtx)));
      updatePlay();
      if (!vids.length && done === chans.length) grid.append(h('div', { class: 'pg-empty' }, filters.onlyNew ? 'No hay vídeos nuevos desde tu última visita.' : 'No hay vídeos con estos filtros.'));
      status.textContent = done < chans.length ? `Cargando ${done}/${chans.length}…` : `${vids.length} vídeos · ${chans.length} canales` + (since ? ` · última visita ${PG.relTime(new Date(since))}` : '');
      const n = all.filter(v => isNew(v) && passBase(v)).length;
      newCount.style.display = n ? '' : 'none';
      newCount.textContent = filters.onlyNew ? `✓ ${n} nuevo${n > 1 ? 's' : ''}` : `${n} nuevo${n > 1 ? 's' : ''}`;
    };
    newCount.onclick = () => { filters.onlyNew = !filters.onlyNew; render(); };
    const renderChips = () => {
      chips.replaceChildren(
        h('button', { class: 'pg-chip' + (!filters.channel ? ' on' : ''), onclick: () => { filters.channel = null; renderChips(); render(); } }, 'Todos'),
        ...chans.filter(c => c.id).map(c => {
          const n = all.filter(v => v.channelId === c.id && isNew(v) && passBase(v)).length;
          return h('button', { class: 'pg-chip' + (filters.channel === c.id ? ' on' : ''), title: c.name, onclick: () => { filters.channel = filters.channel === c.id ? null : c.id; renderChips(); render(); } },
            c.avatar ? h('img', { src: c.avatar, referrerpolicy: 'no-referrer' }) : null, c.name, n ? h('span', { class: 'pg-chip-new' }, String(n)) : null);
        }));
    };
    renderChips();
    search.addEventListener('input', () => { filters.q = search.value; render(); });
    let timer;
    await pool(chans.filter(c => c.id), 6, async c => {
      try { const items = await fetchRss(c.id); all = all.concat(items); }
      finally {
        done++;
        status.textContent = `Cargando ${done}/${chans.length}…`;
        clearTimeout(timer); timer = setTimeout(() => { render(); renderChips(); }, 120);
      }
    });
    if (overlayGroupId !== groupId) return;
    clearTimeout(timer); render(); renderChips();
    // Guardar la visita: la próxima vez se marcarán los vídeos publicados después de ahora
    const seenNow = (await chrome.storage.local.get('seen')).seen || {};
    seenNow[groupId] = Date.now();
    await chrome.storage.local.set({ seen: seenNow });
    newCounts[groupId] = 0; renderGuide(true);
    // Completar avatar, nombre y @usuario de canales que solo tienen id (p. ej. importados de PocketTube)
    const incomplete = chans.filter(c => c.id && (!c.avatar || !c.handle || c.name === c.id));
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

  function card(v, fresh, sel, ctx) {
    const href = v.short ? '/shorts/' + v.vid : '/watch?v=' + v.vid;
    const ch = Object.values(state.channels).find(c => c.id === v.channelId);
    let check = null;
    if (sel) {
      check = h('label', { class: 'pg-check-wrap' }, h('input', { type: 'checkbox', class: 'pg-check' }), h('span', { class: 'pg-check-num' }, sel.index >= 0 ? String(sel.index + 1) : ''));
      check.querySelector('input').checked = sel.index >= 0;
    }
    const seenIt = ctx && ctx.isWatched(v);
    const a = h('a', { class: 'pg-card' + (fresh ? ' pg-new' : '') + (sel && sel.index >= 0 ? ' pg-checked' : '') + (seenIt ? ' pg-watched' : ''), href, 'data-vid': v.vid },
      h('div', { class: 'pg-thumb' }, h('img', { src: `https://i.ytimg.com/vi/${v.vid}/mqdefault.jpg`, loading: 'lazy' }),
        fresh ? h('span', { class: 'pg-new-badge' }, 'NUEVO') : null,
        seenIt ? h('span', { class: 'pg-watched-badge' }, 'VISTO') : null,
        seenIt ? h('span', { class: 'pg-watched-bar' }) : null,
        check,
        v.short ? h('span', { class: 'pg-badge' }, 'SHORT') : null),
      h('div', { class: 'pg-meta' },
        ch && ch.avatar ? h('img', { class: 'pg-avatar', src: ch.avatar, referrerpolicy: 'no-referrer' }) : h('span', { class: 'pg-avatar' }),
        h('div', {},
          h('div', { class: 'pg-title', title: v.title }, v.title),
          h('div', { class: 'pg-sub' }, v.author),
          h('div', { class: 'pg-sub' }, (v.views ? PG.fmtViews(v.views) + ' · ' : '') + PG.relTime(v.published)),
          v.desc ? h('div', { class: 'pg-desc' }, v.desc.slice(0, 300)) : null),
        !sel && ctx ? h('button', { class: 'pg-dots', title: 'Más acciones', onclick: e => { e.preventDefault(); e.stopPropagation(); openVideoMenu(e.currentTarget, v, ctx); } }, '⋮') : null));
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
  document.addEventListener('mousedown', e => { const m = $('#pg-vmenu'); if (m && !m.contains(e.target) && !e.target.closest('.pg-dots')) m.remove(); }, true);
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
    menu.append(
      item('lista', ctx.inQueue(v.vid) ? 'Quitar de la cola' : 'Añadir a la cola', async () => { closeVideoMenu(); await ctx.toggleQueue(v); }),
      item('reloj', 'Ver más tarde', async () => {
        closeVideoMenu();
        try { await YTAPI.watchLater(v.vid); toast('Guardado en «Ver más tarde»'); }
        catch (err) { toast(err.message, true); }
      }),
      item('marcador', 'Guardar en una lista de reproducción', () => showPlaylists(menu, btn, v)),
      h('div', { class: 'pg-vsep' }),
      item('estrella', ctx.isNew(v) ? 'Quitar marca de NUEVO' : 'Marcar como NUEVO', async () => { closeVideoMenu(); await ctx.toggleNew(v); }),
      item('ojo', ctx.isWatched(v) ? 'Marcar como no visto' : 'Marcar como visto', async () => { closeVideoMenu(); await ctx.toggleWatched(v); }),
    );
    placeMenu(menu, btn);
  }

  async function showPlaylists(menu, btn, v) {
    menu.classList.add('pg-vmenu-lists');
    menu.replaceChildren(h('div', { class: 'pg-vtitle' }, 'Guardar en…'), h('div', { class: 'pg-vloading' }, 'Cargando tus listas…'));
    placeMenu(menu, btn);
    let lists;
    try { lists = await YTAPI.getPlaylists(v.vid); }
    catch (err) { menu.replaceChildren(h('div', { class: 'pg-vtitle' }, 'Guardar en…'), h('div', { class: 'pg-vloading err' }, err.message)); return; }
    const rows = lists.map(pl => {
      const cb = h('input', { type: 'checkbox' }); cb.checked = pl.contains;
      cb.addEventListener('change', async () => {
        cb.disabled = true;
        try {
          if (cb.checked) { await YTAPI.addToPlaylist(pl.id, v.vid); toast(`Guardado en «${pl.title}»`); }
          else { await YTAPI.removeFromPlaylist(pl.id, v.vid); toast(`Quitado de «${pl.title}»`); }
        } catch (err) { cb.checked = !cb.checked; toast(err.message, true); }
        cb.disabled = false;
      });
      return h('label', { class: 'pg-vlist' }, cb, h('span', {}, pl.title || pl.id));
    });
    const name = h('input', { type: 'text', class: 'pg-vnew', placeholder: '+ Nueva lista (privada)…' });
    ['keydown', 'keyup', 'keypress'].forEach(t => name.addEventListener(t, e => e.stopPropagation()));
    name.addEventListener('keydown', async e => {
      if (e.key !== 'Enter' || !name.value.trim()) return;
      name.disabled = true;
      try { await YTAPI.createPlaylist(name.value.trim(), v.vid); toast(`Creada «${name.value.trim()}» con este vídeo`); closeVideoMenu(); }
      catch (err) { toast(err.message, true); name.disabled = false; }
    });
    menu.replaceChildren(h('div', { class: 'pg-vtitle' }, 'Guardar en…'),
      h('div', { class: 'pg-vlists' }, rows.length ? rows : h('div', { class: 'pg-vloading' }, 'No tienes listas todavía.')), name);
    placeMenu(menu, btn);
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
  }

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
      h('span', { class: 'pg-feed-label' }, 'YTBox'),
      h('button', { class: 'pg-chip' + (!feedState.group ? ' on' : ''), onclick: () => { feedState.group = null; drawFeedBar(b); applyFeedFilter(); } }, 'Todos'),
      ...state.groups.map(g => h('button', { class: 'pg-chip' + (feedState.group === g.id ? ' on' : ''), onclick: () => { feedState.group = feedState.group === g.id ? null : g.id; drawFeedBar(b); applyFeedFilter(); } }, PG.iconEl(g, 20), g.name)),
      h('div', { class: 'pg-ov-spacer' }),
      h('label', { class: 'pg-toggle' }, hw, 'Ocultar vistos'));
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

  // ---------- Ciclo ----------
  function safe(fn, ...a) { try { fn(...a); } catch (e) { console.error('[YTBox]', e); } }
  function tick() { renderGuide(false); safe(updateFab); safe(decorateChannelList, false); safe(positionOverlay); safe(decorateFeed); recordWatched().catch(() => {}); }
  document.addEventListener('yt-navigate-finish', () => { $('#pg-menu')?.remove(); setTimeout(tick, 300); setTimeout(tick, 1500); });
  chrome.runtime.onMessage.addListener(msg => { if (msg.type === 'openGroup') openGroup(msg.id); });
  refresh().then(() => { setInterval(tick, 1500); setTimeout(() => updateNewCounts().catch(() => {}), 2500); setInterval(() => updateNewCounts().catch(() => {}), 5 * 60 * 1000); });

  // Abrir grupo desde URL (?pg_group=id), p. ej. desde el gestor
  const pgParam = new URLSearchParams(location.search).get('pg_group');
  if (pgParam) setTimeout(() => openGroup(pgParam), 800);
})();
