import { register, acquireBuffer } from './index';

export const id = 'paletteDither';

export const defaults = {
  palette: [[0, 0, 0], [255, 255, 255]] as number[][],
  diffusion: true,
  strength: 1
};

type KernelTap = { dx: number; dy: number; w: number };

const BURKES_KERNEL: { div: number; taps: KernelTap[] } = {
  div: 32,
  taps: [
    { dx: 1, dy: 0, w: 8 },
    { dx: 2, dy: 0, w: 4 },
    { dx: -2, dy: 1, w: 2 },
    { dx: -1, dy: 1, w: 4 },
    { dx: 0, dy: 1, w: 8 },
    { dx: 1, dy: 1, w: 4 },
    { dx: 2, dy: 1, w: 2 }
  ]
};

function normalizePalette(palette: number[][] | undefined): number[][] {
  if (!Array.isArray(palette) || !palette.length) {
    return defaults.palette;
  }
  return palette.map((color) => {
    if (!Array.isArray(color) || color.length < 3) {
      return [0, 0, 0];
    }
    return [
      clampByte(color[0]),
      clampByte(color[1]),
      clampByte(color[2])
    ];
  });
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value | 0;
}

function findNearest(color: number[], palette: number[][]): number {
  let best = 0;
  let minDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = color[0] - p[0];
    const dg = color[1] - p[1];
    const db = color[2] - p[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < minDist) {
      minDist = dist;
      best = i;
    }
  }
  return best;
}

export function apply(
  img: ImageData,
  params: typeof defaults,
  _ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null,
  cache: Map<string, any>
): ImageData {
  const palette = normalizePalette(params?.palette);
  const diffusion = params?.diffusion !== undefined ? Boolean(params.diffusion) : defaults.diffusion;
  const strength = Math.max(0, Math.min(1, Number(params?.strength ?? defaults.strength)));
  const width = img.width;
  const height = img.height;
  const src = img.data;
  const out = acquireBuffer(cache, 'paletteDither:out', src.length);
  const errR = diffusion ? new Float32Array(width * height) : null;
  const errG = diffusion ? new Float32Array(width * height) : null;
  const errB = diffusion ? new Float32Array(width * height) : null;
  const serpentine = true;
  for (let y = 0; y < height; y++) {
    const dir = serpentine && (y & 1) ? -1 : 1;
    const start = dir === 1 ? 0 : width - 1;
    const end = dir === 1 ? width : -1;
    for (let x = start; x !== end; x += dir) {
      const idx = y * width + x;
      const base = idx * 4;
      let r = src[base];
      let g = src[base + 1];
      let b = src[base + 2];
      if (diffusion && errR && errG && errB) {
        r = clampByte(r + errR[idx]);
        g = clampByte(g + errG[idx]);
        b = clampByte(b + errB[idx]);
      }
      const chosen = palette[findNearest([r, g, b], palette)];
      out[base] = chosen[0];
      out[base + 1] = chosen[1];
      out[base + 2] = chosen[2];
      out[base + 3] = src[base + 3];
      if (!diffusion || !errR || !errG || !errB) continue;
      const errorR = (r - chosen[0]) * strength;
      const errorG = (g - chosen[1]) * strength;
      const errorB = (b - chosen[2]) * strength;
      if (errorR === 0 && errorG === 0 && errorB === 0) continue;
      for (const tap of BURKES_KERNEL.taps) {
        const nx = x + (dir === 1 ? tap.dx : -tap.dx);
        const ny = y + tap.dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const target = ny * width + nx;
        errR[target] += (errorR * tap.w) / BURKES_KERNEL.div;
        errG[target] += (errorG * tap.w) / BURKES_KERNEL.div;
        errB[target] += (errorB * tap.w) / BURKES_KERNEL.div;
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
