// DiaPeek — Service Worker
// Nimmt abgefangene URLs entgegen und rendert das Peek-Overlay im Top-Frame.
// Verwaltet die declarativeNetRequest-Regel zum Entfernen der Framing-Header
// (X-Frame-Options / CSP), damit die Zielseite im iframe geladen werden kann.

const DEFAULTS = {
  enabled: true,
  mode: 'overlay', // 'overlay' (Sidepeek/In-Page) | 'window' (eigenes Fenster)
  intercept: {
    newTabLinks: true, // target="_blank", window.open (feature-los), Mittelklick
    shiftClick: true, // Shift + Klick
  },
};

function mergeSettings(stored) {
  const s = stored || {};
  return {
    ...DEFAULTS,
    ...s,
    intercept: { ...DEFAULTS.intercept, ...(s.intercept || {}) },
  };
}

async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return mergeSettings(settings);
}

// ---- declarativeNetRequest: Framing-Header entfernen -----------------------
// WICHTIG: Die Regel ist NUR aktiv, solange ein Peek offen ist, und NUR für die
// gepeekte Domain. Früher strippte sie dauerhaft die CSP ALLER Sub-Frames auf
// ALLEN Seiten — das brach z. B. das Anzeigen von Bildern in Slack. Jetzt bleibt
// der Normalbetrieb fremder Seiten unberührt.
const DNR_RULE_ID = 1001;

async function setStripRule(url) {
  let host = null;
  try {
    host = new URL(url).hostname;
  } catch (e) {
    /* ungültige URL → keine Regel */
  }
  const addRules = host
    ? [
        {
          id: DNR_RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            responseHeaders: [
              { header: 'x-frame-options', operation: 'remove' },
              { header: 'frame-options', operation: 'remove' },
              { header: 'content-security-policy', operation: 'remove' },
              { header: 'content-security-policy-report-only', operation: 'remove' },
            ],
          },
          // Nur Sub-Frames (unser Peek-iframe) und nur von der gepeekten Domain.
          condition: { resourceTypes: ['sub_frame'], requestDomains: [host] },
        },
      ]
    : [];
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [DNR_RULE_ID],
      addRules,
    });
  } catch (e) {
    console.warn('[DiaPeek] DNR set-Fehler:', e);
  }
}

async function clearStripRule() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [DNR_RULE_ID] });
  } catch (e) {
    console.warn('[DiaPeek] DNR clear-Fehler:', e);
  }
}

// Beim Start/Reload alte Session-Regeln sicher entfernen.
chrome.runtime.onInstalled.addListener(clearStripRule);
chrome.runtime.onStartup.addListener(clearStripRule);

// ---- Neuer Tab (nach Möglichkeit in derselben Tab-Gruppe wie der Opener) ----
async function createTabInGroup(url, opener) {
  // Aktuelle groupId des Opener-Tabs holen (kann veraltet sein). -1 = keine Gruppe.
  let groupId = -1;
  if (opener && opener.id != null) {
    try {
      const fresh = await chrome.tabs.get(opener.id);
      if (fresh && typeof fresh.groupId === 'number') groupId = fresh.groupId;
    } catch (e) {
      if (typeof opener.groupId === 'number') groupId = opener.groupId;
    }
  }

  const props = { url };
  if (opener && opener.id != null) {
    props.windowId = opener.windowId;
    if (typeof opener.index === 'number') props.index = opener.index + 1;
    props.openerTabId = opener.id; // hilft Dia, den Tab beim Opener einzuordnen
  }

  let tab;
  try {
    tab = await chrome.tabs.create(props);
  } catch (e) {
    tab = await chrome.tabs.create({ url }); // z. B. openerTabId ungültig
  }

  if (groupId > -1 && chrome.tabs && chrome.tabs.group) {
    try {
      await chrome.tabs.group({ groupId, tabIds: tab.id });
    } catch (e) {
      console.warn('[DiaPeek] tabs.group fehlgeschlagen:', e);
    }
  }
  return tab;
}

// ---- Peek-Fenster (Fallback für nicht einbettbare Seiten) ------------------
// Ein echtes Popup-Fenster (keine iframe-/CSP-Grenzen), mittig zum Hauptfenster,
// proportional zur Hauptfenstergröße, und schließt automatisch, sobald der Fokus
// auf ein anderes Fenster wechselt ("aus dem Fenster rausklicken").
let peekWindowId = null;
let peekOpener = null; // Kontext des Quell-Tabs (für "als Tab in Gruppe öffnen")
const PEEK_WINDOW_RATIO = 0.7;

chrome.windows.onRemoved.addListener((id) => {
  if (id === peekWindowId) {
    peekWindowId = null;
    peekOpener = null;
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (peekWindowId == null) return;
  // Fokus ging auf ein ANDERES Fenster (z. B. Hauptfenster) → Peek-Fenster zu.
  // Bei Wechsel zu einer anderen App (WINDOW_ID_NONE) bleibt es offen.
  if (windowId !== peekWindowId && windowId !== chrome.windows.WINDOW_ID_NONE) {
    const id = peekWindowId;
    peekWindowId = null;
    peekOpener = null;
    chrome.windows.remove(id).catch(() => {});
  }
});

async function openPeekWindow(url, opener) {
  if (opener) peekOpener = opener;
  let width = 900;
  let height = 700;
  let left;
  let top;
  try {
    const win = await chrome.windows.getCurrent();
    const W = win.width || 1200;
    const H = win.height || 900;
    width = Math.round(W * PEEK_WINDOW_RATIO);
    height = Math.round(H * PEEK_WINDOW_RATIO);
    left = Math.round((win.left || 0) + (W - width) / 2);
    top = Math.round((win.top || 0) + (H - height) / 2);
  } catch (e) {
    /* Standardgröße/-position durch den Browser */
  }

  // Vorhandenes Peek-Fenster wiederverwenden (neu positionieren + URL setzen).
  if (peekWindowId != null) {
    try {
      const tabs = await chrome.tabs.query({ windowId: peekWindowId });
      if (tabs[0]) await chrome.tabs.update(tabs[0].id, { url });
      await chrome.windows.update(peekWindowId, {
        focused: true,
        ...(left != null ? { left, top, width, height } : {}),
      });
      return;
    } catch (e) {
      peekWindowId = null;
    }
  }

  const w = await chrome.windows.create({
    url,
    type: 'popup',
    width,
    height,
    ...(left != null ? { left, top } : {}),
    focused: true,
  });
  peekWindowId = w.id;
}

// ---- Nachrichten ----------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'GET_SETTINGS') {
      sendResponse(await getSettings());
      return;
    }

    if (msg.type === 'OPEN_TAB') {
      await createTabInGroup(msg.url, sender.tab);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'OPEN_PEEK_WINDOW') {
      await openPeekWindow(msg.url, sender.tab);
      sendResponse({ ok: true });
      return;
    }

    // Content-Script fragt beim Laden, ob seine Seite das Peek-Fenster ist.
    if (msg.type === 'IS_PEEK_WINDOW') {
      sendResponse({
        isPeekWindow: !!(
          sender.tab &&
          peekWindowId != null &&
          sender.tab.windowId === peekWindowId
        ),
      });
      return;
    }

    if (msg.type === 'CLOSE_PEEK_WINDOW') {
      const winId = peekWindowId;
      peekWindowId = null;
      peekOpener = null;
      if (winId != null) chrome.windows.remove(winId).catch(() => {});
      sendResponse({ ok: true });
      return;
    }

    // Peek-Fenster als Tab (in der Gruppe des ursprünglichen Quell-Tabs) öffnen.
    if (msg.type === 'PROMOTE_PEEK_WINDOW') {
      const opener = peekOpener;
      const winId = peekWindowId;
      peekWindowId = null; // Blur-Handler nicht mehr auslösen
      peekOpener = null;
      await createTabInGroup(msg.url, opener);
      if (winId != null) chrome.windows.remove(winId).catch(() => {});
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'PEEK_CLOSED') {
      await clearStripRule();
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'PEEK') {
      const s = await getSettings();
      if (!s.enabled) {
        sendResponse({ ok: false, disabled: true });
        return;
      }
      // Modus "Fenster": direkt eigenes Fenster öffnen (kein iframe/DNR nötig).
      if (s.mode === 'window') {
        await openPeekWindow(msg.url, sender.tab);
        sendResponse({ ok: true, handled: 'window' });
        return;
      }
      // Modus "Sidepeek": Header-Stripping für diese Domain, dann Overlay rendern.
      await setStripRule(msg.url);
      try {
        await chrome.tabs.sendMessage(
          sender.tab.id,
          { type: 'RENDER_OVERLAY', url: msg.url },
          { frameId: 0 }
        );
        sendResponse({ ok: true, handled: 'overlay' });
      } catch (e) {
        // Top-Frame nicht erreichbar → Regel zurück, als Fenster öffnen.
        await clearStripRule();
        await openPeekWindow(msg.url, sender.tab);
        sendResponse({ ok: true, handled: 'window-fallback' });
      }
      return;
    }
  })();
  return true; // asynchrone Antwort
});
