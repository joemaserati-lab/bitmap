import { register, acquireBuffer } from './index';
import { luminance } from './utils';

export const id = 'blueNoise';

export const defaults = {
  scale: 1,
  contrast: 1,
  bias: 0
};

let mask: number[][] | null = null;

function generateFallbackMask(): number[][] {
  const size = 64;
  const values: number[][] = new Array(size);
  const rng = mulberry32(0x6d6f6465);
  for (let y = 0; y < size; y++) {
    const row = new Array<number>(size);
    for (let x = 0; x < size; x++) {
      row[x] = rng();
    }
    values[y] = row;
  }
  const blurKernel = [
    [0.25, 0.5, 0.25],
    [0.5, 1, 0.5],
    [0.25, 0.5, 0.25]
  ];
  for (let pass = 0; pass < 4; pass++) {
    const blurred = new Array<number[]>(size);
    for (let y = 0; y < size; y++) {
      const row = new Array<number>(size);
      for (let x = 0; x < size; x++) {
        let acc = 0;
        let weight = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const ny = (y + ky + size) % size;
            const nx = (x + kx + size) % size;
            const w = blurKernel[ky + 1][kx + 1];
            acc += values[ny][nx] * w;
            weight += w;
          }
        }
        row[x] = weight > 0 ? acc / weight : values[y][x];
      }
      blurred[y] = row;
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const diff = values[y][x] - blurred[y][x];
        values[y][x] = values[y][x] + diff * 0.7;
      }
    }
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = values[y][x];
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const normalized = new Array<number[]>(size);
  const range = max - min || 1;
  for (let y = 0; y < size; y++) {
    const row = new Array<number>(size);
    for (let x = 0; x < size; x++) {
      row[x] = Math.round(((values[y][x] - min) / range) * 255);
    }
    normalized[y] = row;
  }
  return normalized;
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function () {
    t |= 0;
    t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

async function loadMask(): Promise<void> {
  if (mask) return;
  try {
    const url = new URL('../../assets/masks/blue64.json', import.meta.url);
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to load blue noise mask');
    const data = await response.json();
    if (Array.isArray(data) && Array.isArray(data[0])) {
      mask = data as number[][];
      return;
    }
  } catch (err) {
    console.warn('[blueNoise] fallback mask in use', err);
  }
  if (!mask) {
    mask = generateFallbackMask();
  }
}

loadMask();

export function apply(
  img: ImageData,
  params: typeof defaults,
  _ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null,
  cache: Map<string, any>
): ImageData {
  if (!mask) {
    mask = generateFallbackMask();
  }
  const width = img.width;
  const height = img.height;
  const src = img.data;
  const dst = acquireBuffer(cache, 'blueNoise:out', src.length);
  const scale = Math.max(0.125, Number(params?.scale ?? defaults.scale) || 1);
  const contrast = Math.max(0.1, Number(params?.contrast ?? defaults.contrast) || 1);
  const bias = Number(params?.bias ?? defaults.bias) || 0;
  const maskSize = mask.length || 64;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const L = luminance(src[idx], src[idx + 1], src[idx + 2]);
      const mx = Math.floor(((x * scale) % maskSize + maskSize) % maskSize);
      const my = Math.floor(((y * scale) % maskSize + maskSize) % maskSize);
      const threshold = mask[my][mx] * contrast + bias;
      const value = L > threshold ? 255 : 0;
      dst[idx] = dst[idx + 1] = dst[idx + 2] = value;
      dst[idx + 3] = src[idx + 3];
    }
  }
  return new ImageData(dst, width, height);
}

register(id, {
  apply,
  defaults,
  heavy: false
});
