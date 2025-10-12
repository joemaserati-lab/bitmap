import { register, acquireBuffer } from './index';
import { clampByte } from './utils';

export const defaults = {
  opacity: 0.5,
  mode: 'overlay',
  texture: null as any
};

export const heavy = true;

function blendChannel(base: number, tex: number, mode: string): number {
  if (mode === 'multiply') {
    return (base * tex) / 255;
  }
  if (mode === 'screen') {
    return 255 - ((255 - base) * (255 - tex)) / 255;
  }
  // overlay default
  return base < 128 ? (2 * base * tex) / 255 : 255 - (2 * (255 - base) * (255 - tex)) / 255;
}

export function apply(img: ImageData, params: typeof defaults, _ctx: any, cache: Map<string, any>): ImageData {
  const width = img.width;
  const height = img.height;
  const src = img.data;
  const out = acquireBuffer(cache, 'texture:out', src.length);
  const opacity = Math.max(0, Math.min(1, Number(params.opacity ?? defaults.opacity)));
  const mode = typeof params.mode === 'string' ? params.mode : defaults.mode;
  const texture = params.texture;
  if (!texture || !texture.data || !texture.width || !texture.height || opacity <= 0) {
    out.set(src);
    return new ImageData(out, width, height);
  }
  const texData: Uint8ClampedArray = texture.data;
  const texWidth = texture.width;
  const texHeight = texture.height;
  for (let y = 0; y < height; y++) {
    const ty = Math.floor((y / height) * texHeight);
    for (let x = 0; x < width; x++) {
      const tx = Math.floor((x / width) * texWidth);
      const texIdx = (ty * texWidth + tx) * 4;
      const idx = (y * width + x) * 4;
      const tr = texData[texIdx];
      const tg = texData[texIdx + 1];
      const tb = texData[texIdx + 2];
      const nr = blendChannel(src[idx], tr, mode);
      const ng = blendChannel(src[idx + 1], tg, mode);
      const nb = blendChannel(src[idx + 2], tb, mode);
      out[idx] = clampByte(src[idx] + (nr - src[idx]) * opacity);
      out[idx + 1] = clampByte(src[idx + 1] + (ng - src[idx + 1]) * opacity);
      out[idx + 2] = clampByte(src[idx + 2] + (nb - src[idx + 2]) * opacity);
      out[idx + 3] = src[idx + 3];
    }
  }
  return new ImageData(out, width, height);
}

register('textureOverlay', { apply, defaults, heavy });
