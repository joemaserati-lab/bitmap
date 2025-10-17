import { register, acquireBuffer } from './index.js';
import { clampByte, luminance } from './utils.js';

export const defaults = {
  stops: [
    [0, 0, 0],
    [255, 255, 255]
  ],
  mix: 1
};

export const heavy = false;

function normalizeStops(rawStops){
  if(!Array.isArray(rawStops)){
    return defaults.stops;
  }
  const stops = [];
  for(const entry of rawStops){
    if(!entry){
      continue;
    }
    if(Array.isArray(entry)){
      const r = clampByte(entry[0] ?? 0);
      const g = clampByte(entry[1] ?? 0);
      const b = clampByte(entry[2] ?? 0);
      stops.push([r, g, b]);
    }else if(typeof entry === 'object'){
      const r = clampByte(entry.r ?? entry[0] ?? 0);
      const g = clampByte(entry.g ?? entry[1] ?? 0);
      const b = clampByte(entry.b ?? entry[2] ?? 0);
      stops.push([r, g, b]);
    }
  }
  return stops.length >= 2 ? stops : defaults.stops;
}

function buildLookupTable(stops, cache){
  const key = `gradientMap:lut:${stops.map((s) => `${s[0]}-${s[1]}-${s[2]}`).join('|')}`;
  let table = cache.get(key);
  if(table instanceof Uint8ClampedArray && table.length === 256 * 3){
    return table;
  }
  table = new Uint8ClampedArray(256 * 3);
  const count = stops.length;
  const segments = Math.max(1, count - 1);
  for(let i = 0; i < 256; i++){
    const t = i / 255;
    const scaled = t * segments;
    const index = Math.min(segments - 1, Math.floor(scaled));
    const localT = scaled - index;
    const start = stops[index];
    const end = stops[Math.min(index + 1, count - 1)];
    const base = i * 3;
    table[base] = clampByte(start[0] + (end[0] - start[0]) * localT);
    table[base + 1] = clampByte(start[1] + (end[1] - start[1]) * localT);
    table[base + 2] = clampByte(start[2] + (end[2] - start[2]) * localT);
  }
  cache.set(key, table);
  return table;
}

export function apply(img, params = defaults, _ctx, cache){
  const width = img.width;
  const height = img.height;
  const src = img.data;
  const stops = normalizeStops(params.stops ?? defaults.stops);
  const mix = Math.max(0, Math.min(1, Number(params.mix ?? defaults.mix)));
  const lut = buildLookupTable(stops, cache);
  const out = acquireBuffer(cache, 'gradientMap:out', src.length);
  if(mix === 0){
    out.set(src);
    return new ImageData(out, width, height);
  }
  for(let i = 0; i < src.length; i += 4){
    const L = luminance(src[i], src[i + 1], src[i + 2]);
    const base = L * 3;
    const r = lut[base];
    const g = lut[base + 1];
    const b = lut[base + 2];
    if(mix >= 1){
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
    }else{
      out[i] = clampByte(src[i] + (r - src[i]) * mix);
      out[i + 1] = clampByte(src[i + 1] + (g - src[i + 1]) * mix);
      out[i + 2] = clampByte(src[i + 2] + (b - src[i + 2]) * mix);
    }
    out[i + 3] = src[i + 3];
  }
  return new ImageData(out, width, height);
}

register('gradientMap', { apply, defaults, heavy });
