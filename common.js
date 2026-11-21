// Utilidades compartidas: almacenamiento, iconos y resolución de canales.
const PG = (() => {
  const DEFAULT_STATE = { groups: [], channels: {}, settings: { hideShorts: false, sidebarOpen: true, recentIcons: [] } };

  async function load() {
    const data = await chrome.storage.local.get(['groups', 'channels', 'settings']);
    return {
      groups: data.groups || [],
      channels: data.channels || {},
      settings: Object.assign({}, DEFAULT_STATE.settings, data.settings || {}),
    };
  }
  async function save(partial) { await chrome.storage.local.set(partial); }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // Clave del canal: "@handle" en minúsculas o el id "UC…"
  function keyFromHref(href) {
    if (!href) return null;
    let path;
    try { path = new URL(href, 'https://www.youtube.com').pathname; } catch { return null; }
    let m = path.match(/^\/(@[^/]+)/);
    if (m) return decodeURIComponent(m[1]).toLowerCase();
    m = path.match(/^\/channel\/(UC[\w-]{22})/);
    if (m) return m[1];
    return null;
  }

  // Descarga la página del canal y saca id, handle, nombre y avatar.
  async function resolveChannel(input) {
    input = (input || '').trim();
    let url;
    if (/^UC[\w-]{22}$/.test(input)) url = 'https://www.youtube.com/channel/' + input;
    else if (input.startsWith('@')) url = 'https://www.youtube.com/' + input;
    else if (/youtube\.com|youtu\.be/.test(input)) url = input.startsWith('http') ? input : 'https://' + input;
    else url = 'https://www.youtube.com/@' + input;
    const u = new URL(url);
    u.search = ''; u.hash = '';
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'channel' || parts[0] === 'c' || parts[0] === 'user') u.pathname = '/' + parts.slice(0, 2).join('/');
    else if (parts[0] && parts[0].startsWith('@')) u.pathname = '/' + parts[0];
    const res = await fetch(u.href, { credentials: 'include' });
    if (!res.ok) throw new Error('No se encontró el canal (' + res.status + ')');
    const html = await res.text();
    const id = (html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})"/) || [])[1];
    if (!id) throw new Error('No se pudo leer el id del canal');
    const handleM = html.match(/"vanityChannelUrl":"https?:\/\/www\.youtube\.com\/(@[^"]+)"/) || html.match(/"canonicalBaseUrl":"\/(@[^"]+)"/);
    const handle = handleM ? decodeURIComponent(handleM[1]).toLowerCase() : null;
    const name = decodeEntities((html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || handle || id);
    const avatar = decodeEntities((html.match(/<meta property="og:image" content="([^"]*)"/) || [])[1] || '');
    return { key: handle || id, id, handle, name, avatar };
  }

  function decodeEntities(s) {
    return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }

  // Asegura que el canal tiene id (para el RSS). Actualiza el registro en memoria.
  async function ensureChannelId(ch) {
    if (ch.id) return ch.id;
    const r = await resolveChannel(ch.handle || ch.key);
    ch.id = r.id;
    if (!ch.avatar) ch.avatar = r.avatar;
    if (!ch.name || ch.name === ch.key) ch.name = r.name;
    return ch.id;
  }

  // Crea el elemento visual de un icono de grupo.
  function iconEl(group, size = 24) {
    const icon = group.icon || { type: 'emoji', value: '📁' };
    const color = group.color || '#3ea6ff';
    const el = document.createElement('span');
    el.className = 'pg-icon';
    el.style.cssText = `display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;flex:0 0 ${size}px;border-radius:${icon.round ? '50%' : Math.round(size / 4) + 'px'};overflow:hidden;line-height:1;`;
    if (icon.bg) el.style.background = color;
    switch (icon.type) {
      case 'svg': {
        const inner = (typeof SVG_ICONS !== 'undefined' && SVG_ICONS[icon.value]) || '';
        const fg = icon.bg ? '#fff' : color;
        el.innerHTML = `<svg viewBox="0 0 24 24" width="${Math.round(size * (icon.bg ? .7 : .9))}" height="${Math.round(size * (icon.bg ? .7 : .9))}" fill="none" stroke="${fg}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:${fg}">${inner}</svg>`;
        break;
      }
      case 'image':
        el.innerHTML = '';
        { const img = document.createElement('img'); img.src = icon.value; img.style.cssText = 'width:100%;height:100%;object-fit:cover'; img.referrerPolicy = 'no-referrer'; el.appendChild(img); }
        break;
      case 'text':
        el.textContent = icon.value || '?';
        el.style.fontWeight = '700';
        el.style.fontFamily = 'Roboto, Arial, sans-serif';
        el.style.fontSize = Math.round(size * (String(icon.value).length > 2 ? .38 : .5)) + 'px';
        el.style.color = icon.bg ? '#fff' : color;
        break;
      default:
        el.textContent = icon.value || '📁';
        el.style.fontSize = Math.round(size * (icon.bg ? .62 : .82)) + 'px';
    }
    return el;
  }

  function relTime(date) {
    const s = (Date.now() - date.getTime()) / 1000;
    const f = (n, u, p) => `hace ${n} ${n === 1 ? u : p}`;
    if (s < 3600) return f(Math.max(1, Math.floor(s / 60)), 'minuto', 'minutos');
    if (s < 86400) return f(Math.floor(s / 3600), 'hora', 'horas');
    if (s < 86400 * 30) return f(Math.floor(s / 86400), 'día', 'días');
    if (s < 86400 * 365) return f(Math.floor(s / 86400 / 30), 'mes', 'meses');
    return f(Math.floor(s / 86400 / 365), 'año', 'años');
  }

  function fmtViews(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + ' M visualizaciones';
    if (n >= 1e3) return Math.round(n / 1e3) + ' mil visualizaciones';
    return n + ' visualizaciones';
  }

  return { load, save, uid, keyFromHref, resolveChannel, ensureChannelId, iconEl, relTime, fmtViews };
})();
