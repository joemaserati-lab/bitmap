import type { EffectFn } from './index';

export function clampByte(value: number): number {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value | 0;
}

export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function getReusableImageData(
  cache: Map<string, any>,
  key: string,
  width: number,
  height: number
): ImageData {
  const reuse = cache.get(key);
  const length = width * height * 4;
  if (reuse instanceof ImageData && reuse.width === width && reuse.height === height) {
    return reuse;
  }
  if (reuse instanceof Uint8ClampedArray && reuse.length === length) {
    return new ImageData(reuse, width, height);
  }
  const buf = new Uint8ClampedArray(length);
  return new ImageData(buf, width, height);
}

export function ensureImageData(img: ImageData): ImageData {
  if (img instanceof ImageData) return img;
  return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function createSampleAccessor(data: Uint8ClampedArray, width: number, height: number) {
  return function sample(x: number, y: number) {
    const clampedX = Math.max(0, Math.min(width - 1, x));
    const clampedY = Math.max(0, Math.min(height - 1, y));
    const ix = Math.floor(clampedX);
    const iy = Math.floor(clampedY);
    const fx = clampedX - ix;
    const fy = clampedY - iy;

    const stride = width * 4;
    const i00 = iy * stride + ix * 4;
    const i10 = i00 + 4;
    const i01 = i00 + stride;
    const i11 = i01 + 4;

    const w00 = (1 - fx) * (1 - fy);
    const w10 = fx * (1 - fy);
    const w01 = (1 - fx) * fy;
    const w11 = fx * fy;

    const r = data[i00] * w00 + data[i10] * w10 + data[i01] * w01 + data[i11] * w11;
    const g = data[i00 + 1] * w00 + data[i10 + 1] * w10 + data[i01 + 1] * w01 + data[i11 + 1] * w11;
    const b = data[i00 + 2] * w00 + data[i10 + 2] * w10 + data[i01 + 2] * w01 + data[i11 + 2] * w11;
    const a = data[i00 + 3] * w00 + data[i10 + 3] * w10 + data[i01 + 3] * w01 + data[i11 + 3] * w11;

    return [r, g, b, a];
  };
}

export type EffectDefinition = {
  name: string;
  defaults: Record<string, any>;
  heavy?: boolean;
  apply: EffectFn;
};
