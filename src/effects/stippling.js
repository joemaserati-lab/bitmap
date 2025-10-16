import { register, acquireBuffer } from './index.js';
import { luminance } from './utils.js';

export const id = 'stippling';

export const defaults = {
  minR: 1,
  maxR: 3,
  density: 1
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawDisc(buffer, width, height, cx, cy, radius) {
  const r2 = radius * radius;
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(height - 1, Math.ceil(cy + radius));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        const idx = (y * width + x) * 4;
        buffer[idx] = buffer[idx + 1] = buffer[idx + 2] = 0;
        buffer[idx + 3] = 255;
      }
    }
  }
}

export function apply(img, params, _ctx, cache) {
  const width = img.width;
  const height = img.height;
  const src = img.data;
  const dst = acquireBuffer(cache, 'stippling:out', src.length);
  dst.fill(255);
  for (let i = 3; i < dst.length; i += 4) {
    dst[i] = src[i];
  }
  const minR = clamp(Number((params && params.minR) ?? defaults.minR), 0.5, 10);
  const maxR = clamp(Number((params && params.maxR) ?? defaults.maxR), minR, 12);
  const density = clamp(Number((params && params.density) ?? defaults.density), 0.1, 4);
  const rng = mulberry32(width * 73856093 ^ height * 19349663);
  const samples = Math.floor(width * height * 0.0025 * density);
  for (let i = 0; i < samples; i++) {
    const x = Math.floor(rng() * width);
    const y = Math.floor(rng() * height);
    const idx = (y * width + x) * 4;
    const L = luminance(src[idx], src[idx + 1], src[idx + 2]) / 255;
    const probability = clamp(1 - L, 0, 1);
    if (rng() > probability) continue;
    const radius = minR + (maxR - minR) * rng();
    drawDisc(dst, width, height, x, y, radius);
  }
  return new ImageData(dst, width, height);
}

register(id, {
  apply,
  defaults,
  heavy: true
});
