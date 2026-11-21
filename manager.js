// YTBox — gestor de grupos
let state = { groups: [], channels: {}, settings: {} };
let view = { name: 'group', id: null };

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

const PALETTE = ['#3ea6ff', '#ff4e45', '#ff8a00', '#ffcc00', '#2ecc71', '#00bfa5', '#00b8d9', '#5b6cff', '#9b59ff', '#ff4fa3', '#a1887f', '#8d99ae', '#ffffff', '#111111'];

let saving = false;
async function persist(keys = ['groups', 'channels', 'settings']) {
  saving = true;
  const o = {}; keys.forEach(k => o[k] = state[k]);
  await PG.save(o);
  setTimeout(() => saving = false, 50);
}

chrome.storage.onChanged.addListener(async () => { if (saving) return; state = await PG.load(); render(); });

function avatarEl(c, cls = '') {
  return c && c.avatar ? h('img', { src: c.avatar, referrerpolicy: 'no-referrer', class: cls }) : h('span', { class: 'ph ' + cls });
}

// ---------- Rutas ----------
function route() {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash === 'new') { createGroup(); history.replaceState(null, '', '#'); return; }
  if (hash.startsWith('group=')) view = { name: 'group', id: hash.slice(6) };
  else if (hash === 'channels') view = { name: 'channels' };
  else if (hash === 'settings') view = { name: 'settings' };
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
  if (!state.groups.length) list.append(h('div', { class: 'muted', style: 'padding:8px 10px' }, 'Sin grupos todavía'));
  $$('.side-nav button').forEach(b => b.classList.toggle('on', b.dataset.view === view.name));
}

async function createGroup() {
  const icons = ['📁', '🎮', '🎵', '🎬', '📚', '💻', '⚽', '🍳', '😂', '🔬', '✈️', '🎨'];
  const g = { id: PG.uid(), name: 'Nuevo grupo', icon: { type: 'emoji', value: icons[state.groups.length % icons.length] }, color: PALETTE[state.groups.length % 10], channels: [] };
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
  if (view.name === 'channels') return renderChannels(main);
  if (view.name === 'settings') return renderSettings(main);
  let g = state.groups.find(x => x.id === view.id);
  if (!g && state.groups.length) { g = state.groups[0]; view.id = g.id; renderSide(); }
  if (!g) {
    main.append(h('div', { class: 'card' },
      h('h1', {}, '👋 Bienvenido a YTBox'),
      h('p', {}, 'Organiza tus suscripciones de YouTube en grupos con el icono que quieras. Pasos:'),
      h('ol', {},
        h('li', {}, 'Crea un grupo con «+ Nuevo grupo».'),
        h('li', {}, 'Abre youtube.com/feed/channels y pulsa «Importar todas mis suscripciones», o entra en cualquier canal y pulsa «📁 Añadir a grupo».'),
        h('li', {}, 'Tus grupos aparecen en la barra lateral de YouTube; al pulsar uno ves los últimos vídeos de sus canales.')),
      h('button', { class: 'primary', onclick: createGroup }, '+ Crear mi primer grupo')));
    return;
  }
  renderGroup(main, g);
}

function renderGroup(main, g) {
  const name = h('input', { type: 'text', class: 'name-input', value: g.name });
  name.oninput = () => { g.name = name.value; renderSide(); };
  name.onchange = () => persist(['groups']);
  const iconBtn = h('button', { class: 'big-icon', title: 'Cambiar icono' }, PG.iconEl(g, 64));
  iconBtn.onclick = () => openPicker(g);

  main.append(
    h('div', { class: 'editor-top' }, iconBtn, name,
      h('button', { class: 'secondary', onclick: () => window.open('https://www.youtube.com/?pg_group=' + g.id, '_blank') }, '▶ Ver en YouTube'),
      h('button', { class: 'danger', onclick: async () => {
        if (!confirm(`¿Borrar el grupo «${g.name}»? Los canales no se borran.`)) return;
        state.groups = state.groups.filter(x => x.id !== g.id); view.id = null;
        await persist(['groups']); render();
      } }, 'Borrar grupo')));

  // Canales del grupo
  const chans = g.channels.map(k => state.channels[k] || { key: k, name: k });
  main.append(h('h3', {}, `Canales en el grupo (${chans.length})`));
  const list = h('div', { class: 'ch-list' });
  if (!chans.length) list.append(h('div', { class: 'muted' }, 'Ningún canal todavía. Añádelos abajo.'));
  for (const c of chans) {
    list.append(h('div', { class: 'ch' }, avatarEl(c), h('div', { class: 'nm' }, h('div', {}, c.name), h('small', {}, c.handle || c.id || c.key)),
      h('button', { class: 'icon-btn', title: 'Quitar del grupo', onclick: async () => { g.channels = g.channels.filter(k => k !== c.key); await persist(['groups']); render(); } }, '✕')));
  }
  main.append(list);

  // Añadir por URL
  main.append(h('h3', {}, 'Añadir canal por enlace o @handle'));
  const url = h('input', { type: 'text', placeholder: 'https://www.youtube.com/@canal  ·  @canal  ·  UCxxxx…', style: 'flex:1;min-width:300px' });
  const msg = h('div', { class: 'msg' });
  const addBtn = h('button', { class: 'primary' }, 'Añadir');
  const doAdd = async () => {
    const v = url.value.trim(); if (!v) return;
    addBtn.disabled = true; msg.className = 'msg'; msg.textContent = 'Buscando canal…';
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
  main.append(h('h3', {}, `Añadir desde tus canales importados (${others.length})`));
  if (!others.length) { main.append(h('div', { class: 'muted' }, 'Importa tus suscripciones desde youtube.com/feed/channels para elegirlas aquí.')); return; }
  const q = h('input', { type: 'search', placeholder: 'Filtrar canales…', style: 'width:320px;margin-bottom:10px' });
  const onlyFree = h('input', { type: 'checkbox' });
  const pool = h('div', { class: 'ch-list' });
  const fill = () => {
    const s = q.value.toLowerCase();
    pool.replaceChildren(...others
      .filter(c => !s || c.name.toLowerCase().includes(s) || (c.handle || '').includes(s))
      .filter(c => !onlyFree.checked || !state.groups.some(x => x.channels.includes(c.key)))
      .map(c => h('div', { class: 'ch add', title: 'Añadir al grupo', onclick: async () => { g.channels.push(c.key); await persist(['groups']); render(); } },
        avatarEl(c), h('div', { class: 'nm' }, h('div', {}, c.name), h('small', {}, c.handle || c.id)), h('span', { style: 'font-size:20px;color:var(--acc)' }, '+'))));
  };
  q.oninput = fill; onlyFree.onchange = fill;
  main.append(h('div', { class: 'row' }, q, h('label', { class: 'row', style: 'gap:6px;margin-bottom:10px' }, onlyFree, 'Solo canales sin grupo')), pool);
  fill();
}

function renderChannels(main) {
  const all = Object.values(state.channels).sort((a, b) => a.name.localeCompare(b.name));
  main.append(h('h1', {}, `Todos los canales (${all.length})`));
  main.append(h('p', { class: 'muted' }, 'Pulsa los iconos de cada canal para meterlo o sacarlo de cada grupo.'));
  const q = h('input', { type: 'search', placeholder: 'Buscar…', style: 'width:300px' });
  const sel = h('select', { style: 'background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px' },
    h('option', { value: 'all' }, 'Todos'), h('option', { value: 'none' }, 'Sin grupo'), ...state.groups.map(g => h('option', { value: g.id }, g.name)));
  main.append(h('div', { class: 'toolbar' }, q, sel,
    h('button', { class: 'secondary', onclick: () => window.open('https://www.youtube.com/feed/channels', '_blank') }, '📥 Importar desde YouTube')));
  const list = h('div', { class: 'ch-list' });
  main.append(list);
  if (!all.length) { list.append(h('div', { class: 'empty' }, 'No hay canales. Ve a youtube.com/feed/channels y pulsa «Importar todas mis suscripciones».')); return; }
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
      return h('div', { class: 'ch' }, avatarEl(c), h('div', { class: 'nm' }, h('div', {}, c.name), tags),
        h('button', { class: 'icon-btn', title: 'Olvidar canal', onclick: async () => {
          if (!confirm(`¿Olvidar «${c.name}»? Se quitará de todos los grupos.`)) return;
          delete state.channels[c.key]; state.groups.forEach(g => g.channels = g.channels.filter(k => k !== c.key));
          await persist(['groups', 'channels']); render();
        } }, '🗑'));
    }));
  };
  q.oninput = fill; sel.onchange = fill; fill();
}

function renderSettings(main) {
  main.append(h('h1', {}, 'Importar / Exportar'));
  const file = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden' });
  const msg = h('div', { class: 'msg' });
  file.onchange = async () => {
    try {
      const data = JSON.parse(await file.files[0].text());
      if (!Array.isArray(data.groups)) throw new Error('Archivo no válido');
      const merge = confirm('Aceptar = COMBINAR con lo que ya tienes.\nCancelar = REEMPLAZAR todo.');
      if (merge) {
        Object.assign(state.channels, data.channels || {});
        for (const g of data.groups) { const ex = state.groups.find(x => x.id === g.id); if (ex) ex.channels = [...new Set([...ex.channels, ...g.channels])]; else state.groups.push(g); }
      } else { state.groups = data.groups; state.channels = data.channels || {}; }
      await persist(['groups', 'channels']); msg.className = 'msg'; msg.textContent = '✔ Importado'; render();
    } catch (e) { msg.className = 'msg err'; msg.textContent = e.message; }
  };
  main.append(
    h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, 'Copia de seguridad'),
      h('p', {}, 'Guarda tus grupos, iconos y canales en un archivo JSON, o restáuralos en otro navegador.'),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => {
          const blob = new Blob([JSON.stringify({ app: 'YTBox', version: 1, groups: state.groups, channels: state.channels }, null, 2)], { type: 'application/json' });
          const a = h('a', { href: URL.createObjectURL(blob), download: `ytbox-${new Date().toISOString().slice(0, 10)}.json` }); a.click();
        } }, '⬇ Exportar JSON'),
        h('button', { class: 'secondary', onclick: () => file.click() }, '⬆ Importar JSON'), file), msg),
    h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, 'Importar suscripciones de YouTube'),
      h('p', {}, 'Abre la página de tus suscripciones y pulsa el botón azul «Importar todas mis suscripciones» que aparece abajo.'),
      h('button', { class: 'secondary', onclick: () => window.open('https://www.youtube.com/feed/channels', '_blank') }, 'Abrir youtube.com/feed/channels')),
    h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, 'Borrar todo'),
      h('p', {}, 'Elimina todos los grupos y canales guardados.'),
      h('button', { class: 'danger', onclick: async () => {
        if (!confirm('¿Seguro? Se borrarán todos los grupos y canales.')) return;
        state.groups = []; state.channels = {}; await persist(['groups', 'channels']); render();
      } }, 'Borrar todo')));
}

// ---------- Selector de iconos ----------
const picker = { group: null, draft: null, color: null, tab: 'emoji', cat: 'all', q: '' };

function openPicker(g) {
  picker.group = g;
  picker.draft = Object.assign({ type: 'emoji', value: '📁' }, JSON.parse(JSON.stringify(g.icon || {})));
  picker.color = g.color || '#3ea6ff';
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
  box.append(h('span', { class: 'l' }, 'Recientes'));
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
    count.textContent = `${total} emojis disponibles`;
    const q = h('input', { type: 'search', placeholder: 'Buscar emoji en inglés (cat, music, car, fire…)', style: 'width:100%', value: picker.q });
    const cats = h('div', { class: 'cat-tabs' },
      h('button', { class: picker.cat === 'all' ? 'on' : '', onclick: () => { picker.cat = 'all'; renderPickerTab(); } }, 'Todos'),
      ...EMOJI_DATA.map(c => h('button', { class: picker.cat === c.key ? 'on' : '', onclick: () => { picker.cat = c.key; renderPickerTab(); } }, c.items[0][0] + ' ' + c.label)));
    const area = h('div');
    const fill = () => {
      const s = picker.q.toLowerCase().trim();
      area.replaceChildren();
      for (const c of EMOJI_DATA) {
        if (picker.cat !== 'all' && c.key !== picker.cat && !s) continue;
        const items = s ? c.items.filter(i => i[1].includes(s) || i[0] === s) : c.items;
        if (!items.length) continue;
        area.append(h('div', { class: 'cat-title' }, `${c.label} (${items.length})`));
        const grid = h('div', { class: 'igrid' });
        for (const [e, n] of items) {
          const b = h('button', { title: n, 'data-v': e, 'data-t': 'emoji', class: picker.draft.type === 'emoji' && picker.draft.value === e ? 'on' : '' }, e);
          b.onclick = () => setDraft({ type: 'emoji', value: e });
          b.ondblclick = applyPicker;
          grid.append(b);
        }
        area.append(grid);
      }
      if (!area.children.length) area.append(h('div', { class: 'empty' }, 'Sin resultados. Prueba con otra palabra en inglés.'));
    };
    q.oninput = () => { picker.q = q.value; fill(); };
    body.append(q, cats, area); fill();
    setTimeout(() => q.focus(), 0);
  } else if (picker.tab === 'svg') {
    const names = Object.keys(SVG_ICONS);
    count.textContent = `${names.length} iconos de línea (se pintan con el color elegido)`;
    const q = h('input', { type: 'search', placeholder: 'Buscar icono (casa, musica, mando…)', style: 'width:100%;margin-bottom:12px' });
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
    body.append(h('p', { class: 'muted' }, 'Escribe hasta 3 letras, números o símbolos. Activa «Fondo de color» para que parezca una insignia.'), t);
    setDraft({ type: 'text', value: t.value });
    setTimeout(() => t.focus(), 0);
  } else if (picker.tab === 'image') {
    const file = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
    const drop = h('div', { class: 'drop' }, 'Arrastra aquí una imagen (PNG, JPG, GIF, SVG, WebP)', h('br'), h('br'), h('button', { class: 'secondary', onclick: () => file.click() }, 'Elegir archivo…'));
    const handle = async f => { if (f && f.type.startsWith('image/')) setDraft({ type: 'image', value: await shrinkImage(f) }); };
    file.onchange = () => handle(file.files[0]);
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); handle(e.dataTransfer.files[0]); };
    const url = h('input', { type: 'url', placeholder: 'https://… o pega una imagen con Ctrl+V', style: 'flex:1' });
    url.onchange = () => url.value && setDraft({ type: 'image', value: url.value });
    url.onpaste = async e => { const it = [...e.clipboardData.items].find(i => i.type.startsWith('image/')); if (it) { e.preventDefault(); handle(it.getAsFile()); } };
    body.append(drop, file, h('div', { class: 'row' }, h('span', {}, 'O desde una URL:'), url));
  } else if (picker.tab === 'avatar') {
    const chans = Object.values(state.channels).filter(c => c.avatar);
    const inGroup = chans.filter(c => picker.group.channels.includes(c.key));
    const rest = chans.filter(c => !picker.group.channels.includes(c.key));
    count.textContent = `${chans.length} avatares de canal`;
    const mk = list => h('div', { class: 'igrid', style: 'grid-template-columns:repeat(auto-fill,minmax(52px,1fr))' }, list.map(c => {
      const b = h('button', { title: c.name, 'data-v': c.avatar, 'data-t': 'image', style: 'height:52px', class: picker.draft.value === c.avatar ? 'on' : '' },
        h('img', { src: c.avatar, referrerpolicy: 'no-referrer', style: 'width:40px;height:40px;border-radius:50%' }));
      b.onclick = () => { $('#pickRound').checked = true; setDraft({ type: 'image', value: c.avatar, fromChannel: true }); };
      b.ondblclick = applyPicker;
      return b;
    }));
    if (!chans.length) body.append(h('div', { class: 'empty' }, 'Importa canales para usar sus avatares como icono.'));
    if (inGroup.length) body.append(h('div', { class: 'cat-title' }, 'Canales de este grupo'), mk(inGroup));
    if (rest.length) body.append(h('div', { class: 'cat-title' }, 'Otros canales'), mk(rest));
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
$('#pickClose').onclick = closePicker;
$('#picker').onclick = e => { if (e.target.id === 'picker') closePicker(); };
$('#pickOk').onclick = applyPicker;
$('#pickTabs').onclick = e => { const b = e.target.closest('button'); if (b) { picker.tab = b.dataset.tab; renderPickerTab(); } };
$('#pickColor').oninput = e => { picker.color = e.target.value; renderSwatches(); updatePreview(); if (picker.tab === 'svg') renderPickerTab(); };
$('#pickBg').onchange = () => setDraft(picker.draft);
$('#pickRound').onchange = () => setDraft(picker.draft);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePicker(); });

PG.load().then(s => { state = s; route(); });
