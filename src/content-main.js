// DiaPeek — MAIN-world Content-Script
// Läuft im Seitenkontext (world: MAIN) ab document_start und patcht
// window.open, damit auch skriptgetriebene "öffne neuen Tab"-Aufrufe erwischt
// werden. Der ISOLATED-world-Kontext kann das echte window.open nicht sehen.
// Kommunikation mit content-iso.js über window.postMessage.

(() => {
  const origOpen = window.open ? window.open.bind(window) : null;
  if (!origOpen) return;

  let config = { enabled: true, interceptWindowOpen: true };

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (d && d.__diapeek === 'config' && d.config) {
      config = { ...config, ...d.config };
    }
  });

  function makeStubWindow() {
    const noop = () => {};
    const stub = {
      closed: false,
      focus: noop,
      blur: noop,
      close() {
        this.closed = true;
      },
      postMessage: noop,
      moveTo: noop,
      resizeTo: noop,
      location: { href: '', assign: noop, replace: noop },
      document: null,
    };
    return stub;
  }

  window.open = function (url, target, features) {
    try {
      const featureless = !features || String(features).trim() === '';
      const isHttp = url && /^https?:/i.test(String(url));
      // Nur feature-lose Aufrufe abfangen (das wäre in Dia ein Tab). Aufrufe mit
      // Fenster-Features (popup, width, height …) sind bewusste Popups wie z. B.
      // OAuth-Flows und werden durchgereicht, um nichts zu zerstören.
      if (config.enabled && config.interceptWindowOpen && isHttp && featureless) {
        window.postMessage({ __diapeek: 'open', url: String(url) }, '*');
        return makeStubWindow();
      }
    } catch (e) {
      /* im Zweifel Original benutzen */
    }
    return origOpen(url, target, features);
  };
})();
