import { ensureEffect, getEffect, cloneImageData } from '../effects/index.js';

const memo = new Map();
const bufferCache = new Map();
let workingCanvas = null;
let workingCtx = null;

function getContext(width, height){
  if(typeof OffscreenCanvas === 'undefined'){
    return null;
  }
  if(!workingCanvas || workingCanvas.width !== width || workingCanvas.height !== height){
    workingCanvas = new OffscreenCanvas(width, height);
    workingCtx = workingCanvas.getContext('2d', {willReadFrequently: true});
  }
  return workingCtx;
}

function buildMemoKey(name, params, width, height){
  let paramKey = '';
  try{
    paramKey = JSON.stringify(params);
  }catch(err){
    paramKey = '';
  }
  return `${name}:${paramKey}:${width}x${height}`;
}

function hydrateImageData(payload){
  if(payload instanceof ImageData){
    return payload;
  }
  const { width, height, data } = payload || {};
  if(!width || !height || !data){
    return null;
  }
  return new ImageData(new Uint8ClampedArray(data), width, height);
}

self.onmessage = async (event) => {
  const data = event.data;
  if(!data || data.type !== 'process'){
    return;
  }
  const { id, image, effects, preview } = data;
  const base = hydrateImageData(image);
  if(!base){
    self.postMessage({ type: 'result', id, error: 'invalid-image' });
    return;
  }
  let current = base;
  for(const fx of effects || []){
    const name = fx && fx.name;
    if(!name){
      continue;
    }
    await ensureEffect(name);
    const mod = getEffect(name);
    if(!mod || typeof mod.apply !== 'function'){
      continue;
    }
    const params = fx.params || mod.defaults || {};
    const memoKey = buildMemoKey(name, params, current.width, current.height);
    if(memo.has(memoKey) && !mod.heavy){
      current = cloneImageData(memo.get(memoKey));
      continue;
    }
    const ctx = getContext(current.width, current.height);
    let result;
    try{
      result = mod.apply(current, params, ctx, bufferCache);
    }catch(err){
      console.warn('[postfxWorker] effetto fallito', name, err);
      result = current;
    }
    if(result && result !== current){
      current = result;
    }
    if(!mod.heavy){
      memo.set(memoKey, cloneImageData(current));
    }
  }
  const transferable = new Uint8ClampedArray(current.data);
  const out = new ImageData(transferable, current.width, current.height);
  try{
    self.postMessage({ type: 'result', id, image: { width: out.width, height: out.height, data: transferable.buffer }, preview }, [transferable.buffer]);
  }catch(err){
    self.postMessage({ type: 'result', id, error: err.message || String(err) });
  }
};
