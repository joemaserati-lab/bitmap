import { register, acquireBuffer } from './index';
import { clampByte, createSampleAccessor } from './utils';

export const defaults = {
  amp: 8,
  freq: 0.05,
  dir: 'x'
};

export const heavy = false;

export function apply(img: ImageData, params: typeof defaults, _ctx: any, cache: Map<string, any>): ImageData {
  const width = img.width;
  const height = img.height;
  const src = img.data;
  const out = acquireBuffer(cache, 'wave:out', src.length);
  const amp = Number(params.amp ?? defaults.amp);
  const freq = Number(params.freq ?? defaults.freq);
  const dir = params.dir === 'y' ? 'y' : 'x';
  const sample = createSampleAccessor(src, width, height);
  const waveAmp = Math.max(-200, Math.min(200, amp));
  const frequency = Math.max(0.001, Math.min(1, freq));
  if (dir === 'x') {
    for (let y = 0; y < height; y++) {
      const offset = Math.sin(y * frequency) * waveAmp;
      for (let x = 0; x < width; x++) {
        const rgba = sample(x + offset, y);
        const idx = (y * width + x) * 4;
        out[idx] = clampByte(rgba[0]);
        out[idx + 1] = clampByte(rgba[1]);
        out[idx + 2] = clampByte(rgba[2]);
        out[idx + 3] = clampByte(rgba[3]);
      }
    }
  } else {
    for (let x = 0; x < width; x++) {
      const offset = Math.sin(x * frequency) * waveAmp;
      for (let y = 0; y < height; y++) {
        const rgba = sample(x, y + offset);
        const idx = (y * width + x) * 4;
        out[idx] = clampByte(rgba[0]);
        out[idx + 1] = clampByte(rgba[1]);
        out[idx + 2] = clampByte(rgba[2]);
        out[idx + 3] = clampByte(rgba[3]);
      }
    }
  }
  return new ImageData(out, width, height);
}

register('wave', { apply, defaults, heavy });
