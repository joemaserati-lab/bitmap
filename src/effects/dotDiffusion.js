import { register, acquireBuffer } from './index.js';
import { luminance } from './utils.js';

export const id = 'dotDiffusion';

export const defaults = {
  classMask: 'knuth',
  strength: 1
};

const DOT_DIFFUSION_MASKS = {
  knuth: buildClassMask(8, 0x1234abcd),
  ulichney: buildClassMask(8, 0x8badf00d)
};

const DOT_NEIGHBORS = [
  { dx: 1, dy: 0, w: 4 },
  { dx: 1, dy: 1, w: 2 },
  { dx: 0, dy: 1, w: 4 },
  { dx: -1, dy: 1, w: 2 },
  { dx: -1, dy: 0, w: 4 },
  { dx: -1, dy: -1, w: 1 },
  { dx: 0, dy: -1, w: 2 },
  { dx: 1, dy: -1, w: 1 }
];

const DOT_WEIGHT_SUM = DOT_NEIGHBORS.reduce((sum, n) => sum + n.w, 0);

function buildClassMask(size, seed) {
  const values = new Array(size * size);
  for (let i = 0; i < values.length; i++) values[i] = i;
  shuffle(values, seed);
  const mask = new Array(size);
  for (let y = 0; y < size; y++) {
    const row = new Array(size);
    for (let x = 0; x < size; x++) {
      row[x] = values[y * size + x];
    }
    mask[y] = row;
  }
  return mask;
}

function shuffle(values, seed) {
  let s = seed >>> 0;
  for (let i = values.length - 1; i > 0; i--) {
    s = mulberry32Step(s);
    const j = Math.floor((s / 4294967296) * (i + 1));
    const tmp = values[i];
    values[i] = values[j];
    values[j] = tmp;
  }
}

function mulberry32Step(seed) {
  let t = seed + 0x6D2B79F5;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
  return (t ^ (t >>> 14)) >>> 0;
}

export function apply(img, params, _ctx, cache) {
  const maskKey = params && params.classMask === 'ulichney' ? 'ulichney' : 'knuth';
  const mask = DOT_DIFFUSION_MASKS[maskKey];
  const maskSize = mask.length;
  let maxClass = 0;
  for (let y = 0; y < maskSize; y++) {
    for (let x = 0; x < maskSize; x++) {
      if (mask[y][x] > maxClass) maxClass = mask[y][x];
    }
  }
  const strength = Math.max(0, Number((params && params.strength) ?? defaults.strength));
  const width = img.width;
  const height = img.height;
  const src = img.data;
  const buffer = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      buffer[y * width + x] = luminance(src[idx], src[idx + 1], src[idx + 2]);
    }
  }
  const out = acquireBuffer(cache, 'dotDiffusion:out', src.length);
  const errorBuffer = new Float32Array(width * height);
  for (let c = 0; c <= maxClass; c++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const maskVal = mask[y % maskSize][x % maskSize];
        if (maskVal !== c) continue;
        const idx = y * width + x;
        const base = buffer[idx] + errorBuffer[idx];
        const value = base >= 128 ? 255 : 0;
        const err = (base - value) * strength;
        const outIdx = idx * 4;
        out[outIdx] = out[outIdx + 1] = out[outIdx + 2] = value;
        out[outIdx + 3] = src[outIdx + 3];
        if (err === 0) continue;
        for (const tap of DOT_NEIGHBORS) {
          const nx = x + tap.dx;
          const ny = y + tap.dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nextClass = mask[mod(ny, maskSize)][mod(nx, maskSize)];
          if (nextClass <= c) continue;
          const target = ny * width + nx;
          errorBuffer[target] += (err * tap.w) / DOT_WEIGHT_SUM;
        }
      }
    }
  }
  return new ImageData(out, width, height);
}

function mod(n, base) {
  return ((n % base) + base) % base;
}

register(id, {
  apply,
  defaults,
  heavy: true
});
