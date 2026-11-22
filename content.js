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

  // Orden de los grupos en la barra lateral: vídeos sin ver (por defecto), nombre A-Z o Z-A
  function sortedGroups() {
    const mode = state.settings.sidebarSort || 'unwatched';
    const list = state.groups.map((g, i) => ({ g, i }));
    const byName = (a, b) => a.g.name.localeCompare(b.g.name, 'es', { sensitivity: 'base', numeric: true });
    if (mode === 'az') list.sort(byName);
    else if (mode === 'za') list.sort((a, b) => byName(b, a));
    else list.sort((a, b) => ((newCounts[b.g.id] || 0) - (newCounts[a.g.id] || 0)) || (a.i - b.i));
    return list.map(x => x.g);
  }

  function groupRows(container, size) {
    for (const g of sortedGroups()) {
      const n = newCounts[g.id] || 0;
      container.append(h('a', { class: 'pg-guide-item', href: '#', title: n ? `${g.name} · ${n} vídeo${n > 1 ? 's' : ''} nuevo${n > 1 ? 's' : ''}` : g.name, onclick: e => { e.preventDefault(); $('#pg-launch-menu')?.remove(); openGroup(g.id); } },
        PG.iconEl(g, size), h('span', { class: 'pg-guide-name' + (n ? ' pg-has-new' : '') }, g.name),
        n ? h('span', { class: 'pg-guide-new' }, n > 99 ? '99+' : String(n)) : null));
    }
  }

  // Menú ⋮ de la cabecera de la barra lateral
  function openGuideMenu(btn) {
    const old = $('#pg-menu');
    if (old) { old.remove(); if (old.dataset.kind === 'guide') return; }
    const mode = state.settings.sidebarSort || 'unwatched';
    const setSort = async v => { menu.remove(); state.settings.sidebarSort = v; await PG.save({ settings: state.settings }); };
    const opt = (v, label) => h('button', { class: 'pg-vitem' + (mode === v ? ' on' : ''), onclick: () => setSort(v) },
      h('span', { class: 'pg-vcheck' }, mode === v ? '✓' : ''), h('span', {}, label));
    const menu = h('div', { id: 'pg-menu', 'data-kind': 'guide' },
      h('button', { class: 'pg-vitem', onclick: async () => { menu.remove(); await markAllSeen(); } },
        h('span', { class: 'pg-vicon' }, PG.svgEl('check', 18, 'currentColor')), h('span', {}, 'Marcar todo como visto')),
      h('div', { class: 'pg-vsep' }),
      h('div', { class: 'pg-vlabel' }, 'Ordenar por'),
      opt('az', 'Nombre (A-Z)'), opt('za', 'Nombre (Z-A)'), opt('unwatched', 'Vídeos sin ver'));
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
    await chrome.storage.local.set({ seen, marks });
    renderGuide(true);
    toast('Todo marcado como visto');
  }

  // ---------- Novedades por grupo (para la barra lateral) ----------
  const newCounts = {};
  let countingAt = 0;
  async function updateNewCounts(force) {
    if (!force && Date.now() - countingAt < 15 * 60 * 1000) return;
    countingAt = Date.now();
    const { seen = {}, marks = {}, watched = {} } = await chrome.storage.local.get(['seen', 'marks', 'watched']);
    // Un grupo que nunca se ha abierto empieza a contar novedades desde ahora
    const unseen = state.groups.filter(g => !seen[g.id]);
    if (unseen.length) { unseen.forEach(g => seen[g.id] = Date.now()); await chrome.storage.local.set({ seen }); }
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

  // Botón de YTBox en la barra superior de YouTube (junto a «Crear» y las notificaciones):
  // siempre visible, abre la lista de grupos. Sustituye al antiguo botón flotante.
  // Acceso al modo Descubrir (barra lateral y desplegable superior)
  function discoverEntry(cls, px, inGuide, close) {
    const ico = h('span', { class: 'pg-tv-top-ico pg-disc-ico' }, PG.svgEl('brujula', px, '#ffffff'));
    return h('a', { class: cls + ' pg-disc-entry', href: '#', title: 'Descubrir canales parecidos a los tuyos', onclick: e => { e.preventDefault(); close && close(); openDiscover(); } },
      inGuide ? h('span', { class: 'pg-guide-logo' }, ico) : ico, h('span', { class: 'pg-guide-name' }, 'Descubrir'), h('span', { class: 'pg-tv-top-go' }, '✦'));
  }

  // Preconfiguraciones del Modo TV como accesos directos (un clic = ver)
  // Fila «Modo TV» + sus preconfiguraciones plegadas en un desplegable (▸ 2 / ▾ 2)
  function tvBlock(cls, px, inGuide, close) {
    const presets = YTBoxTV.presets(state);
    const ico = h('span', { class: 'pg-tv-top-ico' }, PG.svgEl('tv', px, '#ffffff'));
    const list = h('div', { class: 'pg-tv-presets-box' }, ...tvPresetRows(close));
    let open = !!state.settings.tvPresetsOpen;
    const caret = h('button', { class: 'pg-tv-caret', title: 'Mostrar u ocultar tus preconfiguraciones', 'aria-label': 'Preconfiguraciones del Modo TV' });
    const paint = () => { list.style.display = open ? '' : 'none'; caret.textContent = `${open ? '▾' : '▸'} ${presets.length}`; caret.setAttribute('aria-expanded', String(open)); };
    caret.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      open = !open; paint();
      state.settings.tvPresetsOpen = open; PG.save({ settings: state.settings });
    });
    paint();
    const row = h('a', { class: cls, href: '#', title: 'Modo TV: lista aleatoria de tus canales', onclick: e => { e.preventDefault(); close && close(); openTV(); } },
      inGuide ? h('span', { class: 'pg-guide-logo' }, ico) : ico, h('span', { class: 'pg-guide-name' }, 'Modo TV'),
      presets.length ? caret : h('span', { class: 'pg-tv-top-go' }, '▶'));
    return presets.length ? [row, list] : [row];
  }

  function tvPresetRows(close) {
    return YTBoxTV.presets(state).map(p => h('a', { class: 'pg-guide-item pg-tv-preset-row', href: '#', title: 'Ver ya: ' + YTBoxTV.summary(p.cfg, state),
      onclick: e => { e.preventDefault(); close && close(); openTV(p.id, true); } },
      h('span', { class: 'pg-tv-preset-dot' }, '▶'), h('span', { class: 'pg-guide-name' }, p.name)));
  }

  function openTopMenu(btn) {
    const old = $('#pg-launch-menu'); if (old) { old.remove(); return; }
    const m = h('div', { id: 'pg-launch-menu' }, h('div', { class: 'pg-menu-head' }, appLogo(20), h('div', { class: 'pg-menu-title' }, 'YTBox · Grupos')));
    // Acceso directo al Modo TV, arriba del todo
    m.append(...tvBlock('pg-guide-item pg-tv-top', 18, false, () => m.remove()),
      discoverEntry('pg-guide-item pg-tv-top', 18, false, () => m.remove()),
      h('div', { class: 'pg-vsep' }));
    if (!state.groups.length) m.append(h('div', { class: 'pg-menu-empty' }, 'Aún no tienes grupos.'));
    groupRows(m, 24);
    m.append(h('div', { class: 'pg-vsep' }),
      h('a', { class: 'pg-guide-item', href: '#', onclick: e => { e.preventDefault(); m.remove(); markAllSeen(); } }, h('span', { class: 'pg-launch-ico' }, PG.svgEl('check', 18, 'currentColor')), h('span', { class: 'pg-guide-name' }, 'Marcar todo como visto')),
      h('a', { class: 'pg-guide-item', href: '#', onclick: e => { e.preventDefault(); m.remove(); openManager(); } }, h('span', { class: 'pg-launch-ico' }, PG.svgEl('engranaje', 18, 'currentColor')), h('span', { class: 'pg-guide-name' }, 'Gestionar grupos')));
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
      l = h('button', { id: 'pg-launcher', title: 'YTBox: tus grupos', 'aria-label': 'YTBox: tus grupos' }, appLogo(24), h('span', { class: 'pg-launch-badge' }));
      l.addEventListener('click', e => { e.stopPropagation(); openTopMenu(l); });
      end.insertBefore(l, end.firstChild);
    }
    const total = Object.values(newCounts).reduce((a, n) => a + (n || 0), 0);
    const badge = l.querySelector('.pg-launch-badge');
    badge.textContent = total ? (total > 99 ? '99+' : String(total)) : '';
    badge.style.display = total ? '' : 'none';
    l.title = total ? `YTBox: ${total} vídeo${total > 1 ? 's' : ''} nuevo${total > 1 ? 's' : ''}` : 'YTBox: tus grupos';
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
    const moreBtn = h('button', { class: 'pg-guide-btn', title: 'Más opciones', 'aria-label': 'Más opciones', onclick: e => { e.stopPropagation(); openGuideMenu(moreBtn); } }, '⋮');
    box.append(h('div', { class: 'pg-guide-head' },
      h('span', { class: 'pg-guide-logo' }, appLogo(20)),
      h('button', { class: 'pg-guide-title', title: open ? 'Ocultar grupos' : 'Mostrar grupos', onclick: async () => {
        state.settings.sidebarOpen = !open; await PG.save({ settings: state.settings });
      } }, h('span', {}, 'YTBox'), h('span', { class: 'pg-guide-caret' }, open ? '▾' : '▸')),
      h('span', { class: 'pg-guide-actions' },
        h('button', { class: 'pg-guide-btn', title: 'Nuevo grupo', 'aria-label': 'Nuevo grupo', onclick: () => openManager('new') }, '+'),
        h('button', { class: 'pg-guide-btn', title: 'Gestionar grupos', 'aria-label': 'Gestionar grupos', onclick: () => openManager() }, '⚙'),
        moreBtn),
    ));
    if (!open) return;
    // Modo TV, arriba del todo (se oculta junto con la lista al plegar YTBox)
    box.append(...tvBlock('pg-guide-item pg-tv-entry', 16, true),
      discoverEntry('pg-guide-item pg-tv-entry', 16, true),
      h('div', { class: 'pg-guide-sep' }));
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
        btn.title = inGroups.length ? 'En YTBox: ' + inGroups.map(g => g.name).join(', ') : 'Añadir este canal a un grupo de YTBox';
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
    const aliasKeys = () => new Set(channelAliases(ref.key).map(c => c.key));
    const inNow = new Set(groupsOfChannel(ref.key).map(g => g.id));
    menu.append(h('div', { class: 'pg-menu-title' }, ref.name || ref.key));
    if (!state.groups.length) menu.append(h('div', { class: 'pg-menu-empty' }, 'No hay grupos todavía.'));
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
    // Que el menú quepa en pantalla: si no cabe debajo del botón, se abre hacia arriba
    if (anchor) {
      const ar = anchor.getBoundingClientRect(), mh = menu.offsetHeight;
      const below = window.innerHeight - ar.bottom - 12, above = ar.top - 12;
      if (mh > below && above > below) { menu.style.top = Math.max(8, ar.top - 6 - Math.min(mh, above)) + 'px'; menu.style.maxHeight = above + 'px'; }
      else { menu.style.top = (ar.bottom + 6) + 'px'; menu.style.maxHeight = below + 'px'; }
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
      const gs = groupsOfChannel(key);
      b.replaceChildren(...(gs.length ? gs.slice(0, 4).map(g => PG.iconEl(g, 18)) : ['📁 +']));
    }
  }

  // ---------- Vista de grupo (feed propio vía RSS) ----------
  async function fetchRss(id) {
    const c = rssCache.get(id);
    if (c && Date.now() - c.t < 10 * 60 * 1000) return c.items;
    const res = await PG.fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + id, { credentials: 'include' });
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
    const modeSel = h('select', { class: 'pg-mode', title: 'Qué vídeos' },
      ...[['todos', 'Todos'], ['nuevos', 'Nuevos'], ['aleatorio', 'Aleatorio'], ['seleccionar', 'Seleccionar']].map(([v, t]) => h('option', { value: v }, t)));
    modeSel.value = mode;
    // Qué hacer con esos vídeos
    let action = ['cola', 'wl', 'playlist'].includes(state.settings.groupAction) ? state.settings.groupAction : 'cola';
    const actionSel = h('select', { class: 'pg-mode', title: 'Qué hacer con los vídeos' },
      ...[['cola', 'Añadir a la cola'], ['wl', 'Añadir a Ver más tarde'], ['playlist', 'Añadir a una playlist']].map(([v, t]) => h('option', { value: v }, t)));
    actionSel.value = action;
    const playBtn = h('button', { class: 'pg-play' }, 'Aplicar');
    const clearSel = h('button', { class: 'pg-clear', title: 'Quitar selección', style: 'display:none' }, 'Limpiar');
    // Cola de YTBox (vídeos añadidos uno a uno con el menú ⋮)
    const queueBtn = h('button', { class: 'pg-queue', title: 'Reproducir tu cola de YTBox' });
    const queueClear = h('button', { class: 'pg-queue-x', title: 'Vaciar la cola' }, '✕');
    const queueBox = h('div', { class: 'pg-queue-box', style: 'display:none' }, queueBtn, queueClear);
    playBtn.style.display = 'none'; modeSel.style.display = 'none'; actionSel.style.display = 'none'; // se muestran cuando hay vídeos
    const actions = h('div', { class: 'pg-actions' }, modeSel, clearSel, actionSel, playBtn);
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
    const stored = await chrome.storage.local.get(['marks', 'queue', 'watched', 'chanViews', 'watchSince']);
    const chanViews = stored.chanViews || {}, watchSince = stored.watchSince || Date.now();
    let hist = null;
    const histP = loadHistory().then(r => { hist = r && { vids: new Set(r.vids), oldest: r.oldest, n: r.vids.length }; }).catch(e => console.warn('[YTBox] historial', e));
    const failed = new Set(); // canales cuyo RSS no ha cargado: sin datos, sin aviso
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
      playBtn.disabled = !n || playBtn.dataset.busy === '1';
      playBtn.style.display = all.length ? '' : 'none';
      modeSel.style.display = all.length ? '' : 'none';
      actionSel.style.display = all.length ? '' : 'none';
      // El número de vídeos va en el propio selector: «Todos (15)», «Nuevos (3)»…
      const vids = visible();
      const counts = { todos: vids.length, nuevos: vids.filter(isNew).length, aleatorio: vids.length, seleccionar: selected.length };
      [...modeSel.options].forEach(o => { o.textContent = `${{ todos: 'Todos', nuevos: 'Nuevos', aleatorio: 'Aleatorio', seleccionar: 'Seleccionar' }[o.value]} (${counts[o.value]})`; });
      const max = action === 'cola' ? 50 : 200;
      const word = n === 1 ? 'vídeo' : 'vídeos';
      playBtn.title = !n ? 'No hay vídeos' : {
        cola: `Crea una lista con ${Math.min(n, max)} ${word} y empieza a verla` + (n > max ? ' (YouTube admite 50 por cola)' : ''),
        wl: `Guarda ${Math.min(n, max)} ${word} en «Ver más tarde»`,
        playlist: `Elige una playlist y guarda en ella ${Math.min(n, max)} ${word}`,
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
    const busy = (on, txt) => { playBtn.dataset.busy = on ? '1' : ''; playBtn.textContent = txt || 'Aplicar'; playBtn.disabled = on; };
    playBtn.onclick = async () => {
      if (action === 'cola') {
        const ids = queueIds().slice(0, 50);
        if (!ids.length) return;
        closeOverlay();
        location.href = '/watch_videos?video_ids=' + ids.join(',');
        return;
      }
      const ids = queueIds().slice(0, 200);
      if (!ids.length) return;
      if (!YTAPI.loggedIn()) { toast('Inicia sesión en YouTube para guardar vídeos en tus listas', true); return; }
      if (action === 'playlist') { showBulkPlaylists(playBtn, ids, busy); return; }
      busy(true, 'Guardando…');
      try {
        const r = await YTAPI.addMany('WL', ids, (d, t) => { playBtn.textContent = `Guardando… ${d}/${t}`; });
        toast(`${r.ok} vídeo${r.ok === 1 ? '' : 's'} en «Ver más tarde»` + (r.fail ? ` · ${r.fail} no se pudieron añadir (quizá ya estaban)` : ''), !r.ok);
      } catch (err) { toast(err.message, true); }
      busy(false); updatePlay();
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
    // Avisos (no se borra nada): canales que llevan mucho sin subir o que hace tiempo que no ves
    const DAY = 864e5;
    const health = c => {
      if (done < chans.length || failed.has(c.id)) return null;
      const items = all.filter(v => v.channelId === c.id).sort((a, b) => b.published - a.published);
      const now = Date.now();
      if (!items.length) return { icon: 'dormido', text: 'No tiene vídeos públicos recientes' };
      const latest = items[0].published.getTime();
      if (now - latest > 90 * DAY) return { icon: 'dormido', text: `Lleva mucho sin subir: su último vídeo es de ${PG.relTime(new Date(latest))}` };
      const seen = v => !!watched[v.vid] || !!(hist && hist.vids.has(v.vid));
      const last = Math.max(chanViews[c.key] || 0, (c.handle && chanViews[c.handle]) || 0, (c.id && chanViews[c.id]) || 0, ...items.map(v => watched[v.vid] || 0));
      if (last && now - last < 30 * DAY) return null;
      // Desde cuándo sabemos lo que ves: lo que cubra tu historial de YouTube o, si no, el registro de YTBox
      const covered = Math.min(watchSince, hist ? (hist.oldest || (hist.n >= 200 ? now - 30 * DAY : now)) : now);
      // Racha: sus vídeos más recientes seguidos que no has visto
      const streak = [];
      for (const v of items) { if (v.short) continue; if (seen(v) || v.published.getTime() < covered) break; streak.push(v); }
      if (streak.length < 4 || now - streak[streak.length - 1].published.getTime() < 21 * DAY) return null;
      return { icon: 'ojoTachado', text: (last ? `No ves este canal desde ${PG.relTime(new Date(last))}` : 'Hace tiempo que no ves este canal') + `: te has saltado sus últimos ${streak.length} vídeos (desde ${PG.relTime(streak[streak.length - 1].published)})` };
    };
    const legendRow = h('div', { class: 'pg-legend-row' });
    const renderChips = () => {
      const flags = { dormido: 0, ojoTachado: 0 };
      chips.replaceChildren(
        h('button', { class: 'pg-chip' + (!filters.channel ? ' on' : ''), onclick: () => { filters.channel = null; renderChips(); render(); } }, 'Todos'),
        ...chans.filter(c => c.id).map(c => {
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
          flags.dormido ? h('span', { class: 'pg-lg-dormido' }, PG.svgEl('dormido', 13, 'currentColor'), 'lleva tiempo sin subir') : null,
          flags.ojoTachado ? h('span', { class: 'pg-lg-ojo' }, PG.svgEl('ojoTachado', 13, 'currentColor'), 'hace tiempo que no lo ves') : null,
          h('span', {}, '· pasa el ratón por el canal para ver el detalle')));
        chips.parentNode.after(legendRow);
      }
    };
    renderChips();
    search.addEventListener('input', () => { filters.q = search.value; render(); });
    let timer;
    await pool(chans.filter(c => c.id), 6, async c => {
      try { const items = await fetchRss(c.id); all = all.concat(items); }
      catch (e) { failed.add(c.id); throw e; }
      finally {
        done++;
        status.textContent = `Cargando ${done}/${chans.length}…`;
        clearTimeout(timer); timer = setTimeout(() => { render(); renderChips(); }, 120);
      }
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
        act('reloj', 'Ver más tarde', async b => {
          try { await YTAPI.watchLater(v.vid); b.classList.add('on'); toast('Guardado en «Ver más tarde»'); } catch (err) { toast(err.message, true); }
        }),
        act('listaMas', 'Guardar en una lista de reproducción', async b => {
          closeVideoMenu();
          const menu = h('div', { id: 'pg-vmenu', 'data-vid': v.vid });
          await showPlaylists(menu, b, v);
        }),
        act('cola', 'Añadir a la cola', async b => { addToYTQueue(v); b.classList.add('on'); })));
  }

  // Añade el vídeo a la cola de YouTube (minirreproductor) a través de page-bridge.js
  function addToYTQueue(v) {
    window.postMessage({ source: 'ytbox', type: 'queue', vid: v.vid }, '*');
    toast('Añadido a la cola de YouTube');
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
        fresh ? h('span', { class: 'pg-new-badge' }, 'Nuevo') : null,
        seenIt ? h('span', { class: 'pg-watched-badge' }, 'VISTO') : null,
        seenIt ? h('span', { class: 'pg-watched-bar' }) : null,
        !sel && ctx ? hoverActions(v, ctx) : null,
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
      item('cola', 'Añadir a la cola', async () => { closeVideoMenu(); addToYTQueue(v); }),
      item('reloj', 'Ver más tarde', async () => {
        closeVideoMenu();
        try { await YTAPI.watchLater(v.vid); toast('Guardado en «Ver más tarde»'); }
        catch (err) { toast(err.message, true); }
      }),
      item('marcador', 'Guardar en una lista de reproducción', () => showPlaylists(menu, btn, v)),
      h('div', { class: 'pg-vsep' }),
      item('estrella', ctx.isNew(v) ? 'Quitar marca de nuevo' : 'Marcar como nuevo', async () => { closeVideoMenu(); await ctx.toggleNew(v); }),
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

  // Elegir playlist para guardar varios vídeos de golpe (botón «Aplicar» del grupo)
  async function showBulkPlaylists(btn, ids, busy) {
    closeVideoMenu();
    const n = ids.length, word = n === 1 ? 'vídeo' : 'vídeos';
    const menu = h('div', { id: 'pg-vmenu', class: 'pg-vmenu-lists', 'data-vid': '__bulk' });
    const title = h('div', { class: 'pg-vtitle' }, `Guardar ${n} ${word} en…`);
    menu.append(title, h('div', { class: 'pg-vloading' }, 'Cargando tus listas…'));
    placeMenu(menu, btn);
    const save = async (label, fn) => {
      closeVideoMenu(); busy(true, 'Guardando…');
      try {
        const r = await fn();
        toast(`${r.ok} ${r.ok === 1 ? 'vídeo' : 'vídeos'} en «${label}»` + (r.fail ? ` · ${r.fail} no se pudieron añadir (quizá ya estaban)` : ''), !r.ok);
      } catch (err) { toast(err.message, true); }
      busy(false); btn.disabled = false;
    };
    let lists;
    try { lists = await YTAPI.getPlaylists(ids[0]); }
    catch (err) { menu.replaceChildren(title, h('div', { class: 'pg-vloading err' }, err.message)); return; }
    lists = lists.filter(pl => pl.id !== 'WL');
    const rows = lists.map(pl => h('button', { class: 'pg-vitem', onclick: e => { e.stopPropagation(); save(pl.title || pl.id, () => YTAPI.addMany(pl.id, ids, (d, t) => { btn.textContent = `Guardando… ${d}/${t}`; })); } },
      h('span', { class: 'pg-vicon' }, PG.svgEl('lista', 18, 'currentColor')), h('span', {}, pl.title || pl.id)));
    const name = h('input', { type: 'text', class: 'pg-vnew', placeholder: '+ Nueva lista (privada)…' });
    ['keydown', 'keyup', 'keypress'].forEach(t => name.addEventListener(t, e => e.stopPropagation()));
    name.addEventListener('keydown', e => {
      const t = name.value.trim();
      if (e.key !== 'Enter' || !t) return;
      save(t, async () => {
        const pid = await YTAPI.createPlaylist(t, ids[0]);
        const r = ids.length > 1 ? await YTAPI.addMany(pid, ids.slice(1), (d, tt) => { btn.textContent = `Guardando… ${d + 1}/${tt + 1}`; }) : { ok: 0, fail: 0 };
        return { ok: r.ok + 1, fail: r.fail };
      });
    });
    menu.replaceChildren(title, h('div', { class: 'pg-vlists' }, rows.length ? rows : h('div', { class: 'pg-vloading' }, 'No tienes listas todavía.')), name);
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
  }

  // Historial de YouTube (con sesión): se guarda 6 horas para no pedirlo cada vez
  async function loadHistory() {
    const { ytHistory } = await chrome.storage.local.get('ytHistory');
    if (ytHistory && Date.now() - ytHistory.t < 6 * 3600e3) return ytHistory;
    if (!YTAPI.loggedIn()) return null;
    const r = await YTAPI.history(10);
    const out = { t: Date.now(), vids: r.vids.slice(0, 3000), oldest: r.oldest };
    await chrome.storage.local.set({ ytHistory: out });
    return out;
  }

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
    const { chanViews = {} } = await chrome.storage.local.get('chanViews');
    chanViews[ch ? ch.key : k] = Date.now();
    await chrome.storage.local.set({ chanViews });
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

  // ---------- Modo TV: lista aleatoria de una duración aproximada ----------
  async function openTV(presetId, autoplay) {
    $('#pg-tv')?.remove();
    const cfg = Object.assign({}, YTBoxTV.DEFAULTS, state.settings.tv || {});
    const groupsSel = new Set(cfg.groups.filter(id => state.groups.some(g => g.id === id)));
    const chansSel = new Set(cfg.channels.filter(k => state.channels[k]));
    const root = h('div', { id: 'pg-tv', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Modo TV' });
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
    const updateCount = () => { const n = selectedChannels().length; count.textContent = n ? `${n} canal${n > 1 ? 'es' : ''} seleccionado${n > 1 ? 's' : ''}` : 'Ningún canal seleccionado'; };

    // Grupos
    const gchips = h('div', { class: 'pg-tv-chips' });
    const drawGroups = () => gchips.replaceChildren(...state.groups.map(g => h('button', { class: 'pg-chip' + (groupsSel.has(g.id) ? ' on' : ''), onclick: () => { groupsSel.has(g.id) ? groupsSel.delete(g.id) : groupsSel.add(g.id); drawGroups(); updateCount(); } }, PG.iconEl(g, 20), g.name)));
    drawGroups();
    // Canales sueltos
    const q = h('input', { type: 'search', class: 'pg-search', placeholder: 'Buscar canal…', style: 'width:100%;box-sizing:border-box' });
    const clist = h('div', { class: 'pg-tv-clist' });
    const allCh = Object.values(state.channels).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    const drawCh = () => {
      const t = q.value.toLowerCase();
      clist.replaceChildren(...allCh.filter(c => !t || c.name.toLowerCase().includes(t) || (c.handle || '').includes(t)).slice(0, 300).map(c => {
        const cb = h('input', { type: 'checkbox' }); cb.checked = chansSel.has(c.key);
        cb.addEventListener('change', () => { cb.checked ? chansSel.add(c.key) : chansSel.delete(c.key); updateCount(); });
        return h('label', { class: 'pg-tv-ch' }, cb, c.avatar ? h('img', { src: c.avatar, referrerpolicy: 'no-referrer' }) : h('span', { class: 'pg-tv-av' }), h('span', {}, c.name));
      }));
    };
    q.addEventListener('input', drawCh); drawCh();
    const details = h('details', { class: 'pg-tv-details' }, h('summary', {}, 'Añadir canales sueltos'), q, clist);
    if (chansSel.size) details.open = true;

    // Qué vídeos
    const onlyNew = h('input', { type: 'checkbox' }); onlyNew.checked = !!cfg.onlyUnwatched;
    const ageSel = h('select', { class: 'pg-mode' }, ...[['all', 'Cualquier fecha'], ['day', 'Último día'], ['3days', 'Últimos 3 días'], ['week', 'Última semana'], ['month', 'Último mes']].map(([v, t]) => h('option', { value: v }, t)));
    ageSel.value = cfg.maxAge;
    const lenSel = h('select', { class: 'pg-mode' }, ...YTBoxTV.MAXLENS.map(([v, t]) => h('option', { value: String(v) }, t)));
    lenSel.value = String(cfg.maxLen || 0); if (!lenSel.value) lenSel.value = '0';
    // Duración
    const amount = h('input', { type: 'number', min: '1', step: '1', class: 'pg-search pg-tv-num', value: String(cfg.amount) });
    const unit = h('select', { class: 'pg-mode' }, h('option', { value: 'min' }, 'minutos'), h('option', { value: 'h' }, 'horas'));
    unit.value = cfg.unit;
    const quick = h('div', { class: 'pg-tv-chips' }, ...[[30, 'min', '30 min'], [1, 'h', '1 h'], [2, 'h', '2 h'], [4, 'h', '4 h']].map(([n, u, t]) =>
      h('button', { class: 'pg-chip', onclick: () => { amount.value = n; unit.value = u; } }, t)));

    // Cómo: vídeos completos o picoteo (solo lo más visto de cada uno)
    let style = cfg.style === 'picoteo' ? 'picoteo' : 'full';
    const clipSel = h('select', { class: 'pg-mode' }, ...YTBoxTV.CLIPS.map(([v, t]) => h('option', { value: String(v) }, t)));
    clipSel.value = String(cfg.clip || 60); if (!clipSel.value) clipSel.value = '60';
    const styleBox = h('div', { class: 'pg-tv-chips' });
    const clipRow = h('div', { class: 'pg-tv-row' }, h('span', {}, 'Trozo de cada vídeo:'), clipSel);
    const styleHelp = h('p', { class: 'pg-tv-help' });
    const drawStyle = () => {
      styleBox.replaceChildren(...[['full', '📺 Vídeos completos'], ['picoteo', '🍿 Picoteo']].map(([v, t]) =>
        h('button', { class: 'pg-chip' + (style === v ? ' on' : ''), onclick: () => { style = v; drawStyle(); } }, t)));
      clipRow.style.display = style === 'picoteo' ? '' : 'none';
      styleHelp.textContent = style === 'picoteo'
        ? 'Solo se reproduce el trozo más visto de cada vídeo (según la curva de «lo más visto» de YouTube) y salta solo al siguiente. Ideal para ponerte al día rápido.'
        : 'Se reproduce cada vídeo entero.';
    };
    drawStyle();

    const status = h('div', { class: 'pg-tv-status', role: 'status' });
    const go = h('button', { class: 'pg-play pg-tv-go' }, '▶ VER');
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
    const nameIn = h('input', { type: 'text', class: 'pg-search pg-tv-name', placeholder: 'Nombre, p. ej. Dormir', maxlength: '40' });
    const presetBox = h('div', { class: 'pg-tv-presets' });
    const loadPreset = p => { activeId = p.id; applyCfg(p.cfg); nameIn.value = p.name; status.className = 'pg-tv-status'; status.textContent = ''; drawPresets(); };
    const drawPresets = () => {
      const list = YTBoxTV.presets(state);
      presetBox.replaceChildren(...(list.length ? list.map(p => {
        const del = h('button', { class: 'pg-tv-preset-x', title: 'Borrar', 'aria-label': 'Borrar ' + p.name }, '✕');
        del.onclick = () => {
          if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = '¿Borrar?'; setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = '✕'; } }, 3000); return; }
          YTBoxTV.deletePreset(state, p.id); if (activeId === p.id) activeId = null;
          PG.save({ settings: state.settings }); drawPresets();
        };
        return h('div', { class: 'pg-tv-preset' + (p.id === activeId ? ' on' : '') },
          h('button', { class: 'pg-tv-preset-load', title: 'Cargar esta configuración', onclick: () => loadPreset(p) }, h('b', {}, p.name), h('small', {}, YTBoxTV.summary(p.cfg, state))),
          h('button', { class: 'pg-tv-preset-play', title: 'Ver ya', 'aria-label': 'Ver ' + p.name, onclick: () => { loadPreset(p); go.click(); } }, '▶'), del);
      }) : [h('span', { class: 'pg-tv-count' }, 'Aún no tienes ninguna. Configura abajo y guárdala con un nombre.')]));
    };
    const saveBtn = h('button', { class: 'pg-btn pg-tv-save' }, '💾 Guardar');
    saveBtn.onclick = () => {
      const name = nameIn.value.trim();
      if (!name) { status.className = 'pg-tv-status err'; status.textContent = 'Ponle un nombre a la preconfiguración.'; nameIn.focus(); return; }
      const exists = YTBoxTV.presets(state).some(x => x.name.toLowerCase() === name.toLowerCase());
      const p = YTBoxTV.savePreset(state, name, current()); activeId = p.id;
      PG.save({ settings: state.settings }); drawPresets();
      status.className = 'pg-tv-status'; status.textContent = exists ? `«${p.name}» actualizada.` : `«${p.name}» guardada.`;
    };
    nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn.click(); });
    drawPresets();

    // Previsualización: la lista generada, con opción de quitar vídeos antes de verla
    let preview = null; // { picked, cfg, picoteo, target }
    const previewBox = h('div', { class: 'pg-tv-preview', style: 'display:none' });
    const previewBtn = h('button', { class: 'pg-btn pg-tv-prevbtn', title: 'Ver qué vídeos se van a cargar antes de reproducirlos' }, '👁 Previsualizar');
    const segDur = v => preview && preview.picoteo ? v.end - v.start : v.seconds;
    const chName = id => (Object.values(state.channels).find(c => c.id === id) || {}).name || '';
    const drawPreview = () => {
      if (!preview) { previewBox.style.display = 'none'; previewBox.replaceChildren(); go.textContent = '▶ VER'; return; }
      const { picked, picoteo } = preview;
      const total = picked.reduce((a, v) => a + segDur(v), 0);
      go.textContent = picked.length ? '▶ VER ESTA LISTA' : '▶ VER';
      previewBox.style.display = '';
      previewBox.replaceChildren(
        h('div', { class: 'pg-tv-prevhead' },
          h('b', {}, picked.length ? `${picked.length} ${picoteo ? 'trozos' : 'vídeos'} · ${YTBoxTV.fmtDur(total)}` : 'Has quitado todos los vídeos'),
          h('span', { class: 'pg-tv-prevtools' },
            h('button', { class: 'pg-btn pg-tv-mini', title: 'Generar otra lista distinta', onclick: () => makePreview() }, '🔀 Otra'),
            h('button', { class: 'pg-btn pg-tv-mini', title: 'Descartar la previsualización', onclick: () => { preview = null; drawPreview(); } }, 'Descartar'))),
        h('ol', { class: 'pg-tv-prevlist' }, ...picked.map((v, i) => h('li', {},
          h('a', { class: 'pg-tv-prevthumb', href: '/watch?v=' + v.vid + (picoteo ? '&t=' + Math.round(v.start) + 's' : ''), target: '_blank', rel: 'noopener', title: 'Abrir en otra pestaña' },
            h('img', { src: `https://i.ytimg.com/vi/${v.vid}/mqdefault.jpg`, loading: 'lazy', alt: '' }),
            h('span', { class: 'pg-tv-prevdur' }, picoteo ? `${clock(v.start)}–${clock(v.end)}` : clock(v.seconds))),
          h('span', { class: 'pg-tv-previnfo' }, h('span', { class: 'pg-tv-prevtitle' }, v.title || v.vid), h('small', {}, chName(v.channelId) + (picoteo && v.hot ? ' · 🔥 lo más visto' : ''))),
          h('button', { class: 'pg-tv-prevx', title: 'Quitar de la lista', 'aria-label': 'Quitar ' + (v.title || v.vid), onclick: () => { preview.picked.splice(i, 1); drawPreview(); } }, '✕')))));
    };
    const makePreview = async () => {
      const newCfg = current();
      status.className = 'pg-tv-status';
      state.settings.tv = newCfg; PG.save({ settings: state.settings });
      previewBtn.disabled = go.disabled = true;
      try {
        const r = await YTBoxTV.run(newCfg, state, t => { status.textContent = t; });
        preview = { picked: r.picked, cfg: newCfg, picoteo: !!r.picoteo, target: r.target };
        status.textContent = r.total < r.target * 0.9 ? 'No hay más vídeos que cumplan las condiciones.' : 'Quita los que no te apetezcan y pulsa VER.';
        drawPreview();
        previewBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) { status.className += ' err'; status.textContent = e.message; }
      finally { previewBtn.disabled = go.disabled = false; }
    };
    previewBtn.onclick = makePreview;
    const play = async (picked, cfgUsed, picoteo) => {
      const total = picked.reduce((a, v) => a + (picoteo ? v.end - v.start : v.seconds), 0);
      const what = picoteo ? `${picked.length} trozos` : `${picked.length} vídeos`;
      status.textContent = `${what} · ${YTBoxTV.fmtDur(total)}. Abriendo…`;
      toast(`Modo TV${picoteo ? ' · picoteo' : ''}: ${what} · ${YTBoxTV.fmtDur(total)}`);
      const url = await YTBoxTV.start(picked, cfgUsed);
      setTimeout(() => { root.remove(); closeOverlay(); location.href = url; }, 700);
    };

    go.onclick = async () => {
      if (preview && preview.picked.length) return play(preview.picked, preview.cfg, preview.picoteo);
      const newCfg = current();
      status.className = 'pg-tv-status';
      state.settings.tv = newCfg; PG.save({ settings: state.settings });
      go.disabled = previewBtn.disabled = true;
      try {
        const r = await YTBoxTV.run(newCfg, state, t => { status.textContent = t; });
        if (r.total < r.target * 0.9) toast('No hay más vídeos que cumplan las condiciones');
        await play(r.picked, newCfg, !!r.picoteo);
      } catch (e) { status.className += ' err'; status.textContent = e.message; }
      finally { go.disabled = previewBtn.disabled = false; }
    };

    box.append(
      h('div', { class: 'pg-tv-head' }, h('span', { class: 'pg-tv-ico' }, PG.svgEl('tv', 26, 'currentColor')), h('h2', {}, 'Modo TV'),
        h('button', { class: 'pg-btn', title: 'Cerrar (Esc)', 'aria-label': 'Cerrar', onclick: () => root.remove() }, '✕')),
      h('p', { class: 'pg-tv-intro' }, 'Crea una lista con vídeos al azar de los canales que elijas y la reproduce, con la duración total que indiques.'),
      h('section', {}, h('h3', {}, 'Mis preconfiguraciones'), presetBox),
      h('section', {}, h('h3', {}, '¿De qué canales?'), gchips, details, count),
      h('section', {}, h('h3', {}, '¿Qué vídeos?'),
        h('label', { class: 'pg-toggle' }, onlyNew, 'Solo vídeos que no he visto'),
        h('div', { class: 'pg-tv-row' }, h('span', {}, 'Subidos en'), ageSel),
        h('div', { class: 'pg-tv-row' }, h('span', {}, 'Duración máxima de cada vídeo'), lenSel)),
      h('section', {}, h('h3', {}, '¿Cuánto tiempo?'),
        h('div', { class: 'pg-tv-row' }, amount, unit), quick),
      h('section', {}, h('h3', {}, '¿Cómo lo ves?'), styleBox, clipRow, styleHelp),
      h('section', {}, h('h3', {}, 'Guardar como preconfiguración'), h('div', { class: 'pg-tv-row' }, nameIn, saveBtn)),
      h('div', { class: 'pg-tv-foot' }, status, previewBtn, go),
      previewBox);
    updateCount();
    document.body.append(root);
    const pre = presetId && YTBoxTV.presets(state).find(x => x.id === presetId);
    if (pre) loadPreset(pre);
    setTimeout(() => { go.focus(); if (pre && autoplay) go.click(); }, 0);
  }

  // ---------- Modo Descubrir: canales parecidos que aún no tienes ----------
  function openDiscover() {
    $('#pg-tv')?.remove();
    const cfg = Object.assign({}, YTBoxDiscover.DEFAULTS, state.settings.discover || {});
    const groupsSel = new Set(cfg.groups.filter(id => state.groups.some(g => g.id === id)));
    const chansSel = new Set(cfg.channels.filter(k => state.channels[k]));
    const root = h('div', { id: 'pg-tv', class: 'pg-disc', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Descubrir canales' });
    ['keydown', 'keyup', 'keypress'].forEach(t => root.addEventListener(t, e => { e.stopPropagation(); if (t === 'keydown' && e.key === 'Escape') root.remove(); }));
    root.addEventListener('mousedown', e => { if (e.target === root) root.remove(); });
    const onEsc = e => { if (!root.isConnected) return window.removeEventListener('keydown', onEsc, true); if (e.key === 'Escape' && !$('#pg-disc-gmenu')) { e.stopPropagation(); root.remove(); } };
    window.addEventListener('keydown', onEsc, true);
    const box = h('div', { class: 'pg-tv-box pg-disc-box' });
    root.append(box);

    const count = h('span', { class: 'pg-tv-count' });
    const selected = () => YTBoxTV.selectedChannels({ groups: [...groupsSel], channels: [...chansSel] }, state);
    const updateCount = () => { const n = selected().length; count.textContent = n ? `${n} canal${n > 1 ? 'es' : ''} seleccionado${n > 1 ? 's' : ''}` + (n > 12 ? ' · se mirarán 12 al azar cada vez' : '') : 'Ningún canal seleccionado'; };
    const gchips = h('div', { class: 'pg-tv-chips' });
    const drawGroups = () => gchips.replaceChildren(...state.groups.map(g => h('button', { class: 'pg-chip' + (groupsSel.has(g.id) ? ' on' : ''), onclick: () => { groupsSel.has(g.id) ? groupsSel.delete(g.id) : groupsSel.add(g.id); drawGroups(); updateCount(); } }, PG.iconEl(g, 20), g.name)));
    drawGroups();
    const q = h('input', { type: 'search', class: 'pg-search', placeholder: 'Buscar canal…', style: 'width:100%;box-sizing:border-box' });
    const clist = h('div', { class: 'pg-tv-clist' });
    const allCh = Object.values(state.channels).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    const drawCh = () => {
      const t = q.value.toLowerCase();
      clist.replaceChildren(...allCh.filter(c => !t || c.name.toLowerCase().includes(t) || (c.handle || '').includes(t)).slice(0, 300).map(c => {
        const cb = h('input', { type: 'checkbox' }); cb.checked = chansSel.has(c.key);
        cb.addEventListener('change', () => { cb.checked ? chansSel.add(c.key) : chansSel.delete(c.key); updateCount(); });
        return h('label', { class: 'pg-tv-ch' }, cb, c.avatar ? h('img', { src: c.avatar, referrerpolicy: 'no-referrer' }) : h('span', { class: 'pg-tv-av' }), h('span', {}, c.name));
      }));
    };
    q.addEventListener('input', drawCh); drawCh();
    const details = h('details', { class: 'pg-tv-details' }, h('summary', {}, 'Elegir canales sueltos'), q, clist);
    if (chansSel.size) details.open = true;

    const status = h('div', { class: 'pg-tv-status', role: 'status' });
    const results = h('div', { class: 'pg-disc-results' });
    const go = h('button', { class: 'pg-play pg-tv-go' }, '✦ Descubrir');

    // Añadir un canal sugerido a uno de tus grupos
    const addTo = async (f, g, card) => {
      const key = f.handle || f.id;
      if (!state.channels[key]) state.channels[key] = { key, id: f.id, handle: f.handle || null, name: f.name || key, avatar: f.avatar || '' };
      if (!g.channels.includes(key)) g.channels.push(key);
      await PG.save({ channels: state.channels, groups: state.groups });
      card.classList.add('pg-disc-added');
      card.querySelector('.pg-disc-add').textContent = `✓ En «${g.name}»`;
      toast(`«${f.name}» añadido a «${g.name}»`);
    };
    const groupMenu = (btn, f, card) => {
      $('#pg-disc-gmenu')?.remove();
      const m = h('div', { id: 'pg-disc-gmenu' }, h('div', { class: 'pg-vtitle' }, 'Añadir a…'),
        ...state.groups.map(g => h('button', { class: 'pg-vitem', onclick: e => { e.stopPropagation(); m.remove(); addTo(f, g, card); } }, PG.iconEl(g, 20), h('span', {}, g.name))));
      if (!state.groups.length) m.append(h('div', { class: 'pg-vloading' }, 'Aún no tienes grupos.'));
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
      const add = h('button', { class: 'pg-disc-add pg-play' }, '+ Añadir a grupo');
      add.onclick = e => { e.stopPropagation(); if (!card.classList.contains('pg-disc-added')) groupMenu(add, f, card); };
      const nope = h('button', { class: 'pg-disc-nope', title: 'No volver a sugerirlo' }, 'No me interesa');
      nope.onclick = async () => {
        const ig = state.settings.discoverIgnored || (state.settings.discoverIgnored = []);
        if (!ig.includes(f.id)) ig.push(f.id);
        await PG.save({ settings: state.settings });
        card.remove();
      };
      card.append(
        h('a', { class: 'pg-disc-who', href: url, target: '_blank', rel: 'noopener', title: 'Abrir el canal en una pestaña nueva' },
          f.avatar ? h('img', { src: f.avatar, referrerpolicy: 'no-referrer' }) : h('span', { class: 'pg-tv-av' }),
          h('span', {}, h('b', {}, f.name || f.handle || f.id), h('small', {}, f.handle || ''))),
        h('div', { class: 'pg-disc-why' }, `Parecido a ${f.sourceNames.slice(0, 3).join(', ')}${f.sourceNames.length > 3 ? ` y ${f.sourceNames.length - 3} más` : ''} · sale ${f.hits} ${f.hits === 1 ? 'vez' : 'veces'} en sus relacionados`),
        h('ul', { class: 'pg-disc-vids' }, ...f.videos.slice(0, 2).map(v => h('li', {}, h('a', { href: 'https://www.youtube.com/watch?v=' + v.vid, target: '_blank', rel: 'noopener' }, v.title)))),
        h('div', { class: 'pg-disc-btns' }, add, nope));
      return card;
    };
    go.onclick = async () => {
      const c = { groups: [...groupsSel], channels: [...chansSel] };
      state.settings.discover = c; PG.save({ settings: state.settings });
      status.className = 'pg-tv-status'; go.disabled = true; results.replaceChildren();
      try {
        const r = await YTBoxDiscover.run(c, state, t => { status.textContent = t; });
        status.textContent = r.list.length ? `${r.list.length} canales sugeridos a partir de ${r.scanned} de tus canales. Vuelve a pulsar para otra tanda.` : 'No he encontrado canales nuevos esta vez. Prueba con otros canales o vuelve a intentarlo.';
        results.append(...r.list.map(cardFor));
        results.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) { status.className += ' err'; status.textContent = e.message; }
      finally { go.disabled = false; }
    };

    box.append(
      h('div', { class: 'pg-tv-head' }, h('span', { class: 'pg-tv-ico' }, PG.svgEl('brujula', 26, 'currentColor')), h('h2', {}, 'Descubrir'),
        h('button', { class: 'pg-btn', title: 'Cerrar (Esc)', 'aria-label': 'Cerrar', onclick: () => root.remove() }, '✕')),
      h('p', { class: 'pg-tv-intro' }, 'Elige tus canales y te sugiero canales parecidos que aún no tienes en YTBox: los que más aparecen en los vídeos relacionados de los tuyos.'),
      h('section', {}, h('h3', {}, '¿A partir de qué canales?'), gchips, details, count),
      h('div', { class: 'pg-tv-foot' }, status, go),
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
    if (!next) { video.pause(); endPicoteo('🍿 Fin del picoteo'); return; }
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
        h('button', { class: 'pg-pico-full', title: 'Ver este vídeo entero sin saltar', onclick: e => { e.stopPropagation(); picoFull.add(picoVid); } }, 'Ver entero'),
        h('button', { title: 'Saltar al siguiente trozo', onclick: e => { e.stopPropagation(); picoAdvancing = true; picoNext(picoVid, $('#movie_player video')); } }, '⏭'),
        h('button', { title: 'Salir del picoteo (seguir viendo normal)', onclick: e => { e.stopPropagation(); endPicoteo('Picoteo terminado'); } }, '✕'));
      ['mousedown', 'click', 'dblclick'].forEach(t => b.addEventListener(t, e => e.stopPropagation()));
      player.append(b);
    }
    const order = tvSession.order || [];
    const full = picoFull.has(vid);
    b.querySelector('.pg-pico-txt').textContent = `🍿 Picoteo ${order.indexOf(vid) + 1}/${order.length} · ` + (full ? 'viendo entero' : `siguiente en ${clock(clip[1] - video.currentTime)}`);
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

  // ---------- Ciclo ----------
  function safe(fn, ...a) { try { fn(...a); } catch (e) { console.error('[YTBox]', e); } }
  function tick() { renderGuide(false); safe(updateFab); safe(decorateChannelList, false); safe(positionOverlay); safe(decorateFeed); recordWatched().catch(() => {}); recordChannelView().catch(() => {}); }
  document.addEventListener('yt-navigate-finish', () => { $('#pg-menu')?.remove(); setTimeout(tick, 300); setTimeout(tick, 1500); });
  chrome.runtime.onMessage.addListener(msg => { if (msg.type === 'openGroup') openGroup(msg.id); });
  refresh().then(() => { setInterval(tick, 1500); setTimeout(() => updateNewCounts().catch(() => {}), 2500); setInterval(() => updateNewCounts().catch(() => {}), 5 * 60 * 1000); });

  // Abrir grupo desde URL (?pg_group=id), p. ej. desde el gestor
  const pgParam = new URLSearchParams(location.search).get('pg_group');
  if (pgParam) setTimeout(() => openGroup(pgParam), 800);
})();
