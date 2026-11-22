// YTBox — puente con la propia página de YouTube (se ejecuta en el «mundo» de la página).
// Sirve para añadir vídeos a la cola real de YouTube (la del minirreproductor),
// que solo se puede manejar desde dentro de la página. Recibe órdenes de content.js por postMessage.
(() => {
  if (window.__ytboxBridge) return;
  window.__ytboxBridge = true;

  function queueCommand(id) {
    return {
      commandMetadata: { webCommandMetadata: { sendPost: true } },
      signalServiceEndpoint: {
        signal: 'CLIENT_SIGNAL',
        actions: [{
          addToPlaylistCommand: {
            openMiniplayer: true,
            videoId: id,
            listType: 'PLAYLIST_EDIT_LIST_TYPE_QUEUE',
            onCreateListCommand: {
              commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/playlist/create' } },
              createPlaylistServiceEndpoint: { videoIds: [id], params: 'CAQ%3D' },
            },
            videoIds: [id],
          },
        }],
      },
    };
  }

  window.addEventListener('message', e => {
    if (e.source !== window || !e.data || e.data.source !== 'ytbox' || e.data.type !== 'queue') return;
    const id = String(e.data.vid || '');
    if (!/^[\w-]{11}$/.test(id)) return;
    let ok = false;
    try {
      const app = document.querySelector('ytd-app');
      if (app) {
        app.dispatchEvent(new CustomEvent('yt-action', {
          bubbles: true, composed: true,
          detail: { actionName: 'yt-service-request', returnValue: [], args: [app, queueCommand(id)], optionalAction: false },
        }));
        ok = true;
      }
    } catch (err) { console.warn('[YTBox] cola', err); }
    window.postMessage({ source: 'ytbox-page', type: 'queue-result', vid: id, ok }, '*');
  });
})();
