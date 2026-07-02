# CLAUDE.md — DiaPeek

Project context and operational notes for Claude Code. Read this first.

## What it is
DiaPeek is a Manifest V3 Chrome/Chromium extension built for the **Dia browser**
(The Browser Company). It intercepts links that would open a new tab and opens
them in a **Peek** instead — a docked in-page overlay ("Sidepeek") or its own
window — so the user never loses their place.

- User-facing docs: [README.md](README.md)
- Design/architecture rationale: [PLAN.md](PLAN.md)
- Privacy policy (DE/EN): [PRIVACY.md](PRIVACY.md)

## ⚠️ Hard rules / gotchas (read before acting)
- **NEVER launch the Dia or Arc binaries** (`/Applications/Dia.app/...`, Arc).
  They ignore `--headless` and open as a full browser, which **disrupts the
  user's running session**. This already annoyed the user once.
- To render images/HTML to PNG, use **`chrome-headless-shell`** from the
  Puppeteer cache (headless-only, no window, does not touch Dia/Arc):
  `~/.cache/puppeteer/chrome-headless-shell/*/chrome-headless-shell-*/chrome-headless-shell`
- The **claude-in-chrome MCP** blocks returning binary/base64/long-hex data, and
  its screenshots time out on `document_idle` in this Dia instance. Browser
  **downloads are blocked** after the first (per-origin/global). So: don't try to
  export images through the browser — render locally instead.
- **qlmanage** renders HTML only up to ~948px wide at 1:1 (wider → clipped); fine
  for text but capped. **JXA/Cocoa (osascript) is broken** here (NSColor factory,
  NSMutableDictionary bridging all fail). Neither ImageMagick/rsvg/PIL exist.
- **Chrome Web Store pages and `chrome://`/`dia://`/extension pages block content
  scripts** — DiaPeek cannot run there (expected; not a bug).

## Dia-specific findings
- Dia has **no page-triggerable native Peek** (Arc had one; Dia dropped it). We
  build the Peek ourselves.
- On **macOS**, `⌘`-click (new tab), `⌃`-click (context menu) and `⌥`-click
  (Dia's native split) are OS/browser behaviors — DiaPeek must **never** intercept
  them. Only `target="_blank"`/`window.open`/middle-click and `Shift`-click are
  ours (opt-in).
- Whether `chrome.tabGroups`/`Tab.groupId` maps to Dia's grouping is
  **unconfirmed** — "open peeked page as a tab in the current group" is
  best-effort (falls back to opening next to the opener).
- `chrome.sidePanel.open()` needs a user gesture that's lost across
  content-script→background messaging → Side Panel mode was **removed**.
- Dia's UA has no "Google Chrome" brand (only "Chromium") — that's how we
  confirmed the connected browser is Dia. Don't UA-sniff; feature-detect.

## Architecture
- `manifest.json` — MV3. permissions: `declarativeNetRequestWithHostAccess`,
  `storage`, `tabs`, `tabGroups`; `host_permissions: <all_urls>`.
- `src/content-main.js` (MAIN world, document_start) — monkey-patches
  `window.open` (feature-less http opens only) and posts to content-iso.
- `src/content-iso.js` (ISOLATED world, all_frames, document_start) — capturing
  `click`/`auxclick` interception, the **overlay renderer** (Shadow DOM, split
  toggle, SVG toolbar icons), and the **peek-window control bar** (shown when the
  page is the peek window).
- `src/background.js` (service worker) — dispatcher; opens overlay vs window per
  `mode`; DNR header-strip management; `chrome.tabs`/`tabGroups`; peek-window
  lifecycle (auto-close on blur, promote-to-tab).
- `src/options/*`, `src/popup/*` — settings UI (checkboxes/radios default
  `checked` in HTML to avoid a save-before-load race that once wiped settings).

### Message flow
click/window.open → content-iso `peek(url)` → `PEEK` to background →
`mode==='window'`? `openPeekWindow` : (setStripRule + `RENDER_OVERLAY` to top
frame). Overlay buttons: `OPEN_TAB`, `OPEN_PEEK_WINDOW`, `PEEK_CLOSED` (clears
DNR). Peek-window bar: `IS_PEEK_WINDOW`, `PROMOTE_PEEK_WINDOW`, `CLOSE_PEEK_WINDOW`.

### Settings schema (chrome.storage.sync `settings`)
```
{ enabled: true, mode: 'overlay'|'window',
  intercept: { newTabLinks: true, shiftClick: true } }
```

## DNR (framing headers)
Removes `x-frame-options` + `content-security-policy` **only while a Peek is
open** and **only for the peeked domain** (`requestDomains:[host]`, sub_frame).
Earlier it was global+always-on, which broke image loading in Slack — do not
regress to that.

## Interception scope
- Only `target="_blank"` links (plain click), middle-click, feature-less
  `window.open`, and Shift-click are intercepted. `⌘`/`⌃`/`⌥` clicks are never touched.
- **Raw-file links are never peeked** — `isPeekable()` (in both content-iso.js and
  content-main.js) skips URLs whose path ends in an image/media/doc/archive
  extension (png, jpg, pdf, zip, mp4, …). This fixed **Slack image thumbnails**
  (Slack opens them via feature-less `window.open` to `files.slack.com/…png`),
  which were being hijacked into a Peek. Embedding a raw file in an iframe is
  useless anyway — let the browser handle it.

## Peek behaviors
- Overlay (`◧` split toggle: squeezes host page left via an injected stylesheet
  that also constrains top-level containers incl. `position:fixed` via
  `max-width: calc(100vw - 46vw)`; `↗` open in tab; `✕`/Esc close).
- Split reflow is **best-effort**: sites whose inner layout keys off the real
  viewport width (e.g. LinkedIn) get clipped, not reflowed — can't change the
  viewport from a content script.
- Window mode: centered popup ~70% of the main window, auto-closes when focus
  leaves it; bar has "open as tab in group" + close.
- Unembeddable sites (COEP/framebust): iframe load timeout → auto fallback to the
  peek window. (Note: iframe `load` fires even when X-Frame blocks, so it's not a
  reliable success signal — that's why the ↗/window escape always exists.)

## Build / dev
- Load unpacked in Dia: Extensions page → Developer mode → Load unpacked → this
  folder. After code changes: Reload (↻) the extension **and** refresh the test page.
- Icons: `node icons/gen-icons.js` (pure Node PNG encoder, no deps) → 16/32/48/128.
- Store assets: edit `dist/store-assets/html/*.html`, then
  `bash dist/store-assets/build.sh` (uses chrome-headless-shell → exact-size PNGs).

## Publishing (Chrome Web Store)
- Package: `dist/diapeek-0.1.0.zip` (manifest at root, `src/`, `icons/*.png`; no
  dev files). Rebuild: `zip -rX dist/diapeek-<v>.zip manifest.json src icons -x 'icons/gen-icons.js'`.
- Store icon: `icons/icon128.png`.
- Screenshots (1280×800): `dist/store-assets/screenshot-{1,2,3}-*.png`.
- Promo tile 440×280 + marquee 1400×560 in `dist/store-assets/`.
- Privacy policy: host `PRIVACY.md` (public URL required by the data form).

### Store copy (English)
- Name: **DiaPeek**
- Short: *Open links in a Peek — a docked overlay or its own window instead of a
  new tab. Split view included.*
- Category: Productivity.
- Long description + full DE/EN text: see chat history / PRIVACY.md.

### Store data/permissions form (English answers)
- Single purpose: open new-tab links in a Peek (overlay or window); all
  permissions serve only this.
- `declarativeNetRequestWithHostAccess`: strip X-Frame-Options/CSP for the peeked
  page only while a Peek is open, so it renders in the iframe; nothing read/stored/sent.
- `storage`: save settings locally.
- `tabs`: open peeked page in a real tab; render overlay in the correct top frame.
- `tabGroups`: keep a promoted tab in the originating tab group.
- host `<all_urls>`: intercept link clicks anywhere + embed target in the Peek;
  no page content read/stored/transmitted (local, ephemeral).
- Remote code: **No** (all JS bundled; no eval/external scripts).
- Data collected: **none** (settings are not collected user data).
- Confirm all three data-use statements (all true).

## Status
Feature-complete MVP: interception + overlay (with split) + window mode +
settings + icon + store assets + listing/privacy copy. `manifest.json` version is
`0.1.0` (bump to `1.0.0` before publishing if desired).
