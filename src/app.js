const $ = (id) => document.getElementById(id);

const preview = $('preview');
const meta = $('meta');
const uploadMessage = $('uploadMessage');
const progressWrap = $('uploadProgressWrapper');
const progressBar = $('uploadProgressBar');

const CONTROL_IDS = [
  'pixelSize','pixelSizeNum','threshold','thresholdNum','blur','blurNum','grain','grainNum',
  'blackPoint','blackPointNum','whitePoint','whitePointNum','gammaVal','gammaValNum',
  'brightness','brightnessNum','contrast','contrastNum','style','thickness','thicknessNum',
  'dither','invert','bg','fg','scale','scaleNum','fmt','dpi','outW','outH','lockAR',
  'jpegQ','jpegQNum','rasterBG'
];

const controls = {};
for(const id of CONTROL_IDS){
  controls[id] = $(id);
}

const MAX_UPLOAD_DIMENSION = 800;
const RENDER_DEBOUNCE_MS = 90;

const OFFSCREEN_SUPPORTED = typeof OffscreenCanvas !== 'undefined';

const state = {
  sourceCanvas: null,
  sourceName: '',
  sourceWidth: 0,
  sourceHeight: 0,
  sourceVersion: 0,
  worker: null,
  workerReady: false,
  workerReadyPromise: null,
  workerReadyResolve: null,
  workerSourceVersion: 0,
  pendingSourcePromise: null,
  pendingSourceVersion: 0,
  pendingSourceResolvers: null,
  pendingJobs: new Map(),
  currentJobId: 0,
  lastResult: null,
  lastResultId: 0,
  lastPreview: null,
  lastSVG: '',
  lastSVGJob: 0,
  lastSize: {width: 0, height: 0},
  lastScale: 1,
  asciiCache: null,
  offscreenSupported: OFFSCREEN_SUPPORTED,
  sourceOffscreen: null
};

let renderQueued = false;
let renderTimer = null;
let renderRaf = 0;
let renderBusy = false;

function init(){
  initWorker();
  bindControls();
  bindFileInputs();
  bindDropzone();
  window.addEventListener('resize', () => {
    if(!state.lastSVG) return;
    schedulePreviewRefresh();
  });
  setSourceCanvas(getPlaceholderCanvas(), '');
  fastRender(true);
}

function initWorker(){
  if(state.worker) return;
  const worker = new Worker(new URL('./worker/processor.js', import.meta.url), {type:'module'});
  state.worker = worker;
  state.workerReadyPromise = new Promise((resolve) => {
    state.workerReadyResolve = resolve;
  });
  worker.onmessage = handleWorkerMessage;
  worker.onerror = (err) => {
    console.error('Worker error', err);
  };
}

function handleWorkerMessage(event){
  const data = event.data || {};
  if(data.type === 'ready'){
    state.workerReady = true;
    if(state.workerReadyResolve){
      state.workerReadyResolve();
      state.workerReadyResolve = null;
    }
    return;
  }
  if(data.type === 'source-loaded'){
    const {version} = data;
    if(state.pendingSourcePromise && state.pendingSourceVersion === version){
      state.workerSourceVersion = version;
      const {resolve} = state.pendingSourceResolvers || {};
      state.pendingSourceResolvers = null;
      state.pendingSourcePromise = null;
      if(resolve) resolve();
    }else if(version > state.workerSourceVersion){
      state.workerSourceVersion = version;
    }
    return;
  }
  if(data.type === 'result'){
    const {jobId} = data;
    const entry = state.pendingJobs.get(jobId);
    if(entry){
      state.pendingJobs.delete(jobId);
      entry.resolve(data);
    }
    return;
  }
  if(data.type === 'error'){
    const {jobId, message} = data;
    if(jobId && state.pendingJobs.has(jobId)){
      const entry = state.pendingJobs.get(jobId);
      state.pendingJobs.delete(jobId);
      entry.reject(new Error(message||'Worker error'));
    }else{
      console.error('Worker error', message);
    }
  }
}

function bindControls(){
  const sliderPairs = [
    ['pixelSize','pixelSizeNum'],
    ['threshold','thresholdNum'],
    ['blur','blurNum'],
    ['grain','grainNum'],
    ['blackPoint','blackPointNum'],
    ['whitePoint','whitePointNum'],
    ['gammaVal','gammaValNum'],
    ['brightness','brightnessNum'],
    ['contrast','contrastNum'],
    ['thickness','thicknessNum'],
    ['scale','scaleNum'],
    ['jpegQ','jpegQNum']
  ];
  for(const [rangeId, numberId] of sliderPairs){
    const rangeEl = controls[rangeId];
    const numberEl = controls[numberId];
    if(!rangeEl || !numberEl) continue;
    rangeEl.addEventListener('input', () => {
      numberEl.value = rangeEl.value;
      fastRender();
    });
    numberEl.addEventListener('input', () => {
      rangeEl.value = numberEl.value;
      fastRender();
    });
  }
  const changeIds = ['dither','invert','bg','fg','style','fmt','dpi','lockAR'];
  for(const id of changeIds){
    const el = controls[id];
    if(!el) continue;
    el.addEventListener('change', () => fastRender());
  }
}

function bindFileInputs(){
  ['fileGallery','fileCamera'].forEach((id) => {
    const input = $(id);
    if(!input) return;
    input.addEventListener('change', async () => {
      if(input.files && input.files[0]){
        await handleFile(input.files[0]);
        input.value = '';
      }
    });
  });
}

function bindDropzone(){
  const dropzone = $('dropzone');
  const gallery = $('fileGallery');
  if(!dropzone) return;
  dropzone.addEventListener('click', () => {
    if(gallery) gallery.click();
  });
  dropzone.addEventListener('keydown', (event) => {
    if(event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar'){
      event.preventDefault();
      if(gallery) gallery.click();
    }
  });
  dropzone.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragover');
  });
  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragover');
    if(event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  dropzone.addEventListener('dragleave', (event) => {
    const rel = event.relatedTarget;
    if(!rel || !dropzone.contains(rel)){
      dropzone.classList.remove('is-dragover');
    }
  });
  dropzone.addEventListener('drop', async (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragover');
    if(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]){
      await handleFile(event.dataTransfer.files[0]);
    }
  });
}

function beginUpload(name=''){
  if(uploadMessage){
    uploadMessage.textContent = name ? `Caricamento di ${name}...` : 'Caricamento in corso...';
  }
  if(progressWrap){
    progressWrap.hidden = false;
    progressWrap.removeAttribute('hidden');
    progressWrap.classList.remove('is-indeterminate');
    progressWrap.setAttribute('aria-valuenow','0');
    progressWrap.setAttribute('aria-valuetext','0%');
  }
  if(progressBar){
    progressBar.style.width = '0%';
  }
}

function updateUploadProgress(value){
  if(!progressWrap || !progressBar) return;
  progressWrap.classList.remove('is-indeterminate');
  const pct = Math.max(0, Math.min(1, value||0));
  const percentText = `${Math.round(pct*100)}%`;
  progressBar.style.width = percentText;
  progressWrap.setAttribute('aria-valuenow', String(Math.round(pct*100)));
  progressWrap.setAttribute('aria-valuetext', percentText);
}

function setUploadIndeterminate(){
  if(!progressWrap || !progressBar) return;
  progressWrap.hidden = false;
  progressWrap.removeAttribute('hidden');
  progressWrap.classList.add('is-indeterminate');
  progressBar.style.width = '40%';
  progressWrap.removeAttribute('aria-valuenow');
  progressWrap.setAttribute('aria-valuetext','Caricamento in corso');
}

function finishUpload(name=''){
  if(progressWrap){
    progressWrap.hidden = true;
    progressWrap.classList.remove('is-indeterminate');
    progressWrap.setAttribute('aria-valuenow','100');
    progressWrap.setAttribute('aria-valuetext','Completato');
  }
  if(uploadMessage){
    const dimsInfo = state.sourceWidth && state.sourceHeight
      ? ` (${state.sourceWidth}×${state.sourceHeight}px)`
      : '';
    uploadMessage.textContent = name ? `File presente: ${name}${dimsInfo}` : `File presente${dimsInfo}`;
  }
}

function uploadError(message='Errore durante il caricamento'){
  if(uploadMessage){
    uploadMessage.textContent = message;
  }
  if(progressWrap){
    progressWrap.hidden = true;
    progressWrap.classList.remove('is-indeterminate');
    progressWrap.setAttribute('aria-valuenow','0');
    progressWrap.setAttribute('aria-valuetext','Errore');
  }
}

async function handleFile(file){
  if(!file) return;
  beginUpload(file.name||'');
  try{
    const type = (file.type||'').toLowerCase();
    if(!type.startsWith('image/')){
      throw new Error('Formato file non supportato');
    }
    const canvas = await readImageFileToCanvas(file);
    setSourceCanvas(canvas, file.name||'');
    finishUpload(file.name||'');
    fastRender(true);
  }catch(err){
    console.error(err);
    uploadError(err && err.message ? err.message : 'Errore durante il caricamento');
  }
}

async function readImageFileToCanvas(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if(event.lengthComputable){
        updateUploadProgress(event.loaded/event.total);
      }else{
        setUploadIndeterminate();
      }
    };
    reader.onerror = () => reject(reader.error||new Error('Errore durante la lettura del file'));
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        try{
          const canvas = rasterizeImageToCanvas(image, MAX_UPLOAD_DIMENSION);
          resolve(canvas);
        }catch(e){
          reject(e);
        }
      };
      image.onerror = () => reject(new Error('Impossibile caricare l\'immagine'));
      if(typeof reader.result === 'string'){
        image.src = reader.result;
      }else{
        reject(new Error('Formato file non supportato'));
      }
    };
    try{
      reader.readAsDataURL(file);
    }catch(err){
      reject(err);
    }
  });
}

function scaleDimensions(width, height, maxDim){
  const maxSide = Math.max(width, height);
  if(maxSide <= maxDim){
    return {width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height))};
  }
  const scale = maxDim / maxSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function rasterizeImageToCanvas(image, maxDim){
  const dims = scaleDimensions(image.naturalWidth || image.width, image.naturalHeight || image.height, maxDim);
  const canvas = document.createElement('canvas');
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function setSourceCanvas(canvas, name){
  state.sourceCanvas = canvas;
  state.sourceName = name;
  state.sourceWidth = canvas.width;
  state.sourceHeight = canvas.height;
  state.lastResult = null;
  state.lastResultId = 0;
  state.asciiCache = null;
  state.lastPreview = null;
  state.lastSVG = '';
  state.lastSVGJob = 0;
  state.lastSize = {width: 0, height: 0};
  state.lastScale = 1;
  if(state.offscreenSupported){
    try{
      if(typeof canvas.transferControlToOffscreen === 'function'){
        const offscreen = canvas.transferControlToOffscreen();
        state.sourceOffscreen = offscreen;
      }else{
        state.sourceOffscreen = null;
        state.offscreenSupported = false;
      }
    }catch(err){
      state.sourceOffscreen = null;
      state.offscreenSupported = false;
    }
  }else{
    state.sourceOffscreen = null;
  }
  state.sourceVersion++;
  state.workerSourceVersion = 0;
}

async function ensureWorkerReady(){
  if(!state.worker){
    initWorker();
  }
  if(state.workerReady){
    return;
  }
  if(state.workerReadyPromise){
    await state.workerReadyPromise;
  }
}

async function ensureWorkerSource(canvas){
  await ensureWorkerReady();
  if(state.workerSourceVersion === state.sourceVersion){
    return;
  }
  if(state.pendingSourcePromise && state.pendingSourceVersion === state.sourceVersion){
    await state.pendingSourcePromise;
    return;
  }
  const version = state.sourceVersion;
  state.pendingSourceVersion = version;
  state.pendingSourcePromise = new Promise((resolve, reject) => {
    state.pendingSourceResolvers = {resolve, reject};
  });
  if(state.offscreenSupported && state.sourceOffscreen){
    const offscreen = state.sourceOffscreen;
    state.sourceOffscreen = null;
    state.worker.postMessage({
      type: 'load-source',
      version,
      width: canvas.width,
      height: canvas.height,
      offscreen
    }, [offscreen]);
  }else{
    const bitmap = await createImageBitmap(canvas);
    state.worker.postMessage({
      type: 'load-source',
      version,
      width: canvas.width,
      height: canvas.height,
      image: bitmap
    }, [bitmap]);
  }
  await state.pendingSourcePromise;
}

function fastRender(immediate=false){
  renderQueued = true;
  if(renderBusy){
    return;
  }
  if(immediate){
    if(renderTimer){
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    if(renderRaf){
      cancelAnimationFrame(renderRaf);
    }
    renderRaf = requestAnimationFrame(() => {
      runRenderCycle();
    });
    return;
  }
  if(renderTimer){
    clearTimeout(renderTimer);
  }
  renderTimer = setTimeout(() => {
    renderTimer = null;
    if(renderRaf){
      cancelAnimationFrame(renderRaf);
    }
    renderRaf = requestAnimationFrame(() => {
      runRenderCycle();
    });
  }, RENDER_DEBOUNCE_MS);
}

async function runRenderCycle(){
  renderRaf = 0;
  if(renderBusy) return;
  if(!renderQueued) return;
  renderQueued = false;
  renderBusy = true;
  updateExportButtons();
  try{
    await generate();
  }catch(err){
    console.error(err);
  }finally{
    renderBusy = false;
    updateExportButtons();
    if(renderQueued){
      fastRender();
    }
  }
}

function clampInt(value, min, max){
  const parsed = parseInt(value, 10);
  if(Number.isNaN(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function collectRenderOptions(){
  const px = clampInt(controls.pixelSize.value||10, 2, 200);
  const thr = clampInt(controls.threshold.value||180, 0, 255);
  const blurPx = Math.max(0, parseFloat(controls.blur.value||'0'));
  const grain = Math.max(0, Math.min(100, parseInt(controls.grain.value||'0',10)));
  const bp = clampInt(controls.blackPoint.value||0, 0, 255);
  const wp = clampInt(controls.whitePoint.value||255, 1, 255);
  const gam = Math.max(0.1, Math.min(3, parseFloat(controls.gammaVal.value||'1')));
  const bri = Math.max(-100, Math.min(100, parseInt(controls.brightness.value||'0',10)));
  const con = Math.max(-100, Math.min(100, parseInt(controls.contrast.value||'0',10)));
  const style = controls.style.value||'solid';
  const thick = clampInt(controls.thickness.value||2,1,6);
  const mode = controls.dither.value||'none';
  const invertMode = controls.invert.value||'auto';
  const bg = controls.bg.value||'#ffffff';
  const fg = controls.fg.value||'#000000';
  const scaleVal = parseFloat(controls.scale.value||'1');
  const scale = Number.isFinite(scaleVal) && scaleVal>0 ? scaleVal : 1;
  return {px, thr, blurPx, grain, bp, wp, gam, bri, con, style, thick, mode, invertMode, bg, fg, scale};
}

async function generate(){
  const options = collectRenderOptions();
  const canvas = state.sourceCanvas || getPlaceholderCanvas();
  await ensureWorkerSource(canvas);
  const jobId = ++state.currentJobId;
  const payload = {
    type: 'process',
    jobId,
    options: {
      pixelSize: options.px,
      threshold: options.thr,
      blur: options.blurPx,
      grain: options.grain,
      blackPoint: options.bp,
      whitePoint: options.wp,
      gamma: options.gam,
      brightness: options.bri,
      contrast: options.con,
      style: options.style,
      thickness: options.thick,
      dither: options.mode,
      invertMode: options.invertMode
    }
  };
  const result = await requestWorkerProcess(payload);
  if(!result || result.jobId !== jobId) return;
  state.lastResult = {options, data: result};
  state.lastResultId = jobId;
  state.lastSVG = '';
  state.lastSVGJob = 0;
  const previewData = buildPreviewData(result, options);
  state.lastPreview = previewData;
  const previewWidth = previewData ? previewData.width : 0;
  const previewHeight = previewData ? previewData.height : 0;
  state.lastSize = {width: previewWidth, height: previewHeight};
  state.lastScale = options.scale;
  renderPreview(previewData, options.scale);
  updateMeta(previewWidth, previewHeight);
  updateExportButtons();
}

function requestWorkerProcess(message){
  return new Promise((resolve, reject) => {
    const {jobId} = message;
    if(!state.worker){
      reject(new Error('Worker non inizializzato'));
      return;
    }
    state.pendingJobs.set(jobId, {resolve, reject});
    try{
      state.worker.postMessage(message);
    }catch(err){
      state.pendingJobs.delete(jobId);
      reject(err);
    }
  });
}

function buildPreviewData(result, options){
  if(!result){
    state.asciiCache = null;
    return null;
  }
  const {gridWidth, gridHeight, mode, mask} = result;
  const tile = Math.max(1, options.px);
  const width = Math.round(gridWidth * tile);
  const height = Math.round(gridHeight * tile);
  const previewMode = mode || options.mode || 'none';
  if(previewMode && previewMode.startsWith('ascii')){
    const svgElement = getAsciiSVGElement(result, options);
    return {
      type: 'ascii',
      mode: previewMode,
      width,
      height,
      gridWidth,
      gridHeight,
      tile,
      node: svgElement
    };
  }
  state.asciiCache = null;
  return {
    type: 'mask',
    mode: previewMode,
    width,
    height,
    gridWidth,
    gridHeight,
    tile,
    mask,
    bg: options.bg,
    fg: options.fg
  };
}

function buildMaskSVGString(mask, width, height, tile, bg, fg){
  if(!mask) return '';
  const svgW = Math.round(width*tile);
  const svgH = Math.round(height*tile);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">`;
  if(bg) svg += `<rect width="100%" height="100%" fill="${bg}"/>`;
  svg += `<path fill="${fg}" d="`;
  for(let y=0;y<height;y++){
    let runStart = -1;
    const rowOffset = y*width;
    for(let x=0;x<=width;x++){
      const value = x<width ? mask[rowOffset+x] : 0;
      if(value && runStart<0){
        runStart = x;
      }else if((!value || x===width) && runStart>=0){
        const rectWidth = (x-runStart)*tile;
        const rectX = runStart*tile;
        const rectY = y*tile;
        svg += `M${rectX} ${rectY}h${rectWidth}v${tile}h-${rectWidth}z`;
        runStart = -1;
      }
    }
  }
  svg += '"/></svg>';
  return svg;
}

const ASCII_SETS = {
  ascii_simple: [' ','.',':','-','=','+','#','@'],
  ascii_unicode8: [' ','·',':','-','=','+','*','#','%','@'],
  ascii_chinese: ['　','丶','丿','ノ','乙','人','口','回','田','国']
};

function buildASCIISVGString(ascii, tonal, width, height, tile, bg, fg, mode){
  const charset = ASCII_SETS[mode] || ASCII_SETS.ascii_simple;
  const svgW = Math.round(width*tile);
  const svgH = Math.round(height*tile);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">`;
  if(bg) svg += `<rect width="100%" height="100%" fill="${bg}"/>`;
  svg += `<g fill="${fg}" font-family="JetBrains Mono, monospace" font-size="${tile}" text-anchor="middle">`;
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const idx = y*width+x;
      const tone = tonal ? tonal[idx] : 0;
      const charIndex = ascii ? ascii[idx] : Math.round((charset.length-1)*(1 - tone/255));
      const ch = charset[Math.max(0, Math.min(charset.length-1, charIndex))];
      const cx = Math.round(x*tile + tile/2);
      const cy = Math.round(y*tile + tile*0.82);
      svg += `<text x="${cx}" y="${cy}">${ch}</text>`;
    }
  }
  svg += '</g></svg>';
  return svg;
}

function getAsciiSVGElement(result, options){
  const cols = result.gridWidth;
  const rows = result.gridHeight;
  const mode = result.mode || 'ascii_simple';
  const tile = Math.max(1, options.px);
  const fg = options.fg || '#000000';
  const bg = options.bg || '#ffffff';
  const charset = ASCII_SETS[mode] || ASCII_SETS.ascii_simple;
  const needsRebuild = !state.asciiCache || state.asciiCache.cols !== cols || state.asciiCache.rows !== rows || state.asciiCache.mode !== mode || state.asciiCache.tile !== tile;
  const svgNS = 'http://www.w3.org/2000/svg';
  if(needsRebuild){
    const width = Math.round(cols*tile);
    const height = Math.round(rows*tile);
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('xmlns', svgNS);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    const bgRect = document.createElementNS(svgNS, 'rect');
    bgRect.setAttribute('width','100%');
    bgRect.setAttribute('height','100%');
    svg.appendChild(bgRect);
    const group = document.createElementNS(svgNS, 'g');
    group.setAttribute('font-family','JetBrains Mono, monospace');
    group.setAttribute('font-size', String(tile));
    group.setAttribute('text-anchor','middle');
    svg.appendChild(group);
    const nodes = new Array(cols*rows);
    for(let y=0;y<rows;y++){
      for(let x=0;x<cols;x++){
        const idx = y*cols+x;
        const textEl = document.createElementNS(svgNS, 'text');
        const cx = Math.round(x*tile + tile/2);
        const cy = Math.round(y*tile + tile*0.82);
        textEl.setAttribute('x', String(cx));
        textEl.setAttribute('y', String(cy));
        group.appendChild(textEl);
        nodes[idx] = textEl;
      }
    }
    state.asciiCache = {cols, rows, mode, tile, svg, bgRect, group, nodes, values: new Int16Array(cols*rows).fill(-1)};
  }else if(state.asciiCache.values.length !== cols*rows){
    state.asciiCache.values = new Int16Array(cols*rows).fill(-1);
  }
  const cache = state.asciiCache;
  cache.bgRect.setAttribute('fill', bg);
  cache.group.setAttribute('fill', fg);
  const asciiData = result.ascii || [];
  const nodes = cache.nodes;
  const values = cache.values;
  for(let i=0;i<nodes.length;i++){
    const index = asciiData[i] ?? 0;
    if(values[i] === index) continue;
    const ch = charset[Math.max(0, Math.min(charset.length-1, index))] || charset[0];
    nodes[i].textContent = ch;
    values[i] = index;
  }
  return cache.svg;
}

function buildExportSVG(result, options){
  if(!result) return '';
  const tile = Math.max(1, options.px);
  if(result.mode && result.mode.startsWith('ascii')){
    return buildASCIISVGString(result.ascii, result.tonal, result.gridWidth, result.gridHeight, tile, options.bg, options.fg, result.mode);
  }
  return buildMaskSVGString(result.mask, result.gridWidth, result.gridHeight, tile, options.bg, options.fg);
}

function renderPreview(previewData, scale){
  if(!preview) return;
  preview.innerHTML = '';
  if(!previewData){
    if(meta) meta.textContent = '';
    return;
  }
  const frame = document.createElement('div');
  frame.className = 'preview-frame';
  const dims = computePreviewDimensions(previewData.width, previewData.height, scale);
  frame.style.width = `${dims.width}px`;
  frame.style.height = `${dims.height}px`;
  if(previewData.type === 'ascii' && previewData.node){
    const node = previewData.node;
    node.setAttribute('width','100%');
    node.setAttribute('height','100%');
    node.setAttribute('preserveAspectRatio','xMidYMid meet');
    node.style.width = '100%';
    node.style.height = '100%';
    frame.appendChild(node);
  }else if(previewData.type === 'mask'){
    const canvas = document.createElement('canvas');
    canvas.width = previewData.width;
    canvas.height = previewData.height;
    drawMaskPreview(canvas, previewData);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.imageRendering = 'pixelated';
    frame.appendChild(canvas);
  }
  preview.appendChild(frame);
}

function drawMaskPreview(canvas, data){
  const ctx = canvas.getContext('2d', {alpha: !!data.bg && data.bg !== 'transparent'});
  if(!ctx) return;
  ctx.imageSmoothingEnabled = false;
  const bg = data.bg;
  if(bg && bg !== 'transparent'){
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }else{
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  if(!data.mask) return;
  ctx.fillStyle = data.fg || '#000000';
  const {gridWidth, gridHeight, tile, mask} = data;
  for(let y=0;y<gridHeight;y++){
    let runStart = -1;
    const rowOffset = y*gridWidth;
    for(let x=0;x<=gridWidth;x++){
      const value = x<gridWidth ? mask[rowOffset+x] : 0;
      if(value && runStart<0){
        runStart = x;
      }else if((!value || x===gridWidth) && runStart>=0){
        const runLength = x - runStart;
        if(runLength>0){
          ctx.fillRect(runStart*tile, y*tile, runLength*tile, tile);
        }
        runStart = -1;
      }
    }
  }
}

function schedulePreviewRefresh(){
  if(!state.lastPreview) return;
  const dims = computePreviewDimensions(state.lastSize.width, state.lastSize.height, state.lastScale);
  const frame = preview.querySelector('.preview-frame');
  if(frame){
    frame.style.width = `${dims.width}px`;
    frame.style.height = `${dims.height}px`;
  }
}

function computePreviewDimensions(width, height, scale){
  const hostRect = preview.getBoundingClientRect();
  let availableW = preview.clientWidth || hostRect.width || 0;
  let availableH = preview.clientHeight || hostRect.height || 0;
  if(availableW <= 0){
    const parentRect = preview.parentElement ? preview.parentElement.getBoundingClientRect() : null;
    availableW = parentRect && parentRect.width ? parentRect.width : width;
  }
  if(availableH <= 0){
    const parentRect = preview.parentElement ? preview.parentElement.getBoundingClientRect() : null;
    availableH = parentRect && parentRect.height ? parentRect.height : height;
  }
  if(availableW <= 0){
    availableW = Math.max(width, window.innerWidth || 1);
  }
  if(availableH <= 0){
    availableH = Math.max(height, (window.innerHeight || 1) * 0.5);
  }
  availableW = Math.max(1, availableW);
  availableH = Math.max(1, availableH);
  const ratio = height ? width/height : 1;
  const userScale = Number.isFinite(scale) && scale>0 ? scale : 1;
  let baseW = availableW;
  let baseH = ratio ? baseW/ratio : availableH;
  if(baseH > availableH){
    baseH = availableH;
    baseW = baseH * ratio;
  }
  const targetW = Math.min(baseW * userScale, availableW);
  const targetH = Math.min(baseH * userScale, availableH);
  return {
    width: Math.max(1, Math.round(targetW)),
    height: Math.max(1, Math.round(targetH))
  };
}

function updateMeta(width, height){
  if(!meta) return;
  if(width && height){
    meta.textContent = `${width}×${height}px`;
  }else{
    meta.textContent = '';
  }
}

function updateExportButtons(){
  const hasResult = !!(state.lastResult && state.lastResult.data);
  const jobActive = renderBusy || state.pendingJobs.size > 0;
  ['dlSVG','dlPNG','dlJPG'].forEach((id) => {
    const btn = $(id);
    if(!btn) return;
    const busy = btn.dataset.busy === 'true';
    const disabled = busy || !hasResult || jobActive;
    btn.disabled = disabled;
    btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    if(busy) btn.setAttribute('aria-busy','true');
    else btn.removeAttribute('aria-busy');
  });
}

function setButtonBusy(btn, busy, label){
  if(!btn) return;
  if(busy){
    if(!btn.dataset.originalLabel) btn.dataset.originalLabel = btn.textContent;
    if(label) btn.textContent = label;
    btn.dataset.busy = 'true';
    btn.disabled = true;
    btn.setAttribute('aria-busy','true');
    btn.setAttribute('aria-disabled','true');
  }else{
    if(btn.dataset.originalLabel) btn.textContent = btn.dataset.originalLabel;
    delete btn.dataset.originalLabel;
    delete btn.dataset.busy;
    btn.removeAttribute('aria-busy');
    btn.removeAttribute('aria-disabled');
  }
}

function triggerDownload(blob, filename){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function wait(ms){
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadSVG(){
  const svgString = ensureSVGString();
  if(!svgString) return;
  const blob = new Blob([svgString], {type:'image/svg+xml'});
  triggerDownload(blob, 'bitmap.svg');
}

async function downloadRaster(format){
  const svgString = ensureSVGString();
  if(!svgString) return;
  const dims = getExportDimensions();
  const background = controls.rasterBG ? controls.rasterBG.value : '#ffffff';
  const dpi = getSelectedDPI();
  const canvas = await rasterizeSVGToCanvas(svgString, dims.width, dims.height, background);
  const quality = format === 'image/jpeg' ? getJPEGQuality() : undefined;
  const blob = await canvasToBlobWithDPI(canvas, format, quality, dpi);
  triggerDownload(blob, format === 'image/png' ? 'bitmap.png' : 'bitmap.jpg');
}

function getExportDimensions(){
  const defaultW = state.lastSize.width;
  const defaultH = state.lastSize.height;
  let outW = parseInt(controls.outW.value||'',10);
  let outH = parseInt(controls.outH.value||'',10);
  const lock = controls.lockAR && controls.lockAR.checked;
  if(!Number.isFinite(outW) || outW<=0){
    outW = defaultW;
  }
  if(!Number.isFinite(outH) || outH<=0){
    outH = defaultH;
  }
  if(lock){
    const ratio = defaultH ? defaultW/defaultH : 1;
    if(outW && !outH){
      outH = Math.round(outW/ratio);
    }else if(outH && !outW){
      outW = Math.round(outH*ratio);
    }
  }
  outW = Math.min(3000, Math.max(1, Math.round(outW)));
  outH = Math.min(3000, Math.max(1, Math.round(outH)));
  return {width: outW, height: outH};
}

function ensureSVGString(){
  if(!state.lastResult || !state.lastResult.data){
    return '';
  }
  if(state.lastSVG && state.lastSVGJob === state.lastResultId){
    return state.lastSVG;
  }
  const svgString = buildExportSVG(state.lastResult.data, state.lastResult.options);
  state.lastSVG = svgString;
  state.lastSVGJob = state.lastResultId;
  return svgString;
}

function getSelectedDPI(){
  const value = controls.dpi ? parseInt(controls.dpi.value||'72', 10) : 72;
  if(value === 150 || value === 300) return value;
  return 72;
}

function getJPEGQuality(){
  const raw = parseFloat(controls.jpegQ ? controls.jpegQ.value || '0.88' : '0.88');
  if(!Number.isFinite(raw)) return 0.88;
  return Math.min(0.95, Math.max(0.6, raw));
}

async function rasterizeSVGToCanvas(svgString, width, height, background){
  const canvas = createExportCanvas(width, height);
  const ctx = canvas.getContext('2d', {alpha: !background});
  if(!ctx) throw new Error('Impossibile ottenere il contesto di disegno');
  ctx.imageSmoothingEnabled = true;
  if(ctx.imageSmoothingQuality){
    ctx.imageSmoothingQuality = 'high';
  }
  if(background){
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }else{
    ctx.clearRect(0, 0, width, height);
  }
  const drawable = await createSVGDrawable(svgString);
  try{
    drawable.draw(ctx, width, height);
  }finally{
    drawable.cleanup();
  }
  return canvas;
}

async function createSVGDrawable(svgString){
  const blob = new Blob([svgString], {type:'image/svg+xml'});
  if(typeof createImageBitmap === 'function'){
    try{
      const bitmap = await createImageBitmap(blob);
      return {
        draw(ctx, width, height){
          ctx.drawImage(bitmap, 0, 0, width, height);
        },
        cleanup(){
          if(typeof bitmap.close === 'function'){
            bitmap.close();
          }
        }
      };
    }catch(err){
      // fallback to Image
    }
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return {
    draw(ctx, width, height){
      ctx.drawImage(img, 0, 0, width, height);
    },
    cleanup(){
      URL.revokeObjectURL(url);
    }
  };
}

function createExportCanvas(width, height){
  if(typeof OffscreenCanvas !== 'undefined'){
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasToBlobWithDPI(canvas, format, quality, dpi){
  let blob;
  if(typeof canvas.convertToBlob === 'function'){
    blob = await canvas.convertToBlob({type: format, quality});
  }else{
    blob = await new Promise((resolve, reject) => {
      const handler = (b) => b ? resolve(b) : reject(new Error('Raster export failed'));
      const result = canvas.toBlob(handler, format, quality);
      if(result && typeof result.then === 'function'){
        result.then(resolve, reject);
      }
    });
  }
  return injectDPI(blob, format, dpi);
}

async function injectDPI(blob, format, dpi){
  if(format === 'image/png'){
    return injectPNGDPI(blob, dpi);
  }
  if(format === 'image/jpeg'){
    return injectJPEGDPI(blob, dpi);
  }
  return blob;
}

async function injectPNGDPI(blob, dpi){
  try{
    const buffer = new Uint8Array(await blob.arrayBuffer());
    if(buffer.length < 8) return blob;
    const signature = [137,80,78,71,13,10,26,10];
    for(let i=0;i<signature.length;i++){
      if(buffer[i] !== signature[i]) return blob;
    }
    const dpmm = Math.max(1, Math.round(dpi / 0.0254));
    let offset = 8;
    let updated = false;
    while(offset + 12 <= buffer.length){
      const length = readUint32BE(buffer, offset);
      const type = String.fromCharCode(buffer[offset+4], buffer[offset+5], buffer[offset+6], buffer[offset+7]);
      if(type === 'pHYs'){
        writeUint32BE(buffer, offset+8, dpmm);
        writeUint32BE(buffer, offset+12, dpmm);
        buffer[offset+16] = 1;
        const crc = crc32(buffer.subarray(offset+4, offset+8+length));
        writeUint32BE(buffer, offset+8+length, crc);
        updated = true;
        break;
      }
      if(type === 'IEND') break;
      offset += 12 + length;
    }
    if(updated){
      return new Blob([buffer], {type:'image/png'});
    }
    const ihdrLength = readUint32BE(buffer, 8);
    const ihdrTotal = 12 + ihdrLength;
    const insertPos = 8 + ihdrTotal;
    const chunkData = new Uint8Array(9);
    writeUint32BE(chunkData, 0, dpmm);
    writeUint32BE(chunkData, 4, dpmm);
    chunkData[8] = 1;
    const chunkType = new Uint8Array([0x70,0x48,0x59,0x73]);
    const lengthBytes = new Uint8Array(4);
    writeUint32BE(lengthBytes, 0, 9);
    const typeAndData = new Uint8Array(4 + chunkData.length);
    typeAndData.set(chunkType, 0);
    typeAndData.set(chunkData, 4);
    const crcValue = crc32(typeAndData);
    const crcBytes = new Uint8Array(4);
    writeUint32BE(crcBytes, 0, crcValue);
    const newBuffer = new Uint8Array(buffer.length + 4 + typeAndData.length + 4);
    newBuffer.set(buffer.subarray(0, insertPos), 0);
    let cursor = insertPos;
    newBuffer.set(lengthBytes, cursor); cursor += 4;
    newBuffer.set(typeAndData, cursor); cursor += typeAndData.length;
    newBuffer.set(crcBytes, cursor); cursor += 4;
    newBuffer.set(buffer.subarray(insertPos), cursor);
    return new Blob([newBuffer], {type:'image/png'});
  }catch(err){
    return blob;
  }
}

async function injectJPEGDPI(blob, dpi){
  try{
    const buffer = new Uint8Array(await blob.arrayBuffer());
    if(buffer.length < 2 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) return blob;
    const density = Math.max(1, Math.round(dpi));
    let offset = 2;
    while(offset + 4 < buffer.length){
      if(buffer[offset] !== 0xFF) break;
      const marker = buffer[offset+1];
      if(marker === 0xDA) break;
      const length = (buffer[offset+2] << 8) | buffer[offset+3];
      if(marker === 0xE0 && length >= 16 && buffer[offset+4] === 0x4A && buffer[offset+5] === 0x46 && buffer[offset+6] === 0x49 && buffer[offset+7] === 0x46 && buffer[offset+8] === 0x00){
        buffer[offset+11] = 1;
        buffer[offset+12] = (density >> 8) & 0xFF;
        buffer[offset+13] = density & 0xFF;
        buffer[offset+14] = (density >> 8) & 0xFF;
        buffer[offset+15] = density & 0xFF;
        return new Blob([buffer], {type:'image/jpeg'});
      }
      offset += 2 + length;
    }
    const segment = new Uint8Array(18);
    segment[0] = 0xFF; segment[1] = 0xE0;
    segment[2] = 0x00; segment[3] = 0x10;
    segment[4] = 0x4A; segment[5] = 0x46; segment[6] = 0x49; segment[7] = 0x46; segment[8] = 0x00;
    segment[9] = 0x01; segment[10] = 0x02;
    segment[11] = 0x01;
    segment[12] = (density >> 8) & 0xFF;
    segment[13] = density & 0xFF;
    segment[14] = (density >> 8) & 0xFF;
    segment[15] = density & 0xFF;
    segment[16] = 0x00;
    segment[17] = 0x00;
    const newBuffer = new Uint8Array(buffer.length + segment.length);
    newBuffer.set(buffer.subarray(0, 2), 0);
    newBuffer.set(segment, 2);
    newBuffer.set(buffer.subarray(2), 2 + segment.length);
    return new Blob([newBuffer], {type:'image/jpeg'});
  }catch(err){
    return blob;
  }
}

function readUint32BE(buffer, offset){
  return ((buffer[offset] << 24) >>> 0) + (buffer[offset+1] << 16) + (buffer[offset+2] << 8) + buffer[offset+3];
}

function writeUint32BE(buffer, offset, value){
  buffer[offset] = (value >>> 24) & 0xFF;
  buffer[offset+1] = (value >>> 16) & 0xFF;
  buffer[offset+2] = (value >>> 8) & 0xFF;
  buffer[offset+3] = value & 0xFF;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for(let n=0;n<256;n++){
    let c = n;
    for(let k=0;k<8;k++){
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes){
  let c = 0xFFFFFFFF;
  for(let i=0;i<bytes.length;i++){
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function bindExportButtons(){
  const svgBtn = $('dlSVG');
  if(svgBtn){
    svgBtn.addEventListener('click', async () => {
      if(svgBtn.dataset.busy === 'true') return;
      setButtonBusy(svgBtn, true, 'Preparing…');
      try{
        await downloadSVG();
      }finally{
        setButtonBusy(svgBtn, false);
        updateExportButtons();
      }
    });
  }
  const pngBtn = $('dlPNG');
  if(pngBtn){
    pngBtn.addEventListener('click', async () => {
      if(pngBtn.dataset.busy === 'true') return;
      setButtonBusy(pngBtn, true, 'Preparing…');
      try{
        await downloadRaster('image/png');
      }finally{
        setButtonBusy(pngBtn, false);
        updateExportButtons();
      }
    });
  }
  const jpgBtn = $('dlJPG');
  if(jpgBtn){
    jpgBtn.addEventListener('click', async () => {
      if(jpgBtn.dataset.busy === 'true') return;
      setButtonBusy(jpgBtn, true, 'Preparing…');
      try{
        await downloadRaster('image/jpeg');
      }finally{
        setButtonBusy(jpgBtn, false);
        updateExportButtons();
      }
    });
  }
}

let placeholderCanvas = null;
function getPlaceholderCanvas(){
  if(!placeholderCanvas){
    placeholderCanvas = document.createElement('canvas');
    placeholderCanvas.width = 800;
    placeholderCanvas.height = 400;
    const ctx = placeholderCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0,0,placeholderCanvas.width,placeholderCanvas.height);
    ctx.fillStyle = '#000000';
    ctx.font = '700 140px "JetBrains Mono", monospace';
    ctx.fillText('Aa', 20, 160);
  }
  return placeholderCanvas;
}

bindExportButtons();
init();
