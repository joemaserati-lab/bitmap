import { register, acquireBuffer } from './index.js';

export const defaults = {
  amount: 0.35,
  maxShift: 12,
  seed: 7
};

export const heavy = false;

function pseudoRandom(seed){
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function apply(img, params = defaults, _ctx, cache){
  const width = img.width;
  const height = img.height;
  const src = img.data;
  const out = acquireBuffer(cache, 'glitch:out', src.length);
  out.set(src);
  const amount = Math.max(0, Math.min(1, Number(params.amount ?? defaults.amount)));
  const maxShift = Math.max(1, Math.min(80, Number(params.maxShift ?? defaults.maxShift)));
  const random = pseudoRandom(Number(params.seed ?? defaults.seed));
  const bands = Math.max(1, Math.floor(height * amount * 0.6));
  for(let i=0;i<bands;i++){
    const bandHeight = Math.max(1, Math.floor((random()*amount + 0.05) * height / bands));
    const startY = Math.floor(random() * Math.max(1, height - bandHeight));
    const shift = Math.floor((random()*2 - 1) * maxShift);
    for(let y=startY; y<startY + bandHeight && y<height; y++){
      const rowStart = y * width * 4;
      for(let x=0;x<width;x++){
        const srcX = Math.max(0, Math.min(width - 1, x + shift));
        const srcIdx = rowStart + srcX * 4;
        const dstIdx = rowStart + x * 4;
        out[dstIdx] = src[srcIdx];
        out[dstIdx+1] = src[srcIdx+1];
        out[dstIdx+2] = src[srcIdx+2];
      }
    }
  }
  return new ImageData(out, width, height);
}

register('glitch', { apply, defaults, heavy });
