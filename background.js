function openManager(hash) {
  chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') + (hash ? '#' + hash : '') });
}
chrome.action.onClicked.addListener(() => openManager(''));
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'openManager') openManager(msg.hash || '');
});
chrome.runtime.onInstalled.addListener((d) => { if (d.reason === 'install') openManager(''); });
