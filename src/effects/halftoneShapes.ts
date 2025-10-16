import { register, acquireBuffer } from './index';
import { luminance } from './utils';

export const id = 'halftoneShapes';

export const defaults = {
  shape: 'circle' as 'circle' | 'square' | 'diamond' | 'triangle' | 'hex',
  angle: 45,
  minSize: 0.1,
  maxSize: 0.6,
  jitter: 0.1,
  seed: 1337
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function pseudoNoise(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 0.002) * 43758.5453;
  return n - Math.floor(n);
}

function shapeMask(shape: string, dx: number, dy: number, size: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  switch (shape) {
    case 'square':
      return ax <= size && ay <= size ? 1 : 0;
    case 'diamond':
      return ax + ay <= size ? 1 : 0;
    case 'triangle':
      return dy >= -size && ax <= size - dy ? 1 : 0;
    case 'hex': {
      const qx = ax;
      const qy = ay * 0.57735 + ax * 0.5;
      return qx <= size && qy <= size ? 1 : 0;
    }
    default:
      return Math.sqrt(dx * dx + dy * dy) <= size ? 1 : 0;
  }
}

export function apply(
  img: ImageData,
  params: typeof defaults,
  _ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null,
  cache: Map<string, any>
): ImageData {
  const shape = params?.shape || defaults.shape;
  const angle = Number(params?.angle ?? defaults.angle) || 0;
  const minSize = clamp(Number(params?.minSize ?? defaults.minSize), 0.05, 1.5);
  const maxSize = clamp(Number(params?.maxSize ?? defaults.maxSize), minSize, 2);
  const jitter = clamp(Number(params?.jitter ?? defaults.jitter), 0, 1);
  const seed = Number(params?.seed ?? defaults.seed) || 0;
  const width = img.width;
  const height = img.height;
  const src = img.data;
  const dst = acquireBuffer(cache, 'halftoneShapes:out', src.length);
  const rad = (angle * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const cell = 8;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const L = luminance(src[idx], src[idx + 1], src[idx + 2]) / 255;
      const level = 1 - L;
      const baseSize = mix(minSize, maxSize, level);
      const noise = pseudoNoise(x, y, seed) * 2 - 1;
      const jitterSize = baseSize * (1 + noise * jitter);
      const rx = (x * cosA - y * sinA) / cell;
      const ry = (x * sinA + y * cosA) / cell;
      const fx = rx - Math.floor(rx);
      const fy = ry - Math.floor(ry);
      const dx = fx - 0.5;
      const dy = fy - 0.5;
      const value = shapeMask(shape, dx, dy, clamp(jitterSize, 0.02, 0.8));
      const color = value ? 0 : 255;
      dst[idx] = dst[idx + 1] = dst[idx + 2] = color;
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
