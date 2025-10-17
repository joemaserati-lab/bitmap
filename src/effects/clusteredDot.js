import { register, acquireBuffer } from './index.js';
import { luminance } from './utils.js';

export const id = 'clusteredDot';

export const defaults = {
  size: 8,
  angle: 45,
  gain: 1
};

const CLUSTER_CACHE = new Map();

function buildClusterMap(size) {
  const cached = CLUSTER_CACHE.get(size);
  if (cached) return cached;
  const center = (size - 1) / 2;
  const entries = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx);
      entries.push({ x, y, weight: dist, angle: ang });
    }
  }
  entries.sort((a, b) => {
    if (a.weight === b.weight) {
      return a.angle - b.angle;
    }
    return a.weight - b.weight;
  });
  const total = size * size;
  const matrix = new Array(size);
  for (let y = 0; y < size; y++) {
    matrix[y] = new Array(size).fill(0);
  }
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    matrix[entry.y][entry.x] = Math.round((i / (total - 1)) * 255);
  }
  CLUSTER_CACHE.set(size, matrix);
  return matrix;
}

function rotateCoordinate(x, y, cosA, sinA) {
  return {
    x: x * cosA - y * sinA,
    y: x * sinA + y * cosA
  };
}

function mod(n, base) {
  return ((n % base) + base) % base;
}

export function apply(img, params, _ctx, cache) {
  const size = params && (params.size === 4 || params.size === 8) ? params.size : defaults.size;
  const angleDeg = Number((params && params.angle) ?? defaults.angle) || 0;
  const gain = Math.max(0.1, Number((params && params.gain) ?? defaults.gain) || 1);
  const map = buildClusterMap(size);
  const width = img.width;
  const height = img.height;
  const src = img.data;
  const out = acquireBuffer(cache, 'clusteredDot:out', src.length);
  const cosA = Math.cos((angleDeg * Math.PI) / 180);
  const sinA = Math.sin((angleDeg * Math.PI) / 180);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const L = luminance(src[idx], src[idx + 1], src[idx + 2]);
      const rotated = rotateCoordinate(x / size, y / size, cosA, sinA);
      const cellX = mod(Math.floor(rotated.x * size), size);
      const cellY = mod(Math.floor(rotated.y * size), size);
      const threshold = map[cellY][cellX] * gain;
      const value = L > threshold ? 255 : 0;
      out[idx] = out[idx + 1] = out[idx + 2] = value;
      out[idx + 3] = src[idx + 3];
    }
  }
  return new ImageData(out, width, height);
}

register(id, {
  apply,
  defaults,
  heavy: false
});
