/* injected into x.com pages */
(() => {
  const port = chrome.runtime.connect({ name: 'grok-csrf' });
  // respond to background/service-worker requests
  port.onMessage.addListener((msg) => {
    try {
      if (msg && msg.type === 'grok-tokens') {
        const csrf = document.cookie.split('ct0=')[1]?.split(';')[0] || '';
        port.postMessage({ csrf, txnId: crypto.randomUUID(), reqId: crypto.randomUUID() });
      }
    } catch (_) {}
  });

  // cleanup on unload
  window.addEventListener('unload', () => { try { port.disconnect(); } catch (_) {} });
})();
