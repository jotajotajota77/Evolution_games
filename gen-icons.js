#!/usr/bin/env node
// One-shot icon generator. Renders 192×192 and 512×512 PNGs that mirror
// the SVG icon's look, but as a raster file Chrome Android accepts for
// PWA install. Re-run if the SVG ever changes:
//   node gen-icons.js

const fs = require('fs');
const zlib = require('zlib');

// --- PNG encoding helpers (no external deps) -------------------------------
function crc32() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return function (buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
}
const computeCrc = crc32();

function chunk(type, data) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(computeCrc(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makePng(size, drawFn) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;     // bit depth
  ihdr[9] = 6;     // color type (RGBA)
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // compress / filter / interlace

  const raw = Buffer.alloc(size * (1 + size * 4));
  let off = 0;
  for (let y = 0; y < size; y++) {
    raw[off++] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = drawFn(x, y, size);
      raw[off++] = r; raw[off++] = g; raw[off++] = b; raw[off++] = a;
    }
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

// --- Icon look -------------------------------------------------------------
// Five glowing organisms over a dark radial background, rounded corners
// (~18% of the image size, similar to the SVG `rx` attribute). Mirrors
// icon.svg's composition without anti-aliasing — that's fine for PWA icons,
// the device's rasterizer/cropper sees it as a flat image anyway.
function render(x, y, size) {
  const cx = size / 2;
  const cy = size / 2;
  const sx = (x - cx) / cx;
  const sy = (y - cy) / cy;
  const radial = Math.min(1, Math.sqrt(sx * sx + sy * sy));

  // Rounded corner mask — anything outside the rounded box is transparent.
  const cornerR = size * 0.18;
  const ax = Math.abs(x - cx);
  const ay = Math.abs(y - cy);
  const limit = cx - cornerR;
  if (ax > limit && ay > limit) {
    const dCorner = Math.sqrt((ax - limit) ** 2 + (ay - limit) ** 2);
    if (dCorner > cornerR) return [0, 0, 0, 0];
  }

  // Dark blue radial background.
  let r = Math.round(22 * (1 - radial) + 6 * radial);
  let g = Math.round(24 * (1 - radial) + 8 * radial);
  let b = Math.round(44 * (1 - radial) + 15 * radial);

  // Glowing organisms — each contributes a soft additive falloff.
  const orgs = [
    { x: 0.500, y: 0.500, br: 0.085, gr: 0.20, col: [127, 255, 212] }, // centre, accent
    { x: 0.286, y: 0.359, br: 0.045, gr: 0.12, col: [127, 169, 255] },
    { x: 0.734, y: 0.313, br: 0.040, gr: 0.11, col: [255, 127, 200] },
    { x: 0.758, y: 0.727, br: 0.048, gr: 0.13, col: [255, 200, 100] },
    { x: 0.309, y: 0.734, br: 0.044, gr: 0.12, col: [168, 128, 255] },
  ];

  for (const o of orgs) {
    const px = o.x * size;
    const py = o.y * size;
    const br = o.br * size;
    const gr = o.gr * size;
    const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
    if (dist < br) {
      r = o.col[0]; g = o.col[1]; b = o.col[2];
    } else if (dist < gr) {
      const t = 1 - (dist - br) / (gr - br);
      const k = t * t * 0.75;
      r = Math.min(255, r + o.col[0] * k);
      g = Math.min(255, g + o.col[1] * k);
      b = Math.min(255, b + o.col[2] * k);
    }
  }
  return [Math.round(r), Math.round(g), Math.round(b), 255];
}

for (const size of [192, 512]) {
  const png = makePng(size, render);
  const path = `icon-${size}.png`;
  fs.writeFileSync(path, png);
  console.log(`wrote ${path} (${png.length} bytes)`);
}
