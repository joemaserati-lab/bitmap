import { register, acquireBuffer } from './index';
import { clampByte } from './utils';

export const defaults = {
  color: [255, 120, 0],
  opacity: 0.35,
  mode: 'overlay'
};

export const heavy = false;

function blendPixel(r: number, g: number, b: number, color: number[], mode: string, opacity: number) {
  const cr = color[0];
  const cg = color[1];
  const cb = color[2];
  let nr = r;
  let ng = g;
  let nb = b;
  if (mode === 'multiply') {
    nr = (r * cr) / 255;
    ng = (g * cg) / 255;
    nb = (b * cb) / 255;
  } else if (mode === 'screen') {
    nr = 255 - ((255 - r) * (255 - cr)) / 255;
    ng = 255 - ((255 - g) * (255 - cg)) / 255;
    nb = 255 - ((255 - b) * (255 - cb)) / 255;
  } else {
    // overlay
    const applyOverlay = (base: number, blend: number) =>
      base < 128 ? (2 * base * blend) / 255 : 255 - (2 * (255 - base) * (255 - blend)) / 255;
    nr = applyOverlay(r, cr);
    ng = applyOverlay(g, cg);
    nb = applyOverlay(b, cb);
  }
  return [
    clampByte(r + (nr - r) * opacity),
    clampByte(g + (ng - g) * opacity),
    clampByte(b + (nb - b) * opacity)
  ];
}

export function apply(img: ImageData, params: typeof defaults, _ctx: any, cache: Map<string, any>): ImageData {
  const src = img.data;
  const out = acquireBuffer(cache, 'tint:out', src.length);
  const color = Array.isArray(params.color) ? params.color : defaults.color;
  const opacity = Math.max(0, Math.min(1, Number(params.opacity ?? defaults.opacity)));
  const mode = typeof params.mode === 'string' ? params.mode : defaults.mode;
  for (let i = 0; i < src.length; i += 4) {
    const [r, g, b] = blendPixel(src[i], src[i + 1], src[i + 2], color, mode, opacity);
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = src[i + 3];
  }
  return new ImageData(out, img.width, img.height);
}

register('tint', { apply, defaults, heavy });
