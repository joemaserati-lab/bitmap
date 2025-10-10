import { register, acquireBuffer } from './index';
import { clampByte, createSampleAccessor } from './utils';

export const defaults = {
  offsetR: { x: 3, y: 0 },
  offsetG: { x: 0, y: 0 },
  offsetB: { x: -3, y: 0 },
  feather: 0.35
};

export const heavy = false;

function normalizeOffset(offset: any) {
  if (!offset || typeof offset !== 'object') {
    return { x: 0, y: 0 };
  }
  return {
    x: Number.isFinite(offset.x) ? offset.x : 0,
    y: Number.isFinite(offset.y) ? offset.y : 0
  };
}

export function apply(img: ImageData, params: typeof defaults, _ctx: any, cache: Map<string, any>): ImageData {
  const width = img.width;
  const height = img.height;
  const src = img.data;
  const out = acquireBuffer(cache, 'rgbsplit:out', src.length);
  const sample = createSampleAccessor(src, width, height);
  const offsetR = normalizeOffset(params.offsetR);
  const offsetG = normalizeOffset(params.offsetG);
  const offsetB = normalizeOffset(params.offsetB);
  const feather = Math.max(0, Math.min(1, Number(params.feather ?? defaults.feather)));
  const centerX = width / 2;
  const centerY = height / 2;
  const maxDist = Math.hypot(centerX, centerY);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dist = Math.hypot(x - centerX, y - centerY);
      const blend = feather > 0 ? Math.max(0, 1 - (dist / maxDist) * feather) : 1;
      const idx = (y * width + x) * 4;
      const r = sample(x + offsetR.x * blend, y + offsetR.y * blend);
      const g = sample(x + offsetG.x * blend, y + offsetG.y * blend);
      const b = sample(x + offsetB.x * blend, y + offsetB.y * blend);
      out[idx] = clampByte(r[0]);
      out[idx + 1] = clampByte(g[1]);
      out[idx + 2] = clampByte(b[2]);
      out[idx + 3] = src[idx + 3];
    }
  }
  return new ImageData(out, width, height);
}

register('rgbSplit', { apply, defaults, heavy });
