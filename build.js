#!/usr/bin/env node
// YTBox — empaqueta la extensión para Chrome/Edge y para Firefox a partir del mismo código.
// Uso: node build.js
// Resultado en dist/:
//   dist/chrome/            carpeta para «Cargar descomprimida» en Chrome/Edge
//   dist/firefox/           carpeta para about:debugging → «Cargar complemento temporal»
//   dist/ytbox-chrome.zip   para subir a la Chrome Web Store
//   dist/ytbox-firefox.xpi  para firmar en addons.mozilla.org (o instalar en Firefox Developer/Nightly)
// Sin dependencias: solo Node.js (usa zlib para comprimir).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const FIREFOX_ID = 'ytbox@dani9del9';
const FIREFOX_MIN = '128.0';

// Archivos que forman la extensión
const INCLUDE = name => /\.(js|css|html|json|png)$/.test(name) && !['build.js', 'package.json', 'package-lock.json'].includes(name);
function listFiles(dir = ROOT, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || ['dist', 'node_modules'].includes(e.name)) continue;
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...listFiles(path.join(dir, e.name), rel));
    else if (INCLUDE(e.name)) out.push(rel);
  }
  return out.sort();
}

// Manifiesto de Firefox: script de fondo en vez de service worker, options_ui e id de Gecko
function firefoxManifest(m) {
  const f = JSON.parse(JSON.stringify(m));
  f.background = { scripts: [m.background.service_worker] };
  if (f.options_page) { f.options_ui = { page: f.options_page, open_in_tab: true }; delete f.options_page; }
  f.browser_specific_settings = {
    gecko: {
      id: FIREFOX_ID,
      strict_min_version: FIREFOX_MIN,
      data_collection_permissions: { required: ['none'] },
    },
  };
  return f;
}

// ---- ZIP mínimo (deflate) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function dosTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
function makeZip(entries) { // entries: [{ name, data: Buffer }]
  const locals = [], centrals = [];
  let offset = 0;
  const { time, date } = dosTime(new Date());
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10); central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

// ---- Construcción ----
function writeTarget(name, manifest, files) {
  const dir = path.join(DIST, name);
  fs.rmSync(dir, { recursive: true, force: true });
  const entries = [];
  for (const rel of files) {
    const data = rel === 'manifest.json' ? Buffer.from(JSON.stringify(manifest, null, 2) + '\n') : fs.readFileSync(path.join(ROOT, rel));
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
    entries.push({ name: rel, data });
  }
  return entries;
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const files = listFiles();
fs.mkdirSync(DIST, { recursive: true });

const chromeEntries = writeTarget('chrome', manifest, files);
fs.writeFileSync(path.join(DIST, 'ytbox-chrome.zip'), makeZip(chromeEntries));

const ffEntries = writeTarget('firefox', firefoxManifest(manifest), files);
fs.writeFileSync(path.join(DIST, 'ytbox-firefox.xpi'), makeZip(ffEntries));

console.log(`YTBox ${manifest.version}: ${files.length} archivos`);
console.log('  dist/chrome/  y  dist/ytbox-chrome.zip');
console.log('  dist/firefox/ y  dist/ytbox-firefox.xpi');
