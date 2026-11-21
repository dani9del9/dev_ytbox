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

  async function refresh() { state = await PG.load(); renderGuide(true); updateFab(); decorateChannelList(true); }
  chrome.storage.onChanged.addListener(refresh);

  function openManager(hash = '') { chrome.runtime.sendMessage({ type: 'openManager', hash }); }

  // ---------- Barra lateral ----------
  function renderGuide(force) {
    const sections = $('ytd-app #guide-content #sections, ytd-guide-renderer #sections');
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
      } }, (open ? '▾ ' : '▸ ') + 'Grupos'),
      h('button', { class: 'pg-guide-btn', title: 'Nuevo grupo', onclick: () => openManager('new') }, '+'),
      h('button', { class: 'pg-guide-btn', title: 'Gestionar grupos', onclick: () => openManager() }, '⚙'),
    ));
    if (!open) return;
    if (!state.groups.length) {
      box.append(h('div', { class: 'pg-guide-empty' }, 'Aún no tienes grupos. ', h('a', { href: '#', onclick: e => { e.preventDefault(); openManager('new'); } }, 'Crear uno')));
    }
    for (const g of state.groups) {
      box.append(h('a', { class: 'pg-guide-item', href: '#', title: g.name, onclick: e => { e.preventDefault(); openGroup(g.id); } },
        PG.iconEl(g, 24), h('span', { class: 'pg-guide-name' }, g.name), h('span', { class: 'pg-guide-count' }, String(g.channels.length))));
    }
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
    if (ch) return ch;
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
      state.groups.push({ id: PG.uid(), name: input.value.trim(), icon: { type: 'emoji', value: '📁' }, color: '#3ea6ff', channels: [c.key] });
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
    if (!res.ok) throw new Error('RSS ' + res.status);
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

  let overlay, overlayGroupId;
  function closeOverlay() { overlay?.remove(); overlay = null; overlayGroupId = null; document.documentElement.classList.remove('pg-noscroll'); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay) closeOverlay(); });

  function positionOverlay() {
    if (!overlay) return;
    const guide = $('tp-yt-app-drawer#guide[opened] #contentContainer, ytd-mini-guide-renderer[mini-guide-visible]');
    let left = 0;
    if (guide) { const r = guide.getBoundingClientRect(); if (r.width > 0 && r.right < window.innerWidth / 2) left = r.right; }
    const mast = $('#masthead-container');
    overlay.style.left = left + 'px';
    overlay.style.top = (mast ? mast.getBoundingClientRect().bottom : 56) + 'px';
  }
  window.addEventListener('resize', positionOverlay);

  async function openGroup(groupId, forceReload) {
    const g = state.groups.find(x => x.id === groupId);
    if (!g) return;
    closeOverlay();
    overlayGroupId = groupId;
    const filters = { channel: null, q: '', hideShorts: !!state.settings.hideShorts };
    overlay = h('div', { id: 'pg-overlay' });
    document.documentElement.classList.add('pg-noscroll');
    const status = h('span', { class: 'pg-status' }, 'Cargando…');
    const search = h('input', { type: 'search', class: 'pg-search', placeholder: 'Buscar en el grupo' });
    ['keydown', 'keyup', 'keypress'].forEach(t => search.addEventListener(t, e => e.stopPropagation()));
    const shortsCb = h('input', { type: 'checkbox' }); shortsCb.checked = filters.hideShorts;
    const head = h('div', { class: 'pg-ov-head' },
      PG.iconEl(g, 40), h('h2', {}, g.name), status,
      h('div', { class: 'pg-ov-spacer' }),
      search,
      h('label', { class: 'pg-toggle' }, shortsCb, 'Ocultar Shorts'),
      h('button', { class: 'pg-btn', title: 'Recargar', onclick: () => { g.channels.forEach(k => { const c = state.channels[k]; c && c.id && rssCache.delete(c.id); }); openGroup(groupId, true); } }, '⟳'),
      h('button', { class: 'pg-btn', title: 'Editar grupo', onclick: () => openManager('group=' + g.id) }, '✎'),
      h('button', { class: 'pg-btn', title: 'Cerrar (Esc)', onclick: closeOverlay }, '✕'));
    const chips = h('div', { class: 'pg-chips' });
    const grid = h('div', { class: 'pg-grid' });
    overlay.append(head, chips, grid);
    document.body.append(overlay);
    positionOverlay();

    const chans = g.channels.map(k => state.channels[k]).filter(Boolean);
    if (!chans.length) {
      status.textContent = '';
      grid.append(h('div', { class: 'pg-empty' }, 'Este grupo no tiene canales. Entra en un canal y pulsa «📁 Añadir a grupo», o usa el gestor.'));
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
    const render = () => {
      const q = filters.q.toLowerCase();
      const vids = all.filter(v => (!filters.channel || v.channelId === filters.channel) && (!filters.hideShorts || !v.short) && (!q || v.title.toLowerCase().includes(q) || v.author.toLowerCase().includes(q)))
        .sort((a, b) => b.published - a.published);
      grid.replaceChildren(...vids.map(card));
      if (!vids.length && done === chans.length) grid.append(h('div', { class: 'pg-empty' }, 'No hay vídeos que mostrar.'));
    };
    const renderChips = () => {
      chips.replaceChildren(
        h('button', { class: 'pg-chip' + (!filters.channel ? ' on' : ''), onclick: () => { filters.channel = null; renderChips(); render(); } }, 'Todos'),
        ...chans.filter(c => c.id).map(c => h('button', { class: 'pg-chip' + (filters.channel === c.id ? ' on' : ''), title: c.name, onclick: () => { filters.channel = filters.channel === c.id ? null : c.id; renderChips(); render(); } },
          c.avatar ? h('img', { src: c.avatar, referrerpolicy: 'no-referrer' }) : null, c.name)));
    };
    renderChips();
    search.addEventListener('input', () => { filters.q = search.value; render(); });
    shortsCb.addEventListener('change', async () => { filters.hideShorts = shortsCb.checked; state.settings.hideShorts = shortsCb.checked; render(); await PG.save({ settings: state.settings }); });
    let timer;
    await pool(chans.filter(c => c.id), 6, async c => {
      try { all = all.concat(await fetchRss(c.id)); }
      finally {
        done++;
        status.textContent = done < chans.length ? `Cargando ${done}/${chans.length}…` : `${chans.length} canales`;
        clearTimeout(timer); timer = setTimeout(render, 120);
      }
    });
    if (overlayGroupId === groupId) render();
  }

  function card(v) {
    const href = v.short ? '/shorts/' + v.vid : '/watch?v=' + v.vid;
    const ch = Object.values(state.channels).find(c => c.id === v.channelId);
    const a = h('a', { class: 'pg-card', href },
      h('div', { class: 'pg-thumb' }, h('img', { src: `https://i.ytimg.com/vi/${v.vid}/mqdefault.jpg`, loading: 'lazy' }), v.short ? h('span', { class: 'pg-badge' }, 'SHORT') : null),
      h('div', { class: 'pg-meta' },
        ch && ch.avatar ? h('img', { class: 'pg-avatar', src: ch.avatar, referrerpolicy: 'no-referrer' }) : h('span', { class: 'pg-avatar' }),
        h('div', {},
          h('div', { class: 'pg-title', title: v.title }, v.title),
          h('div', { class: 'pg-sub' }, v.author),
          h('div', { class: 'pg-sub' }, (v.views ? PG.fmtViews(v.views) + ' · ' : '') + PG.relTime(v.published)))));
    return a;
  }

  // ---------- Ciclo ----------
  function tick() { renderGuide(false); updateFab(); decorateChannelList(false); positionOverlay(); }
  document.addEventListener('yt-navigate-finish', () => { $('#pg-menu')?.remove(); setTimeout(tick, 300); setTimeout(tick, 1500); });
  chrome.runtime.onMessage.addListener(msg => { if (msg.type === 'openGroup') openGroup(msg.id); });
  refresh().then(() => setInterval(tick, 1500));

  // Abrir grupo desde URL (?pg_group=id), p. ej. desde el gestor
  const pgParam = new URLSearchParams(location.search).get('pg_group');
  if (pgParam) setTimeout(() => openGroup(pgParam), 800);
})();
