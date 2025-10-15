import { register, acquireBuffer } from './index';
import { luminance } from './utils';

export const id = 'lineDither';

export const defaults = {
  cell: 8,
  angle: 0,
  thickness: 0.5,
  aa: true
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function apply(
  img: ImageData,
  params: typeof defaults,
  _ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null,
  cache: Map<string, any>
): ImageData {
  const cell = Math.max(2, Number(params?.cell ?? defaults.cell) || 8);
  const angle = Number(params?.angle ?? defaults.angle) || 0;
  const thickness = clamp(Number(params?.thickness ?? defaults.thickness), 0.05, 1);
  const aa = params?.aa ?? defaults.aa;
  const width = img.width;
  const height = img.height;
  const src = img.data;
  const dst = acquireBuffer(cache, 'lineDither:out', src.length);
  const rad = (angle * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const L = luminance(src[idx], src[idx + 1], src[idx + 2]) / 255;
      const rx = (x * cosA - y * sinA) / cell;
      const dist = Math.abs(rx - Math.round(rx));
      const threshold = thickness * (1 - L);
      let value = dist < threshold ? 0 : 255;
      if (aa && dist < threshold + 0.3) {
        const blend = clamp((dist - threshold) / 0.3, 0, 1);
        value = Math.round(255 * blend);
      }
      dst[idx] = dst[idx + 1] = dst[idx + 2] = value;
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
