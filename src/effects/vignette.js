import { register, acquireBuffer } from './index.js';
import { clampByte } from './utils.js';

export const defaults = {
  strength: 0.5,
  radius: 0.75,
  centerX: 0.5,
  centerY: 0.5
};

export const heavy = false;

export function apply(img, params = defaults, _ctx, cache){
  const width = img.width;
  const height = img.height;
  const src = img.data;
  const out = acquireBuffer(cache, 'vignette:out', src.length);
  const strength = Math.max(0, Math.min(1, Number(params.strength ?? defaults.strength)));
  const radius = Math.max(0.1, Math.min(1, Number(params.radius ?? defaults.radius)));
  const cx = Math.max(0, Math.min(1, Number(params.centerX ?? defaults.centerX)));
  const cy = Math.max(0, Math.min(1, Number(params.centerY ?? defaults.centerY)));
  const centerPx = cx * width;
  const centerPy = cy * height;
  const maxDist = Math.hypot(Math.max(centerPx, width - centerPx), Math.max(centerPy, height - centerPy));
  const innerRadius = radius * maxDist;
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const dx = x - centerPx;
      const dy = y - centerPy;
      const dist = Math.hypot(dx, dy);
      const normalized = Math.max(0, Math.min(1, (dist - innerRadius) / Math.max(1, maxDist - innerRadius)));
      const falloff = normalized * normalized;
      const factor = 1 - strength * falloff;
      const idx = (y*width + x) * 4;
      out[idx] = clampByte(src[idx] * factor);
      out[idx+1] = clampByte(src[idx+1] * factor);
      out[idx+2] = clampByte(src[idx+2] * factor);
      out[idx+3] = src[idx+3];
    }
  }
  return new ImageData(out, width, height);
}

register('vignette', { apply, defaults, heavy });
