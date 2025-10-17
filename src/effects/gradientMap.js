import { register, acquireBuffer } from './index.js';
import { clampByte, luminance } from './utils.js';

export const defaults = {
  stops: [
    [0, 0, 0, 0],
    [255, 255, 255, 1]
  ],
  mix: 1
};

export const heavy = false;

function clampUnit(value){
  const num = Number(value);
  if(!Number.isFinite(num)){
    return null;
  }
  if(num <= 0){
    return 0;
  }
  if(num >= 1){
    return 1;
  }
  return num;
}

function normalizeStops(rawStops){
  const collected = [];
  if(Array.isArray(rawStops)){
    for(let i = 0; i < rawStops.length; i++){
      const entry = rawStops[i];
      if(!entry) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      let t = null;
      if(Array.isArray(entry)){
        r = clampByte(entry[0] ?? 0);
        g = clampByte(entry[1] ?? 0);
        b = clampByte(entry[2] ?? 0);
        t = clampUnit(entry[3]);
      }else if(typeof entry === 'object'){
        if(Array.isArray(entry.color)){
          r = clampByte(entry.color[0] ?? 0);
          g = clampByte(entry.color[1] ?? 0);
          b = clampByte(entry.color[2] ?? 0);
        }else{
          r = clampByte(entry.r ?? entry[0] ?? 0);
          g = clampByte(entry.g ?? entry[1] ?? 0);
          b = clampByte(entry.b ?? entry[2] ?? 0);
        }
        t = clampUnit(entry.t ?? entry.offset ?? entry.position);
      }
      collected.push({ r, g, b, t });
    }
  }
  if(collected.length < 2){
    return [
      { r: 0, g: 0, b: 0, t: 0 },
      { r: 255, g: 255, b: 255, t: 1 }
    ];
  }
  const count = collected.length;
  for(let i = 0; i < count; i++){
    if(!Number.isFinite(collected[i].t)){
      collected[i].t = count === 1 ? 0 : i / (count - 1);
    }
    collected[i].t = clampUnit(collected[i].t);
    if(collected[i].t === null){
      collected[i].t = count === 1 ? 0 : i / (count - 1);
    }
  }
  collected.sort((a, b) => a.t - b.t);
  const normalized = [];
  let previous = -1;
  for(const stop of collected){
    let t = stop.t;
    if(t <= previous){
      t = Math.min(1, previous + 1e-3);
    }
    previous = t;
    normalized.push({ r: stop.r, g: stop.g, b: stop.b, t });
  }
  if(normalized[0].t > 0){
    const first = normalized[0];
    normalized.unshift({ r: first.r, g: first.g, b: first.b, t: 0 });
  }
  const lastIndex = normalized.length - 1;
  if(normalized[lastIndex].t < 1){
    const last = normalized[lastIndex];
    normalized.push({ r: last.r, g: last.g, b: last.b, t: 1 });
  }else{
    normalized[lastIndex].t = 1;
  }
  return normalized;
}

function buildLookupTable(stops, cache){
  const key = `gradientMap:lut:${stops.map((s) => `${s.r}-${s.g}-${s.b}-${Math.round(s.t * 1000)}`).join('|')}`;
  let table = cache.get(key);
  if(table instanceof Uint8ClampedArray && table.length === 256 * 3){
    return table;
  }
  table = new Uint8ClampedArray(256 * 3);
  const segments = Math.max(1, stops.length - 1);
  let current = 0;
  for(let i = 0; i < 256; i++){
    const t = i / 255;
    while(current < segments && t > stops[current + 1].t){
      current++;
    }
    const start = stops[current];
    const end = stops[Math.min(current + 1, stops.length - 1)];
    const span = Math.max(1e-6, end.t - start.t);
    const localT = span > 0 ? (t - start.t) / span : 0;
    const base = i * 3;
    table[base] = clampByte(start.r + (end.r - start.r) * localT);
    table[base + 1] = clampByte(start.g + (end.g - start.g) * localT);
    table[base + 2] = clampByte(start.b + (end.b - start.b) * localT);
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
