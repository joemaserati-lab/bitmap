import { register, acquireBuffer } from './index';
import { clampByte, luminance } from './utils';

export const defaults = {
  threshold: 0.6,
  radius: 8,
  intensity: 0.4
};

export const heavy = false;

function applyBoxBlur(buffer: Float32Array, temp: Float32Array, width: number, height: number, radius: number) {
  const kernel = Math.max(1, Math.round(radius));
  const kernelSize = kernel * 2 + 1;
  const inv = 1 / kernelSize;
  // horizontal
  for (let y = 0; y < height; y++) {
    let acc = 0;
    let offset = y * width;
    for (let k = -kernel; k <= kernel; k++) {
      const x = Math.min(width - 1, Math.max(0, k));
      acc += buffer[offset + x];
    }
    for (let x = 0; x < width; x++) {
      temp[offset + x] = acc * inv;
      const left = x - kernel;
      const right = x + kernel + 1;
      if (left >= 0) acc -= buffer[offset + left];
      const rIdx = right < width ? right : width - 1;
      acc += buffer[offset + rIdx];
    }
  }
  // vertical
  for (let x = 0; x < width; x++) {
    let acc = 0;
    for (let k = -kernel; k <= kernel; k++) {
      const y = Math.min(height - 1, Math.max(0, k));
      acc += temp[y * width + x];
    }
    for (let y = 0; y < height; y++) {
      buffer[y * width + x] = acc * inv;
      const top = y - kernel;
      const bottom = y + kernel + 1;
      if (top >= 0) acc -= temp[top * width + x];
      const bIdx = bottom < height ? bottom : height - 1;
      acc += temp[bIdx * width + x];
    }
  }
}

export function apply(img: ImageData, params: typeof defaults, _ctx: any, cache: Map<string, any>): ImageData {
  const width = img.width;
  const height = img.height;
  const size = width * height;
  const src = img.data;
  const out = acquireBuffer(cache, 'bloom:out', src.length);
  const threshold = Math.max(0, Math.min(1, Number(params.threshold ?? defaults.threshold))) * 255;
  const radius = Math.max(1, Math.min(50, Number(params.radius ?? defaults.radius)));
  const intensity = Math.max(0, Math.min(1, Number(params.intensity ?? defaults.intensity)));
  const lumBuffer = cache.get('bloom:lum') instanceof Float32Array && cache.get('bloom:lum').length === size
    ? cache.get('bloom:lum') as Float32Array
    : new Float32Array(size);
  const tempBuffer = cache.get('bloom:tmp') instanceof Float32Array && cache.get('bloom:tmp').length === size
    ? cache.get('bloom:tmp') as Float32Array
    : new Float32Array(size);
  cache.set('bloom:lum', lumBuffer);
  cache.set('bloom:tmp', tempBuffer);
  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    const lum = luminance(src[i], src[i + 1], src[i + 2]);
    lumBuffer[p] = lum > threshold ? (lum - threshold) : 0;
  }
  applyBoxBlur(lumBuffer, tempBuffer, width, height, radius);
  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    const bloom = lumBuffer[p] * intensity / 255;
    out[i] = clampByte(src[i] + bloom * 255);
    out[i + 1] = clampByte(src[i + 1] + bloom * 255);
    out[i + 2] = clampByte(src[i + 2] + bloom * 255);
    out[i + 3] = src[i + 3];
  }
  return new ImageData(out, width, height);
}

register('bloom', { apply, defaults, heavy });
