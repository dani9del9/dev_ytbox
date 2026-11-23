// YTBox — idiomas (español, inglés, gallego).
// Los textos del código están en español y se traducen con T('texto', ...args); los {0}, {1}… se sustituyen por los argumentos.
// TN(n, 'singular', 'plural', ...args) elige la forma según n (que siempre es {0}).
// Los diccionarios están en i18n-en.js e i18n-gl.js (claves = texto en español).
var YTBOX_LANGS = [['es', 'Español'], ['en', 'English'], ['gl', 'Galego']];
var YTBOX_DICT = typeof YTBOX_DICT !== 'undefined' ? YTBOX_DICT : {};
var YTBOX_LANG = (() => {
  const nav = (typeof navigator !== 'undefined' && navigator.language || 'es').toLowerCase();
  return nav.startsWith('gl') ? 'gl' : nav.startsWith('es') || nav.startsWith('ca') || nav.startsWith('eu') ? 'es' : 'en';
})();
var YTBOX_DEFAULT_LANG = YTBOX_LANG;
function T(s, ...args) {
  if (s == null) return s;
  let out = s;
  if (YTBOX_LANG !== 'es') { const d = YTBOX_DICT[YTBOX_LANG]; if (d && d[s] != null) out = d[s]; }
  return args.length ? out.replace(/\{(\d+)\}/g, (m, i) => (args[i] != null ? args[i] : '')) : out;
}
function TN(n, one, many, ...rest) { return T(Number(n) === 1 ? one : many, n, ...rest); }
T.setLang = l => { YTBOX_LANG = ['es', 'en', 'gl'].includes(l) ? l : YTBOX_DEFAULT_LANG; if (typeof document !== 'undefined' && document.documentElement && location.protocol.endsWith('extension:')) document.documentElement.lang = YTBOX_LANG; return YTBOX_LANG; };
T.lang = () => YTBOX_LANG;
T.locale = () => ({ es: 'es-ES', en: 'en-GB', gl: 'gl-ES' })[YTBOX_LANG];
// Nombre del mes (0-11) en el idioma actual, en minúscula salvo en inglés
const YTBOX_MONTHS = {
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  gl: ['xaneiro', 'febreiro', 'marzo', 'abril', 'maio', 'xuño', 'xullo', 'agosto', 'setembro', 'outubro', 'novembro', 'decembro'],
};
T.month = m => YTBOX_MONTHS[YTBOX_LANG][m];
// Iniciales de los días de la semana empezando en lunes
T.weekdays = () => ({ es: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], en: ['M', 'T', 'W', 'T', 'F', 'S', 'S'], gl: ['L', 'M', 'M', 'X', 'V', 'S', 'D'] })[YTBOX_LANG];
// «3 de marzo» / «3 March» / «3 de marzo»
T.dayMonth = (d, m) => YTBOX_LANG === 'en' ? `${d} ${T.month(m)}` : `${d} de ${T.month(m)}`;
