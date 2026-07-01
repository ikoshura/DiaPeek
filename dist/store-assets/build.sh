#!/bin/bash
# Renders the HTML templates to exact-size PNGs with real fonts using
# chrome-headless-shell (a headless-only Chromium from the Puppeteer cache —
# it never opens a window and does NOT touch your Dia/Arc browser).
# Rendered at 2x device scale, then downscaled → crisp, retina-quality.
set -e
D="$(cd "$(dirname "$0")" && pwd)"
CHS="$(ls "$HOME"/.cache/puppeteer/chrome-headless-shell/*/chrome-headless-shell-*/chrome-headless-shell 2>/dev/null | head -1)"
[ -x "$CHS" ] || { echo "chrome-headless-shell not found"; exit 1; }
TMP="$(mktemp -d)"

r(){ # name  width  height  outname
  "$CHS" --headless --disable-gpu --hide-scrollbars --no-sandbox \
    --force-device-scale-factor=2 --window-size="$2,$3" \
    --screenshot="$TMP/$1.png" "file://$D/html/$1.html" >/dev/null 2>&1
  sips --resampleHeightWidth "$3" "$2" "$TMP/$1.png" --out "$D/$4" >/dev/null
  echo "  $4 (${2}x${3})"
}

r screenshot-1 1280 800  screenshot-1-overlay-1280x800.png
r screenshot-2 1280 800  screenshot-2-split-1280x800.png
r screenshot-3 1280 800  screenshot-3-modes-1280x800.png
r promo         440  280 promo-small-440x280.png
r marquee      1400  560 marquee-1400x560.png

rm -rf "$TMP"
echo "done."
