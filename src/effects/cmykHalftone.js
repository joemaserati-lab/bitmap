import { register, acquireBuffer } from './index.js';

export const id = 'cmykHalftone';

export const defaults = {
  angles: { C: 15, M: 75, Y: 0, K: 45 },
  dotScale: 1,
  ucr: 0.2
};

const CHANNELS = ['C', 'M', 'Y', 'K'];

function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function toCMYK(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k >= 1) {
    return { C: 0, M: 0, Y: 0, K: 1 };
  }
  const denom = 1 - k || 1;
  return {
    C: (1 - rn - k) / denom,
    M: (1 - gn - k) / denom,
    Y: (1 - bn - k) / denom,
    K: k
  };
}

function applyUCR(values, amount) {
  const u = clamp01(amount);
  const black = values.K;
  const reduction = black * u;
  return {
    C: clamp01(values.C - reduction),
    M: clamp01(values.M - reduction),
    Y: clamp01(values.Y - reduction),
    K: clamp01(black)
  };
}

function halftoneDot(x, y, angle, scale, value) {
  const rad = (angle * Math.PI) / 180;
  const cell = Math.max(4, 8 * scale);
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const rx = (x * cosA - y * sinA) / cell;
  const ry = (x * sinA + y * cosA) / cell;
  const fx = rx - Math.floor(rx);
  const fy = ry - Math.floor(ry);
  const dx = fx - 0.5;
  const dy = fy - 0.5;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const radius = clamp01(value) * 0.45 + 0.05;
  if (dist < radius) {
    return value;
  }
  return 0;
}

function composeRGB(values) {
  const c = clamp01(values.C);
  const m = clamp01(values.M);
  const y = clamp01(values.Y);
  const k = clamp01(values.K);
  const r = 1 - clamp01(c + k);
  const g = 1 - clamp01(m + k);
  const b = 1 - clamp01(y + k);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function apply(img, params, _ctx, cache) {
  const width = img.width;
  const height = img.height;
  const src = img.data;
  const dst = acquireBuffer(cache, 'cmykHalftone:out', src.length);
  const angles = (params && params.angles) || defaults.angles;
  const dotScale = Math.max(0.5, Number((params && params.dotScale) ?? defaults.dotScale) || 1);
  const ucr = Number((params && params.ucr) ?? defaults.ucr);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const cmyk = toCMYK(src[idx], src[idx + 1], src[idx + 2]);
      const adjusted = applyUCR(cmyk, ucr);
      const dotValues = { C: 0, M: 0, Y: 0, K: 0 };
      for (const channel of CHANNELS) {
        const angle = angles && typeof angles[channel] === 'number' ? angles[channel] : defaults.angles[channel];
        dotValues[channel] = halftoneDot(x, y, angle, dotScale, adjusted[channel]);
      }
      const rgb = composeRGB(dotValues);
      dst[idx] = rgb[0];
      dst[idx + 1] = rgb[1];
      dst[idx + 2] = rgb[2];
      dst[idx + 3] = src[idx + 3];
    }
  }
  return new ImageData(dst, width, height);
}

register(id, {
  apply,
  defaults,
  heavy: true
});
