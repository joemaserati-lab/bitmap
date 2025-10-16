import { register, acquireBuffer } from './index';
import { luminance } from './utils';

export const id = 'clusteredDot';

export const defaults = {
  size: 8 as 4 | 8,
  angle: 45,
  gain: 1
};

type ThresholdMap = number[][];

const CLUSTER_CACHE = new Map<number, ThresholdMap>();

function buildClusterMap(size: number): ThresholdMap {
  const cached = CLUSTER_CACHE.get(size);
  if (cached) return cached;
  const center = (size - 1) / 2;
  const entries: { x: number; y: number; weight: number; angle: number }[] = [];
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
  const matrix: number[][] = new Array(size);
  for (let y = 0; y < size; y++) {
    matrix[y] = new Array<number>(size).fill(0);
  }
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    matrix[entry.y][entry.x] = Math.round((i / (total - 1)) * 255);
  }
  CLUSTER_CACHE.set(size, matrix);
  return matrix;
}

function rotateCoordinate(x: number, y: number, cosA: number, sinA: number): { x: number; y: number } {
  return {
    x: x * cosA - y * sinA,
    y: x * sinA + y * cosA
  };
}

function mod(n: number, base: number): number {
  return ((n % base) + base) % base;
}

export function apply(
  img: ImageData,
  params: typeof defaults,
  _ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null,
  cache: Map<string, any>
): ImageData {
  const size = (params?.size === 4 || params?.size === 8) ? params.size : defaults.size;
  const angleDeg = Number(params?.angle ?? defaults.angle) || 0;
  const gain = Math.max(0.1, Number(params?.gain ?? defaults.gain) || 1);
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
