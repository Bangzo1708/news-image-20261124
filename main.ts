// news-image-20261124 — "The world in one picture"
// A hand-drawn front page summing up Tuesday 24 November 2026.
// Node 22, standard library only. Pure-Node PNG encoder (zlib deflate),
// a small built-in 5x7 bitmap font, and vector pictograms drawn in code.
// Fully deterministic: no clock, no randomness, no network, no files read.
// Run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// PNG encoding (truecolor, 8 bit, filter 0 on every row)
// ---------------------------------------------------------------------------

const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(w: number, h: number, rgb: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolor RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Canvas: an RGB pixel buffer with simple vector drawing
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

class Canvas {
  readonly w: number;
  readonly h: number;
  readonly px: Buffer;
  constructor(w: number, h: number, bg: RGB) {
    this.w = w;
    this.h = h;
    this.px = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      this.px[i * 3] = bg[0];
      this.px[i * 3 + 1] = bg[1];
      this.px[i * 3 + 2] = bg[2];
    }
  }
  set(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
  }
  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
  }
  // filled circle
  disc(cx: number, cy: number, r: number, c: RGB): void {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r * r) this.set(x, y, c);
      }
    }
  }
  // circle outline, thickness t
  ring(cx: number, cy: number, r: number, t: number, c: RGB): void {
    for (let y = cy - r - t; y <= cy + r + t; y++) {
      for (let x = cx - r - t; x <= cx + r + t; x++) {
        const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
        if (Math.abs(d - r) <= t / 2) this.set(x, y, c);
      }
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, t = 1): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(x0 + (dx * s) / steps);
      const y = Math.round(y0 + (dy * s) / steps);
      for (let a = 0; a < t; a++) for (let b = 0; b < t; b++) this.set(x + a, y + b, c);
    }
  }
  // filled triangle
  tri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
    const minX = Math.min(x0, x1, x2);
    const maxX = Math.max(x0, x1, x2);
    const minY = Math.min(y0, y1, y2);
    const maxY = Math.max(y0, y1, y2);
    const d = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
    if (d === 0) return;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const a = ((x1 - x) * (y2 - y) - (y1 - y) * (x2 - x)) / d;
        const b = ((x2 - x) * (y0 - y) - (y2 - y) * (x0 - x)) / d;
        const g = 1 - a - b;
        if (a >= 0 && b >= 0 && g >= 0) this.set(x, y, c);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font (uppercase headlines; lowercase folded to uppercase)
// ---------------------------------------------------------------------------

const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '00100', '01000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  ';': ['00000', '01100', '01100', '00000', '01100', '00100', '01000'],
  "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00110', '00100', '00000', '00100'],
  '+': ['00000', '00100', '00100', '01110', '00100', '00100', '00000'],
  '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  $: ['00100', '01111', '10100', '01110', '00101', '11110', '00100'],
  '•': ['00000', '00000', '01100', '01100', '01100', '00000', '00000'],
};

function textWidth(s: string, scale: number): number {
  return s.length * 6 * scale - scale;
}

function drawText(cv: Canvas, s: string, x: number, y: number, scale: number, c: RGB): void {
  const up = s.toUpperCase();
  for (let ci = 0; ci < up.length; ci++) {
    const g = GLYPHS[up[ci]] ?? GLYPHS[' '];
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (g[r][col] === '1') cv.rect(x + ci * 6 * scale + col * scale, y + r * scale, scale, scale, c);
      }
    }
  }
}

function drawTextCentred(cv: Canvas, s: string, cx: number, y: number, scale: number, c: RGB): void {
  drawText(cv, s, cx - Math.floor(textWidth(s, scale) / 2), y, scale, c);
}

// Greedy word wrap to at most maxChars per line.
function wrap(text: string, maxChars: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur === '') {
      cur = w;
    } else if (cur.length + 1 + w.length <= maxChars) {
      cur += ' ' + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const PAPER: RGB = [247, 243, 234];
const INK: RGB = [26, 26, 26];
const NAVY: RGB = [20, 33, 61];
const GOLD: RGB = [252, 163, 17];
const WHITE: RGB = [255, 255, 255];
const PANEL: RGB = [255, 255, 255];
const BORDER: RGB = [200, 192, 175];
const GREY: RGB = [90, 90, 90];
const GREEN: RGB = [118, 185, 0];
const RED: RGB = [180, 35, 24];
const TEAL: RGB = [14, 116, 144];
const ORANGE: RGB = [194, 65, 12];
const BLUE: RGB = [29, 78, 216];
const AMBER: RGB = [146, 64, 14];

// ---------------------------------------------------------------------------
// Pictograms — each drawn inside a square box (bx, by, size)
// ---------------------------------------------------------------------------

function picChip(cv: Canvas, bx: number, by: number, s: number): void {
  // Nvidia-style AI chip: dark body, green core, pins on all sides.
  const cx = bx + Math.floor(s / 2);
  const cy = by + Math.floor(s / 2);
  const body = Math.floor(s * 0.52);
  for (let i = 0; i < 4; i++) {
    const off = -Math.floor(s * 0.32) + i * Math.floor(s * 0.21);
    cv.rect(cx + off - 3, by + 2, 6, Math.floor(s * 0.12), GREEN);
    cv.rect(cx + off - 3, by + s - Math.floor(s * 0.12) - 2, 6, Math.floor(s * 0.12), GREEN);
    cv.rect(bx + 2, cy + off - 3, Math.floor(s * 0.12), 6, GREEN);
    cv.rect(bx + s - Math.floor(s * 0.12) - 2, cy + off - 3, Math.floor(s * 0.12), 6, GREEN);
  }
  cv.rect(cx - Math.floor(body / 2), cy - Math.floor(body / 2), body, body, [30, 30, 30]);
  const core = Math.floor(body * 0.55);
  cv.rect(cx - Math.floor(core / 2), cy - Math.floor(core / 2), core, core, GREEN);
  drawTextCentred(cv, 'AI', cx, cy - 7, 2, WHITE);
}

function picShip(cv: Canvas, bx: number, by: number, s: number): void {
  // Warship on waves with a burst above it.
  const cx = bx + Math.floor(s / 2);
  const cy = by + Math.floor(s / 2);
  // explosion burst
  const bx0 = cx - 8;
  const by0 = cy - Math.floor(s * 0.36);
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const x2 = Math.round(bx0 + Math.cos(a) * 22);
    const y2 = Math.round(by0 + Math.sin(a) * 22);
    cv.line(bx0, by0, x2, y2, ORANGE, 4);
  }
  cv.disc(bx0, by0, 10, GOLD);
  cv.disc(bx0, by0, 5, RED);
  // hull
  cv.tri(cx - 44, cy + 6, cx + 44, cy + 6, cx + 34, cy + 26, [40, 40, 48]);
  cv.rect(cx - 44, cy - 2, 88, 10, [40, 40, 48]);
  // superstructure + mast
  cv.rect(cx - 18, cy - 22, 30, 20, [70, 70, 80]);
  cv.line(cx + 16, cy - 22, cx + 16, cy - 40, [40, 40, 48], 3);
  cv.line(cx + 16, cy - 40, cx + 30, cy - 34, RED, 3);
  // waves
  for (let w = 0; w < 3; w++) {
    const wy = cy + 34 + w * 9;
    for (let x = bx + 6; x < bx + s - 6; x += 18) {
      cv.line(x, wy, x + 9, wy - 4, TEAL, 3);
      cv.line(x + 9, wy - 4, x + 18, wy, TEAL, 3);
    }
  }
}

function picClimate(cv: Canvas, bx: number, by: number, s: number): void {
  // Globe with a crack: climate talks broken.
  const cx = bx + Math.floor(s / 2);
  const cy = by + Math.floor(s / 2);
  const r = Math.floor(s * 0.36);
  cv.disc(cx, cy, r, [186, 227, 240]);
  cv.disc(cx - 10, cy - 8, 12, [46, 139, 87]);
  cv.disc(cx + 12, cy + 12, 9, [46, 139, 87]);
  cv.ring(cx, cy, r, 3, TEAL);
  cv.line(cx - r, cy, cx + r, cy, TEAL, 2);
  cv.line(cx, cy - r, cx, cy + r, TEAL, 2);
  // crack: jagged red line across the globe
  const crack: [number, number][] = [
    [cx - 6, cy - r - 2],
    [cx + 4, cy - 18],
    [cx - 4, cy - 4],
    [cx + 6, cy + 10],
    [cx - 2, cy + 24],
    [cx + 4, cy + r + 2],
  ];
  for (let i = 0; i < crack.length - 1; i++) {
    cv.line(crack[i][0], crack[i][1], crack[i + 1][0], crack[i + 1][1], RED, 4);
  }
}

function picFire(cv: Canvas, bx: number, by: number, s: number): void {
  // Factory with flames and smoke.
  const cx = bx + Math.floor(s / 2);
  const base = by + Math.floor(s * 0.78);
  // smoke
  cv.disc(cx + 30, by + 12, 10, [150, 150, 150]);
  cv.disc(cx + 38, by + 4, 8, [170, 170, 170]);
  cv.disc(cx + 22, by + 20, 8, [150, 150, 150]);
  // chimney
  cv.rect(cx + 26, by + 22, 12, 44, [90, 90, 90]);
  // factory body with sawtooth roof
  cv.rect(cx - 44, by + 44, 66, base - (by + 44), [70, 70, 80]);
  cv.tri(cx - 44, by + 44, cx - 22, by + 26, cx - 22, by + 44, [70, 70, 80]);
  cv.tri(cx - 22, by + 44, cx, by + 26, cx, by + 44, [70, 70, 80]);
  cv.tri(cx, by + 44, cx + 22, by + 26, cx + 22, by + 44, [70, 70, 80]);
  // windows
  cv.rect(cx - 36, by + 54, 10, 10, GOLD);
  cv.rect(cx - 14, by + 54, 10, 10, GOLD);
  cv.rect(cx + 8, by + 54, 10, 10, GOLD);
  // flames
  cv.tri(cx - 30, base - 6, cx - 18, by + 30, cx - 8, base - 6, ORANGE);
  cv.tri(cx - 12, base - 6, cx, by + 22, cx + 10, base - 6, GOLD);
  cv.tri(cx + 4, base - 6, cx + 16, by + 34, cx + 26, base - 6, ORANGE);
  cv.disc(cx - 4, base - 14, 7, [255, 220, 80]);
}

function picBall(cv: Canvas, bx: number, by: number, s: number): void {
  // Football with trophy behind it.
  const cx = bx + Math.floor(s / 2);
  const cy = by + Math.floor(s / 2);
  // trophy
  cv.rect(cx + 18, cy - 34, 26, 30, GOLD);
  cv.tri(cx + 18, cy - 4, cx + 44, cy - 4, cx + 31, cy + 14, GOLD);
  cv.rect(cx + 26, cy + 14, 10, 10, GOLD);
  cv.rect(cx + 18, cy + 24, 26, 6, GOLD);
  cv.line(cx + 18, cy - 28, cx + 8, cy - 18, GOLD, 4);
  cv.line(cx + 44, cy - 28, cx + 54, cy - 18, GOLD, 4);
  // ball
  cv.disc(cx - 12, cy + 6, 30, WHITE);
  cv.ring(cx - 12, cy + 6, 30, 3, INK);
  cv.disc(cx - 12, cy + 6, 9, INK);
  for (let k = 0; k < 5; k++) {
    const a = (k * 2 * Math.PI) / 5 - Math.PI / 2;
    const px = Math.round(cx - 12 + Math.cos(a) * 20);
    const py = Math.round(cy + 6 + Math.sin(a) * 20);
    cv.disc(px, py, 4, INK);
    cv.line(cx - 12, cy + 6, px, py, INK, 2);
  }
}

function picWarning(cv: Canvas, bx: number, by: number, s: number): void {
  // Warning triangle over poisoned ground: Gaza contamination.
  const cx = bx + Math.floor(s / 2);
  const cy = by + Math.floor(s / 2);
  // ground layers
  cv.rect(bx + 8, cy + 26, s - 16, 10, [120, 90, 60]);
  cv.rect(bx + 8, cy + 36, s - 16, 10, [90, 70, 45]);
  cv.rect(bx + 8, cy + 46, s - 16, 8, [70, 55, 35]);
  // droplets
  cv.disc(bx + 24, cy + 31, 4, [40, 120, 90]);
  cv.disc(bx + s - 26, cy + 41, 4, [40, 120, 90]);
  // warning triangle
  cv.tri(cx, cy - 42, cx - 40, cy + 22, cx + 40, cy + 22, GOLD);
  cv.tri(cx, cy - 30, cx - 29, cy + 14, cx + 29, cy + 14, [30, 30, 30]);
  drawTextCentred(cv, '!', cx, cy - 22, 4, GOLD);
}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

interface Story {
  kicker: string;
  colour: RGB;
  headline: string;
  sub: string;
  pic: (cv: Canvas, bx: number, by: number, s: number) => void;
}

const STORIES: Story[] = [
  {
    kicker: 'TECH',
    colour: GREEN,
    headline: 'HUANG BACK AS NVIDIA CEO',
    sub: 'Board reinstates Jensen Huang 13 days after his exit; shares soar.',
    pic: picChip,
  },
  {
    kicker: 'WAR AT SEA',
    colour: RED,
    headline: 'UKRAINE HITS RUSSIAN SHIP OFF LIBYA',
    sub: 'Kyiv claims a Russian corvette sunk at Benghazi; war reaches the Med.',
    pic: picShip,
  },
  {
    kicker: 'CLIMATE',
    colour: TEAL,
    headline: 'COP31 ENDS WITH NO DEAL',
    sub: 'Climate talks fail to reach a deal; talks may resume next year.',
    pic: picClimate,
  },
  {
    kicker: 'DISASTER',
    colour: ORANGE,
    headline: 'FACTORY FIRE KILLS 24 IN INDONESIA',
    sub: 'Blaze at a candy factory kills 24; dozens still missing.',
    pic: picFire,
  },
  {
    kicker: 'SPORT',
    colour: BLUE,
    headline: "UK TO HOST 2035 WOMEN'S WORLD CUP",
    sub: 'FIFA confirms Britain as host of the 2035 tournament.',
    pic: picBall,
  },
  {
    kicker: 'MIDDLE EAST',
    colour: AMBER,
    headline: "GAZA LAND AND WATER 'POISONED'",
    sub: 'Oxfam: war has poisoned air, soil and water across the Strip.',
    pic: picWarning,
  },
];

// ---------------------------------------------------------------------------
// Layout — Variant C: six-panel grid under a masthead
// ---------------------------------------------------------------------------

const W = 1024;
const H = 1024;

function drawPanel(cv: Canvas, st: Story, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, PANEL);
  // border
  cv.rect(x, y, w, 3, BORDER);
  cv.rect(x, y + h - 3, w, 3, BORDER);
  cv.rect(x, y, 3, h, BORDER);
  cv.rect(x + w - 3, y, 3, h, BORDER);
  // kicker strip
  cv.rect(x + 3, y + 3, w - 6, 34, st.colour);
  drawText(cv, st.kicker, x + 16, y + 13, 2, WHITE);
  // pictogram, left
  const picSize = 108;
  const picX = x + 14;
  const picY = y + 50;
  st.pic(cv, picX, picY, picSize);
  // headline, right of pictogram
  const hx = x + 136;
  const hw = w - 136 - 16;
  const headChars = Math.floor(hw / (6 * 3));
  const headLines = wrap(st.headline, headChars);
  let ty = y + 52;
  for (const ln of headLines.slice(0, 3)) {
    drawText(cv, ln, hx, ty, 3, INK);
    ty += 26;
  }
  // sub, full width below
  const subChars = Math.floor((w - 32) / (6 * 2));
  const subLines = wrap(st.sub, subChars);
  let sy = y + 50 + picSize + 14;
  for (const ln of subLines.slice(0, 2)) {
    drawText(cv, ln, x + 16, sy, 2, GREY);
    sy += 20;
  }
}

function build(): Buffer {
  const cv = new Canvas(W, H, PAPER);

  // ---- Masthead ----
  cv.rect(0, 0, W, 148, NAVY);
  cv.rect(0, 148, W, 6, GOLD);
  drawTextCentred(cv, 'THE WORLD IN ONE PICTURE', W / 2, 26, 4, WHITE);
  drawTextCentred(cv, 'TUESDAY  •  24 NOVEMBER 2026', W / 2, 78, 3, GOLD);
  drawTextCentred(cv, 'SIX STORIES THAT DEFINED THE DAY', W / 2, 116, 2, [200, 205, 220]);

  // ---- Six panels: 2 columns x 3 rows ----
  const margin = 16;
  const gap = 16;
  const panelW = Math.floor((W - margin * 2 - gap) / 2);
  const gridTop = 170;
  const gridBottom = 956;
  const panelH = Math.floor((gridBottom - gridTop - gap * 2) / 3);
  for (let i = 0; i < 6; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = margin + col * (panelW + gap);
    const y = gridTop + row * (panelH + gap);
    drawPanel(cv, STORIES[i], x, y, panelW, panelH);
  }

  // ---- Footer ticker ----
  cv.rect(0, 972, W, 52, NAVY);
  drawTextCentred(
    cv,
    'ALSO TODAY: WORLD CHESS CHAMPIONSHIP OPENS IN GENEVA  •  ALCARAZ WINS ATP FINALS',
    W / 2,
    990,
    2,
    WHITE,
  );

  return encodePng(W, H, cv.px);
}

function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  const png = build();
  writeFileSync(join(outDir, 'entry.png'), png);
}

main();
