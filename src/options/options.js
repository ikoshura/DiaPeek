// DiaPeek — Einstellungsseite

const DEFAULTS = {
  enabled: true,
  mode: 'overlay', // 'overlay' (Sidepeek) | 'window' (eigenes Fenster)
  intercept: {
    newTabLinks: true, // target="_blank", window.open (feature-los), Mittelklick
    shiftClick: true, // Shift + Klick
  },
};

function merge(stored) {
  const s = stored || {};
  return { ...DEFAULTS, ...s, intercept: { ...DEFAULTS.intercept, ...(s.intercept || {}) } };
}

const $ = (id) => document.getElementById(id);

function fill(s) {
  $('enabled').checked = s.enabled;
  const modeEl = document.querySelector('input[name="mode"][value="' + s.mode + '"]');
  if (modeEl) modeEl.checked = true;
  $('ic-newtab').checked = s.intercept.newTabLinks;
  $('ic-shift').checked = s.intercept.shiftClick;
}

function collect() {
  const modeSel = document.querySelector('input[name="mode"]:checked');
  return {
    enabled: $('enabled').checked,
    mode: modeSel ? modeSel.value : 'overlay',
    intercept: {
      newTabLinks: $('ic-newtab').checked,
      shiftClick: $('ic-shift').checked,
    },
  };
}

async function load() {
  const { settings } = await chrome.storage.sync.get('settings');
  fill(merge(settings));
}

function flash(text) {
  const st = $('status');
  st.textContent = text;
  setTimeout(() => (st.textContent = ''), 1800);
}

$('save').addEventListener('click', async () => {
  await chrome.storage.sync.set({ settings: collect() });
  flash('Gespeichert ✓');
});

$('reset').addEventListener('click', async () => {
  const defaults = { enabled: true, mode: 'overlay', intercept: { newTabLinks: true, shiftClick: true } };
  fill(defaults);
  await chrome.storage.sync.set({ settings: defaults });
  flash('Auf Standard zurückgesetzt ✓');
});

load();
