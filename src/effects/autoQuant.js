import { register, acquireBuffer } from './index.js';

export const id = 'autoQuant';

export const defaults = {
  colors: 8,
  diffusion: false
};

const BURKES_KERNEL = {
  div: 32,
  taps: [
    { dx: 1, dy: 0, w: 8 },
    { dx: 2, dy: 0, w: 4 },
    { dx: -2, dy: 1, w: 2 },
    { dx: -1, dy: 1, w: 4 },
    { dx: 0, dy: 1, w: 8 },
    { dx: 1, dy: 1, w: 4 },
    { dx: 2, dy: 1, w: 2 }
  ]
};

function clampByte(value) {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value | 0;
}

function buildSignature(data) {
  let hash = 2166136261 >>> 0;
  const step = Math.max(1, Math.floor(data.length / 4096));
  for (let i = 0; i < data.length; i += step) {
    hash ^= data[i];
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function collectPixels(data, width, height) {
  const pixels = [];
  const step = Math.max(1, Math.floor((width * height) / 20000));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      pixels.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
  }
  return pixels;
}

function makeBox(pixels) {
  let rMin = 255, rMax = 0;
  let gMin = 255, gMax = 0;
  let bMin = 255, bMax = 0;
  for (const [r, g, b] of pixels) {
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    if (g < gMin) gMin = g;
    if (g > gMax) gMax = g;
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
  }
  return { pixels, rMin, rMax, gMin, gMax, bMin, bMax };
}

function splitBox(box) {
  const rRange = box.rMax - box.rMin;
  const gRange = box.gMax - box.gMin;
  const bRange = box.bMax - box.bMin;
  let channel = 0;
  if (gRange >= rRange && gRange >= bRange) channel = 1;
  else if (bRange >= rRange && bRange >= gRange) channel = 2;
  const sorted = box.pixels.slice().sort((a, b) => a[channel] - b[channel]);
  const mid = Math.max(1, Math.floor(sorted.length / 2));
  const left = sorted.slice(0, mid);
  const right = sorted.slice(mid);
  return [makeBox(left), makeBox(right)];
}

function averageColor(box) {
  let r = 0, g = 0, b = 0;
  const total = box.pixels.length || 1;
  for (const [cr, cg, cb] of box.pixels) {
    r += cr;
    g += cg;
    b += cb;
  }
  return [Math.round(r / total), Math.round(g / total), Math.round(b / total)];
}

function medianCut(pixels, target) {
  if (!pixels.length) return [[0, 0, 0], [255, 255, 255]];
  let boxes = [makeBox(pixels)];
  while (boxes.length < target) {
    boxes.sort((a, b) => {
      const aRange = Math.max(a.rMax - a.rMin, a.gMax - a.gMin, a.bMax - a.bMin);
      const bRange = Math.max(b.rMax - b.rMin, b.gMax - b.gMin, b.bMax - b.bMin);
      return bRange - aRange;
    });
    const box = boxes.shift();
    if (!box || box.pixels.length <= 1) {
      break;
    }
    const [left, right] = splitBox(box);
    boxes.push(left, right);
  }
  return boxes.map((box) => averageColor(box));
}

function findNearest(color, palette) {
  let best = 0;
  let minDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = color[0] - p[0];
    const dg = color[1] - p[1];
    const db = color[2] - p[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < minDist) {
      minDist = dist;
      best = i;
    }
  }
  return best;
}

export function apply(img, params, _ctx, cache) {
  const colorCount = Math.max(2, Math.min(256, Math.floor((params && params.colors) ?? defaults.colors)));
  const width = img.width;
  const height = img.height;
  const data = img.data;
  const signature = buildSignature(data);
  const cacheKey = `autoQuant:palette:${colorCount}:${width}x${height}:${signature}`;
  let palette = cache.get(cacheKey);
  if (!palette) {
    const pixels = collectPixels(data, width, height);
    palette = medianCut(pixels, colorCount);
    cache.set(cacheKey, palette);
  }
  const diffusion = params && params.diffusion !== undefined ? Boolean(params.diffusion) : defaults.diffusion;
  const out = acquireBuffer(cache, 'autoQuant:out', data.length);
  const errR = diffusion ? new Float32Array(width * height) : null;
  const errG = diffusion ? new Float32Array(width * height) : null;
  const errB = diffusion ? new Float32Array(width * height) : null;
  const serpentine = true;
  for (let y = 0; y < height; y++) {
    const dir = serpentine && (y & 1) ? -1 : 1;
    const start = dir === 1 ? 0 : width - 1;
    const end = dir === 1 ? width : -1;
    for (let x = start; x !== end; x += dir) {
      const idx = y * width + x;
      const base = idx * 4;
      let r = data[base];
      let g = data[base + 1];
      let b = data[base + 2];
      if (diffusion && errR && errG && errB) {
        r = clampByte(r + errR[idx]);
        g = clampByte(g + errG[idx]);
        b = clampByte(b + errB[idx]);
      }
      const chosen = palette[findNearest([r, g, b], palette)];
      out[base] = chosen[0];
      out[base + 1] = chosen[1];
      out[base + 2] = chosen[2];
      out[base + 3] = data[base + 3];
      if (!diffusion || !errR || !errG || !errB) continue;
      const errValR = r - chosen[0];
      const errValG = g - chosen[1];
      const errValB = b - chosen[2];
      for (const tap of BURKES_KERNEL.taps) {
        const nx = x + (dir === 1 ? tap.dx : -tap.dx);
        const ny = y + tap.dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const target = ny * width + nx;
        errR[target] += (errValR * tap.w) / BURKES_KERNEL.div;
        errG[target] += (errValG * tap.w) / BURKES_KERNEL.div;
        errB[target] += (errValB * tap.w) / BURKES_KERNEL.div;
      }
    }
  }
  return new ImageData(out, width, height);
}

register(id, {
  apply,
  defaults,
  heavy: true
});
