/**
 * Generate simple PNG fixtures for image-translation e2e tests.
 */
import { writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createCanvas } from '../scripts/icon-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, 'fixtures');
mkdirSync(outDir, { recursive: true });

function writePng(name, size, bg, fg) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = fg;
  const barW = Math.floor(size * 0.55);
  const barH = Math.floor(size * 0.18);
  ctx.fillRect(Math.floor((size - barW) / 2), Math.floor((size - barH) / 2), barW, barH);
  writeFileSync(join(outDir, name), canvas.toBuffer('image/png'));
  console.log(`Wrote ${name} (${size}x${size})`);
}

function writeRectPng(name, w, h, bg, fg) {
  // icon-utils createCanvas is square-only; draw via square then note dimensions in filename usage.
  const size = Math.max(w, h);
  const canvas = createCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = fg;
  ctx.fillRect(Math.floor(size * 0.42), Math.floor(size * 0.1), Math.floor(size * 0.16), Math.floor(size * 0.8));
  writeFileSync(join(outDir, name), canvas.toBuffer('image/png'));
  console.log(`Wrote ${name} (${size}x${size}, used as ${w}x${h} display)`);
}

writePng('bonjour.png', 320, '#f0f4ff', '#1a73e8');
writePng('cors-bonjour.png', 320, '#fff4e6', '#c45c26');
writePng('fox.png', 320, '#e8f5e9', '#2e7d32');
writePng('hello.png', 320, '#e3f2fd', '#1565c0');
writePng('large-intrinsic.png', 800, '#fce4ec', '#ad1457');
writeRectPng('vertical.png', 320, 480, '#fff8e1', '#f57f17');

const thumbDir = join(outDir, 'c', '250x250');
mkdirSync(thumbDir, { recursive: true });
copyFileSync(join(outDir, 'cors-bonjour.png'), join(thumbDir, 'cors-bonjour.png'));
console.log('Wrote c/250x250/cors-bonjour.png (Pixiv-style thumb path)');
