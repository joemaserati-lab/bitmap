import { register, acquireBuffer } from './index';
import { luminance } from './utils';

export const id = 'dotDiffusion';

export const defaults = {
  classMask: 'knuth' as 'knuth' | 'ulichney',
  strength: 1
};

type ClassMask = number[][];

const DOT_DIFFUSION_MASKS: Record<string, ClassMask> = {
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

function buildClassMask(size: number, seed: number): ClassMask {
  const values = new Array<number>(size * size);
  for (let i = 0; i < values.length; i++) values[i] = i;
  shuffle(values, seed);
  const mask: number[][] = new Array(size);
  for (let y = 0; y < size; y++) {
    const row = new Array<number>(size);
    for (let x = 0; x < size; x++) {
      row[x] = values[y * size + x];
    }
    mask[y] = row;
  }
  return mask;
}

function shuffle(values: number[], seed: number): void {
  let s = seed >>> 0;
  for (let i = values.length - 1; i > 0; i--) {
    s = mulberry32Step(s);
    const j = Math.floor((s / 4294967296) * (i + 1));
    const tmp = values[i];
    values[i] = values[j];
    values[j] = tmp;
  }
}

function mulberry32Step(seed: number): number {
  let t = seed + 0x6D2B79F5;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
  return (t ^ (t >>> 14)) >>> 0;
}

export function apply(
  img: ImageData,
  params: typeof defaults,
  _ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null,
  cache: Map<string, any>
): ImageData {
  const maskKey = params?.classMask === 'ulichney' ? 'ulichney' : 'knuth';
  const mask = DOT_DIFFUSION_MASKS[maskKey];
  const maskSize = mask.length;
  let maxClass = 0;
  for (let y = 0; y < maskSize; y++) {
    for (let x = 0; x < maskSize; x++) {
      if (mask[y][x] > maxClass) maxClass = mask[y][x];
    }
  }
  const strength = Math.max(0, Number(params?.strength ?? defaults.strength));
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
        out[idx * 4] = out[idx * 4 + 1] = out[idx * 4 + 2] = value;
        out[idx * 4 + 3] = src[idx * 4 + 3];
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

function mod(n: number, base: number): number {
  return ((n % base) + base) % base;
}

register(id, {
  apply,
  defaults,
  heavy: true
});
