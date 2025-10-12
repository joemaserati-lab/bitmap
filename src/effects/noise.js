import { register, acquireBuffer } from './index.js';
import { clampByte, luminance } from './utils.js';

export const defaults = {
  intensity: 0.1,
  mono: false,
  seed: 1337
};

export const heavy = false;

function createRandom(seed){
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s & 0xffffffff) / 0x100000000;
  };
}

export function apply(img, params = defaults, _ctx, cache){
  const src = img.data;
  const out = acquireBuffer(cache, 'noise:out', src.length);
  const intensity = Math.max(0, Math.min(1, Number(params.intensity ?? defaults.intensity)));
  const mono = Boolean(params.mono);
  const random = createRandom(Number(params.seed ?? defaults.seed));
  for(let i=0;i<src.length;i+=4){
    const noiseVal = (random()*2 - 1) * intensity * 255;
    if(mono){
      const lum = luminance(src[i], src[i+1], src[i+2]);
      const value = clampByte(lum + noiseVal);
      out[i] = value;
      out[i+1] = value;
      out[i+2] = value;
    }else{
      out[i] = clampByte(src[i] + noiseVal);
      out[i+1] = clampByte(src[i+1] + noiseVal);
      out[i+2] = clampByte(src[i+2] + noiseVal);
    }
    out[i+3] = src[i+3];
  }
  return new ImageData(out, img.width, img.height);
}

register('noise', { apply, defaults, heavy });
