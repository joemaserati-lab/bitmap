import { register, acquireBuffer } from './index';
import { clampByte } from './utils';

export const defaults = {
  thickness: 2,
  strength: 0.4,
  mode: 'mono'
};

export const heavy = false;

export function apply(img: ImageData, params: typeof defaults, _ctx: any, cache: Map<string, any>): ImageData {
  const { width, height } = img;
  const src = img.data;
  const out = acquireBuffer(cache, 'scanlines:out', src.length);
  const thickness = Math.max(1, Math.min(20, Math.round(Number(params.thickness ?? defaults.thickness))));
  const strength = Math.max(0, Math.min(1, Number(params.strength ?? defaults.strength)));
  const mode = params.mode === 'rgb' ? 'rgb' : 'mono';
  const attenuation = 1 - strength;
  for (let y = 0; y < height; y++) {
    const rowFactor = (y % (thickness * 2)) < thickness ? attenuation : 1;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (mode === 'rgb') {
        const rFactor = ((x + y) % (thickness * 2)) < thickness ? attenuation : 1;
        const gFactor = ((x + y + thickness) % (thickness * 2)) < thickness ? attenuation : 1;
        const bFactor = ((x + y + thickness * 2) % (thickness * 2)) < thickness ? attenuation : 1;
        out[idx] = clampByte(src[idx] * rFactor);
        out[idx + 1] = clampByte(src[idx + 1] * gFactor);
        out[idx + 2] = clampByte(src[idx + 2] * bFactor);
      } else {
        out[idx] = clampByte(src[idx] * rowFactor);
        out[idx + 1] = clampByte(src[idx + 1] * rowFactor);
        out[idx + 2] = clampByte(src[idx + 2] * rowFactor);
      }
      out[idx + 3] = src[idx + 3];
    }
  }
  return new ImageData(out, width, height);
}

register('scanlines', { apply, defaults, heavy });
