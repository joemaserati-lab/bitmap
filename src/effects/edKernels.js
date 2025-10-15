import { register, acquireBuffer } from './index.js';
import { luminance } from './utils.js';

export const id = 'edKernels';

export const defaults = {
  kernel: 'sierraLite',
  serpentine: true,
  clip: true,
  gain: 1
};

const KERNELS = {
  sierraLite: {
    div: 4,
    taps: [
      { dx: 1, dy: 0, w: 2 },
      { dx: 2, dy: 0, w: 1 },
      { dx: -1, dy: 1, w: 1 },
      { dx: 0, dy: 1, w: 2 },
      { dx: 1, dy: 1, w: 1 }
    ]
  },
  twoRowSierra: {
    div: 32,
    taps: [
      { dx: 1, dy: 0, w: 4 },
      { dx: 2, dy: 0, w: 5 },
      { dx: 3, dy: 0, w: 4 },
      { dx: -2, dy: 1, w: 2 },
      { dx: -1, dy: 1, w: 3 },
      { dx: 0, dy: 1, w: 4 },
      { dx: 1, dy: 1, w: 3 },
      { dx: 2, dy: 1, w: 2 }
    ]
  },
  stevensonArce: {
    div: 200,
    taps: [
      { dx: 2, dy: 0, w: 32 },
      { dx: 3, dy: 0, w: 12 },
      { dx: 4, dy: 0, w: 26 },
      { dx: 5, dy: 0, w: 12 },
      { dx: 6, dy: 0, w: 32 },
      { dx: -2, dy: 1, w: 12 },
      { dx: -1, dy: 1, w: 26 },
      { dx: 1, dy: 1, w: 26 },
      { dx: 2, dy: 1, w: 12 }
    ]
  },
  shiauFan: {
    div: 16,
    taps: [
      { dx: 1, dy: 0, w: 4 },
      { dx: 2, dy: 0, w: 3 },
      { dx: -1, dy: 1, w: 3 },
      { dx: 0, dy: 1, w: 2 },
      { dx: 1, dy: 1, w: 3 },
      { dx: 2, dy: 1, w: 1 }
    ]
  }
};

function getKernel(name) {
  return KERNELS[name] || KERNELS.sierraLite;
}

export function apply(img, params, _ctx, cache) {
  const kernel = getKernel(params && params.kernel ? params.kernel : defaults.kernel);
  const serpentine = params && params.serpentine !== undefined ? Boolean(params.serpentine) : defaults.serpentine;
  const clip = params && params.clip !== undefined ? Boolean(params.clip) : defaults.clip;
  const gain = Math.max(0, Number((params && params.gain) ?? defaults.gain));
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
  const error = new Float32Array(width * height);
  const out = acquireBuffer(cache, 'edKernels:out', src.length);
  for (let y = 0; y < height; y++) {
    const dir = serpentine && (y & 1) ? -1 : 1;
    const start = dir === 1 ? 0 : width - 1;
    const end = dir === 1 ? width : -1;
    for (let x = start; x !== end; x += dir) {
      const idx = y * width + x;
      const base = buffer[idx] + error[idx];
      const value = base >= 128 ? 255 : 0;
      const err = (base - value) * gain;
      const outIdx = idx * 4;
      out[outIdx] = out[outIdx + 1] = out[outIdx + 2] = value;
      out[outIdx + 3] = src[outIdx + 3];
      if (err === 0) continue;
      for (const tap of kernel.taps) {
        const nx = x + (dir === 1 ? tap.dx : -tap.dx);
        const ny = y + tap.dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const target = ny * width + nx;
        error[target] += (err * tap.w) / kernel.div;
        if (clip) {
          if (error[target] > 255) error[target] = 255;
          else if (error[target] < -255) error[target] = -255;
        }
      }
    }
  }
  return new ImageData(out, width, height);
}

register(id, {
  apply,
  defaults,
  heavy: false
});
