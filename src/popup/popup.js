// DiaPeek — Toolbar-Popup (Schnellzugriff)

const DEFAULTS = {
  enabled: true,
  mode: 'overlay',
  intercept: { newTabLinks: true, shiftClick: true },
};

function merge(stored) {
  const s = stored || {};
  return { ...DEFAULTS, ...s, intercept: { ...DEFAULTS.intercept, ...(s.intercept || {}) } };
}

const enabledEl = document.getElementById('enabled');

async function save(patch) {
  const { settings } = await chrome.storage.sync.get('settings');
  const next = merge(settings);
  Object.assign(next, patch);
  await chrome.storage.sync.set({ settings: next });
}

async function load() {
  const { settings } = await chrome.storage.sync.get('settings');
  enabledEl.checked = merge(settings).enabled;
}

enabledEl.addEventListener('change', () => save({ enabled: enabledEl.checked }));
document.getElementById('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());

load();
