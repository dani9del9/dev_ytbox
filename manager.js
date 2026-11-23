// YTBox — gestor de grupos
// Las consultas a YouTube (youtubei) desde el gestor las hace, si la hay, una pestaña de YouTube abierta:
// así salen desde youtube.com con tu sesión, igual que desde la propia web. Si no hay ninguna, se hacen directamente.
(() => {
  const direct = PG.fetch;
  PG.fetch = async (url, opts = {}) => {
    if (/^https:\/\/www\.youtube\.com\/youtubei\//.test(String(url))) {
      try {
        const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
        for (const t of tabs) {
          try {
            const r = await chrome.tabs.sendMessage(t.id, { type: 'ytbox-fetch', url: String(url), opts: { method: opts.method, headers: opts.headers, body: opts.body, credentials: opts.credentials, auth: opts.credentials !== 'omit' } });
            if (r && !r.error) return new Response(r.text, { status: r.status || 200, headers: { 'Content-Type': 'application/json' } });
          } catch {}
        }
      } catch {}
    }
    return direct(url, opts);
  };
})();
let state = { groups: [], channels: {}, settings: {} };
let view = { name: 'settings' }; // sin destino (botón de la extensión) se abre en Ajustes

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) el.append(k instanceof Node ? k : document.createTextNode(k));
  return el;
};

const PALETTE = ['#ff6347', '#3ea6ff', '#ff4e45', '#ff8a00', '#ffcc00', '#2ecc71', '#00bfa5', '#00b8d9', '#5b6cff', '#9b59ff', '#ff4fa3', '#a1887f', '#8d99ae', '#2b2523'];

let saving = false;
async function persist(keys = ['groups', 'channels', 'settings']) {
  saving = true;
  const o = {}; keys.forEach(k => o[k] = state[k]);
  await PG.save(o);
  setTimeout(() => saving = false, 50);
}

chrome.storage.onChanged.addListener(async ch => { if (ch.chanHealth) chanHealth = ch.chanHealth.newValue || {}; if (saving) return; const prev = T.lang(); state = await PG.load(); applyTheme(); if (T.lang() !== prev) { translateStatic(); renderSide(); } render(); });

// ---------- Tema del gestor ----------
const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const dark = PG.isDark(state.settings, darkMQ.matches);
  const v = PG.themeVars(state.settings, dark);
  const r = document.documentElement.style;
  r.setProperty('--bg', v.bg); r.setProperty('--panel', v.panel); r.setProperty('--panel2', v.panel2);
  r.setProperty('--line', v.line); r.setProperty('--txt', v.txt); r.setProperty('--mut', v.mut);
  r.setProperty('--acc', v.acc); r.setProperty('--acc2', v.acc2); r.setProperty('--grad', v.grad);
  r.setProperty('--acc-soft', v.accSoft); r.setProperty('--shadow', v.shadow);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  const bl = document.querySelector('.brand-logo');
  if (bl) bl.replaceChildren(PG.logoEl(30, v.acc, v.acc2));
}
darkMQ.addEventListener('change', applyTheme);

function channelUrl(c) {
  if (c.handle) return 'https://www.youtube.com/' + encodeURI(c.handle);
  if (c.id) return 'https://www.youtube.com/channel/' + c.id;
  if (String(c.key).startsWith('@')) return 'https://www.youtube.com/' + encodeURI(c.key);
  return 'https://www.youtube.com/channel/' + c.key;
}
// Avatar y nombre del canal como enlace a su página de YouTube (pestaña nueva)
function channelLink(c, sub) {
  return h('a', { class: 'ch-link', href: channelUrl(c), target: '_blank', rel: 'noopener', title: T('Abrir ') + c.name + T(' en YouTube') },
    avatarEl(c), h('div', { class: 'nm' }, h('div', {}, c.name), sub));
}

// Avisos calculados al abrir el grupo en YouTube (canal que no sube / canal que no ves)
let chanHealth = {};
chrome.storage.local.get('chanHealth').then(r => { chanHealth = r.chanHealth || {}; if (Object.keys(chanHealth).length) render(); });
function healthEl(c) {
  const hl = chanHealth[c.key];
  if (!hl || Date.now() - hl.t > 14 * 864e5) return null;
  return h('span', { class: 'ch-warn ch-warn-' + hl.icon, title: hl.text, 'aria-label': hl.text }, PG.svgEl(hl.icon, 16, 'currentColor'));
}

function avatarEl(c, cls = '') {
  return c && c.avatar ? h('img', { src: c.avatar, referrerpolicy: 'no-referrer', class: cls }) : h('span', { class: 'ph ' + cls });
}

// ---------- Rutas ----------
function route() {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash === 'new') { createGroup(); history.replaceState(null, '', '#'); return; }
  if (hash.startsWith('group=')) view = { name: 'group', id: hash.slice(6) };
  else if (hash === 'groups') view = { name: 'group', id: null }; // «Gestionar grupos»: el primer grupo
  else if (hash === 'channels') view = { name: 'channels' };
  else if (hash === 'settings') view = { name: 'settings' };
  else if (hash === 'tv') view = { name: 'tv' };
  else if (hash === 'discover') view = { name: 'discover' };
  else if (hash === 'calendar') view = { name: 'calendar' };
  else if (hash === 'help' || hash.startsWith('help=')) view = { name: 'help', section: hash.split('=')[1] || '' };
  render();
}
window.addEventListener('hashchange', route);

function go(v) { view = v; render(); }

// ---------- Barra lateral ----------
function renderSide() {
  const list = $('#groupList');
  list.replaceChildren();
  state.groups.forEach((g, i) => {
    const it = h('div', { class: 'g-item' + (view.name === 'group' && view.id === g.id ? ' on' : ''), draggable: 'true' },
      PG.iconEl(g, 26), h('span', { class: 'n' }, g.name), h('span', { class: 'c' }, String(g.channels.length)));
    it.onclick = () => go({ name: 'group', id: g.id });
    it.ondragstart = e => { e.dataTransfer.setData('text/plain', String(i)); };
    it.ondragover = e => { e.preventDefault(); it.classList.add('drag-over'); };
    it.ondragleave = () => it.classList.remove('drag-over');
    it.ondrop = async e => {
      e.preventDefault(); it.classList.remove('drag-over');
      const from = +e.dataTransfer.getData('text/plain');
      if (isNaN(from) || from === i) return;
      const [m] = state.groups.splice(from, 1);
      state.groups.splice(i, 0, m);
      await persist(['groups']); render();
    };
    list.append(it);
  });
  if (!state.groups.length) list.append(h('div', { class: 'muted', style: 'padding:8px 10px' }, T('Sin grupos todavía')));
  $$('.side-nav button').forEach(b => b.classList.toggle('on', b.dataset.view === view.name));
}

async function createGroup() {
  const icons = ['📁', '🎮', '🎵', '🎬', '📚', '💻', '⚽', '🍳', '😂', '🔬', '✈️', '🎨'];
  const g = { id: PG.uid(), name: T('Nuevo grupo'), icon: { type: 'emoji', value: icons[state.groups.length % icons.length] }, color: PALETTE[state.groups.length % 10], channels: [] };
  state.groups.push(g);
  await persist(['groups']);
  go({ name: 'group', id: g.id });
  setTimeout(() => { const n = $('.name-input'); n && (n.focus(), n.select()); }, 30);
}

// ---------- Vistas ----------
function render() {
  renderSide();
  const main = $('#main');
  main.replaceChildren();
  main.dataset.view = view.name; // Modo TV, Descubrir, Calendario y Ayuda usan más ancho
  if (view.name === 'channels') return renderChannels(main);
  if (view.name === 'settings') return renderSettings(main);
  if (view.name === 'tv') return renderTV(main);
  if (view.name === 'discover') return renderDiscover(main);
  if (view.name === 'calendar') return renderCalendar(main);
  if (view.name === 'help') return renderHelp(main);
  let g = state.groups.find(x => x.id === view.id);
  if (!g && state.groups.length) { g = state.groups[0]; view.id = g.id; renderSide(); }
  if (!g) {
    main.append(h('div', { class: 'card' },
      h('h1', {}, T('👋 Bienvenido a YTBox')),
      h('p', {}, T('Organiza tus suscripciones de YouTube en grupos con el icono que quieras. Pasos:')),
      h('ol', {},
        h('li', {}, T('Crea un grupo con «+ Nuevo grupo».')),
        h('li', {}, T('Abre youtube.com/feed/channels y pulsa «Importar todas mis suscripciones», o entra en cualquier canal y pulsa «📁 Añadir a grupo».')),
        h('li', {}, T('Tus grupos aparecen en la barra lateral de YouTube; al pulsar uno ves los últimos vídeos de sus canales.'))),
      h('button', { class: 'primary', onclick: createGroup }, T('+ Crear mi primer grupo'))));
    return;
  }
  renderGroup(main, g);
}

// ---------- Ordenar canales de un grupo ----------
let viewStats = { chanViewCount: {}, histCounts: {}, histT: 0 };
chrome.storage.local.get(['chanViewCount', 'ytHistory']).then(r => {
  viewStats = { chanViewCount: r.chanViewCount || {}, histCounts: (r.ytHistory && r.ytHistory.chanCounts) || {}, histT: (r.ytHistory && r.ytHistory.t) || 0 };
});
const fmtNum = n => n >= 1e6 ? (n / 1e6).toLocaleString(T.locale(), { maximumFractionDigits: 1 }) + ' M' : n >= 1e3 ? (n / 1e3).toLocaleString(T.locale(), { maximumFractionDigits: 1 }) + ' K' : String(n);
const timesSeen = c => Math.max(viewStats.chanViewCount[c.key] || 0, (c.handle && viewStats.chanViewCount[c.handle]) || 0, (c.id && viewStats.histCounts[c.id]) || 0);
function sortMetric(c, mode) {
  if (mode === 'subs') return typeof c.subs === 'number' ? `${fmtNum(c.subs)} suscriptores` : null;
  if (mode === 'latest') return c.lastUpload ? T('Último vídeo ') + PG.relTime(new Date(c.lastUpload)) : (c.lastUploadT ? T('Sin vídeos') : null);
  if (mode === 'watched') { const n = timesSeen(c); return n ? TN(n, 'Visto {0} vez', 'Visto {0} veces') : T('No lo has visto'); }
  return null;
}
async function poolRun(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) { const k = i++; try { await fn(list[k]); } catch (e) { console.warn('[YTBox]', e); } }
  }));
}
async function sortGroup(g, mode, statusEl, sel) {
  if (!mode) return;
  const chans = g.channels.map(k => state.channels[k]).filter(Boolean);
  const name = c => (c.name || c.key);
  const byName = (a, b) => name(a).localeCompare(name(b), 'es', { sensitivity: 'base' });
  sel.disabled = true;
  try {
    // Datos que hagan falta (se guardan en el canal para no pedirlos cada vez)
    if (mode === 'subs' || mode === 'latest') {
      const maxAge = mode === 'subs' ? 7 * 864e5 : 6 * 3600e3;
      const need = chans.filter(c => mode === 'subs' ? (!c.subsT || Date.now() - c.subsT > maxAge) : (!c.lastUploadT || Date.now() - c.lastUploadT > maxAge));
      let done = 0;
      const missing = need.filter(c => !c.id);
      if (missing.length) { statusEl.textContent = T('Buscando {0} canales…', missing.length); await poolRun(missing, 4, c => PG.ensureChannelId(c)); }
      await poolRun(need.filter(c => c.id), 4, async c => {
        try {
          if (mode === 'subs') { const s = await YTAPI.channelStats(c.id); c.subs = s.subs; c.subsT = Date.now(); }
          else {
            let vids = [];
            try { vids = await YTAPI.rssVideos(c.id); } catch { vids = (await YTAPI.channelVideos(c.id)).map(v => ({ published: v.published ? new Date(v.published) : null })); }
            const t = vids.map(v => v.published && v.published.getTime()).filter(Boolean);
            c.lastUpload = t.length ? Math.max(...t) : null; c.lastUploadT = Date.now();
          }
        } finally { done++; statusEl.textContent = `${mode === 'subs' ? T('Leyendo suscriptores') : T('Mirando su último vídeo')}… ${done}/${need.length}`; }
      });
      await persist(['channels']);
    }
    if (mode === 'watched') {
      const r = await chrome.storage.local.get(['chanViewCount', 'ytHistory']);
      viewStats = { chanViewCount: r.chanViewCount || {}, histCounts: (r.ytHistory && r.ytHistory.chanCounts) || {}, histT: (r.ytHistory && r.ytHistory.t) || 0 };
    }
    const cmp = {
      az: byName,
      subs: (a, b) => ((b.subs ?? -1) - (a.subs ?? -1)) || byName(a, b),
      latest: (a, b) => ((b.lastUpload || 0) - (a.lastUpload || 0)) || byName(a, b),
      watched: (a, b) => (timesSeen(b) - timesSeen(a)) || byName(a, b),
    }[mode];
    const sorted = chans.slice().sort(cmp).map(c => c.key);
    const rest = g.channels.filter(k => !state.channels[k]);
    g.channels = sorted.concat(rest);
    state.settings.groupSort = Object.assign({}, state.settings.groupSort, { [g.id]: mode });
    statusEl.textContent = mode === 'watched' && !viewStats.histT ? T('Para usar tu historial, abre YouTube con tu sesión iniciada') : '';
    await persist(['groups', 'settings']);
    render();
  } catch (e) { statusEl.textContent = e.message; }
  finally { sel.disabled = false; }
}

function renderGroup(main, g) {
  const name = h('input', { type: 'text', class: 'name-input', value: g.name });
  name.oninput = () => { g.name = name.value; renderSide(); };
  name.onchange = () => persist(['groups']);
  const iconBtn = h('button', { class: 'big-icon', title: T('Cambiar icono') }, PG.iconEl(g, 64));
  iconBtn.onclick = () => openPicker(g);

  main.append(
    h('div', { class: 'editor-top' }, iconBtn, name,
      h('button', { class: 'secondary', onclick: () => window.open('https://www.youtube.com/?pg_group=' + g.id, '_blank') }, T('▶ Ver en YouTube')),
      h('button', { class: 'danger', onclick: async () => {
        if (!confirm(T('¿Borrar el grupo «{0}»? Los canales no se borran.', g.name))) return;
        state.groups = state.groups.filter(x => x.id !== g.id); view.id = null;
        await persist(['groups']); render();
      } }, T('Borrar grupo'))));

  // Canales del grupo
  const chans = g.channels.map(k => state.channels[k] || { key: k, name: k });
  // Ordenar: A-Z, suscriptores, último vídeo subido o los que más ves. El orden se guarda en el grupo.
  const sortMode = (state.settings.groupSort || {})[g.id] || '';
  const sortStatus = h('span', { class: 'muted sort-status' });
  const sortSel = h('select', { class: 'tv-select', title: T('Ordenar los canales del grupo') },
    ...[['', T('Ordenar…')], ['az', T('Alfabético (A-Z)')], ['subs', T('Más suscriptores')], ['latest', T('Último vídeo subido')], ['watched', T('Los que más ves')]].map(([v, t]) => h('option', { value: v }, t)));
  sortSel.value = sortMode;
  sortSel.onchange = () => sortGroup(g, sortSel.value, sortStatus, sortSel);
  main.append(h('div', { class: 'section-head' },
    h('h3', { style: 'margin:0' }, T('Canales en el grupo ({0})', chans.length)),
    chans.length > 1 ? h('div', { class: 'row', style: 'gap:12px' }, sortStatus, sortSel) : null));
  const list = h('div', { class: 'ch-list' });
  if (!chans.length) list.append(h('div', { class: 'muted' }, T('Ningún canal todavía. Añádelos abajo.')));
  for (const c of chans) {
    list.append(h('div', { class: 'ch' }, channelLink(c, h('small', {}, sortMetric(c, sortMode) || c.handle || c.id || c.key)), healthEl(c),
      h('button', { class: 'icon-btn', title: T('Quitar del grupo'), onclick: async () => { g.channels = g.channels.filter(k => k !== c.key); await persist(['groups']); render(); } }, '✕')));
  }
  main.append(list);

  // Añadir por URL
  main.append(h('h3', {}, T('Añadir canal por enlace o @handle')));
  const url = h('input', { type: 'text', placeholder: 'https://www.youtube.com/@canal  ·  @canal  ·  UCxxxx…', style: 'flex:1;min-width:300px' });
  const msg = h('div', { class: 'msg' });
  const addBtn = h('button', { class: 'primary' }, T('Añadir'));
  const doAdd = async () => {
    const v = url.value.trim(); if (!v) return;
    addBtn.disabled = true; msg.className = 'msg'; msg.textContent = T('Buscando canal…');
    try {
      const r = await PG.resolveChannel(v);
      let c = Object.values(state.channels).find(x => x.id === r.id || x.key === r.key);
      if (!c) { c = { key: r.key, id: r.id, handle: r.handle, name: r.name, avatar: r.avatar }; state.channels[c.key] = c; }
      else { c.id = r.id; c.avatar = c.avatar || r.avatar; }
      if (!g.channels.includes(c.key)) g.channels.push(c.key);
      await persist(['groups', 'channels']);
      render();
    } catch (e) { msg.className = 'msg err'; msg.textContent = e.message; addBtn.disabled = false; }
  };
  addBtn.onclick = doAdd;
  url.onkeydown = e => { if (e.key === 'Enter') doAdd(); };
  main.append(h('div', { class: 'row' }, url, addBtn), msg);

  // Añadir desde canales conocidos
  const others = Object.values(state.channels).filter(c => !g.channels.includes(c.key)).sort((a, b) => a.name.localeCompare(b.name));
  main.append(h('h3', {}, T('Añadir desde tus canales importados ({0})', others.length)));
  if (!others.length) { main.append(h('div', { class: 'muted' }, T('Importa tus suscripciones desde youtube.com/feed/channels para elegirlas aquí.'))); return; }
  const q = h('input', { type: 'search', placeholder: T('Filtrar canales…'), style: 'width:320px;margin-bottom:10px' });
  const onlyFree = h('input', { type: 'checkbox' });
  const pool = h('div', { class: 'ch-list' });
  const fill = () => {
    const s = q.value.toLowerCase();
    pool.replaceChildren(...others
      .filter(c => !s || c.name.toLowerCase().includes(s) || (c.handle || '').includes(s))
      .filter(c => !onlyFree.checked || !state.groups.some(x => x.channels.includes(c.key)))
      .map(c => h('div', { class: 'ch add', title: T('Añadir al grupo'), onclick: async () => { g.channels.push(c.key); await persist(['groups']); render(); } },
        avatarEl(c), h('div', { class: 'nm' }, h('div', {}, c.name), h('small', {}, c.handle || c.id)), h('span', { style: 'font-size:20px;color:var(--acc)' }, '+'))));
  };
  q.oninput = fill; onlyFree.onchange = fill;
  main.append(h('div', { class: 'row' }, q, h('label', { class: 'row', style: 'gap:6px;margin-bottom:10px' }, onlyFree, T('Solo canales sin grupo'))), pool);
  fill();
}

function renderChannels(main) {
  const all = Object.values(state.channels).sort((a, b) => a.name.localeCompare(b.name));
  main.append(h('h1', {}, T('Todos los canales ({0})', all.length)));
  main.append(h('p', { class: 'muted' }, T('Pulsa los iconos de cada canal para meterlo o sacarlo de cada grupo.')));
  const q = h('input', { type: 'search', placeholder: T('Buscar…'), style: 'width:300px' });
  const sel = h('select', { style: 'background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px' },
    h('option', { value: 'all' }, T('Todos')), h('option', { value: 'none' }, T('Sin grupo')), ...state.groups.map(g => h('option', { value: g.id }, g.name)));
  main.append(h('div', { class: 'toolbar' }, q, sel,
    h('button', { class: 'secondary', onclick: () => window.open('https://www.youtube.com/feed/channels', '_blank') }, T('📥 Importar desde YouTube'))));
  const list = h('div', { class: 'ch-list' });
  main.append(list);
  if (!all.length) { list.append(h('div', { class: 'empty' }, T('No hay canales. Ve a youtube.com/feed/channels y pulsa «Importar todas mis suscripciones».'))); return; }
  const fill = () => {
    const s = q.value.toLowerCase();
    list.replaceChildren(...all.filter(c => {
      if (s && !c.name.toLowerCase().includes(s) && !(c.handle || '').includes(s)) return false;
      if (sel.value === 'none') return !state.groups.some(g => g.channels.includes(c.key));
      if (sel.value !== 'all') return state.groups.find(g => g.id === sel.value)?.channels.includes(c.key);
      return true;
    }).map(c => {
      const tags = h('div', { class: 'ch-groups' }, state.groups.map(g => {
        const b = h('button', { class: 'gt' + (g.channels.includes(c.key) ? ' on' : ''), title: g.name }, PG.iconEl(g, 20));
        b.onclick = async () => {
          if (g.channels.includes(c.key)) g.channels = g.channels.filter(k => k !== c.key); else g.channels.push(c.key);
          b.classList.toggle('on'); await persist(['groups']); renderSide();
        };
        return b;
      }));
      return h('div', { class: 'ch ch-all' }, channelLink(c, null), healthEl(c), tags,
        h('button', { class: 'icon-btn', title: T('Olvidar canal'), onclick: async () => {
          if (!confirm(T('¿Olvidar «{0}»? Se quitará de todos los grupos.', c.name))) return;
          delete state.channels[c.key]; state.groups.forEach(g => g.channels = g.channels.filter(k => k !== c.key));
          await persist(['groups', 'channels']); render();
        } }, '🗑'));
    }));
  };
  q.oninput = fill; sel.onchange = fill; fill();
}

function renderSettings(main) {
  main.append(h('h1', {}, T('Ajustes')));
  // ---- Apariencia: tema y colores de la app
  const st = state.settings;
  let saveT;
  const saveLater = () => { clearTimeout(saveT); saveT = setTimeout(() => persist(['settings']), 300); };
  const themeSeg = h('div', { class: 'theme-seg' });
  const drawTheme = () => themeSeg.replaceChildren(...[['light', T('☀️ Claro')], ['dark', T('🌙 Oscuro')], ['auto', T('🌓 Automático')]].map(([v, t]) =>
    h('button', { class: (st.theme || 'light') === v ? 'on' : '', onclick: () => { st.theme = v; drawTheme(); applyTheme(); saveLater(); } }, t)));
  drawTheme();
  const picker = (key, idx) => {
    const inp = h('input', { type: 'color', value: st[key] || PG.DEFAULT_COLORS[idx] });
    const code = h('code', {}, inp.value);
    inp.oninput = () => { st[key] = inp.value; code.textContent = inp.value; applyTheme(); saveLater(); };
    return { el: h('div', { class: 'color-pick' }, inp, code), inp, code };
  };
  const p1 = picker('color1', 0), p2 = picker('color2', 1);
  // ---- Opciones de portada (YouTube)
  const check = (key, def, title, desc) => {
    const cb = h('input', { type: 'checkbox' }); cb.checked = def ? st[key] !== false : !!st[key];
    cb.onchange = () => { st[key] = cb.checked; persist(['settings']); };
    return h('label', { class: 'set-check' }, cb, h('span', {}, h('b', {}, title), h('small', {}, desc)));
  };
  main.append(h('div', { class: 'card', id: 'set-features' }, h('h3', { style: 'margin-top:0' }, T('🏠 Opciones de portada')),
    check('homeShelf', true, T('Estante de YTBox en la portada de YouTube'),
      T('Entre las recomendaciones de la portada, los 3 últimos vídeos de uno de tus grupos (al azar, se puede cambiar) con botones para ver los 3 anteriores y siguientes.')),
    check('onlyNewGroups', false, T('Mostrar solo los grupos con vídeos nuevos'),
      T('En el panel lateral de YouTube solo salen los grupos que tienen vídeos nuevos (los fijados también se ocultan si no tienen novedades).'))));
  main.append(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, T('🎨 Apariencia')),
    h('p', {}, T('Elige el tema y los dos colores de la app. Se usan en degradado (el primero domina la mitad) en botones, etiquetas y títulos, aquí y dentro de YouTube. «Automático» sigue el tema de YouTube o el de tu sistema.')),
    h('div', { class: 'set-row' }, h('label', { class: 'lbl' }, T('Tema')), themeSeg),
    h('div', { class: 'set-row' }, h('label', { class: 'lbl' }, T('Color 1')), p1.el, h('label', { class: 'lbl', style: 'min-width:auto;margin-left:14px' }, T('Color 2')), p2.el,
      h('button', { class: 'secondary', onclick: () => {
        st.color1 = PG.DEFAULT_COLORS[0]; st.color2 = PG.DEFAULT_COLORS[1];
        p1.inp.value = st.color1; p1.code.textContent = st.color1; p2.inp.value = st.color2; p2.code.textContent = st.color2;
        applyTheme(); saveLater();
      } }, T('Restablecer'))),
    h('div', { class: 'grad-preview' }, 'YTBox')));
  // ---- Idioma
  const langSel = h('select', { class: 'tv-select', 'aria-label': T('Idioma') }, ...YTBOX_LANGS.map(([v, n]) => h('option', { value: v }, n)));
  langSel.value = T.lang();
  langSel.onchange = async () => { state.settings.lang = langSel.value; T.setLang(langSel.value); await persist(['settings']); translateStatic(); renderSide(); render(); };
  main.append(h('div', { class: 'card', id: 'set-lang' }, h('h3', { style: 'margin-top:0' }, T('🌐 Idioma')),
    h('div', { class: 'row' }, h('span', {}, T('Idioma de YTBox (en el gestor y dentro de YouTube):')), langSel)));
  const file = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden' });
  const msg = h('div', { class: 'msg', id: 'backup-msg' });
  file.onchange = async () => {
    try {
      const data = JSON.parse(await file.files[0].text());
      if (isPocketTube(data)) { file.value = ''; return importPocketTube(data); }
      if (!Array.isArray(data.groups)) throw new Error(T('Archivo no válido'));
      const merge = confirm(T('Aceptar = COMBINAR con lo que ya tienes.\nCancelar = REEMPLAZAR todo.'));
      const presetsIn = Array.isArray(data.tvPresets) ? data.tvPresets : (data.settings && Array.isArray(data.settings.tvPresets) ? data.settings.tvPresets : []);
      if (merge) {
        Object.assign(state.channels, data.channels || {});
        for (const g of data.groups) { const ex = state.groups.find(x => x.id === g.id); if (ex) ex.channels = [...new Set([...ex.channels, ...g.channels])]; else state.groups.push(g); }
        // Presets del Modo TV: se añaden; si ya hay uno con el mismo nombre, se actualiza
        for (const p of presetsIn) if (p && p.name && p.cfg) YTBoxTV.savePreset(state, p.name, p.cfg);
        // Ajustes (idioma, tema, colores, opciones…): se aplican los del archivo
        if (data.settings) { const { tvPresets, sync, ...rest } = data.settings; Object.assign(state.settings, rest); }
      } else {
        state.groups = data.groups; state.channels = data.channels || {};
        if (data.settings) state.settings = Object.assign({}, state.settings, data.settings, { sync: state.settings.sync });
        state.settings.tvPresets = presetsIn.filter(p => p && p.name && p.cfg);
      }
      await persist(['groups', 'channels', 'settings']); T.setLang(state.settings.lang); applyTheme(); translateStatic(); renderSide(); render();
      const m2 = $('#backup-msg'); if (m2) { m2.className = 'msg'; m2.textContent = T('✔ Importado'); }
    } catch (e) { msg.className = 'msg err'; msg.textContent = e.message; }
  };
  const syncCb = h('input', { type: 'checkbox' }); syncCb.checked = !!state.settings.sync;
  const syncMsg = h('div', { class: 'msg' });
  const showSync = async () => {
    const { syncStatus } = await chrome.storage.local.get('syncStatus');
    if (!syncStatus) { syncMsg.textContent = ''; return; }
    syncMsg.className = 'msg' + (syncStatus.error ? ' err' : '');
    syncMsg.textContent = (T(syncStatus.error) || ('✔ ' + T(syncStatus.ok))) + ' · ' + new Date(syncStatus.at).toLocaleString(T.locale());
  };
  syncCb.onchange = async () => { state.settings.sync = syncCb.checked; await persist(['settings']); setTimeout(showSync, 1500); };
  showSync();
  // Importar desde PocketTube
  const ptFile = h('input', { type: 'file', accept: '.json,.txt,application/json,text/plain', class: 'hidden' });
  const ptMsg = h('div', { class: 'msg' });
  ptFile.onchange = async () => {
    try {
      const data = JSON.parse(await ptFile.files[0].text());
      ptFile.value = '';
      if (!isPocketTube(data)) throw new Error(T('Este archivo no parece una copia de seguridad de PocketTube'));
      await importPocketTube(data);
    } catch (e) { ptMsg.className = 'msg err'; ptMsg.textContent = e.message; }
  };
  main.append(
    h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, T('Sincronizar entre navegadores')),
      h('p', {}, T('Guarda tus grupos y canales en tu cuenta del navegador (Chrome o Edge con la sincronización activada) para tenerlos iguales en todos tus ordenadores. Los avatares no se sincronizan: se vuelven a cargar solos.')),
      h('div', { class: 'row' }, h('label', { class: 'row', style: 'gap:8px' }, syncCb, T('Activar sincronización')),
        h('button', { class: 'secondary', onclick: async () => {
          syncMsg.className = 'msg'; syncMsg.textContent = T('Sincronizando…');
          const r = await chrome.runtime.sendMessage({ type: 'syncNow' });
          if (r && r.skipped) { syncMsg.textContent = T('Activa primero la sincronización'); return; }
          setTimeout(showSync, 300);
        } }, T('⟳ Sincronizar ahora'))), syncMsg),
    h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, T('Copia de seguridad')),
      h('p', {}, T('Guarda en un archivo JSON toda tu configuración: grupos, iconos, canales, preconfiguraciones del Modo TV, idioma, tema, colores y opciones. Al importarlo se restaura todo (también en otro navegador).')),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => {
          const blob = new Blob([JSON.stringify({ app: 'YTBox', version: 3, exportedAt: new Date().toISOString(), groups: state.groups, channels: state.channels, tvPresets: YTBoxTV.presets(state), settings: Object.assign({}, state.settings, { tvPresets: undefined, sync: undefined }) }, null, 2)], { type: 'application/json' });
          const a = h('a', { href: URL.createObjectURL(blob), download: `ytbox-${new Date().toISOString().slice(0, 10)}.json` }); a.click();
        } }, T('⬇ Exportar JSON')),
        h('button', { class: 'secondary', onclick: () => file.click() }, T('⬆ Importar JSON')), file), msg),
    h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, T('📥 Importar desde PocketTube')),
      h('p', {}, T('Trae tus grupos y canales de PocketTube. En PocketTube abre sus ajustes y exporta la copia de seguridad (un archivo .json o .txt); luego elígelo aquí. Los grupos con el mismo nombre se combinan.')),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => ptFile.click() }, T('Elegir archivo de PocketTube…')), ptFile), ptMsg),
    h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, T('Importar suscripciones de YouTube')),
      h('p', {}, T('Abre la página de tus suscripciones y pulsa el botón azul «Importar todas mis suscripciones» que aparece abajo.')),
      h('button', { class: 'secondary', onclick: () => window.open('https://www.youtube.com/feed/channels', '_blank') }, T('Abrir youtube.com/feed/channels'))),
    h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, T('Borrar todo')),
      h('p', {}, T('Elimina todos los grupos y canales guardados.')),
      h('button', { class: 'danger', onclick: async () => {
        if (!confirm(T('¿Seguro? Se borrarán todos los grupos y canales.'))) return;
        state.groups = []; state.channels = {}; await persist(['groups', 'channels']); render();
      } }, T('Borrar todo'))));
  // Dos columnas: los ajustes a la izquierda y, en el hueco de la derecha, la tarjeta de apoyo (fija al hacer scroll)
  const cards = [...main.children].filter(el => el.tagName !== 'H1');
  main.append(h('div', { class: 'set-layout' },
    h('div', { class: 'set-col' }, ...cards),
    h('aside', { class: 'set-aside' },
    h('div', { class: 'card', id: 'set-support' }, h('div', { class: 'kofi-ico', 'aria-hidden': 'true' }, '☕'), h('h3', { style: 'margin-top:0' }, T('Apoya YTBox')),
        h('p', {}, T('YTBox es gratis y sin anuncios. Si te resulta útil y quieres invitarme a un café para que siga mejorándolo, puedes hacerlo en Ko-fi. ¡Muchas gracias!')),
        h('a', { class: 'primary kofi-btn', href: 'https://ko-fi.com/dani9del9', target: '_blank', rel: 'noopener noreferrer' }, T('☕ Invítame a un café en Ko-fi'))))));
}

// Indicador de trabajo para Modo TV y Descubrir: spinner, barra de progreso y botón en «Cargando…»
function busyUI(go, status, idleLabel, busyLabel) {
  const spin = h('span', { class: 'spin', 'aria-hidden': 'true' });
  const bar = h('div', { class: 'progress' }, h('i'));
  const progress = t => {
    status.textContent = t;
    const m = String(t).match(/(\d+)\/(\d+)/);
    bar.classList.toggle('indet', !m);
    bar.firstChild.style.width = m ? Math.round(100 * Number(m[1]) / Math.max(1, Number(m[2]))) + '%' : '';
  };
  const setBusy = on => {
    spin.style.display = on ? 'inline-block' : 'none'; bar.style.display = on ? 'block' : 'none';
    go.disabled = on; status.classList.toggle('busy', on);
    if (on) { bar.classList.add('indet'); go.replaceChildren(h('span', { class: 'spin spin-w', 'aria-hidden': 'true' }), busyLabel); }
    else go.textContent = idleLabel;
  };
  spin.style.display = 'none'; bar.style.display = 'none';
  return { spin, bar, progress, setBusy };
}

// Chips con los canales sueltos elegidos (× para quitar uno, «Quitar todos») — Modo TV y Descubrir
function selectedChips(set, onChange) {
  const box = h('div', { class: 'selchips' });
  const draw = () => {
    const list = [...set].map(k => state.channels[k]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    box.style.display = list.length ? '' : 'none';
    box.replaceChildren(
      h('span', { class: 'selchips-label' }, T('Canales sueltos ({0}):', list.length)),
      ...list.map(c => h('span', { class: 'selchip' }, avatarEl(c), h('span', { class: 'selchip-name' }, c.name),
        h('button', { class: 'selchip-x', title: T('Quitar'), 'aria-label': T('Quitar ') + c.name, onclick: () => { set.delete(c.key); onChange(); } }, '×'))),
      ...(list.length > 1 ? [h('button', { class: 'selchip-all', onclick: () => { set.clear(); onChange(); } }, T('Quitar todos'))] : []));
  };
  return { box, draw };
}

function modeIcon(name, size) {
  const small = size === 'small';
  return h('span', { class: 'mode-ico' + (small ? ' small' : '') }, PG.svgEl(name, small ? 14 : 24, '#ffffff'));
}

// ---------- Ayuda ----------
function richText(t) {
  // **negrita** → <b>
  const out = []; const re = /\*\*(.+?)\*\*/g; let last = 0, m;
  while ((m = re.exec(t))) { if (m.index > last) out.push(t.slice(last, m.index)); out.push(h('b', {}, m[1])); last = re.lastIndex; }
  if (last < t.length) out.push(t.slice(last));
  return out;
}
function renderHelp(main) {
  const q = h('input', { type: 'search', placeholder: T('Buscar en la ayuda…'), class: 'help-search' });
  const toc = h('nav', { class: 'help-toc', 'aria-label': T('Índice de la ayuda') });
  const body = h('div', { class: 'help-body' });
  const blockEl = b => {
    if (typeof b === 'string') return h('p', {}, ...richText(b));
    if (b[0] === 'ul') return h('ul', {}, ...b.slice(1).map(li => h('li', {}, ...richText(li))));
    if (b[0] === 'tip') return h('div', { class: 'help-tip' }, h('span', { class: 'help-tip-ico' }, '💡'), h('p', {}, ...richText(b[1])));
    return null;
  };
  const textOf = s => (s.title + ' ' + JSON.stringify(s.blocks)).toLowerCase().replace(/\*\*/g, '');
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    const help = YTBOX_HELP.map(s => ({ ...s, title: T(s.title), blocks: s.blocks.map(b => typeof b === 'string' ? T(b) : [b[0], ...b.slice(1).map(x => T(x))]) }));
    const list = help.filter(s => !t || textOf(s).includes(t));
    toc.replaceChildren(...list.map(s => h('a', { href: '#help=' + s.id, onclick: e => { e.preventDefault(); $('#help-' + s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
      h('span', { class: 'mode-ico small plain' }, PG.svgEl(s.icon, 16, 'currentColor')), s.title)));
    body.replaceChildren(...(list.length ? list.map(s => h('section', { class: 'card help-sec', id: 'help-' + s.id },
      h('h2', {}, h('span', { class: 'mode-ico' }, PG.svgEl(s.icon, 22, '#ffffff')), s.title), ...s.blocks.map(blockEl).filter(Boolean)))
      : [h('div', { class: 'card muted' }, T('No hay nada en la ayuda que coincida con tu búsqueda.'))]));
  };
  q.oninput = draw;
  draw();
  main.append(
    h('h1', { class: 'mode-title' }, h('span', { class: 'mode-ico' }, PG.svgEl('ayuda', 24, '#ffffff')), T('Ayuda')),
    h('p', { class: 'muted', style: 'max-width:760px;margin:-12px 0 24px' }, T('Cómo funciona YTBox y todas sus opciones.')),
    h('div', { class: 'help-layout' }, h('div', { class: 'help-side' }, q, toc), body));
  if (view.section) setTimeout(() => $('#help-' + view.section)?.scrollIntoView({ block: 'start' }), 50);
}

// ---------- Calendario: los vídeos de todos los canales de todos los grupos ----------
let calData = null;          // { t, items } (se reutiliza 15 min)
let calLoading = null;
const calUI = { month: null, group: '', type: 'videos', day: null };
const pad2c = n => String(n).padStart(2, '0');
const dayKeyC = d => `${d.getFullYear()}-${pad2c(d.getMonth() + 1)}-${pad2c(d.getDate())}`;
const fmtDurC = s => { s = Math.round(s); const hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60; return (hh ? hh + ':' + pad2c(mm) : mm) + ':' + pad2c(ss); };

function loadCalendarData(onProgress) {
  if (calData && Date.now() - calData.t < 15 * 60 * 1000) return Promise.resolve(calData);
  if (calLoading) return calLoading;
  calLoading = (async () => {
    const chans = new Map();
    for (const g of state.groups) for (const k of g.channels) { const c = state.channels[k]; if (c && c.id) chans.set(c.id, c); }
    const list = [...chans.values()];
    const items = []; let done = 0;
    await poolRun(list, 6, async c => {
      try { (await YTAPI.rssVideos(c.id)).forEach(v => items.push(v)); }
      finally { done++; onProgress(T('Leyendo los vídeos de tus canales… {0}/{1}', done, list.length)); }
    });
    calData = { t: Date.now(), items };
    return calData;
  })();
  calLoading.finally(() => { calLoading = null; });
  return calLoading;
}

function renderCalendar(main) {
  const status = h('div', { class: 'msg', role: 'status' });
  const dummy = h('button', { style: 'display:none' });
  const ui = busyUI(dummy, status, '', '');
  const box = h('div', {});
  const head = h('div', { class: 'card' });
  main.append(
    h('h1', { class: 'mode-title' }, modeIcon('calendario'), T('Calendario')),
    h('p', { class: 'muted', style: 'max-width:760px;margin:-12px 0 28px' }, T('Qué días han subido vídeos tus canales, de todos tus grupos. Pulsa un día para ver sus vídeos. YouTube da los últimos 15 vídeos de cada canal, así que los meses antiguos salen más vacíos.')),
    head, box);
  const groupsOf = new Map(); // channelId -> [grupos]
  for (const g of state.groups) for (const k of g.channels) { const c = state.channels[k]; if (c && c.id) { if (!groupsOf.has(c.id)) groupsOf.set(c.id, []); if (!groupsOf.get(c.id).includes(g)) groupsOf.get(c.id).push(g); } }
  const chanById = new Map(Object.values(state.channels).filter(c => c.id).map(c => [c.id, c]));
  let durations = {};
  chrome.storage.local.get('durations').then(r => { durations = r.durations || {}; if (calData) draw(); });

  const draw = () => {
    const items = calData.items.filter(v =>
      (calUI.type === 'all' || (calUI.type === 'shorts') === !!v.short) &&
      (!calUI.group || (groupsOf.get(v.channelId) || []).some(g => g.id === calUI.group)));
    if (!calUI.month) {
      const newest = items.reduce((m, v) => (v.published > m ? v.published : m), new Date(0));
      const ref = items.length ? newest : new Date();
      calUI.month = new Date(ref.getFullYear(), ref.getMonth(), 1);
    }
    const byDay = new Map();
    for (const v of items) { const k = dayKeyC(v.published); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(v); }
    const y = calUI.month.getFullYear(), m = calUI.month.getMonth();
    const days = new Date(y, m + 1, 0).getDate(), lead = (new Date(y, m, 1).getDay() + 6) % 7;
    let max = 1, total = 0;
    for (let d = 1; d <= days; d++) { const n = (byDay.get(dayKeyC(new Date(y, m, d))) || []).length; max = Math.max(max, n); total += n; }
    const today = dayKeyC(new Date());
    const nav = delta => { calUI.month = new Date(y, m + delta, 1); calUI.day = null; draw(); };

    // Filtros
    head.replaceChildren(
      h('div', { class: 'tv-chips' },
        h('button', { class: 'tv-chip' + (!calUI.group ? ' on' : ''), onclick: () => { calUI.group = ''; calUI.day = null; draw(); } }, T('Todos los grupos')),
        ...state.groups.map(g => h('button', { class: 'tv-chip' + (calUI.group === g.id ? ' on' : ''), onclick: () => { calUI.group = calUI.group === g.id ? '' : g.id; calUI.day = null; draw(); } }, PG.iconEl(g, 20), g.name))),
      h('div', { class: 'row', style: 'margin-top:16px;gap:8px' },
        ...[['videos', T('Vídeos')], ['shorts', T('Shorts')], ['all', T('Todo')]].map(([v, t]) => h('button', { class: 'tv-chip' + (calUI.type === v ? ' on' : ''), onclick: () => { calUI.type = v; calUI.day = null; draw(); } }, t)),
        h('span', { style: 'flex:1' }),
        h('button', { class: 'secondary', title: T('Volver a leer los vídeos de tus canales'), onclick: () => { calData = null; start(); } }, T('⟳ Actualizar'))));

    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(h('span', { class: 'cal-cell blank' }));
    for (let d = 1; d <= days; d++) {
      const k = dayKeyC(new Date(y, m, d)), list = byDay.get(k) || [];
      const authors = [...new Set(list.map(v => v.channelId))].map(id => chanById.get(id)).filter(Boolean);
      cells.push(h('button', { class: 'cal-cell cal-day' + (list.length ? ' has' : '') + (k === today ? ' today' : '') + (calUI.day === k ? ' sel' : ''),
        ...(list.length ? {} : { disabled: '' }), style: `--i:${(list.length / max).toFixed(2)}`,
        title: list.length ? TN(list.length, '{1}: {0} vídeo', '{1}: {0} vídeos', T.dayMonth(d, m)) : '',
        onclick: () => { calUI.day = calUI.day === k ? null : k; draw(); if (calUI.day) setTimeout(() => $('.cal-daylist')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); } },
        h('span', { class: 'cal-num' }, String(d)),
        list.length ? h('span', { class: 'cal-count' }, String(list.length)) : null,
        authors.length ? h('span', { class: 'cal-avs' }, ...authors.slice(0, 4).map(c => c.avatar ? h('img', { src: c.avatar, referrerpolicy: 'no-referrer', alt: '' }) : h('i', {})), authors.length > 4 ? h('small', {}, '+' + (authors.length - 4)) : null) : null));
    }
    const dayList = calUI.day ? (byDay.get(calUI.day) || []).slice().sort((a, b) => b.published - a.published) : [];
    box.replaceChildren(
      h('div', { class: 'card cal-card' },
        h('div', { class: 'cal-head' },
          h('button', { class: 'secondary cal-nav', title: T('Mes anterior'), 'aria-label': T('Mes anterior'), onclick: () => nav(-1) }, '‹'),
          h('b', {}, `${T.month(m)} ${y}`),
          h('button', { class: 'secondary cal-nav', title: T('Mes siguiente'), 'aria-label': T('Mes siguiente'), onclick: () => nav(1) }, '›'),
          h('button', { class: 'secondary', onclick: () => { const t = new Date(); calUI.month = new Date(t.getFullYear(), t.getMonth(), 1); calUI.day = null; draw(); } }, T('Hoy')),
          h('span', { class: 'muted', style: 'margin-left:auto' }, total ? TN(total, '{0} vídeo este mes', '{0} vídeos este mes') : T('Ningún vídeo este mes'))),
        h('div', { class: 'cal-grid' }, ...T.weekdays().map(t => h('span', { class: 'cal-wd' }, t)), ...cells)),
      calUI.day ? h('div', { class: 'card cal-daylist' },
        h('h3', { style: 'margin-top:0' }, TN(dayList.length, '{1} · {0} vídeo', '{1} · {0} vídeos', T.dayMonth(Number(calUI.day.slice(8)), Number(calUI.day.slice(5, 7)) - 1))),
        h('div', { class: 'cal-vids' }, ...dayList.map(v => {
          const c = chanById.get(v.channelId) || {};
          const url = 'https://www.youtube.com/' + (v.short ? 'shorts/' : 'watch?v=') + v.vid;
          return h('a', { class: 'cal-vid', href: url, target: '_blank', rel: 'noopener' },
            h('span', { class: 'cal-thumb' }, h('img', { src: `https://i.ytimg.com/vi/${v.vid}/mqdefault.jpg`, loading: 'lazy', alt: '' }),
              v.short ? h('span', { class: 'cal-dur' }, 'SHORT') : (v.vid in durations ? h('span', { class: 'cal-dur' }, fmtDurC(durations[v.vid])) : null)),
            h('span', { class: 'cal-vinfo' }, h('b', {}, v.title),
              h('small', {}, `${c.name || ''} · ${v.published.toLocaleTimeString(T.locale(), { hour: '2-digit', minute: '2-digit' })}`),
              h('span', { class: 'cal-tags' }, ...(groupsOf.get(v.channelId) || []).map(g => h('span', { class: 'cal-tag' }, PG.iconEl(g, 14), g.name)))));
        }))) : null);
  };
  const start = async () => {
    box.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'row busy-row' }, ui.spin, status), ui.bar));
    ui.setBusy(true); ui.progress(T('Preparando…'));
    try { await loadCalendarData(ui.progress); ui.setBusy(false); draw(); }
    catch (e) { ui.setBusy(false); status.className = 'msg err'; status.textContent = e.message; }
  };
  if (calData && Date.now() - calData.t < 15 * 60 * 1000) draw(); else start();
}

// Aviso: desde el gestor YouTube suele rechazar las consultas de Descubrir
function discoverNotice() {
  const extra = h('span', {});
  try {
    chrome.tabs.query({ url: 'https://www.youtube.com/*' }).then(t => {
      extra.textContent = t.length ? T(' Ahora mismo tienes YouTube abierto, así que el gestor lo usará para hacer las consultas: debería funcionar.') : T(' Ahora mismo no tienes YouTube abierto en ninguna pestaña.');
    }).catch(() => {});
  } catch {}
  return h('div', { class: 'card notice' },
    h('span', { class: 'notice-ico' }, '⚠️'),
    h('div', {},
      h('p', { style: 'margin:0 0 6px' }, h('b', {}, T('Desde el gestor, Descubrir puede no mostrar resultados. ')),
        T('YouTube suele rechazar estas consultas cuando no salen de su propia web (verás «YouTube respondió 403»). Para que funcione siempre, úsalo desde YouTube: sección YTBox de la barra lateral → Descubrir.'), extra),
      h('button', { class: 'primary', style: 'margin-top:8px', onclick: () => window.open('https://www.youtube.com/#ytbox-descubrir', '_blank') }, T('✦ Abrir Descubrir en YouTube'))));
}

// ---------- Descubrir ----------
function renderDiscover(main) {
  const cfg = Object.assign({}, YTBoxDiscover.DEFAULTS, state.settings.discover || {});
  const groupsSel = new Set(cfg.groups.filter(id => state.groups.some(g => g.id === id)));
  const chansSel = new Set(cfg.channels.filter(k => state.channels[k]));
  const saveCfg = () => { state.settings.discover = { groups: [...groupsSel], channels: [...chansSel] }; persist(['settings']); };
  const count = h('span', { class: 'muted' });
  const updateCount = () => {
    const n = YTBoxTV.selectedChannels({ groups: [...groupsSel], channels: [...chansSel] }, state).length;
    count.textContent = n ? TN(n, '{0} canal seleccionado', '{0} canales seleccionados') + (n > 12 ? T(' · se mirarán 12 al azar cada vez') : '') : T('Ningún canal seleccionado');
  };
  const gchips = h('div', { class: 'tv-chips' });
  const drawGroups = () => {
    const allOn = state.groups.length > 0 && state.groups.every(g => groupsSel.has(g.id));
    gchips.replaceChildren(
      ...(state.groups.length > 1 ? [h('button', { class: 'tv-chip chip-all', title: allOn ? T('Quitar todos los grupos') : T('Elegir todos los grupos'),
        onclick: () => { if (allOn) groupsSel.clear(); else state.groups.forEach(g => groupsSel.add(g.id)); drawGroups(); updateCount(); saveCfg(); } },
        PG.svgEl('check', 16, 'currentColor'), allOn ? T('Desmarcar todos') : T('Marcar todos'))] : []),
      ...state.groups.map(g => h('button', { class: 'tv-chip' + (groupsSel.has(g.id) ? ' on' : ''), 'aria-pressed': groupsSel.has(g.id) ? 'true' : 'false',
        onclick: () => { groupsSel.has(g.id) ? groupsSel.delete(g.id) : groupsSel.add(g.id); drawGroups(); updateCount(); saveCfg(); } }, PG.iconEl(g, 20), g.name)));
  };
  drawGroups();
  const q = h('input', { type: 'search', placeholder: T('Buscar canal…'), style: 'width:100%;max-width:420px' });
  const clist = h('div', { class: 'tv-clist' });
  const allCh = Object.values(state.channels).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  const sel = selectedChips(chansSel, () => { drawCh(); updateCount(); saveCfg(); });
  const drawCh = () => {
    sel.draw();
    const t = q.value.toLowerCase();
    clist.replaceChildren(...allCh.filter(c => !t || c.name.toLowerCase().includes(t) || (c.handle || '').includes(t)).slice(0, 400).map(c => {
      const cb = h('input', { type: 'checkbox' }); cb.checked = chansSel.has(c.key);
      cb.onchange = () => { cb.checked ? chansSel.add(c.key) : chansSel.delete(c.key); updateCount(); saveCfg(); sel.draw(); };
      return h('label', { class: 'tv-ch' }, cb, avatarEl(c), h('span', {}, c.name));
    }));
  };
  q.oninput = drawCh; drawCh();
  const details = h('details', { class: 'tv-details' }, h('summary', {}, T('Elegir canales sueltos ({0})', allCh.length)), q, clist);
  if (chansSel.size) details.open = true;

  const status = h('div', { class: 'msg', role: 'status' });
  const results = h('div', { class: 'disc-results' });
  const go = h('button', { class: 'primary tv-go' }, T('✦ Descubrir'));
  const cardFor = f => {
    const url = 'https://www.youtube.com/' + (f.handle || 'channel/' + f.id);
    const card = h('div', { class: 'disc-card' });
    const add = h('select', { class: 'tv-select disc-add', title: T('Añadir este canal a uno de tus grupos') },
      h('option', { value: '' }, T('+ Añadir a grupo…')), ...state.groups.map(g => h('option', { value: g.id }, g.name)));
    add.onchange = async () => {
      const g = state.groups.find(x => x.id === add.value); if (!g) return;
      const key = f.handle || f.id;
      if (!state.channels[key]) state.channels[key] = { key, id: f.id, handle: f.handle || null, name: f.name || key, avatar: f.avatar || '' };
      if (!g.channels.includes(key)) g.channels.push(key);
      await persist(['groups', 'channels']); renderSide();
      card.classList.add('added');
      add.replaceWith(h('span', { class: 'disc-ok' }, T('✓ Añadido a «{0}»', g.name)));
    };
    const nope = h('button', { class: 'secondary disc-nope', title: T('No volver a sugerirlo') }, T('No me interesa'));
    nope.onclick = async () => {
      const ig = state.settings.discoverIgnored || (state.settings.discoverIgnored = []);
      if (!ig.includes(f.id)) ig.push(f.id);
      await persist(['settings']); card.remove();
    };
    card.append(
      h('a', { class: 'disc-who', href: url, target: '_blank', rel: 'noopener', title: T('Abrir el canal en YouTube') },
        f.avatar ? h('img', { src: f.avatar, referrerpolicy: 'no-referrer' }) : h('span', { class: 'ph' }),
        h('span', {}, h('b', {}, f.name || f.handle || f.id), h('small', {}, f.handle || ''))),
      h('div', { class: 'muted disc-why' }, T('Parecido a {0}', f.sourceNames.slice(0, 3).join(', ') + (f.sourceNames.length > 3 ? T(' y {0} más', f.sourceNames.length - 3) : '')) + TN(f.hits, ' · sale {0} vez en sus relacionados', ' · sale {0} veces en sus relacionados')),
      h('ul', { class: 'disc-vids' }, ...f.videos.slice(0, 2).map(v => h('li', {}, h('a', { href: 'https://www.youtube.com/watch?v=' + v.vid, target: '_blank', rel: 'noopener' }, v.title)))),
      h('div', { class: 'row disc-btns' }, add, nope));
    return card;
  };
  go.onclick = async () => {
    saveCfg();
    status.className = 'msg'; results.replaceChildren(); ui.setBusy(true); ui.progress(T('Preparando…'));
    try {
      const r = await YTBoxDiscover.run({ groups: [...groupsSel], channels: [...chansSel] }, state, ui.progress);
      status.textContent = r.list.length ? T('✔ {0} canales sugeridos a partir de {1} de tus canales. Vuelve a pulsar para otra tanda.', r.list.length, r.scanned) : T('No he encontrado canales nuevos esta vez. Prueba con otros canales o vuelve a intentarlo.');
      results.append(...r.list.map(cardFor));
    } catch (e) { status.className = 'msg err'; status.textContent = e.message; }
    finally { ui.setBusy(false); }
  };
  const ui = busyUI(go, status, T('✦ Descubrir'), T('Buscando…'));

  main.append(
    h('h1', { class: 'mode-title' }, modeIcon('brujula'), T('Descubrir')),
    h('p', { class: 'muted', style: 'max-width:760px;margin:-12px 0 20px' }, T('Elige tus canales y te sugiero canales parecidos que aún no tienes en YTBox: los que más aparecen en los vídeos relacionados de los tuyos.')),
    discoverNotice(),
    h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, T('¿A partir de qué canales?')),
      state.groups.length ? gchips : h('p', {}, T('Aún no tienes grupos.')), sel.box, details, h('div', { style: 'margin-top:14px' }, count)),
    h('div', { class: 'card tv-actions' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('div', { class: 'row busy-row' }, ui.spin, status), go), ui.bar, results));
  updateCount();
}

// ---------- Modo TV ----------
const fmtClock = s => { s = Math.round(s); const m = Math.floor(s / 60), x = s % 60; return `${m}:${String(x).padStart(2, '0')}`; };
function renderTV(main) {
  const cfg = Object.assign({}, YTBoxTV.DEFAULTS, state.settings.tv || {});
  const groupsSel = new Set(cfg.groups.filter(id => state.groups.some(g => g.id === id)));
  const chansSel = new Set(cfg.channels.filter(k => state.channels[k]));
  const current = () => ({ groups: [...groupsSel], channels: [...chansSel], onlyUnwatched: onlyNew.checked, maxAge: ageSel.value, amount: Number(amount.value) || 0, unit: unit.value, style, clip: Number(clipSel.value) || 60, maxLen: Number(lenSel.value) || 0 });
  // Cómo: vídeos completos o picoteo
  let style = cfg.style === 'picoteo' ? 'picoteo' : 'full';
  const clipSel = h('select', { class: 'tv-select' }, ...YTBoxTV.CLIPS.map(([v, t]) => h('option', { value: String(v) }, T(t))));
  clipSel.value = String(cfg.clip || 60); if (!clipSel.value) clipSel.value = '60';
  const styleBox = h('div', { class: 'tv-chips' });
  const clipRow = h('div', { class: 'row', style: 'margin-top:16px' }, h('span', {}, T('Trozo de cada vídeo:')), clipSel);
  const styleHelp = h('p', { class: 'muted', style: 'margin:14px 0 0' });
  const drawStyle = () => {
    styleBox.replaceChildren(...[['full', T('📺 Vídeos completos')], ['picoteo', T('🍿 Picoteo')]].map(([v, t]) =>
      h('button', { class: 'tv-chip' + (style === v ? ' on' : ''), onclick: () => { style = v; drawStyle(); saveCfg(); } }, t)));
    clipRow.style.display = style === 'picoteo' ? '' : 'none';
    styleHelp.textContent = style === 'picoteo'
      ? T('Solo se reproduce el trozo más visto de cada vídeo (según la curva de «lo más visto» de YouTube) y salta solo al siguiente. Ideal para ponerte al día rápido.')
      : T('Se reproduce cada vídeo entero.');
  };
  clipSel.onchange = () => saveCfg();
  let saveT;
  const saveCfg = () => { clearTimeout(saveT); saveT = setTimeout(() => { state.settings.tv = current(); persist(['settings']); }, 300); };

  const count = h('span', { class: 'muted' });
  const updateCount = () => {
    const n = YTBoxTV.selectedChannels({ groups: [...groupsSel], channels: [...chansSel] }, state).length;
    count.textContent = n ? TN(n, '{0} canal seleccionado', '{0} canales seleccionados') : T('Ningún canal seleccionado');
  };
  // Grupos
  const gchips = h('div', { class: 'tv-chips' });
  const drawGroups = () => {
    const allOn = state.groups.length > 0 && state.groups.every(g => groupsSel.has(g.id));
    gchips.replaceChildren(
      ...(state.groups.length > 1 ? [h('button', { class: 'tv-chip chip-all', title: allOn ? T('Quitar todos los grupos') : T('Elegir todos los grupos'),
        onclick: () => { if (allOn) groupsSel.clear(); else state.groups.forEach(g => groupsSel.add(g.id)); drawGroups(); updateCount(); saveCfg(); } },
        PG.svgEl('check', 16, 'currentColor'), allOn ? T('Desmarcar todos') : T('Marcar todos'))] : []),
      ...state.groups.map(g => h('button', { class: 'tv-chip' + (groupsSel.has(g.id) ? ' on' : ''), 'aria-pressed': groupsSel.has(g.id) ? 'true' : 'false',
        onclick: () => { groupsSel.has(g.id) ? groupsSel.delete(g.id) : groupsSel.add(g.id); drawGroups(); updateCount(); saveCfg(); } }, PG.iconEl(g, 20), g.name)));
  };
  drawGroups();
  // Canales sueltos
  const q = h('input', { type: 'search', placeholder: T('Buscar canal…'), style: 'width:100%;max-width:420px' });
  const clist = h('div', { class: 'tv-clist' });
  const allCh = Object.values(state.channels).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  const sel = selectedChips(chansSel, () => { drawCh(); updateCount(); saveCfg(); });
  const drawCh = () => {
    sel.draw();
    const t = q.value.toLowerCase();
    clist.replaceChildren(...allCh.filter(c => !t || c.name.toLowerCase().includes(t) || (c.handle || '').includes(t)).slice(0, 400).map(c => {
      const cb = h('input', { type: 'checkbox' }); cb.checked = chansSel.has(c.key);
      cb.onchange = () => { cb.checked ? chansSel.add(c.key) : chansSel.delete(c.key); updateCount(); saveCfg(); sel.draw(); };
      return h('label', { class: 'tv-ch' }, cb, avatarEl(c), h('span', {}, c.name));
    }));
  };
  q.oninput = drawCh; drawCh();
  const details = h('details', { class: 'tv-details' }, h('summary', {}, T('Añadir canales sueltos ({0})', allCh.length)), q, clist);
  if (chansSel.size) details.open = true;
  // Qué vídeos
  const onlyNew = h('input', { type: 'checkbox' }); onlyNew.checked = !!cfg.onlyUnwatched; onlyNew.onchange = saveCfg;
  const ageSel = h('select', { class: 'tv-select' }, ...[['all', T('Cualquier fecha')], ['day', T('Último día')], ['3days', T('Últimos 3 días')], ['week', T('Última semana')], ['month', T('Último mes')]].map(([v, t]) => h('option', { value: v }, t)));
  ageSel.value = cfg.maxAge; ageSel.onchange = saveCfg;
  const lenSel = h('select', { class: 'tv-select' }, ...YTBoxTV.MAXLENS.map(([v, t]) => h('option', { value: String(v) }, T(t))));
  lenSel.value = String(cfg.maxLen || 0); if (!lenSel.value) lenSel.value = '0'; lenSel.onchange = saveCfg;
  // Duración
  const amount = h('input', { type: 'number', min: '1', step: '1', value: String(cfg.amount), class: 'tv-num' }); amount.oninput = saveCfg;
  const unit = h('select', { class: 'tv-select' }, h('option', { value: 'min' }, T('minutos')), h('option', { value: 'h' }, T('horas')));
  unit.value = cfg.unit; unit.onchange = saveCfg;
  const quick = h('div', { class: 'tv-chips' }, ...[[30, 'min', '30 min'], [1, 'h', '1 h'], [2, 'h', '2 h'], [4, 'h', '4 h']].map(([n, u, t]) =>
    h('button', { class: 'tv-chip', onclick: () => { amount.value = n; unit.value = u; saveCfg(); } }, t)));
  // Ver
  const status = h('div', { class: 'msg', role: 'status' });
  const result = h('div', { class: 'tv-result' });
  const go = h('button', { class: 'primary tv-go' }, T('▶ VER'));
  const applyCfg = c => {
    c = Object.assign({}, YTBoxTV.DEFAULTS, c);
    groupsSel.clear(); c.groups.forEach(id => state.groups.some(g => g.id === id) && groupsSel.add(id));
    chansSel.clear(); c.channels.forEach(k => state.channels[k] && chansSel.add(k));
    onlyNew.checked = !!c.onlyUnwatched; ageSel.value = c.maxAge; amount.value = String(c.amount); unit.value = c.unit;
    lenSel.value = String(c.maxLen || 0); if (!lenSel.value) lenSel.value = '0';
    style = c.style === 'picoteo' ? 'picoteo' : 'full'; clipSel.value = String(c.clip || 60); if (!clipSel.value) clipSel.value = '60'; drawStyle();
    drawGroups(); drawCh(); if (chansSel.size) details.open = true; updateCount(); saveCfg();
  };
  // Preconfiguraciones guardadas
  let activeId = null;
  const nameIn = h('input', { type: 'text', placeholder: T('Nombre, p. ej. Dormir'), maxlength: '40', class: 'tv-name' });
  const presetBox = h('div', { class: 'tv-presets' });
  const loadPreset = p => { activeId = p.id; applyCfg(p.cfg); nameIn.value = p.name; status.className = 'msg'; status.textContent = ''; drawPresets(); };
  const drawPresets = () => {
    const list = YTBoxTV.presets(state);
    presetBox.replaceChildren(...(list.length ? list.map(p => {
      const del = h('button', { class: 'tv-preset-x', title: T('Borrar'), 'aria-label': T('Borrar ') + p.name }, '✕');
      del.onclick = () => {
        if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = T('¿Borrar?'); setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = '✕'; } }, 3000); return; }
        YTBoxTV.deletePreset(state, p.id); if (activeId === p.id) activeId = null;
        persist(['settings']); drawPresets();
      };
      return h('div', { class: 'tv-preset' + (p.id === activeId ? ' on' : '') },
        h('button', { class: 'tv-preset-load', title: T('Cargar «{0}»\n{1}', p.name, YTBoxTV.summary(p.cfg, state)), onclick: () => loadPreset(p) }, p.name),
        h('button', { class: 'tv-preset-play', title: T('Ver ya'), 'aria-label': T('Ver ') + p.name, onclick: () => { loadPreset(p); go.click(); } }, '▶'), del);
    }) : [h('span', { class: 'muted' }, T('Aún no tienes ninguna. Configura abajo y guárdala con un nombre (p. ej. «Dormir» o «Comer»).'))]));
  };
  const saveBtn = h('button', { class: 'secondary' }, T('💾 Guardar'));
  saveBtn.onclick = async () => {
    const name = nameIn.value.trim();
    if (!name) { status.className = 'msg err'; status.textContent = T('Ponle un nombre a la preconfiguración.'); nameIn.focus(); return; }
    const exists = YTBoxTV.presets(state).some(x => x.name.toLowerCase() === name.toLowerCase());
    const p = YTBoxTV.savePreset(state, name, current()); activeId = p.id;
    state.settings.tv = current(); await persist(['settings']); drawPresets();
    status.className = 'msg'; status.textContent = exists ? T('«{0}» actualizada.', p.name) : T('«{0}» guardada.', p.name);
  };
  nameIn.onkeydown = e => { if (e.key === 'Enter') saveBtn.click(); };
  drawPresets();
  drawStyle();
  go.onclick = async () => {
    const c = current();
    state.settings.tv = c; await persist(['settings']);
    status.className = 'msg'; result.replaceChildren(); ui.setBusy(true); ui.progress(T('Preparando…'));
    try {
      const r = await YTBoxTV.run(c, state, ui.progress);
      const url = await YTBoxTV.start(r.picked, c, state, ui.progress);
      await chrome.tabs.create({ url });
      status.textContent = '✔ ' + T(r.picoteo ? '{0} trozos · {1}' : '{0} vídeos · {1}', r.picked.length, YTBoxTV.fmtDur(r.total)) + (r.total < r.target * 0.9 ? T(' (no hay más vídeos que cumplan las condiciones)') : '') + T('. Se está reproduciendo en una pestaña nueva.');
      const chName = id => (Object.values(state.channels).find(x => x.id === id) || {}).name || '';
      result.append(
        h('div', { class: 'row', style: 'margin-bottom:12px' }, h('button', { class: 'secondary', onclick: () => chrome.tabs.create({ url }) }, T('Abrir otra vez')), h('button', { class: 'secondary', onclick: () => go.click() }, T('🔀 Otra lista distinta'))),
        h('ol', { class: 'tv-list' }, r.picked.map(v => h('li', {},
          h('a', { href: 'https://www.youtube.com/watch?v=' + v.vid + (r.picoteo ? '&t=' + Math.round(v.start) + 's' : ''), target: '_blank', rel: 'noopener' }, v.title || v.vid),
          h('span', { class: 'muted' }, ` · ${chName(v.channelId)} · ` + (r.picoteo ? `${fmtClock(v.start)}–${fmtClock(v.end)}${v.hot ? ' 🔥' : ''}` : YTBoxTV.fmtDur(v.seconds)))))));
    } catch (e) { status.className = 'msg err'; status.textContent = e.message; }
    finally { ui.setBusy(false); }
  };
  const ui = busyUI(go, status, T('▶ VER'), T('Cargando…'));

  main.append(
    h('h1', { class: 'mode-title' }, modeIcon('tv'), T('Modo TV')),
    h('p', { class: 'muted', style: 'max-width:760px;margin:-12px 0 28px' }, T('Crea una lista con vídeos al azar de los canales que elijas y la reproduce en YouTube, con la duración total que indiques. También puedes abrirlo desde YouTube, en el lateral de YTBox.')),
    h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, T('Mis preconfiguraciones')), presetBox),
    h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, T('¿De qué canales?')),
      state.groups.length ? gchips : h('p', {}, T('Aún no tienes grupos.')), sel.box, details, h('div', { style: 'margin-top:14px' }, count)),
    h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, T('¿Qué vídeos?')),
      h('label', { class: 'row', style: 'gap:8px;margin-bottom:16px' }, onlyNew, T('Solo vídeos que no he visto')),
      h('div', { class: 'row' }, h('span', {}, T('Subidos en')), ageSel),
      h('div', { class: 'row', style: 'margin-top:14px' }, h('span', {}, T('Duración máxima de cada vídeo')), lenSel)),
    h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, T('¿Cuánto tiempo?')),
      h('div', { class: 'row', style: 'margin-bottom:16px' }, amount, unit), quick),
    h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, T('¿Cómo lo ves?')), styleBox, clipRow, styleHelp),
    h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, T('Guardar como preconfiguración')), h('div', { class: 'row' }, nameIn, saveBtn)),
    h('div', { class: 'card tv-actions' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('div', { class: 'row busy-row' }, ui.spin, status), go), ui.bar, result));
  updateCount();
}

// ---------- Importar desde PocketTube ----------
// Formato: { "<grupo>": ["UC…", "https://www.youtube.com/c/…"], …, ysc_collection, ysc_meta: { "<grupo>": { img, position } }, ysc_settings }
function isPocketTube(d) {
  return d && typeof d === 'object' && !Array.isArray(d) && (d.ysc_collection || d.ysc_meta || d.ysc_settings) && !Array.isArray(d.groups);
}

const PT_ICONS = [
  [/serie|anime|manga/i, '📺'], [/\bdb\b|dragon/i, '🐉'], [/cocin|recet|food|comida|chef/i, '🍳'], [/m[uú]sic|music|canci|hh|hip ?hop|rap|trap/i, '🎵'], [/cine|pel[ií]cul|film|movie/i, '🎬'],
  [/f[uú]tbol|futbol|soccer|deporte|sport/i, '⚽'], [/nintendo|switch|mario|zelda|pok[eé]mon/i, '🍄'], [/juego|game|gaming|videojuego|developer/i, '🎮'],
  [/program|c[oó]digo|code|dev|javascript|python/i, '💻'], [/blender|3d|modelado/i, '🧊'], [/ajedrez|chess/i, '♟️'], [/anim|v[ií]deo|edici/i, '🎞️'],
 [/fav/i, '⭐'], [/interesant|ciencia|science|curios|divulg/i, '💡'], [/entreten|humor|risa|comedia/i, '😂'],
  [/meh|otros|varios|misc/i, '🤷'], [/noticia|news|pol[ií]tica/i, '📰'], [/viaje|travel/i, '✈️'], [/arte|art|dibujo|pint/i, '🎨'], [/tech|tecnolog/i, '📱'],
  [/libro|book|lectura/i, '📚'], [/coche|motor|car/i, '🚗'], [/fitness|gym|salud/i, '💪'], [/podcast|charla/i, '🎙️'], [/kid|niñ|infantil/i, '🧸'],
];
const PT_COLORS = ['#ff6347', '#9c5dc3', '#3ea6ff', '#2ecc71', '#ff8a00', '#ff4fa3', '#00b8d9', '#5b6cff', '#ffcc00', '#00bfa5', '#a1887f', '#e74c3c'];

function ptIcon(name, i) {
  const hit = PT_ICONS.find(([re]) => re.test(name));
  const color = PT_COLORS[i % PT_COLORS.length];
  if (hit) return { icon: { type: 'emoji', value: hit[1] }, color };
  const initials = name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || name.slice(0, 2).toUpperCase();
  return { icon: { type: 'text', value: initials, bg: true }, color };
}

function statusBanner() {
  let b = document.getElementById('importStatus');
  if (!b) { b = h('div', { id: 'importStatus', class: 'banner' }); document.body.append(b); }
  return b;
}

async function importPocketTube(data) {
  const meta = data.ysc_meta || {};
  const names = Object.keys(data).filter(k => !k.startsWith('ysc_') && Array.isArray(data[k]))
    .sort((a, b) => ((meta[a] || {}).position ?? 999) - ((meta[b] || {}).position ?? 999));
  if (!names.length) throw new Error(T('No hay grupos en el archivo'));
  const total = new Set(names.flatMap(n => data[n])).size;
  if (!confirm(T('Se van a importar {0} grupos con {1} canales de PocketTube.\nLos grupos con el mismo nombre se combinarán con los que ya tienes. ¿Continuar?', names.length, total))) return;

  const msg = statusBanner();
  msg.className = 'banner'; msg.textContent = T('Importando desde PocketTube…');
  const byId = id => Object.values(state.channels).find(c => c.id === id);
  const pendingUrls = [];
  names.forEach((name, i) => {
    let g = state.groups.find(x => x.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (!g) { g = Object.assign({ id: PG.uid(), name, channels: [] }, ptIcon(name, i)); state.groups.push(g); }
    for (const raw of data[name]) {
      const v = String(raw).trim();
      if (/^UC[\w-]{22}$/.test(v)) {
        let c = byId(v);
        if (!c) { c = { key: v, id: v, handle: null, name: v, avatar: '' }; state.channels[v] = c; }
        if (!g.channels.includes(c.key)) g.channels.push(c.key);
      } else if (v) pendingUrls.push({ g, v });
    }
  });
  // Preferencias equivalentes
  const pts = data.ysc_settings || {};
  if (pts.sort_type === 'new' || pts.sort_type === 'old') state.settings.sortBy = pts.sort_type;
  if (pts.video_view_type === 'list') state.settings.viewMode = 'list';
  else if (pts.video_view_type === 'scale_grid' || pts.video_view_type === 'grid') state.settings.viewMode = 'grid';
  await persist(['groups', 'channels', 'settings']);
  render();

  // Canales que venían como enlace (/c/…, /user/…, /@…): hay que averiguar su id
  let failed = 0;
  for (const { g, v } of pendingUrls) {
    try {
      const r = await PG.resolveChannel(v);
      let c = byId(r.id);
      if (!c) { c = { key: r.key, id: r.id, handle: r.handle, name: r.name, avatar: r.avatar }; state.channels[c.key] = c; }
      if (!g.channels.includes(c.key)) g.channels.push(c.key);
    } catch { failed++; }
  }
  if (pendingUrls.length) { await persist(['groups', 'channels']); render(); }

  // Nombres de los canales (PocketTube solo guarda el id): se leen del RSS de cada canal, que es ligero
  const unnamed = Object.values(state.channels).filter(c => c.id && c.name === c.id);
  let done = 0;
  const tick = () => { msg.className = 'banner'; msg.textContent = T('✔ {0} grupos importados. Cargando nombres de canales… {1}/{2}', names.length, done, unnamed.length); };
  tick();
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < unnamed.length) {
      const c = unnamed[i++];
      try {
        const res = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + c.id, { credentials: 'include' });
        if (res.ok) {
          const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
          const t = xml.querySelector('feed > title')?.textContent || xml.getElementsByTagName('title')[0]?.textContent;
          const author = xml.querySelector('feed > author > uri')?.textContent || '';
          if (t) c.name = t;
          const hm = author.match(/\/(@[^/?#]+)/); if (hm) c.handle = decodeURIComponent(hm[1]).toLowerCase();
        }
      } catch {}
      done++; if (done % 10 === 0) { tick(); await persist(['channels']); }
    }
  }));
  await persist(['channels']); render();
  const noName = Object.values(state.channels).filter(c => c.name === c.id).length;
  msg.className = 'banner done';
  msg.onclick = () => msg.remove();
  msg.title = T('Pulsa para cerrar');
  msg.textContent = T('✔ Importados {0} grupos y {1} canales de PocketTube.', names.length, total) + (failed ? ` ${failed} enlaces no se pudieron resolver.` : '') + (noName ? T(' {0} canales sin nombre (puede que ya no existan).', noName) : '') + T(' Los avatares se cargan al abrir cada grupo en YouTube. Revisa los iconos en cada grupo.');
}

// ---------- Selector de iconos ----------
const picker = { group: null, draft: null, color: null, tab: 'emoji', cat: 'all', q: '' };

function openPicker(g) {
  picker.group = g;
  picker.draft = Object.assign({ type: 'emoji', value: '📁' }, JSON.parse(JSON.stringify(g.icon || {})));
  picker.color = g.color || '#ff6347';
  picker.tab = picker.draft.type === 'avatar' ? 'avatar' : (['emoji', 'svg', 'text', 'image'].includes(picker.draft.type) ? picker.draft.type : 'emoji');
  if (picker.draft.type === 'image' && picker.draft.fromChannel) picker.tab = 'avatar';
  $('#picker').classList.remove('hidden');
  $('#pickColor').value = picker.color;
  $('#pickBg').checked = !!picker.draft.bg;
  $('#pickRound').checked = !!picker.draft.round;
  renderSwatches(); renderRecent(); renderPickerTab(); updatePreview();
}
function closePicker() { $('#picker').classList.add('hidden'); }

function updatePreview() {
  $('#pickPreview').replaceChildren(PG.iconEl({ icon: picker.draft, color: picker.color }, 48));
  $$('#pickTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === picker.tab));
}

function setDraft(icon) {
  picker.draft = Object.assign({}, icon, { bg: $('#pickBg').checked, round: $('#pickRound').checked });
  updatePreview();
  $$('#pickBody .igrid button').forEach(b => b.classList.toggle('on', b.dataset.v === icon.value && b.dataset.t === icon.type));
}

function renderSwatches() {
  $('#swatches').replaceChildren(...PALETTE.map(c => {
    const b = h('button', { style: 'background:' + c, class: c === picker.color ? 'on' : '' });
    b.onclick = () => { picker.color = c; $('#pickColor').value = c; renderSwatches(); updatePreview(); if (picker.tab === 'svg') renderPickerTab(); };
    return b;
  }));
}

function renderRecent() {
  const rec = state.settings.recentIcons || [];
  const box = $('#recent');
  box.replaceChildren();
  if (!rec.length) return;
  box.append(h('span', { class: 'l' }, T('Recientes')));
  rec.forEach(r => {
    const b = h('button', { class: 'icon-btn', style: 'width:38px;height:38px;display:flex;align-items:center;justify-content:center' }, PG.iconEl({ icon: r.icon, color: r.color }, 26));
    b.onclick = () => { picker.color = r.color; $('#pickColor').value = r.color; $('#pickBg').checked = !!r.icon.bg; $('#pickRound').checked = !!r.icon.round; renderSwatches(); setDraft(r.icon); };
    box.append(b);
  });
}

function renderPickerTab() {
  const body = $('#pickBody');
  body.replaceChildren();
  const count = $('#pickCount');
  count.textContent = '';
  if (picker.tab === 'emoji') {
    const total = EMOJI_DATA.reduce((n, c) => n + c.items.length, 0);
    count.textContent = T('{0} emojis disponibles', total);
    const q = h('input', { type: 'search', placeholder: T('Buscar emoji en inglés (cat, music, car, fire…)'), style: 'width:100%', value: picker.q });
    const cats = h('div', { class: 'cat-tabs' },
      h('button', { class: picker.cat === 'all' ? 'on' : '', onclick: () => { picker.cat = 'all'; renderPickerTab(); } }, T('Todos')),
      ...EMOJI_DATA.map(c => h('button', { class: picker.cat === c.key ? 'on' : '', onclick: () => { picker.cat = c.key; renderPickerTab(); } }, c.items[0][0] + ' ' + T(c.label))));
    const area = h('div');
    const fill = () => {
      const s = picker.q.toLowerCase().trim();
      area.replaceChildren();
      for (const c of EMOJI_DATA) {
        if (picker.cat !== 'all' && c.key !== picker.cat && !s) continue;
        const items = s ? c.items.filter(i => i[1].includes(s) || i[0] === s) : c.items;
        if (!items.length) continue;
        area.append(h('div', { class: 'cat-title' }, `${T(c.label)} (${items.length})`));
        const grid = h('div', { class: 'igrid' });
        for (const [e, n] of items) {
          const b = h('button', { title: n, 'data-v': e, 'data-t': 'emoji', class: picker.draft.type === 'emoji' && picker.draft.value === e ? 'on' : '' }, e);
          b.onclick = () => setDraft({ type: 'emoji', value: e });
          b.ondblclick = applyPicker;
          grid.append(b);
        }
        area.append(grid);
      }
      if (!area.children.length) area.append(h('div', { class: 'empty' }, T('Sin resultados. Prueba con otra palabra en inglés.')));
    };
    q.oninput = () => { picker.q = q.value; fill(); };
    body.append(q, cats, area); fill();
    setTimeout(() => q.focus(), 0);
  } else if (picker.tab === 'svg') {
    const names = Object.keys(SVG_ICONS);
    count.textContent = T('{0} iconos de línea (se pintan con el color elegido)', names.length);
    const q = h('input', { type: 'search', placeholder: T('Buscar icono (casa, musica, mando…)'), style: 'width:100%;margin-bottom:12px' });
    const grid = h('div', { class: 'igrid svg' });
    const fill = () => {
      const s = q.value.toLowerCase();
      grid.replaceChildren(...names.filter(n => n.includes(s)).map(n => {
        const b = h('button', { title: n, 'data-v': n, 'data-t': 'svg', class: picker.draft.type === 'svg' && picker.draft.value === n ? 'on' : '' },
          PG.iconEl({ icon: { type: 'svg', value: n }, color: picker.color }, 30), n);
        b.onclick = () => setDraft({ type: 'svg', value: n });
        b.ondblclick = applyPicker;
        return b;
      }));
    };
    q.oninput = fill; body.append(q, grid); fill();
  } else if (picker.tab === 'text') {
    const t = h('input', { type: 'text', maxlength: '3', placeholder: 'AB', value: picker.draft.type === 'text' ? picker.draft.value : picker.group.name.slice(0, 2).toUpperCase(), style: 'font-size:28px;width:140px;text-align:center' });
    t.oninput = () => setDraft({ type: 'text', value: t.value });
    body.append(h('p', { class: 'muted' }, T('Escribe hasta 3 letras, números o símbolos. Activa «Fondo de color» para que parezca una insignia.')), t);
    setDraft({ type: 'text', value: t.value });
    setTimeout(() => t.focus(), 0);
  } else if (picker.tab === 'image') {
    const file = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
    const drop = h('div', { class: 'drop' }, T('Arrastra aquí una imagen (PNG, JPG, GIF, SVG, WebP)'), h('br'), h('br'), h('button', { class: 'secondary', onclick: () => file.click() }, T('Elegir archivo…')));
    const handle = async f => { if (f && f.type.startsWith('image/')) setDraft({ type: 'image', value: await shrinkImage(f) }); };
    file.onchange = () => handle(file.files[0]);
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); handle(e.dataTransfer.files[0]); };
    const url = h('input', { type: 'url', placeholder: T('https://… o pega una imagen con Ctrl+V'), style: 'flex:1' });
    url.onchange = () => url.value && setDraft({ type: 'image', value: url.value });
    url.onpaste = async e => { const it = [...e.clipboardData.items].find(i => i.type.startsWith('image/')); if (it) { e.preventDefault(); handle(it.getAsFile()); } };
    body.append(drop, file, h('div', { class: 'row' }, h('span', {}, T('O desde una URL:')), url));
  } else if (picker.tab === 'avatar') {
    const chans = Object.values(state.channels).filter(c => c.avatar);
    const inGroup = chans.filter(c => picker.group.channels.includes(c.key));
    const rest = chans.filter(c => !picker.group.channels.includes(c.key));
    count.textContent = T('{0} avatares de canal', chans.length);
    const mk = list => h('div', { class: 'igrid', style: 'grid-template-columns:repeat(auto-fill,minmax(52px,1fr))' }, list.map(c => {
      const b = h('button', { title: c.name, 'data-v': c.avatar, 'data-t': 'image', style: 'height:52px', class: picker.draft.value === c.avatar ? 'on' : '' },
        h('img', { src: c.avatar, referrerpolicy: 'no-referrer', style: 'width:40px;height:40px;border-radius:50%' }));
      b.onclick = () => { $('#pickRound').checked = true; setDraft({ type: 'image', value: c.avatar, fromChannel: true }); };
      b.ondblclick = applyPicker;
      return b;
    }));
    if (!chans.length) body.append(h('div', { class: 'empty' }, T('Importa canales para usar sus avatares como icono.')));
    if (inGroup.length) body.append(h('div', { class: 'cat-title' }, T('Canales de este grupo')), mk(inGroup));
    if (rest.length) body.append(h('div', { class: 'cat-title' }, T('Otros canales')), mk(rest));
  }
  updatePreview();
}

function shrinkImage(file, size = 96) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const s = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      res(c.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', .9));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

async function applyPicker() {
  const g = picker.group;
  g.icon = Object.assign({}, picker.draft, { bg: $('#pickBg').checked, round: $('#pickRound').checked });
  g.color = picker.color;
  const rec = (state.settings.recentIcons || []).filter(r => JSON.stringify(r.icon) !== JSON.stringify(g.icon) || r.color !== g.color);
  rec.unshift({ icon: g.icon, color: g.color });
  state.settings.recentIcons = rec.slice(0, 18);
  await persist(['groups', 'settings']);
  closePicker(); render();
}

// ---------- Eventos globales ----------
$('#newGroup').onclick = createGroup;
$$('.side-nav button').forEach(b => b.onclick = () => go({ name: b.dataset.view }));
// Iconos de Modo TV y Descubrir: los mismos de YouTube (cuadradito con el degradado de la app)
$$('.side-nav .nav-ico').forEach(s => s.replaceWith(s.dataset.plain ? h('span', { class: 'mode-ico small plain' }, PG.svgEl(s.dataset.ico, 16, 'currentColor')) : modeIcon(s.dataset.ico, 'small')));
$('#pickClose').onclick = closePicker;
$('#picker').onclick = e => { if (e.target.id === 'picker') closePicker(); };
$('#pickOk').onclick = applyPicker;
$('#pickTabs').onclick = e => { const b = e.target.closest('button'); if (b) { picker.tab = b.dataset.tab; renderPickerTab(); } };
$('#pickColor').oninput = e => { picker.color = e.target.value; renderSwatches(); updatePreview(); if (picker.tab === 'svg') renderPickerTab(); };
$('#pickBg').onchange = () => setDraft(picker.draft);
$('#pickRound').onchange = () => setDraft(picker.draft);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePicker(); });

// Textos fijos de manager.html (data-i18n = texto en español; data-i18n-title para el title)
function translateStatic() {
  document.title = T('YTBox — Gestor');
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const txt = [...el.childNodes].reverse().find(n => n.nodeType === 3 && n.textContent.trim());
    const val = T(el.dataset.i18n);
    if (txt) txt.textContent = (txt.textContent.match(/^\s*/)[0]) + val; else el.append(val);
  }
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = T(el.dataset.i18nTitle);
}
PG.load().then(s => { state = s; applyTheme(); translateStatic(); route(); });
