import { register, acquireBuffer } from './index.js';
import { luminance } from './utils.js';

export const id = 'hatching';

export const defaults = {
  levels: 5,
  angles: [0, 45, 90, 135],
  densityCurve: 'linear'
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseAngles(input) {
  if (Array.isArray(input) && input.length) {
    return input.map((val) => Number(val) || 0);
  }
  return defaults.angles;
}

function curve(value, mode) {
  if (mode === 'ease') {
    return value * value * (3 - 2 * value);
  }
  return value;
}

export function apply(img, params, _ctx, cache) {
  const levels = Math.max(1, Math.floor((params && params.levels) ?? defaults.levels));
  const angles = parseAngles(params && params.angles);
  const curveMode = params && params.densityCurve === 'ease' ? 'ease' : 'linear';
  const width = img.width;
  const height = img.height;
  const src = img.data;
  const dst = acquireBuffer(cache, 'hatching:out', src.length);
  const baseCell = 6;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const L = luminance(src[idx], src[idx + 1], src[idx + 2]) / 255;
      const intensity = curve(1 - L, curveMode);
      const activeLevels = Math.floor(intensity * levels);
      let ink = 0;
      for (let level = 0; level < activeLevels; level++) {
        const angle = angles[level % angles.length] || 0;
        const rad = (angle * Math.PI) / 180;
        const cosA = Math.cos(rad);
        const sinA = Math.sin(rad);
        const freq = baseCell + level * 2;
        const pos = (x * cosA - y * sinA) / freq;
        const dist = Math.abs(pos - Math.round(pos));
        if (dist < 0.25) {
          ink++;
        }
      }
      const color = ink > 0 ? 0 : 255;
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
