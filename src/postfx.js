import { ensureEffect, getEffect, cloneImageData } from './effects/index.js';

let worker = null;
let workerJobId = 0;
const workerJobs = new Map();
const fallbackCache = new Map();
let fallbackCanvas = null;
let fallbackCtx = null;
let previewCanvas = null;
let previewCtx = null;

const supportsWorker = typeof Worker !== 'undefined';
const supportsOffscreen = typeof OffscreenCanvas !== 'undefined';

function getFallbackContext(width, height){
  if(!fallbackCanvas){
    fallbackCanvas = document.createElement('canvas');
  }
  if(fallbackCanvas.width !== width || fallbackCanvas.height !== height){
    fallbackCanvas.width = width;
    fallbackCanvas.height = height;
  }
  fallbackCtx = fallbackCanvas.getContext('2d', { willReadFrequently: true });
  return fallbackCtx;
}

function getPreviewContext(width, height){
  if(supportsOffscreen){
    if(!previewCanvas || previewCanvas.width !== width || previewCanvas.height !== height){
      previewCanvas = new OffscreenCanvas(width, height);
      previewCtx = previewCanvas.getContext('2d', { willReadFrequently: true });
    }
    return previewCtx;
  }
  return getFallbackContext(width, height);
}

function ensureWorker(){
  if(worker || !supportsWorker){
    return worker;
  }
  worker = new Worker(new URL('./worker/postfxWorker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const { data } = event;
    if(!data || data.type !== 'result'){
      return;
    }
    const job = workerJobs.get(data.id);
    if(!job){
      return;
    }
    workerJobs.delete(data.id);
    if(data.error){
      job.reject(new Error(data.error));
      return;
    }
    const { image } = data;
    if(!image || !image.data){
      job.reject(new Error('Invalid worker response'));
      return;
    }
    const img = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
    job.resolve(img);
  };
  worker.onerror = (err) => {
    for(const [, job] of workerJobs){
      job.reject(err);
    }
    workerJobs.clear();
  };
  return worker;
}

async function processInWorker(imageData, effects, preview){
  const instance = ensureWorker();
  if(!instance){
    throw new Error('Worker not available');
  }
  const id = ++workerJobId;
  const payload = {
    type: 'process',
    id,
    image: {
      width: imageData.width,
      height: imageData.height,
      data: imageData.data.buffer
    },
    effects,
    preview
  };
  const transfer = [imageData.data.buffer];
  const promise = new Promise((resolve, reject) => {
    workerJobs.set(id, { resolve, reject });
  });
  instance.postMessage(payload, transfer);
  return promise;
}

async function processOnMain(imageData, effects){
  let current = cloneImageData(imageData);
  const ctx = getFallbackContext(current.width, current.height);
  for(const fx of effects){
    await ensureEffect(fx.name);
    const mod = getEffect(fx.name);
    if(!mod || typeof mod.apply !== 'function'){
      continue;
    }
    const params = fx.params || mod.defaults || {};
    await waitForIdle();
    const result = mod.apply(current, params, ctx, fallbackCache);
    current = result || current;
  }
  return cloneImageData(current);
}

export async function runPostEffects(imageData, effects, { preview = false } = {}){
  if(!effects || !effects.length){
    return imageData;
  }
  try{
    if(supportsWorker){
      return await processInWorker(cloneImageData(imageData), effects, preview);
    }
  }catch(err){
    console.warn('[postfx] worker fallback', err);
  }
  return processOnMain(imageData, effects);
}

export async function applyToCanvas(canvas, effects, { preview = false, maxDimension = 1024 } = {}){
  if(!canvas || !effects || !effects.length){
    return;
  }
  const width = canvas.width;
  const height = canvas.height;
  if(!width || !height){
    return;
  }
  const scale = preview ? Math.min(1, maxDimension / Math.max(width, height)) : 1;
  const workWidth = Math.max(1, Math.round(width * scale));
  const workHeight = Math.max(1, Math.round(height * scale));
  const ctx = getPreviewContext(workWidth, workHeight);
  if(!ctx){
    return;
  }
  ctx.clearRect(0, 0, workWidth, workHeight);
  ctx.drawImage(canvas, 0, 0, workWidth, workHeight);
  const imageData = ctx.getImageData(0, 0, workWidth, workHeight);
  const processed = await runPostEffects(imageData, effects, { preview });
  ctx.putImageData(processed, 0, 0);
  const targetCtx = canvas.getContext('2d');
  if(!targetCtx){
    return;
  }
  targetCtx.save();
  targetCtx.globalCompositeOperation = 'source-over';
  if(typeof targetCtx.resetTransform === 'function'){
    targetCtx.resetTransform();
  }else{
    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
  }
  targetCtx.imageSmoothingEnabled = false;
  targetCtx.clearRect(0, 0, width, height);
  if(preview && (workWidth !== width || workHeight !== height)){
    const source = supportsOffscreen ? previewCanvas : fallbackCanvas;
    if(source){
      targetCtx.drawImage(source, 0, 0, width, height);
    }
  }else{
    targetCtx.putImageData(processed, 0, 0);
  }
  targetCtx.restore();
}

function waitForIdle(){
  if(typeof requestIdleCallback === 'function'){
    return new Promise((resolve) => requestIdleCallback(() => resolve()));
  }
  return new Promise((resolve) => setTimeout(resolve, 16));
}
