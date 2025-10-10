import { register, acquireBuffer } from './index.js';
import { clampByte, luminance } from './utils.js';

export const defaults = {
  lowColor: [0, 0, 0],
  highColor: [255, 255, 255],
  mix: 1
};

export const heavy = false;

export function apply(img, params = defaults, _ctx, cache){
  const width = img.width;
  const height = img.height;
  const src = img.data;
  const out = acquireBuffer(cache, 'duotone:out', src.length);
  const lc = Array.isArray(params.lowColor) ? params.lowColor : defaults.lowColor;
  const hc = Array.isArray(params.highColor) ? params.highColor : defaults.highColor;
  const mix = Math.max(0, Math.min(1, Number(params.mix ?? defaults.mix)));
  for(let i=0;i<src.length;i+=4){
    const L = luminance(src[i], src[i+1], src[i+2]);
    const t = (L/255) * mix;
    out[i] = clampByte(lc[0] + (hc[0]-lc[0]) * t);
    out[i+1] = clampByte(lc[1] + (hc[1]-lc[1]) * t);
    out[i+2] = clampByte(lc[2] + (hc[2]-lc[2]) * t);
    out[i+3] = src[i+3];
  }
  return new ImageData(out, width, height);
}

register('duotone', { apply, defaults, heavy });
