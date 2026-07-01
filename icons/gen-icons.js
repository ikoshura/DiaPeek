// Erzeugt die DiaPeek-Icon-PNGs rein lokal (Node + zlib, keine Abhängigkeiten).
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ---- PNG-Encoder (8-bit RGBA) ----
const CRCT = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRCT[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- Zeichnen ----
const BG = [79, 104, 247];
const PAGE = [111, 132, 249];
const WHITE = [255, 255, 255];
const LINE = [195, 206, 224];

function inRR(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const rx = Math.min(Math.max(px, x + r), x + w - r);
  const ry = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - rx;
  const dy = py - ry;
  return dx * dx + dy * dy <= r * r;
}

// Farbe (oder null=transparent) an einem kontinuierlichen Punkt
function colorAt(px, py, s) {
  const withLines = s >= 48;
  const panel = { x: s * 0.45, y: s * 0.22, w: s * 0.42, h: s * 0.56, r: s * 0.095 };
  if (withLines && inRR(px, py, panel.x, panel.y, panel.w, panel.h, panel.r)) {
    const lx = panel.x + panel.w * 0.2;
    const lw = panel.w * 0.62;
    const lh = s * 0.04;
    const ys = [0.22, 0.42, 0.6];
    for (let i = 0; i < 3; i++) {
      const ly = panel.y + panel.h * ys[i];
      const w = i === 2 ? lw * 0.6 : lw;
      if (inRR(px, py, lx, ly, w, lh, lh / 2)) return LINE;
    }
    return WHITE;
  }
  if (inRR(px, py, panel.x, panel.y, panel.w, panel.h, panel.r)) return WHITE;
  if (inRR(px, py, s * 0.125, s * 0.27, s * 0.27, s * 0.46, s * 0.06)) return PAGE;
  if (inRR(px, py, 0, 0, s, s, s * 0.22)) return BG;
  return null;
}

function render(s) {
  const SS = 4; // Supersampling für glatte Kanten
  const rgba = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let ar = 0, ag = 0, ab = 0, aa = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const col = colorAt(px, py, s);
          if (col) {
            ar += col[0];
            ag += col[1];
            ab += col[2];
            aa += 1;
          }
        }
      }
      const n = SS * SS;
      const idx = (y * s + x) * 4;
      if (aa > 0) {
        rgba[idx] = Math.round(ar / aa);
        rgba[idx + 1] = Math.round(ag / aa);
        rgba[idx + 2] = Math.round(ab / aa);
        rgba[idx + 3] = Math.round((aa / n) * 255);
      } // sonst transparent (0,0,0,0)
    }
  }
  return encodePNG(s, s, rgba);
}

for (const s of [16, 32, 48, 128]) {
  const out = path.join(__dirname, `icon${s}.png`);
  fs.writeFileSync(out, render(s));
  console.log('wrote', out, fs.statSync(out).size, 'bytes');
}
