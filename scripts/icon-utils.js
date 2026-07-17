import { createRequire } from 'module';

const require = createRequire(import.meta.url);

let canvasModule;
try {
  canvasModule = require('canvas');
} catch {
  canvasModule = null;
}

export function createCanvas(size) {
  if (canvasModule) {
    return canvasModule.createCanvas(size, size);
  }
  return new MinimalCanvas(size);
}

class MinimalCanvas {
  width;
  height;
  #ctx;

  constructor(size) {
    this.width = size;
    this.height = size;
    this.#ctx = new MinimalContext(size);
  }

  getContext(type) {
    if (type === '2d') return this.#ctx;
    return null;
  }

  toBuffer(format) {
    if (format !== 'image/png') throw new Error('Only PNG supported');
    return createMinimalPng(this.width, this.height, this.#ctx.getPixels());
  }
}

class MinimalContext {
  #size;
  #pixels;
  fillStyle = '#000000';
  font = '10px sans-serif';
  textAlign = 'start';
  textBaseline = 'alphabetic';

  constructor(size) {
    this.#size = size;
    this.#pixels = new Uint8ClampedArray(size * size * 4);
  }

  fillRect(x, y, w, h) {
    const color = parseColor(this.fillStyle);
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        if (px >= 0 && py >= 0 && px < this.#size && py < this.#size) {
          const i = (py * this.#size + px) * 4;
          this.#pixels[i] = color.r;
          this.#pixels[i + 1] = color.g;
          this.#pixels[i + 2] = color.b;
          this.#pixels[i + 3] = 255;
        }
      }
    }
  }

  fillText(text, x, y) {
    const color = parseColor(this.fillStyle);
    const fontSize = parseInt(this.font, 10) || 10;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const half = Math.floor(fontSize / 2);
    for (let py = cy - half; py < cy + half; py++) {
      for (let px = cx - half; px < cx + half; px++) {
        if (px >= 0 && py >= 0 && px < this.#size && py < this.#size) {
          const i = (py * this.#size + px) * 4;
          this.#pixels[i] = color.r;
          this.#pixels[i + 1] = color.g;
          this.#pixels[i + 2] = color.b;
          this.#pixels[i + 3] = 255;
        }
      }
    }
  }

  getPixels() {
    return this.#pixels;
  }
}

function parseColor(css) {
  if (css.startsWith('#')) {
    const hex = css.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
      };
    }
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  return { r: 0, g: 0, b: 0 };
}

function createMinimalPng(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = createChunk('IHDR', (() => {
    const buf = Buffer.alloc(13);
    buf.writeUInt32BE(width, 0);
    buf.writeUInt32BE(height, 4);
    buf[8] = 8;
    buf[9] = 6;
    buf[10] = 0;
    buf[11] = 0;
    buf[12] = 0;
    return buf;
  })());

  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = y * (1 + width * 4) + 1 + x * 4;
      raw[di] = pixels[si];
      raw[di + 1] = pixels[si + 1];
      raw[di + 2] = pixels[si + 2];
      raw[di + 3] = pixels[si + 3];
    }
  }

  const zlib = require('zlib');
  const compressed = zlib.deflateSync(raw);
  const idat = createChunk('IDAT', compressed);
  const iend = createChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}
