function openManager(hash) {
  chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') + (hash ? '#' + hash : '') });
}
chrome.action.onClicked.addListener(() => openManager(''));
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === 'openManager') openManager(msg.hash || '');
  if (msg && msg.type === 'syncNow') { syncNow().then(r => reply(r)).catch(e => reply({ error: e.message })); return true; }
});
chrome.runtime.onInstalled.addListener((d) => { if (d.reason === 'install') openManager(''); pull().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => pull().catch(() => {}));

// ---------- Sincronización entre navegadores (chrome.storage.sync) ----------
// Se guardan grupos y canales troceados (cada elemento de sync admite ~8 KB, en total ~100 KB).
const CHUNK = 7000, MAX_CHUNKS = 12;
let pushTimer = null, applying = false;

async function deviceId() {
  let { syncDevice } = await chrome.storage.local.get('syncDevice');
  if (!syncDevice) { syncDevice = Math.random().toString(36).slice(2); await chrome.storage.local.set({ syncDevice }); }
  return syncDevice;
}

function payloadOf(groups, channels) {
  // Los avatares se pueden volver a obtener: no se sincronizan para ahorrar espacio
  const ch = {};
  for (const [k, c] of Object.entries(channels || {})) ch[k] = { key: c.key, id: c.id, handle: c.handle, name: c.name };
  return JSON.stringify({ groups: groups || [], channels: ch });
}

async function push() {
  const { settings = {}, groups, channels, syncHash } = await chrome.storage.local.get(['settings', 'groups', 'channels', 'syncHash']);
  if (!settings.sync) return { skipped: true };
  const json = payloadOf(groups, channels);
  if (json === syncHash) return { unchanged: true };
  const parts = [];
  for (let i = 0; i < json.length; i += CHUNK) parts.push(json.slice(i, i + CHUNK));
  if (parts.length > MAX_CHUNKS) {
    await chrome.storage.local.set({ syncStatus: { error: 'Demasiados datos para sincronizar (prueba a usar iconos que no sean imágenes subidas)', at: Date.now() } });
    return { error: 'too big' };
  }
  const items = { meta: { n: parts.length, ts: Date.now(), by: await deviceId() } };
  parts.forEach((p, i) => items['c' + i] = p);
  await chrome.storage.sync.set(items);
  const old = await chrome.storage.sync.get(null);
  const stale = Object.keys(old).filter(k => /^c\d+$/.test(k) && +k.slice(1) >= parts.length);
  if (stale.length) await chrome.storage.sync.remove(stale);
  await chrome.storage.local.set({ syncHash: json, syncTs: items.meta.ts, syncStatus: { ok: 'Subido', at: Date.now() } });
  return { pushed: true };
}

async function pull() {
  const { settings = {}, syncTs = 0, channels: localCh = {} } = await chrome.storage.local.get(['settings', 'syncTs', 'channels']);
  if (!settings.sync) return { skipped: true };
  const all = await chrome.storage.sync.get(null);
  const meta = all.meta;
  if (!meta || meta.ts <= syncTs) return { nothing: true };
  let json = '';
  for (let i = 0; i < meta.n; i++) json += all['c' + i] || '';
  const data = JSON.parse(json);
  // Conservar los avatares locales
  for (const [k, c] of Object.entries(data.channels)) if (localCh[k] && localCh[k].avatar) c.avatar = localCh[k].avatar;
  applying = true;
  await chrome.storage.local.set({ groups: data.groups, channels: data.channels, syncHash: payloadOf(data.groups, data.channels), syncTs: meta.ts, syncStatus: { ok: 'Descargado', at: Date.now() } });
  applying = false;
  return { pulled: true };
}

async function syncNow() {
  const r = await pull();
  if (r.pulled) return r;
  await chrome.storage.local.remove('syncHash');
  return push();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.meta) { pull().catch(() => {}); return; }
  if (area !== 'local' || applying) return;
  if (changes.settings && changes.settings.newValue && changes.settings.newValue.sync && !(changes.settings.oldValue || {}).sync) { syncNow().catch(() => {}); return; }
  if (changes.groups || changes.channels) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => push().catch(e => chrome.storage.local.set({ syncStatus: { error: e.message, at: Date.now() } })), 3000);
  }
});
