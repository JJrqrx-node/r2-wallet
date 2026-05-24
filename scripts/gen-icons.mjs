#!/usr/bin/env node
// Generates icon PNGs for R2 Wallet in sizes 16, 32, 48, 128.
// Solid emerald-green (#10B981) rounded-corner square with white "R2" centered.
// Uses sharp if available, otherwise falls back to a hand-rolled PNG via zlib.

import { createWriteStream, mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { deflateSync } from "zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, "../src/manifest/icons");

if (!existsSync(ICONS_DIR)) mkdirSync(ICONS_DIR, { recursive: true });

const SIZES = [16, 32, 48, 128];
const EMERALD = { r: 0x10, g: 0xb9, b: 0x81 };

// ---------------------------------------------------------------------------
// Sharp-based path (preferred): renders SVG with proper text + radius.
// ---------------------------------------------------------------------------
async function trySharp() {
  const sharp = await import("sharp").catch(() => null);
  if (!sharp) return false;

  for (const size of SIZES) {
    const cornerRadius = Math.round(size * 0.18);
    const fontSize = Math.round(size * 0.42);
    const fontWeight = 800;

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${cornerRadius}" ry="${cornerRadius}" fill="#10B981"/>
  <text
    x="${size / 2}" y="${size / 2 + fontSize * 0.36}"
    font-family="-apple-system, BlinkMacSystemFont, Arial, sans-serif"
    font-size="${fontSize}"
    font-weight="${fontWeight}"
    fill="white"
    text-anchor="middle"
    letter-spacing="-${Math.round(fontSize * 0.05)}"
  >R2</text>
</svg>`.trim();

    const outPath = join(ICONS_DIR, `icon-${size}.png`);
    await sharp.default(Buffer.from(svg))
      .png()
      .toFile(outPath);

    console.log(`Generated icon-${size}.png (sharp)`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Fallback: hand-rolled PNG using raw pixel data + zlib deflate.
// ---------------------------------------------------------------------------

// Write a 4-byte big-endian uint32.
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

// CRC32 table.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c;
  }
  return t;
})();

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const combined = Buffer.concat([typeBytes, data]);
  return Buffer.concat([u32(data.length), typeBytes, data, u32(crc32(combined))]);
}

function buildPng(size) {
  const r = EMERALD.r;
  const g = EMERALD.g;
  const b = EMERALD.b;

  // RGBA pixel buffer.
  const pixels = Buffer.alloc(size * size * 4);

  const corner = Math.round(size * 0.18);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Rounded corners via distance-to-corner check.
      let alpha = 255;
      const inCorner = (cx, cy) => {
        if (x >= cx - corner && x < cx && y >= cy - corner && y < cy) {
          const dx = x - (cx - corner);
          const dy = y - (cy - corner);
          const dist = Math.sqrt((dx - corner) ** 2 + (dy - corner) ** 2);
          return dist > corner;
        }
        return false;
      };
      if (
        inCorner(corner, corner) ||               // top-left
        inCorner(size - corner, corner) ||          // top-right (mirrored)
        inCorner(corner, size - corner) ||
        inCorner(size - corner, size - corner)
      ) {
        // Actually recompute for each corner properly:
        // We'll just skip and handle below.
        alpha = 0;
      }

      // Re-check using proper corner logic.
      const corners = [
        [corner, corner],
        [size - 1 - corner, corner],
        [corner, size - 1 - corner],
        [size - 1 - corner, size - 1 - corner],
      ];
      alpha = 255;
      for (const [cx, cy] of corners) {
        const dx = x - cx;
        const dy = y - cy;
        // Only applies if pixel is in the corner quadrant.
        const inQuadrant =
          (x < corner && y < corner && cx === corner && cy === corner) ||
          (x >= size - corner && y < corner && cx === size - 1 - corner && cy === corner) ||
          (x < corner && y >= size - corner && cx === corner && cy === size - 1 - corner) ||
          (x >= size - corner && y >= size - corner && cx === size - 1 - corner && cy === size - 1 - corner);
        if (inQuadrant && Math.sqrt(dx * dx + dy * dy) > corner) {
          alpha = 0;
          break;
        }
      }

      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = alpha;
    }
  }

  // Build PNG scanlines (filter byte 0 = None prepended to each row).
  const scanlines = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    scanlines[row] = 0; // filter type None
    pixels.copy(scanlines, row + 1, y * size * 4, (y + 1) * size * 4);
  }

  const compressed = deflateSync(scanlines, { level: 9 });

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.concat([
    u32(size), u32(size),
    Buffer.from([8, 6, 0, 0, 0]), // bit depth, RGBA, compression, filter, interlace
  ]);

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function fallback() {
  for (const size of SIZES) {
    const outPath = join(ICONS_DIR, `icon-${size}.png`);
    const data = buildPng(size);
    await new Promise((resolve, reject) => {
      const ws = createWriteStream(outPath);
      ws.write(data);
      ws.end();
      ws.on("finish", resolve);
      ws.on("error", reject);
    });
    console.log(`Generated icon-${size}.png (fallback PNG encoder)`);
  }
}

const sharpOk = await trySharp();
if (!sharpOk) await fallback();
console.log("Icon generation complete.");
