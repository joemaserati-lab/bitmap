const $ = (id) => document.getElementById(id);

const preview = $('preview');
const meta = $('meta');
const uploadMessage = $('uploadMessage');
const progressWrap = $('uploadProgressWrapper');
const progressBar = $('uploadProgressBar');
const exportModal = $('exportModal');
const exportDialog = exportModal ? exportModal.querySelector('.export-modal__dialog') : null;
const exportOverlay = exportModal ? exportModal.querySelector('.export-modal__overlay') : null;
const openExportButton = $('openExport');
const closeExportButton = $('closeExport');

const CONTROL_IDS = [
  'pixelSize','pixelSizeNum','threshold','thresholdNum','blur','blurNum','grain','grainNum','glow','glowNum',
  'blackPoint','blackPointNum','whitePoint','whitePointNum','gammaVal','gammaValNum',
  'brightness','brightnessNum','contrast','contrastNum','style','thickness','thicknessNum',
  'dither','invert','bg','fg','scale','scaleNum','fmt','dpi','exportScale','outW','outH','lockAR',
  'jpegQ','jpegQNum','rasterBG'
];

const controls = {};
for(const id of CONTROL_IDS){
  controls[id] = $(id);
}

const MAX_UPLOAD_DIMENSION = 800;
const PREVIEW_MAX_DIMENSION = 360;
const VIDEO_PREVIEW_FPS = 8;
const VIDEO_EXPORT_FPS = 12;
const MAX_VIDEO_FRAMES = 240;
const RENDER_DEBOUNCE_MS = 90;

const OFFSCREEN_SUPPORTED = typeof OffscreenCanvas !== 'undefined';

const state = {
  sourceCanvas: null,
  sourceName: '',
  sourceWidth: 0,
  sourceHeight: 0,
  sourceVersion: 0,
  sourceKind: 'image',
  sourceKey: '',
  worker: null,
  workerReady: false,
  workerReadyPromise: null,
  workerReadyResolve: null,
  workerSourceVersion: 0,
  workerSourceKey: '',
  pendingSourcePromise: null,
  pendingSourceVersion: 0,
  pendingSourceKey: '',
  pendingSourceResolvers: null,
  sourceToken: 0,
  pendingJobs: new Map(),
  currentJobId: 0,
  lastResult: null,
  lastResultId: 0,
  lastPreview: null,
  lastSVG: '',
  lastSVGJob: 0,
  lastSize: {width: 0, height: 0},
  lastScale: 1,
  offscreenSupported: OFFSCREEN_SUPPORTED,
  sourceOffscreen: null,
  videoSource: null,
  previewPlayer: null
};

let renderQueued = false;
let renderTimer = null;
let renderRaf = 0;
let renderBusy = false;
let exportModalVisible = false;
let lastFocusedBeforeExport = null;

function init(){
  initWorker();
  bindControls();
  bindFileInputs();
  bindDropzone();
  bindExportModal();
  bindPlaybackControl();
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
    const {version, key=''} = data;
    if(state.pendingSourcePromise && state.pendingSourceVersion === version){
      state.workerSourceVersion = version;
      state.workerSourceKey = key;
      const {resolve} = state.pendingSourceResolvers || {};
      state.pendingSourceResolvers = null;
      state.pendingSourcePromise = null;
      state.pendingSourceKey = '';
      if(resolve) resolve();
    }else{
      if(key) state.workerSourceKey = key;
      if(version > state.workerSourceVersion){
        state.workerSourceVersion = version;
      }
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
    ['glow','glowNum'],
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

  if(controls.outW){
    controls.outW.addEventListener('input', () => handleExportDimensionInput('width'));
    controls.outW.addEventListener('change', () => handleExportDimensionInput('width'));
  }
  if(controls.outH){
    controls.outH.addEventListener('input', () => handleExportDimensionInput('height'));
    controls.outH.addEventListener('change', () => handleExportDimensionInput('height'));
  }
  if(controls.exportScale){
    controls.exportScale.addEventListener('change', () => {
      applyExportScalePreset(true);
      updateExportButtons();
    });
  }
}

function getExportScalePreset(){
  if(!controls.exportScale) return 1;
  const raw = parseFloat(controls.exportScale.value || '1');
  if(!Number.isFinite(raw) || raw < 1) return 1;
  return raw;
}

function getExportBaseSize(){
  if(state.lastResult){
    if(state.lastResult.type === 'image' && state.lastResult.frame){
      const frame = state.lastResult.frame;
      return {
        width: frame.outputWidth || state.sourceWidth || state.lastSize.width || 0,
        height: frame.outputHeight || state.sourceHeight || state.lastSize.height || 0
      };
    }
    if(state.lastResult.type === 'video' && state.lastResult.frames && state.lastResult.frames.length){
      const frame = state.lastResult.frames[0];
      return {
        width: frame.outputWidth || state.sourceWidth || state.lastSize.width || 0,
        height: frame.outputHeight || state.sourceHeight || state.lastSize.height || 0
      };
    }
  }
  if(state.sourceWidth && state.sourceHeight){
    return {width: state.sourceWidth, height: state.sourceHeight};
  }
  if(state.lastSize.width && state.lastSize.height){
    return {width: state.lastSize.width, height: state.lastSize.height};
  }
  return {width: 1024, height: 1024};
}

function updateExportDimensionPlaceholders(){
  if(!controls.outW || !controls.outH) return;
  const base = getExportBaseSize();
  const placeholderW = base.width ? Math.min(3000, Math.max(1, Math.round(base.width))) : '';
  const placeholderH = base.height ? Math.min(3000, Math.max(1, Math.round(base.height))) : '';
  controls.outW.placeholder = placeholderW ? String(placeholderW) : 'auto';
  controls.outH.placeholder = placeholderH ? String(placeholderH) : 'auto';
}

function areDimensionsAuto(){
  if(!controls.outW || !controls.outH) return false;
  if(controls.outW.dataset.autoDim !== 'true' || controls.outH.dataset.autoDim !== 'true'){
    return false;
  }
  const currentScale = controls.exportScale ? controls.exportScale.value || '1' : '1';
  return controls.outW.dataset.autoScale === currentScale && controls.outH.dataset.autoScale === currentScale;
}

function setDimensionInputs(width, height, markAuto=false, scaleValue='1'){
  if(controls.outW){
    controls.outW.value = width ? String(Math.max(1, Math.round(width))) : '';
    if(markAuto){
      controls.outW.dataset.autoDim = 'true';
      controls.outW.dataset.autoScale = scaleValue;
    }else{
      delete controls.outW.dataset.autoDim;
      delete controls.outW.dataset.autoScale;
    }
  }
  if(controls.outH){
    controls.outH.value = height ? String(Math.max(1, Math.round(height))) : '';
    if(markAuto){
      controls.outH.dataset.autoDim = 'true';
      controls.outH.dataset.autoScale = scaleValue;
    }else{
      delete controls.outH.dataset.autoDim;
      delete controls.outH.dataset.autoScale;
    }
  }
}

function clearDimensionAuto(){
  if(controls.outW){
    delete controls.outW.dataset.autoDim;
    delete controls.outW.dataset.autoScale;
  }
  if(controls.outH){
    delete controls.outH.dataset.autoDim;
    delete controls.outH.dataset.autoScale;
  }
}

function clampExportDimensions(width, height, ratio){
  let w = Math.max(1, Math.round(width));
  let h = Math.max(1, Math.round(height));
  if(ratio && ratio > 0){
    h = Math.max(1, Math.round(w / ratio));
  }
  const limitW = w > 0 ? 3000 / w : 1;
  const limitH = h > 0 ? 3000 / h : 1;
  const scale = Math.min(limitW, limitH, 1);
  if(scale < 1){
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    if(ratio && ratio > 0){
      h = Math.max(1, Math.round(w / ratio));
    }
  }
  w = Math.min(3000, Math.max(1, w));
  h = Math.min(3000, Math.max(1, h));
  return {width: w, height: h};
}

function applyExportScalePreset(force){
  if(!controls.exportScale) return;
  const scaleValue = controls.exportScale.value || '1';
  const factor = parseFloat(scaleValue);
  if(!Number.isFinite(factor) || factor < 1){
    if(force){
      clearDimensionAuto();
    }
    updateExportDimensionPlaceholders();
    return;
  }
  if(!force && !areDimensionsAuto()){
    return;
  }
  const base = getExportBaseSize();
  if(base.width <= 0 || base.height <= 0){
    updateExportDimensionPlaceholders();
    return;
  }
  const ratio = base.height > 0 ? base.width / base.height : 1;
  const scaled = clampExportDimensions(base.width * factor, base.height * factor, ratio);
  setDimensionInputs(scaled.width, scaled.height, true, scaleValue);
  updateExportDimensionPlaceholders();
}

function handleExportDimensionInput(source){
  if(controls.exportScale && controls.exportScale.value !== '1'){
    controls.exportScale.value = '1';
  }
  clearDimensionAuto();
  if(!controls.lockAR || !controls.lockAR.checked) return;
  const base = getExportBaseSize();
  const ratio = base.height > 0 ? base.width / base.height : 0;
  if(!(ratio > 0)) return;
  if(source === 'width' && controls.outW){
    const width = parseInt(controls.outW.value || '', 10);
    if(Number.isFinite(width) && width > 0){
      const dims = clampExportDimensions(width, width / ratio, ratio);
      setDimensionInputs(dims.width, dims.height, false);
    }
  }else if(source === 'height' && controls.outH){
    const height = parseInt(controls.outH.value || '', 10);
    if(Number.isFinite(height) && height > 0){
      const width = height * ratio;
      const dims = clampExportDimensions(width, height, ratio);
      setDimensionInputs(dims.width, dims.height, false);
    }
  }
}

function refreshExportDimensionUI(){
  updateExportDimensionPlaceholders();
  applyExportScalePreset(false);
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

function bindExportModal(){
  if(!exportModal || !openExportButton) return;
  openExportButton.addEventListener('click', () => {
    if(openExportButton.disabled) return;
    openExportSettings();
  });
  if(closeExportButton){
    closeExportButton.addEventListener('click', () => closeExportSettings());
  }
  if(exportOverlay){
    exportOverlay.addEventListener('click', () => closeExportSettings());
  }
  exportModal.addEventListener('click', (event) => {
    const target = event.target;
    if(target instanceof HTMLElement && target.dataset && target.dataset.exportClose === 'true'){
      closeExportSettings();
    }
  });
  document.addEventListener('keydown', (event) => {
    if(!exportModalVisible) return;
    if(event.key === 'Escape'){
      event.preventDefault();
      closeExportSettings();
    }else if(event.key === 'Tab'){
      handleExportFocusTrap(event);
    }
  });
}

function openExportSettings(){
  if(!exportModal || exportModalVisible) return;
  exportModal.hidden = false;
  exportModal.setAttribute('aria-hidden','false');
  exportModalVisible = true;
  lastFocusedBeforeExport = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if(document.body){
    document.body.classList.add('modal-open');
  }
  refreshExportDimensionUI();
  updateExportButtons();
  const focusables = getExportFocusableElements();
  const autofocus = exportModal.querySelector('[data-export-autofocus]');
  const focusTarget = autofocus instanceof HTMLElement && !autofocus.disabled && autofocus.offsetParent !== null
    ? autofocus
    : (focusables[0] || exportDialog);
  requestAnimationFrame(() => {
    if(exportDialog && typeof exportDialog.focus === 'function'){
      exportDialog.focus();
    }
    if(focusTarget && typeof focusTarget.focus === 'function'){
      focusTarget.focus();
    }
  });
}

function closeExportSettings(fallback){
  if(!exportModal || !exportModalVisible) return;
  exportModal.setAttribute('aria-hidden','true');
  exportModal.hidden = true;
  exportModalVisible = false;
  if(document.body){
    document.body.classList.remove('modal-open');
  }
  const preferred = fallback && typeof fallback.focus === 'function' ? fallback : null;
  const last = lastFocusedBeforeExport && typeof lastFocusedBeforeExport.focus === 'function' ? lastFocusedBeforeExport : null;
  const target = preferred || last || openExportButton;
  if(target && typeof target.focus === 'function'){
    setTimeout(() => target.focus(), 0);
  }
  lastFocusedBeforeExport = null;
}

function getExportFocusableElements(){
  if(!exportDialog) return [];
  const selectors = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  return Array.from(exportDialog.querySelectorAll(selectors)).filter((el) => {
    if(!(el instanceof HTMLElement)) return false;
    if(el.hasAttribute('hidden')) return false;
    const style = window.getComputedStyle(el);
    if(style.visibility === 'hidden' || style.display === 'none') return false;
    return el.offsetParent !== null || el === document.activeElement;
  });
}

function handleExportFocusTrap(event){
  const focusable = getExportFocusableElements();
  if(!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if(event.shiftKey){
    if(active === first || !exportDialog || !exportDialog.contains(active)){
      event.preventDefault();
      last.focus();
    }
  }else if(active === last){
    event.preventDefault();
    first.focus();
  }
}

function bindPlaybackControl(){
  const btn = $('togglePlayback');
  if(!btn) return;
  btn.addEventListener('click', () => {
    const player = state.previewPlayer;
    if(!player) return;
    player.playing = !player.playing;
    if(player.playing){
      player.accumulator = 0;
      player.lastTime = 0;
      updatePlaybackButton(true, true);
    }else{
      updatePlaybackButton(true, false);
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
    let handled = false;
    if(type.startsWith('video/')){
      const videoData = await loadVideoAsset(file);
      if(!videoData) throw new Error('Impossibile elaborare il video');
      setSourceVideo(videoData, file.name||'');
      handled = true;
    }else if(type === 'image/gif' || (file.name && file.name.toLowerCase().endsWith('.gif'))){
      const videoData = await loadGifAsset(file);
      if(videoData){
        setSourceVideo(videoData, file.name||'');
        handled = true;
      }else{
        const canvas = await readImageFileToCanvas(file);
        setSourceCanvas(canvas, file.name||'');
        handled = true;
      }
    }else if(type.startsWith('image/')){
      const canvas = await readImageFileToCanvas(file);
      setSourceCanvas(canvas, file.name||'');
      handled = true;
    }
    if(!handled){
      throw new Error('Formato file non supportato');
    }
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

async function loadVideoAsset(file){
  return decodeVideoElementFrames(file);
}

async function loadGifAsset(file){
  if(typeof ImageDecoder === 'undefined'){
    return null;
  }
  try{
    const decoder = new ImageDecoder({data: file, type: file.type || 'image/gif'});
    const track = decoder.tracks ? decoder.tracks.selectedTrack : null;
    const frameCount = track ? Math.min(track.frameCount || 0, MAX_VIDEO_FRAMES) : MAX_VIDEO_FRAMES;
    if(frameCount <= 1){
      return null;
    }
    const previewFrames = [];
    const exportFrames = [];
    const previewDurations = [];
    let exportWidth = 0;
    let exportHeight = 0;
    for(let i=0;i<frameCount;i++){
      const {image, duration} = await decoder.decode({frameIndex: i});
      const frameDuration = duration && duration > 0 ? duration : Math.round(1000/VIDEO_PREVIEW_FPS);
      const exportDims = scaleDimensions(image.width, image.height, MAX_UPLOAD_DIMENSION);
      const previewDims = scaleDimensions(image.width, image.height, PREVIEW_MAX_DIMENSION);
      const exportCanvas = drawBitmapToCanvas(image, exportDims.width, exportDims.height);
      const previewCanvas = drawBitmapToCanvas(image, previewDims.width, previewDims.height);
      exportWidth = exportDims.width;
      exportHeight = exportDims.height;
      exportFrames.push(exportCanvas);
      previewFrames.push(previewCanvas);
      previewDurations.push(frameDuration);
      updateUploadProgress((i+1)/frameCount);
      if(typeof image.close === 'function'){
        try{ image.close(); }catch(err){ /* ignore */ }
      }
    }
    const totalDuration = previewDurations.reduce((sum, val) => sum + val, 0) || (previewFrames.length * 1000/VIDEO_PREVIEW_FPS);
    const fps = totalDuration > 0 ? (previewFrames.length / (totalDuration/1000)) : VIDEO_PREVIEW_FPS;
    return {
      type: 'video',
      exportWidth,
      exportHeight,
      previewFrames,
      exportFrames,
      previewDurations,
      exportDurations: previewDurations.slice(),
      previewFPS: fps,
      exportFPS: fps,
      frameCount: previewFrames.length,
      durationMs: totalDuration
    };
  }catch(err){
    console.error(err);
    return null;
  }
}

async function decodeVideoElementFrames(file){
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  try{
    await waitForVideo(video, 'loadedmetadata');
    const width = video.videoWidth || 1;
    const height = video.videoHeight || 1;
    const exportDims = scaleDimensions(width, height, MAX_UPLOAD_DIMENSION);
    const previewDims = scaleDimensions(width, height, PREVIEW_MAX_DIMENSION);
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    let frameCount = duration > 0 ? Math.round(duration * VIDEO_PREVIEW_FPS) : VIDEO_PREVIEW_FPS * 3;
    frameCount = Math.max(1, Math.min(MAX_VIDEO_FRAMES, frameCount));
    const interval = duration > 0 ? duration / frameCount : 1 / VIDEO_PREVIEW_FPS;
    const previewFrames = [];
    const exportFrames = [];
    const durations = [];
    for(let i=0;i<frameCount;i++){
      const targetTime = duration > 0 ? Math.min(duration - 0.0005, Math.max(0, i * interval)) : 0;
      await seekVideo(video, targetTime);
      const exportCanvas = captureVideoFrame(video, exportDims.width, exportDims.height);
      const previewCanvas = captureVideoFrame(video, previewDims.width, previewDims.height);
      exportFrames.push(exportCanvas);
      previewFrames.push(previewCanvas);
      durations.push(Math.round(Math.max(16, interval * 1000)));
      updateUploadProgress((i+1)/frameCount);
    }
    const totalDuration = durations.reduce((sum, val) => sum + val, 0) || (frameCount * 1000/VIDEO_PREVIEW_FPS);
    const fps = totalDuration > 0 ? (frameCount / (totalDuration/1000)) : VIDEO_PREVIEW_FPS;
    return {
      type: 'video',
      exportWidth: exportDims.width,
      exportHeight: exportDims.height,
      previewFrames,
      exportFrames,
      previewDurations: durations.slice(),
      exportDurations: durations.slice(),
      previewFPS: fps,
      exportFPS: fps,
      frameCount,
      durationMs: totalDuration
    };
  }finally{
    video.pause();
    video.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}

function drawBitmapToCanvas(imageBitmap, width, height){
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function waitForVideo(video, event){
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(event, onSuccess);
      video.removeEventListener('error', onError);
    };
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Errore durante il caricamento del video'));
    };
    video.addEventListener(event, onSuccess, {once:true});
    video.addEventListener('error', onError, {once:true});
  });
}

async function seekVideo(video, time){
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Errore durante la lettura del video'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked, {once:true});
    video.addEventListener('error', onError, {once:true});
    try{
      const maxTime = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, video.duration - 0.0005) : time;
      video.currentTime = Math.min(maxTime, Math.max(0, time));
    }catch(err){
      cleanup();
      reject(err);
    }
  });
}

function captureVideoFrame(video, width, height){
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function setSourceCanvas(canvas, name){
  stopPreviewAnimation();
  state.sourceKind = 'image';
  state.videoSource = null;
  state.sourceCanvas = canvas;
  state.sourceName = name;
  state.sourceWidth = canvas.width;
  state.sourceHeight = canvas.height;
  state.lastResult = null;
  state.lastResultId = 0;
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
  state.sourceKey = `still:${state.sourceVersion}`;
  state.workerSourceVersion = 0;
  state.workerSourceKey = '';
  state.pendingSourceKey = '';
  updateExportButtons();
  refreshExportDimensionUI();
}

function setSourceVideo(videoData, name){
  if(!videoData) return;
  stopPreviewAnimation();
  state.sourceKind = 'video';
  state.videoSource = videoData;
  state.sourceCanvas = null;
  state.sourceOffscreen = null;
  state.sourceName = name;
  state.sourceWidth = videoData.exportWidth;
  state.sourceHeight = videoData.exportHeight;
  state.lastResult = null;
  state.lastResultId = 0;
  state.lastPreview = null;
  state.lastSVG = '';
  state.lastSVGJob = 0;
  state.lastSize = {width: 0, height: 0};
  state.lastScale = 1;
  state.sourceVersion++;
  state.sourceKey = `video:${state.sourceVersion}`;
  state.workerSourceVersion = 0;
  state.workerSourceKey = '';
  state.pendingSourceKey = '';
  updateExportButtons();
  refreshExportDimensionUI();
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

async function ensureWorkerSource(source){
  if(!source) return;
  await ensureWorkerReady();
  const width = source.width;
  const height = source.height;
  if(!width || !height) throw new Error('Sorgente non valida');
  const key = source.key || `${state.sourceKey}:${width}x${height}`;
  if(state.workerSourceKey === key){
    return;
  }
  if(state.pendingSourcePromise && state.pendingSourceKey === key){
    await state.pendingSourcePromise;
    return;
  }
  const version = ++state.sourceToken;
  state.pendingSourceVersion = version;
  state.pendingSourceKey = key;
  state.pendingSourcePromise = new Promise((resolve, reject) => {
    state.pendingSourceResolvers = {resolve, reject};
  });
  const payload = {
    type: 'load-source',
    version,
    key,
    width,
    height
  };
  const transfers = [];
  if(source.offscreen){
    payload.offscreen = source.offscreen;
    transfers.push(source.offscreen);
  }else if(source.bitmap){
    payload.image = source.bitmap;
    transfers.push(source.bitmap);
  }else if(source.canvas){
    const bitmap = await createImageBitmap(source.canvas);
    payload.image = bitmap;
    transfers.push(bitmap);
  }else{
    throw new Error('Sorgente non valida');
  }
  try{
    state.worker.postMessage(payload, transfers);
  }catch(err){
    state.pendingSourcePromise = null;
    state.pendingSourceResolvers = null;
    state.pendingSourceKey = '';
    throw err;
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
  const glow = Math.max(0, Math.min(100, parseInt(controls.glow.value||'0',10)));
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
  return {px, thr, blurPx, grain, glow, bp, wp, gam, bri, con, style, thick, mode, invertMode, bg, fg, scale};
}

function buildWorkerOptions(options){
  return {
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
  };
}

async function generate(){
  const options = collectRenderOptions();
  if(state.sourceKind === 'video' && state.videoSource){
    await generateVideoPreview(options);
    return;
  }
  const canvas = state.sourceCanvas || getPlaceholderCanvas();
  let offscreen = null;
  if(state.offscreenSupported && state.sourceOffscreen){
    offscreen = state.sourceOffscreen;
    state.sourceOffscreen = null;
  }
  await ensureWorkerSource({
    canvas,
    offscreen,
    width: canvas.width,
    height: canvas.height,
    key: state.sourceKey || `still:${state.sourceVersion}`
  });
  const jobId = ++state.currentJobId;
  const workerOptions = buildWorkerOptions(options);
  const payload = {
    type: 'process',
    jobId,
    options: workerOptions
  };
  const result = await requestWorkerProcess(payload);
  if(!result || result.jobId !== jobId) return;
  state.lastResult = {type: 'image', options, frame: result};
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
  refreshExportDimensionUI();
}

async function generateVideoPreview(options){
  const video = state.videoSource;
  if(!video || !video.previewFrames || !video.previewFrames.length){
    state.lastResult = null;
    state.lastPreview = null;
    state.lastSVG = '';
    state.lastSVGJob = 0;
    state.lastSize = {width: 0, height: 0};
    state.lastScale = options.scale;
    renderPreview(null, options.scale);
    updateMeta(0, 0);
    updateExportButtons();
    return;
  }
  const frames = [];
  const durations = (video.previewDurations && video.previewDurations.length === video.previewFrames.length)
    ? video.previewDurations.slice()
    : new Array(video.previewFrames.length).fill(Math.round(1000/(video.previewFPS || VIDEO_PREVIEW_FPS)));
  for(let i=0;i<video.previewFrames.length;i++){
    const frameCanvas = video.previewFrames[i];
    await ensureWorkerSource({
      canvas: frameCanvas,
      width: frameCanvas.width,
      height: frameCanvas.height,
      key: `${state.sourceKey}:preview:${i}:${frameCanvas.width}x${frameCanvas.height}`
    });
    const jobId = ++state.currentJobId;
    const workerOptions = buildWorkerOptions(options);
    const payload = {
      type: 'process',
      jobId,
      options: workerOptions
    };
    const result = await requestWorkerProcess(payload);
    if(!result || result.jobId !== jobId) return;
    frames.push(result);
  }
  state.lastResult = {type: 'video', options, frames, durations};
  state.lastResultId = state.currentJobId;
  state.lastSVG = '';
  state.lastSVGJob = 0;
  const previewData = buildAnimationPreviewData(frames, options, durations, video.previewFPS || VIDEO_PREVIEW_FPS);
  state.lastPreview = previewData;
  const previewWidth = previewData ? previewData.width : 0;
  const previewHeight = previewData ? previewData.height : 0;
  state.lastSize = {width: previewWidth, height: previewHeight};
  state.lastScale = options.scale;
  renderPreview(previewData, options.scale);
  updateMeta(previewWidth, previewHeight);
  updateExportButtons();
  refreshExportDimensionUI();
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
    return null;
  }
  const {gridWidth, gridHeight, mode, mask} = result;
  const tile = result.tile != null ? result.tile : Math.max(1, options.px);
  const width = Math.round(result.outputWidth || (gridWidth * tile));
  const height = Math.round(result.outputHeight || (gridHeight * tile));
  const previewMode = mode || options.mode || 'none';
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
    fg: options.fg,
    glow: options.glow
  };
}

function buildAnimationPreviewData(results, options, durations, fps){
  if(!results || !results.length){
    return null;
  }
  const tile = results[0].tile != null ? results[0].tile : Math.max(1, options.px);
  const first = results[0];
  const width = Math.round(first.outputWidth || (first.gridWidth * tile));
  const height = Math.round(first.outputHeight || (first.gridHeight * tile));
  const frames = results.map((res) => ({
    gridWidth: res.gridWidth,
    gridHeight: res.gridHeight,
    tile: res.tile != null ? res.tile : tile,
    mask: res.mask
  }));
  const effectiveDurations = durations.slice(0, frames.length);
  const total = effectiveDurations.reduce((sum, val) => sum + val, 0) || (frames.length * 1000/VIDEO_PREVIEW_FPS);
  const derivedFPS = total > 0 ? (frames.length / (total/1000)) : (fps || VIDEO_PREVIEW_FPS);
  return {
    type: 'animation',
    width,
    height,
    frames,
    durations: effectiveDurations,
    bg: options.bg,
    fg: options.fg,
    glow: options.glow,
    fps: derivedFPS
  };
}

function buildMaskSVGString(mask, width, height, tile, bg, fg, opts={}){
  if(!mask) return '';
  const unit = tile || 1;
  const svgW = Math.round(width*unit);
  const svgH = Math.round(height*unit);
  const pathData = buildMaskPathData(mask, width, height, unit);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">`;
  if(bg) svg += `<rect width="100%" height="100%" fill="${bg}"/>`;
  const glowAmount = Math.max(0, opts.glow || 0);
  if(glowAmount > 0 && pathData){
    const fgRGB = hexToRGB(fg || '#000000');
    const glowRGB = lightenColor(fgRGB, 0.4);
    const blurRadius = Math.max(0.2, Math.sqrt(unit*unit) * (0.3 + glowAmount/80));
    const glowOpacity = Math.min(1, 0.18 + glowAmount/120);
    svg += `<defs><filter id="glowFx" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="${formatNumber(blurRadius)}" result="blur"/></filter></defs>`;
    svg += `<g filter="url(#glowFx)" opacity="${formatNumber(glowOpacity)}"><path fill="rgb(${glowRGB[0]},${glowRGB[1]},${glowRGB[2]})" d="${pathData}"/></g>`;
  }
  if(pathData){
    svg += `<path fill="${fg}" d="${pathData}"/>`;
  }
  svg += '</svg>';
  return svg;
}

function buildExportSVG(result, options){
  if(!result) return '';
  const tile = result.tile != null ? result.tile : Math.max(1, options.px);
  return buildMaskSVGString(result.mask, result.gridWidth, result.gridHeight, tile, options.bg, options.fg, {glow: options.glow});
}

function buildMaskPathData(mask, width, height, tile){
  let path = '';
  forEachMaskRun(mask, width, height, (x, y, length) => {
    const rectWidth = length * tile;
    const rectX = x * tile;
    const rectY = y * tile;
    path += `M${formatNumber(rectX)} ${formatNumber(rectY)}h${formatNumber(rectWidth)}v${formatNumber(tile)}h-${formatNumber(rectWidth)}z`;
  });
  return path;
}

function formatNumber(value){
  if(!Number.isFinite(value)) return '0';
  const fixed = value.toFixed(3);
  if(fixed.indexOf('.') === -1) return fixed;
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function stopPreviewAnimation(){
  const player = state.previewPlayer;
  if(player && player.rafId){
    cancelAnimationFrame(player.rafId);
  }
  state.previewPlayer = null;
  updatePlaybackButton(false);
}

function updatePlaybackButton(show, playing){
  const btn = $('togglePlayback');
  if(!btn) return;
  if(!show){
    btn.hidden = true;
    btn.setAttribute('aria-pressed', 'true');
    btn.textContent = 'PAUSA';
    return;
  }
  btn.hidden = false;
  if(playing){
    btn.textContent = 'PAUSA';
    btn.setAttribute('aria-pressed','true');
  }else{
    btn.textContent = 'PLAY';
    btn.setAttribute('aria-pressed','false');
  }
}

function startPreviewAnimation(canvas, data){
  const ctx = canvas.getContext('2d', {alpha: !!(data.bg && data.bg !== 'transparent')});
  if(!ctx || !data.frames || !data.frames.length) return;
  const player = {
    canvas,
    ctx,
    data,
    frameIndex: 0,
    accumulator: 0,
    lastTime: 0,
    playing: true,
    rafId: 0
  };
  state.previewPlayer = player;
  updatePlaybackButton(true, true);
  drawAnimationFrame(player, 0);
  const step = (timestamp) => {
    if(state.previewPlayer !== player){
      return;
    }
    if(!player.lastTime) player.lastTime = timestamp;
    const delta = timestamp - player.lastTime;
    player.lastTime = timestamp;
    if(player.playing){
      player.accumulator += delta;
      let frameDuration = data.durations[player.frameIndex] || 125;
      while(player.accumulator >= frameDuration){
        player.accumulator -= frameDuration;
        player.frameIndex = (player.frameIndex + 1) % data.frames.length;
        frameDuration = data.durations[player.frameIndex] || frameDuration;
        drawAnimationFrame(player, player.frameIndex);
      }
    }
    player.rafId = requestAnimationFrame(step);
  };
  player.rafId = requestAnimationFrame(step);
}

function drawAnimationFrame(player, index){
  const frame = player.data.frames[index];
  if(!frame) return;
  paintMask(player.ctx, {
    ...frame,
    bg: player.data.bg,
    fg: player.data.fg,
    glow: player.data.glow
  }, player.canvas.width, player.canvas.height);
}

function renderPreview(previewData, scale){
  if(!preview) return;
  preview.innerHTML = '';
  stopPreviewAnimation();
  if(!previewData){
    if(meta) meta.textContent = '';
    return;
  }
  const frame = document.createElement('div');
  frame.className = 'preview-frame';
  const dims = computePreviewDimensions(previewData.width, previewData.height, scale);
  frame.style.width = `${dims.width}px`;
  frame.style.height = `${dims.height}px`;
  if(previewData.type === 'mask'){
    const canvas = document.createElement('canvas');
    canvas.width = previewData.width;
    canvas.height = previewData.height;
    drawMaskPreview(canvas, previewData);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.imageRendering = 'pixelated';
    frame.appendChild(canvas);
    updatePlaybackButton(false);
  }else if(previewData.type === 'animation'){
    const canvas = document.createElement('canvas');
    canvas.width = previewData.width;
    canvas.height = previewData.height;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.imageRendering = 'pixelated';
    frame.appendChild(canvas);
    startPreviewAnimation(canvas, previewData);
  }
  preview.appendChild(frame);
}

let glowHelperCanvas = null;
let glowHelperCtx = null;

function paintMask(ctx, data, outWidth, outHeight){
  if(!ctx || !data) return;
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.imageSmoothingEnabled = false;
  const bg = data.bg;
  if(bg && bg !== 'transparent'){
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, outWidth, outHeight);
  }else{
    ctx.clearRect(0, 0, outWidth, outHeight);
  }
  const mask = data.mask;
  if(!mask){
    ctx.restore();
    return;
  }
  const gridWidth = data.gridWidth;
  const gridHeight = data.gridHeight;
  const tile = data.tile != null ? data.tile : 1;
  const baseWidth = gridWidth * tile;
  const baseHeight = gridHeight * tile;
  const scaleX = baseWidth ? outWidth / baseWidth : 1;
  const scaleY = baseHeight ? outHeight / baseHeight : 1;
  const cellWidth = tile * scaleX;
  const cellHeight = tile * scaleY;
  const glowAmount = Math.max(0, data.glow || 0);

  if(glowAmount > 0 && ensureGlowContext(outWidth, outHeight)){
    const helperCtx = glowHelperCtx;
    helperCtx.setTransform(1,0,0,1,0,0);
    helperCtx.clearRect(0, 0, outWidth, outHeight);
    const glowRGB = hexToRGB(data.fg || '#000000');
    const glowColor = lightenColor(glowRGB, 0.4);
    helperCtx.fillStyle = `rgba(${glowColor[0]},${glowColor[1]},${glowColor[2]},1)`;
    forEachMaskRun(mask, gridWidth, gridHeight, (x, y, length) => {
      const drawX = x * cellWidth;
      const drawY = y * cellHeight;
      helperCtx.fillRect(drawX, drawY, length * cellWidth, cellHeight);
    });
    const blurRadius = Math.max(0.5, Math.sqrt(cellWidth*cellWidth + cellHeight*cellHeight) * (0.3 + glowAmount/70));
    ctx.save();
    ctx.filter = `blur(${blurRadius.toFixed(2)}px)`;
    ctx.globalAlpha = Math.min(1, 0.18 + glowAmount/120);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(glowHelperCanvas, 0, 0, outWidth, outHeight);
    ctx.restore();
  }

  ctx.fillStyle = data.fg || '#000000';
  forEachMaskRun(mask, gridWidth, gridHeight, (x, y, length) => {
    const drawX = x * cellWidth;
    const drawY = y * cellHeight;
    ctx.fillRect(drawX, drawY, length * cellWidth, cellHeight);
  });
  ctx.restore();
}

function ensureGlowContext(width, height){
  if(!glowHelperCanvas){
    if(typeof document !== 'undefined' && document.createElement){
      glowHelperCanvas = document.createElement('canvas');
    }else if(typeof OffscreenCanvas !== 'undefined'){
      glowHelperCanvas = new OffscreenCanvas(width, height);
    }else{
      return false;
    }
  }
  if(glowHelperCanvas.width !== width || glowHelperCanvas.height !== height){
    glowHelperCanvas.width = width;
    glowHelperCanvas.height = height;
  }
  const ctx = glowHelperCanvas.getContext('2d', {alpha: true});
  if(!ctx) return false;
  glowHelperCtx = ctx;
  return true;
}

function forEachMaskRun(mask, width, height, callback){
  for(let y=0;y<height;y++){
    let runStart = -1;
    const rowOffset = y*width;
    for(let x=0;x<=width;x++){
      const value = x<width ? mask[rowOffset+x] : 0;
      if(value && runStart<0){
        runStart = x;
      }else if((!value || x===width) && runStart>=0){
        const runLength = x - runStart;
        if(runLength>0){
          callback(runStart, y, runLength);
        }
        runStart = -1;
      }
    }
  }
}

function lightenColor([r,g,b], amount){
  const t = Math.max(0, Math.min(1, amount));
  return [
    Math.round(r + (255 - r) * t),
    Math.round(g + (255 - g) * t),
    Math.round(b + (255 - b) * t)
  ];
}

function drawMaskPreview(canvas, data){
  const ctx = canvas.getContext('2d', {alpha: !!data.bg && data.bg !== 'transparent'});
  if(!ctx) return;
  paintMask(ctx, data, canvas.width, canvas.height);
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
  if(state.sourceKind === 'video' && state.videoSource){
    const video = state.videoSource;
    const frames = video.frameCount || (video.previewFrames ? video.previewFrames.length : 0);
    const fps = state.lastPreview && state.lastPreview.fps ? state.lastPreview.fps : (video.previewFPS || VIDEO_PREVIEW_FPS);
    const durationMs = video.durationMs || (frames * (1000/(fps || 1)));
    const durationSec = durationMs / 1000;
    if(width && height){
      meta.textContent = `${width}×${height}px · ${frames} frame · ${fps.toFixed(1)} fps · ${durationSec.toFixed(1)}s`;
    }else{
      meta.textContent = `${frames} frame · ${fps.toFixed(1)} fps · ${durationSec.toFixed(1)}s`;
    }
    return;
  }
  if(width && height){
    meta.textContent = `${width}×${height}px`;
  }else{
    meta.textContent = '';
  }
}

function updateExportButtons(){
  const last = state.lastResult;
  const hasImageResult = !!(last && last.type === 'image' && last.frame);
  const hasVideoResult = !!(last && last.type === 'video' && last.frames && last.frames.length);
  const jobActive = renderBusy || state.pendingJobs.size > 0;
  const isVideo = state.sourceKind === 'video';
  ['dlSVG','dlPNG','dlJPG'].forEach((id) => {
    const btn = $(id);
    if(!btn) return;
    const busy = btn.dataset.busy === 'true';
    let disabled = busy || jobActive || !hasImageResult;
    if(isVideo){
      disabled = true;
    }
    btn.disabled = disabled;
    btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    if(busy) btn.setAttribute('aria-busy','true');
    else btn.removeAttribute('aria-busy');
    if(id !== 'dlSVG'){
      btn.hidden = isVideo;
    }else{
      btn.hidden = false;
    }
  });
  ['dlGIF','dlMP4'].forEach((id) => {
    const btn = $(id);
    if(!btn) return;
    const busy = btn.dataset.busy === 'true';
    if(!isVideo){
      btn.hidden = true;
      btn.disabled = true;
      btn.setAttribute('aria-disabled','true');
      btn.removeAttribute('aria-busy');
      return;
    }
    btn.hidden = false;
    const disabled = busy || jobActive || !hasVideoResult;
    btn.disabled = disabled;
    btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    if(busy) btn.setAttribute('aria-busy','true');
    else btn.removeAttribute('aria-busy');
  });
  if(openExportButton){
    const disableTrigger = jobActive;
    openExportButton.disabled = disableTrigger;
    openExportButton.setAttribute('aria-disabled', disableTrigger ? 'true' : 'false');
  }
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

async function downloadGIF(){
  if(state.sourceKind !== 'video' || !state.videoSource) return;
  const options = collectRenderOptions();
  const exportData = await getVideoExportData(options);
  const dims = alignVideoExportDimensions(getExportDimensions(), exportData.baseWidth, exportData.baseHeight);
  const frames = exportData.frames.map((frame) =>
    maskToBinaryFrame(
      frame.mask,
      frame.gridWidth,
      frame.gridHeight,
      dims.width,
      dims.height,
      frame.tile != null ? frame.tile : options.px
    )
  );
  const gifBytes = encodeBinaryGif(frames, dims.width, dims.height, exportData.durations, options.bg, options.fg);
  const blob = new Blob([gifBytes], {type:'image/gif'});
  triggerDownload(blob, 'bitmap.gif');
}

async function downloadMP4(){
  if(state.sourceKind !== 'video' || !state.videoSource) return;
  if(typeof MediaRecorder === 'undefined'){
    throw new Error('MediaRecorder non supportato per l\'export video in questo browser');
  }
  const mimeType = chooseMediaRecorderType();
  if(!mimeType){
    throw new Error('Nessun formato MP4/WebM supportato per la registrazione');
  }
  const options = collectRenderOptions();
  const exportData = await getVideoExportData(options);
  const dims = alignVideoExportDimensions(getExportDimensions(), exportData.baseWidth, exportData.baseHeight);
  const canvas = createExportCanvas(dims.width, dims.height, {forceDOM: true});
  const videoBg = options.bg === 'transparent' ? '#ffffff' : options.bg;
  const ctx = canvas.getContext('2d', {alpha: false});
  if(!ctx) throw new Error('Impossibile inizializzare il canvas di export');
  const fps = Math.max(1, Math.round(exportData.fps || VIDEO_PREVIEW_FPS));
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {mimeType});
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if(event.data && event.data.size) chunks.push(event.data);
  };
  const finished = new Promise((resolve, reject) => {
    recorder.onstop = resolve;
    recorder.onerror = (event) => reject(event.error || new Error('Registrazione video fallita'));
  });
  recorder.start();
  for(let i=0;i<exportData.frames.length;i++){
    const frame = exportData.frames[i];
    paintMask(ctx, {
      gridWidth: frame.gridWidth,
      gridHeight: frame.gridHeight,
      tile: frame.tile != null ? frame.tile : Math.max(1, options.px),
      mask: frame.mask,
      bg: videoBg,
      fg: options.fg,
      glow: options.glow
    }, dims.width, dims.height);
    const delay = Math.max(16, exportData.durations[i] || Math.round(1000/fps));
    await wait(delay);
  }
  recorder.stop();
  await finished;
  const blob = new Blob(chunks, {type: mimeType});
  const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
  triggerDownload(blob, `bitmap.${extension}`);
}

async function getVideoExportData(options){
  const video = state.videoSource;
  if(!video || !video.exportFrames || !video.exportFrames.length){
    throw new Error('Nessun video disponibile per l\'export');
  }
  const workerOptions = buildWorkerOptions(options);
  const frames = [];
  const durations = (video.exportDurations && video.exportDurations.length === video.exportFrames.length)
    ? video.exportDurations.slice()
    : new Array(video.exportFrames.length).fill(Math.round(1000/(video.exportFPS || VIDEO_PREVIEW_FPS)));
  for(let i=0;i<video.exportFrames.length;i++){
    const frameCanvas = video.exportFrames[i];
    await ensureWorkerSource({
      canvas: frameCanvas,
      width: frameCanvas.width,
      height: frameCanvas.height,
      key: `${state.sourceKey}:export:${i}:${frameCanvas.width}x${frameCanvas.height}`
    });
    const jobId = ++state.currentJobId;
    const payload = {
      type: 'process',
      jobId,
      options: workerOptions
    };
    const result = await requestWorkerProcess(payload);
    if(!result || result.jobId !== jobId){
      throw new Error('Elaborazione video interrotta');
    }
    frames.push(result);
  }
  const firstTile = frames[0].tile != null ? frames[0].tile : Math.max(1, options.px);
  const baseWidth = Math.round(frames[0].gridWidth * firstTile);
  const baseHeight = Math.round(frames[0].gridHeight * firstTile);
  const totalDuration = durations.reduce((sum, val) => sum + val, 0) || (frames.length * 1000/(video.exportFPS || VIDEO_PREVIEW_FPS));
  const fps = totalDuration > 0 ? (frames.length / (totalDuration/1000)) : (video.exportFPS || VIDEO_PREVIEW_FPS);
  return {frames, durations, fps, baseWidth, baseHeight};
}

function alignVideoExportDimensions(dims, baseWidth, baseHeight){
  if(!dims) return {width: baseWidth || 1, height: baseHeight || 1};
  if(!baseWidth || !baseHeight){
    return {width: dims.width, height: dims.height};
  }
  const ratio = baseHeight > 0 ? (baseWidth / baseHeight) : 1;
  let width = Math.max(1, Math.min(3000, Math.round(dims.width || baseWidth)));
  let height = Math.max(1, Math.min(3000, Math.round(dims.height || Math.round(width / (ratio || 1)))));
  const hasWidthInput = !!(controls.outW && controls.outW.value && controls.outW.value.trim() !== '');
  const hasHeightInput = !!(controls.outH && controls.outH.value && controls.outH.value.trim() !== '');
  if(hasWidthInput && !hasHeightInput){
    height = Math.max(1, Math.min(3000, Math.round(width / (ratio || 1))));
  }else if(hasHeightInput && !hasWidthInput){
    width = Math.max(1, Math.min(3000, Math.round(height * (ratio || 1))));
  }else{
    const expectedHeight = Math.max(1, Math.round(width / (ratio || 1)));
    const expectedWidth = Math.max(1, Math.round(height * (ratio || 1)));
    const heightDelta = Math.abs(expectedHeight - height);
    const widthDelta = Math.abs(expectedWidth - width);
    if(heightDelta > widthDelta){
      height = expectedHeight;
    }else{
      width = expectedWidth;
      height = Math.max(1, Math.round(width / (ratio || 1)));
    }
  }
  return {
    width: Math.max(1, Math.min(3000, width)),
    height: Math.max(1, Math.min(3000, height))
  };
}

function maskToBinaryFrame(mask, gridWidth, gridHeight, outWidth, outHeight, tile){
  if(!gridWidth || !gridHeight){
    return new Uint8Array(Math.max(1, Math.round(outWidth || 1)) * Math.max(1, Math.round(outHeight || 1)));
  }
  const unit = Math.max(1e-3, Math.abs(tile || 1));
  const baseWidth = Math.max(1, Math.round(gridWidth * unit));
  const baseHeight = Math.max(1, Math.round(gridHeight * unit));
  const targetWidth = Math.max(1, Math.round(outWidth || baseWidth));
  const targetHeight = Math.max(1, Math.round(outHeight || baseHeight));
  const cellWidthPx = baseWidth / gridWidth;
  const cellHeightPx = baseHeight / gridHeight;
  const output = new Uint8Array(targetWidth * targetHeight);
  for(let y=0;y<targetHeight;y++){
    const srcYPx = Math.min(baseHeight - 1, Math.floor(y * baseHeight / targetHeight));
    const cellY = Math.min(gridHeight - 1, Math.floor(srcYPx / cellHeightPx));
    const rowOffset = cellY * gridWidth;
    for(let x=0;x<targetWidth;x++){
      const srcXPx = Math.min(baseWidth - 1, Math.floor(x * baseWidth / targetWidth));
      const cellX = Math.min(gridWidth - 1, Math.floor(srcXPx / cellWidthPx));
      output[y*targetWidth + x] = mask[rowOffset + cellX] ? 1 : 0;
    }
  }
  return output;
}

function hexToRGB(hex){
  if(!hex || hex === 'transparent'){
    return [255,255,255];
  }
  let value = hex.replace('#','');
  if(value.length === 3){
    value = value.split('').map((c) => c + c).join('');
  }
  if(value.length !== 6){
    return [255,255,255];
  }
  const intVal = parseInt(value, 16);
  if(Number.isNaN(intVal)) return [255,255,255];
  return [
    (intVal >> 16) & 0xFF,
    (intVal >> 8) & 0xFF,
    intVal & 0xFF
  ];
}

function encodeBinaryGif(frames, width, height, durations, bgColor, fgColor){
  const bytes = [];
  const writeByte = (b) => bytes.push(b & 0xFF);
  const writeWord = (w) => { writeByte(w & 0xFF); writeByte((w >> 8) & 0xFF); };
  const pushString = (str) => { for(let i=0;i<str.length;i++) writeByte(str.charCodeAt(i)); };
  const transparent = !bgColor || bgColor === 'transparent';
  const bg = transparent ? [0,0,0] : hexToRGB(bgColor);
  const fg = hexToRGB(fgColor);
  pushString('GIF89a');
  writeWord(width);
  writeWord(height);
  const packedFields = 0x80; // global color table present, 2 entries
  writeByte(packedFields);
  writeByte(0x00);
  writeByte(0x00);
  writeByte(bg[0]); writeByte(bg[1]); writeByte(bg[2]);
  writeByte(fg[0]); writeByte(fg[1]); writeByte(fg[2]);
  writeByte(0x21); writeByte(0xFF); writeByte(0x0B);
  pushString('NETSCAPE2.0');
  writeByte(0x03); writeByte(0x01); writeWord(0x0000); writeByte(0x00);
  for(let i=0;i<frames.length;i++){
    const delay = Math.max(1, Math.round((durations[i] || 100) / 10));
    writeByte(0x21); writeByte(0xF9); writeByte(0x04);
    writeByte(transparent ? 0x01 : 0x00);
    writeByte(delay & 0xFF); writeByte((delay >> 8) & 0xFF);
    writeByte(transparent ? 0x00 : 0x00);
    writeByte(0x00);
    writeByte(0x2C);
    writeWord(0); writeWord(0);
    writeWord(width); writeWord(height);
    writeByte(0x00);
    writeBinaryImageData(frames[i]);
  }
  writeByte(0x3B);
  return new Uint8Array(bytes);

  function writeBinaryImageData(indexes){
    const minCodeSize = 2;
    writeByte(minCodeSize);
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    const codeSize = minCodeSize + 1;
    const data = [];
    let buffer = 0;
    let bits = 0;
    const pushCode = (code) => {
      buffer |= code << bits;
      bits += codeSize;
      while(bits >= 8){
        data.push(buffer & 0xFF);
        buffer >>= 8;
        bits -= 8;
      }
    };
    pushCode(clearCode);
    for(let i=0;i<indexes.length;i++){
      pushCode(indexes[i]);
    }
    pushCode(eoiCode);
    if(bits > 0){
      data.push(buffer & 0xFF);
    }
    let offset = 0;
    while(offset < data.length){
      const size = Math.min(255, data.length - offset);
      writeByte(size);
      for(let i=0;i<size;i++){
        writeByte(data[offset++]);
      }
    }
    writeByte(0x00);
  }
}

function chooseMediaRecorderType(){
  if(typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function'){
    return null;
  }
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  return candidates.find((type) => {
    try{ return MediaRecorder.isTypeSupported(type); }
    catch{ return false; }
  }) || null;
}

function getExportDimensions(){
  const base = getExportBaseSize();
  let defaultW = Math.max(0, Math.round(base.width || 0));
  let defaultH = Math.max(0, Math.round(base.height || 0));
  if(defaultW <= 0 || defaultH <= 0){
    defaultW = Math.max(1, Math.round(state.sourceWidth || state.lastSize.width || 1024));
    defaultH = Math.max(1, Math.round(state.sourceHeight || state.lastSize.height || defaultW));
  }
  const rawW = (controls.outW.value || '').trim();
  const rawH = (controls.outH.value || '').trim();
  const lock = controls.lockAR && controls.lockAR.checked;
  const preset = getExportScalePreset();
  const ratio = defaultH > 0 ? defaultW / defaultH : 0;
  let outW = parseInt(rawW, 10);
  let outH = parseInt(rawH, 10);
  const usingPreset = (!rawW && !rawH && preset > 1);
  if(usingPreset){
    outW = defaultW * preset;
    outH = defaultH * preset;
  }else{
    if(lock && ratio > 0){
      if(rawW && !rawH && Number.isFinite(outW) && outW > 0){
        outH = outW / ratio;
      }else if(rawH && !rawW && Number.isFinite(outH) && outH > 0){
        outW = outH * ratio;
      }
    }
    if(!Number.isFinite(outW) || outW <= 0){
      outW = defaultW || 1024;
    }
    if(!Number.isFinite(outH) || outH <= 0){
      if(lock && ratio > 0){
        outH = outW / ratio;
      }else{
        outH = defaultH || (ratio > 0 ? outW / ratio : outW);
      }
    }
  }
  const dims = clampExportDimensions(outW, outH, lock && ratio > 0 ? ratio : 0);
  return dims;
}

function ensureSVGString(){
  if(!state.lastResult || state.lastResult.type !== 'image' || !state.lastResult.frame){
    return '';
  }
  if(state.lastSVG && state.lastSVGJob === state.lastResultId){
    return state.lastSVG;
  }
  const svgString = buildExportSVG(state.lastResult.frame, state.lastResult.options);
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

function createExportCanvas(width, height, opts={}){
  const {forceDOM = false} = opts;
  if(!forceDOM && typeof OffscreenCanvas !== 'undefined'){
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
  const gifBtn = $('dlGIF');
  if(gifBtn){
    gifBtn.addEventListener('click', async () => {
      if(gifBtn.dataset.busy === 'true') return;
      setButtonBusy(gifBtn, true, 'Preparing…');
      try{
        await downloadGIF();
      }catch(err){
        console.error(err);
        alert(err && err.message ? err.message : 'Impossibile esportare la GIF');
      }finally{
        setButtonBusy(gifBtn, false);
        updateExportButtons();
      }
    });
  }
  const mp4Btn = $('dlMP4');
  if(mp4Btn){
    mp4Btn.addEventListener('click', async () => {
      if(mp4Btn.dataset.busy === 'true') return;
      setButtonBusy(mp4Btn, true, 'Preparing…');
      try{
        await downloadMP4();
      }catch(err){
        console.error(err);
        alert(err && err.message ? err.message : 'Impossibile esportare il video');
      }finally{
        setButtonBusy(mp4Btn, false);
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
