import { applyToCanvas } from './postfx.js';
import { ensureEffect } from './effects/index.js';
import { computeExportBaseSize } from './exportSizing.mjs';

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
  'dither','asciiChars','asciiWord','invert','bg','fg','scale','scaleNum','fmt','dpi','exportScale','outW','outH','lockAR',
  'jpegQ','jpegQNum','rasterBG'
];

const controls = {};
for(const id of CONTROL_IDS){
  controls[id] = $(id);
}

const MAX_UPLOAD_DIMENSION = 1200;
const PREVIEW_MAX_DIMENSION = 360;
const VIDEO_PREVIEW_FPS = 8;
const VIDEO_EXPORT_FPS = 12;
const MAX_VIDEO_FRAMES = 240;
const RENDER_DEBOUNCE_MS = 90;

const OFFSCREEN_SUPPORTED = typeof OffscreenCanvas !== 'undefined';

const DEFAULT_ASCII_CUSTOM = ' .:-=+*#%@';
const DEFAULT_ASCII_WORD = 'PIXEL';
const ASCII_MIN_TILE = 8;
const ASCII_CUSTOM_MAX = 64;
const ASCII_WORD_MAX = 32;

const ASCII_CHARSETS = {
  ascii_simple: [' ','.',':','-','=','+','#','@'],
  ascii_pixel: [' ','.',':','-','=','+','#','@'],
  ascii_unicode: [' ','·',':','-','=','+','*','#','%','@'],
  ascii_word: [' ','P','I','X','E','L']
};

const ADVANCED_DITHER_DEFS = [
  {
    id: 'blueNoise',
    label: 'Blue Noise',
    hotkey: 'b',
    defaults: { scale: 1, contrast: 1, bias: 0 },
    params: [
      { key: 'scale', type: 'range', min: 0.25, max: 4, step: 0.25, label: 'Scala' },
      { key: 'contrast', type: 'range', min: 0.2, max: 3, step: 0.1, label: 'Contrasto' },
      { key: 'bias', type: 'number', min: -128, max: 128, step: 1, label: 'Bias' }
    ]
  },
  {
    id: 'clusteredDot',
    label: 'Clustered Dot',
    hotkey: 'c',
    defaults: { size: 8, angle: 45, gain: 1 },
    params: [
      { key: 'size', type: 'select', options: [{ value: 4, label: '4×4' }, { value: 8, label: '8×8' }], label: 'Dimensione' },
      { key: 'angle', type: 'number', min: 0, max: 180, step: 1, label: 'Angolo' },
      { key: 'gain', type: 'range', min: 0.5, max: 2.5, step: 0.1, label: 'Gain' }
    ]
  },
  {
    id: 'dotDiffusion',
    label: 'Dot Diffusion',
    defaults: { classMask: 'knuth', strength: 1 },
    params: [
      { key: 'classMask', type: 'select', options: [{ value: 'knuth', label: 'Knuth' }, { value: 'ulichney', label: 'Ulichney' }], label: 'Maschera' },
      { key: 'strength', type: 'range', min: 0.2, max: 2, step: 0.1, label: 'Forza' }
    ]
  },
  {
    id: 'edKernels',
    label: 'Error Diffusion+',
    defaults: { kernel: 'sierraLite', serpentine: true, clip: true, gain: 1 },
    params: [
      { key: 'kernel', type: 'select', options: [
        { value: 'sierraLite', label: 'Sierra Lite' },
        { value: 'twoRowSierra', label: 'Two-Row Sierra' },
        { value: 'stevensonArce', label: 'Stevenson-Arce' },
        { value: 'shiauFan', label: 'Shiau-Fan' }
      ], label: 'Kernel' },
      { key: 'serpentine', type: 'checkbox', label: 'Serpentine' },
      { key: 'clip', type: 'checkbox', label: 'Clipping' },
      { key: 'gain', type: 'range', min: 0.2, max: 2, step: 0.1, label: 'Gain' }
    ]
  },
  {
    id: 'paletteDither',
    label: 'Palette Dither',
    hotkey: 'p',
    defaults: { palette: [[0, 0, 0], [255, 255, 255]], diffusion: true, strength: 1 },
    params: [
      { key: 'palette', type: 'text', label: 'Palette (hex)', placeholder: '#000000,#ffffff' },
      { key: 'diffusion', type: 'checkbox', label: 'Diffusione errore' },
      { key: 'strength', type: 'range', min: 0, max: 1, step: 0.05, label: 'Forza' }
    ]
  },
  {
    id: 'autoQuant',
    label: 'Auto Quant',
    defaults: { colors: 8, diffusion: false },
    params: [
      { key: 'colors', type: 'number', min: 2, max: 32, step: 1, label: 'Colori' },
      { key: 'diffusion', type: 'checkbox', label: 'Diffusione' }
    ]
  },
  {
    id: 'cmykHalftone',
    label: 'CMYK Halftone',
    hotkey: 'h',
    defaults: { dotScale: 1, ucr: 0.2 },
    params: [
      { key: 'dotScale', type: 'range', min: 0.5, max: 3, step: 0.1, label: 'Scala punto' },
      { key: 'ucr', type: 'range', min: 0, max: 1, step: 0.05, label: 'UCR' }
    ]
  },
  {
    id: 'halftoneShapes',
    label: 'Halftone Shapes',
    defaults: { shape: 'circle', angle: 45, minSize: 0.1, maxSize: 0.6, jitter: 0.1, seed: 1337 },
    params: [
      { key: 'shape', type: 'select', options: [
        { value: 'circle', label: 'Cerchio' },
        { value: 'square', label: 'Quadrato' },
        { value: 'diamond', label: 'Diamante' },
        { value: 'triangle', label: 'Triangolo' },
        { value: 'hex', label: 'Esagono' }
      ], label: 'Forma' },
      { key: 'angle', type: 'number', min: 0, max: 180, step: 1, label: 'Angolo' },
      { key: 'minSize', type: 'number', min: 0.05, max: 1, step: 0.05, label: 'Min' },
      { key: 'maxSize', type: 'number', min: 0.1, max: 1.5, step: 0.05, label: 'Max' },
      { key: 'jitter', type: 'range', min: 0, max: 0.5, step: 0.05, label: 'Jitter' },
      { key: 'seed', type: 'number', min: 0, max: 9999, step: 1, label: 'Seed' }
    ]
  },
  {
    id: 'lineDither',
    label: 'Line Dither',
    hotkey: 'l',
    defaults: { cell: 8, angle: 0, thickness: 0.5, aa: true },
    params: [
      { key: 'cell', type: 'number', min: 2, max: 64, step: 1, label: 'Cella' },
      { key: 'angle', type: 'number', min: 0, max: 180, step: 1, label: 'Angolo' },
      { key: 'thickness', type: 'range', min: 0.1, max: 1, step: 0.05, label: 'Spessore' },
      { key: 'aa', type: 'checkbox', label: 'Antialias' }
    ]
  },
  {
    id: 'hatching',
    label: 'Hatching',
    hotkey: 'x',
    defaults: { levels: 5, angles: [0, 45, 90, 135], densityCurve: 'linear' },
    params: [
      { key: 'levels', type: 'number', min: 1, max: 8, step: 1, label: 'Livelli' },
      { key: 'angles', type: 'text', label: 'Angoli (°)', placeholder: '0,45,90,135' },
      { key: 'densityCurve', type: 'select', options: [
        { value: 'linear', label: 'Lineare' },
        { value: 'ease', label: 'Ease' }
      ], label: 'Curva densità' }
    ]
  },
  {
    id: 'stippling',
    label: 'Stippling',
    defaults: { minR: 1, maxR: 3, density: 1 },
    params: [
      { key: 'minR', type: 'number', min: 0.5, max: 6, step: 0.1, label: 'Raggio minimo' },
      { key: 'maxR', type: 'number', min: 1, max: 8, step: 0.1, label: 'Raggio massimo' },
      { key: 'density', type: 'number', min: 0.1, max: 4, step: 0.1, label: 'Densità' }
    ]
  }
];

function clamp01(value){
  const num = Number(value);
  if(!Number.isFinite(num)) return 0;
  if(num < 0) return 0;
  if(num > 1) return 1;
  return num;
}

function clampFloat(value, min, max){
  const num = Number(value);
  if(!Number.isFinite(num)) return min;
  if(num < min) return min;
  if(num > max) return max;
  return num;
}

function clampIntValue(value, min, max){
  const num = parseInt(value, 10);
  if(Number.isNaN(num)) return min;
  if(num < min) return min;
  if(num > max) return max;
  return num;
}

const THERMAL_PALETTE_KEY = 'thermal_v2';
const THERMAL_COLOR_STOPS = [
  {t: 0.0, r: 130, g: 0, b: 0},
  {t: 0.12, r: 185, g: 0, b: 0},
  {t: 0.24, r: 235, g: 20, b: 0},
  {t: 0.36, r: 255, g: 80, b: 0},
  {t: 0.48, r: 255, g: 150, b: 0},
  {t: 0.6, r: 255, g: 210, b: 0},
  {t: 0.7, r: 190, g: 255, b: 0},
  {t: 0.78, r: 90, g: 255, b: 60},
  {t: 0.86, r: 0, g: 240, b: 140},
  {t: 0.92, r: 0, g: 200, b: 230},
  {t: 0.97, r: 0, g: 120, b: 255},
  {t: 1.0, r: 70, g: 0, b: 255}
];

const THERMAL_PALETTE = buildThermalPalette(THERMAL_COLOR_STOPS, 64);

function buildThermalPalette(stops, steps){
  const count = Math.max(steps|0, 16);
  const palette = new Uint8Array(count * 3);
  if(!Array.isArray(stops) || stops.length === 0){
    return palette;
  }
  const orderedStops = stops.slice().sort((a, b) => a.t - b.t);
  let current = 0;
  for(let i=0; i<count; i++){
    const t = count === 1 ? 0 : i / (count - 1);
    while(current < orderedStops.length - 1 && t > orderedStops[current + 1].t){
      current++;
    }
    const a = orderedStops[current];
    const b = orderedStops[Math.min(current + 1, orderedStops.length - 1)];
    const span = Math.max(1e-6, b.t - a.t);
    const local = span > 0 ? (t - a.t) / span : 0;
    const clamped = Math.max(0, Math.min(1, local));
    const base = i * 3;
    palette[base] = clampByte(Math.round(lerp(a.r, b.r, clamped)));
    palette[base + 1] = clampByte(Math.round(lerp(a.g, b.g, clamped)));
    palette[base + 2] = clampByte(Math.round(lerp(a.b, b.b, clamped)));
  }
  return palette;
}

function lerp(a, b, t){
  return a + (b - a) * t;
}

function clampByte(value){
  if(value < 0) return 0;
  if(value > 255) return 255;
  return value;
}

const PALETTE_LIBRARY = {
  [THERMAL_PALETTE_KEY]: THERMAL_PALETTE
};

function getPaletteByKey(key){
  if(!key) return null;
  if(PALETTE_LIBRARY[key]) return PALETTE_LIBRARY[key];
  if(key === THERMAL_PALETTE_KEY) return THERMAL_PALETTE;
  return null;
}

const ASCII_FONT_STACK = 'IBM Plex Mono, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace';

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
  previewPlayer: null,
  customASCIIString: normalizeCustomASCIIString(DEFAULT_ASCII_CUSTOM),
  asciiWordString: normalizeASCIIWordString(DEFAULT_ASCII_WORD),
  advancedDitherSettings: {},
  advancedDitherControls: new Map(),
  advancedDitherActiveCanvas: null,
  advancedDitherPreviewTokens: new WeakMap(),
  advancedDitherJobCounter: 0
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
  initAdvancedDitherControls();
  if(controls.asciiChars){
    controls.asciiChars.value = state.customASCIIString;
  }
  if(controls.asciiWord){
    controls.asciiWord.value = state.asciiWordString;
  }
  updateAsciiCustomVisibility();
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
  if(controls.asciiChars){
    controls.asciiChars.addEventListener('input', handleCustomASCIIInput);
    controls.asciiChars.addEventListener('blur', syncCustomASCIIInput);
  }
  if(controls.asciiWord){
    controls.asciiWord.addEventListener('input', handleASCIIWordInput);
    controls.asciiWord.addEventListener('blur', syncASCIIWordInput);
  }
  const changeIds = ['dither','invert','bg','fg','style','fmt','dpi','lockAR'];
  for(const id of changeIds){
    const el = controls[id];
    if(!el) continue;
    el.addEventListener('change', () => {
      if(id === 'dither'){
        updateAsciiCustomVisibility();
        updateAdvancedDitherVisibility();
      }
      fastRender();
    });
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

function updateAsciiCustomVisibility(){
  const customField = $('asciiCustomField');
  const wordField = $('asciiWordField');
  const mode = controls.dither ? controls.dither.value : 'none';
  if(customField){
    customField.hidden = mode !== 'ascii_custom';
  }
  if(wordField){
    wordField.hidden = mode !== 'ascii_word';
  }
}

function handleCustomASCIIInput(){
  if(!controls.asciiChars) return;
  const raw = controls.asciiChars.value || '';
  const normalized = normalizeCustomASCIIString(raw);
  const prev = state.customASCIIString;
  state.customASCIIString = normalized;
  if(normalized !== prev){
    fastRender();
  }
}

function syncCustomASCIIInput(){
  if(!controls.asciiChars) return;
  const normalized = normalizeCustomASCIIString(controls.asciiChars.value || '');
  state.customASCIIString = normalized;
  if(controls.asciiChars.value !== normalized){
    controls.asciiChars.value = normalized;
  }
}

function handleASCIIWordInput(){
  if(!controls.asciiWord) return;
  const raw = controls.asciiWord.value || '';
  const normalized = normalizeASCIIWordString(raw);
  const prev = state.asciiWordString;
  state.asciiWordString = normalized;
  if(normalized !== prev){
    fastRender();
  }
}

function syncASCIIWordInput(){
  if(!controls.asciiWord) return;
  const normalized = normalizeASCIIWordString(controls.asciiWord.value || '');
  state.asciiWordString = normalized;
  if(controls.asciiWord.value !== normalized){
    controls.asciiWord.value = normalized;
  }
}

function getExportScalePreset(){
  if(!controls.exportScale) return 1;
  const raw = parseFloat(controls.exportScale.value || '1');
  if(!Number.isFinite(raw) || raw < 1) return 1;
  return raw;
}

function getExportBaseSize(){
  return computeExportBaseSize({
    sourceKind: state.sourceKind,
    videoSource: state.videoSource,
    lastResult: state.lastResult,
    sourceWidth: state.sourceWidth,
    sourceHeight: state.sourceHeight,
    lastSize: state.lastSize
  });
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

function initAdvancedDitherControls(){
  const panel = $('ditherAdvancedPanel');
  const container = $('ditherAdvancedControls');
  if(!panel || !container){
    return;
  }
  container.innerHTML = '';
  state.advancedDitherSettings = {};
  state.advancedDitherControls = new Map();
  for(const def of ADVANCED_DITHER_DEFS){
    const defaults = cloneAdvancedDefaults(def.defaults || {});
    state.advancedDitherSettings[def.id] = { params: defaults };
    const group = document.createElement('div');
    group.className = 'dither-advanced__group';
    group.hidden = true;
    const paramRefs = new Map();
    for(const param of def.params || []){
      const field = document.createElement('div');
      field.className = 'field';
      const label = document.createElement('label');
      label.textContent = param.label || param.key;
      field.appendChild(label);
      const { input, display } = createAdvancedDitherInput(def, param, defaults[param.key]);
      if(param.placeholder){
        input.placeholder = param.placeholder;
      }
      field.appendChild(input);
      if(display){
        field.appendChild(display);
      }
      group.appendChild(field);
      paramRefs.set(param.key, { input, display, definition: param });
    }
    container.appendChild(group);
    state.advancedDitherControls.set(def.id, { root: group, params: paramRefs });
  }
  updateAdvancedDitherVisibility();
}

function createAdvancedDitherInput(def, param, initialValue){
  let value = initialValue;
  if(value === undefined){
    value = param.type === 'checkbox' ? false : '';
  }
  let input;
  let display = null;
  if(param.type === 'select'){
    input = document.createElement('select');
    for(const option of param.options || []){
      const opt = document.createElement('option');
      opt.value = String(option.value);
      opt.textContent = option.label;
      input.appendChild(opt);
    }
    const fallback = param.options && param.options.length ? param.options[0].value : '';
    input.value = String(value != null ? value : fallback);
  }else if(param.type === 'checkbox'){
    input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(value);
  }else if(param.type === 'range'){
    input = document.createElement('input');
    input.type = 'range';
    if(param.min != null) input.min = String(param.min);
    if(param.max != null) input.max = String(param.max);
    if(param.step != null) input.step = String(param.step);
    const numValue = Number.isFinite(Number(value)) ? Number(value) : Number(param.min || 0);
    input.value = String(numValue);
    display = document.createElement('span');
    display.className = 'range-display';
    display.textContent = formatAdvancedDisplayValue(param, numValue);
  }else{
    input = document.createElement('input');
    input.type = param.type === 'number' ? 'number' : 'text';
    if(param.min != null) input.min = String(param.min);
    if(param.max != null) input.max = String(param.max);
    if(param.step != null) input.step = String(param.step);
    let initial = value;
    if(param.key === 'palette' && Array.isArray(value)){
      initial = stringifyPalette(value);
    }else if(param.key === 'angles' && Array.isArray(value)){
      initial = value.join(',');
    }
    input.value = initial != null ? String(initial) : '';
  }
  const eventType = param.type === 'checkbox' || param.type === 'select' ? 'change' : 'input';
  input.addEventListener(eventType, () => handleAdvancedDitherParamChange(def, param, input, display));
  return { input, display };
}

function handleAdvancedDitherParamChange(def, param, input, display){
  const settings = state.advancedDitherSettings[def.id];
  if(!settings) return;
  let value;
  if(param.type === 'checkbox'){
    value = Boolean(input.checked);
  }else if(param.type === 'select'){
    const selected = input.value;
    const numeric = Number(selected);
    value = Number.isNaN(numeric) ? selected : numeric;
  }else if(param.key === 'palette'){
    value = parsePaletteValue(input.value, def.defaults && def.defaults.palette);
    input.value = stringifyPalette(value);
  }else if(param.key === 'angles'){
    value = parseAnglesValue(input.value, def.defaults && def.defaults.angles);
    input.value = value.join(',');
  }else if(param.type === 'range' || param.type === 'number'){
    const num = Number(input.value);
    const fallback = Number(param.min || 0);
    value = Number.isFinite(num) ? num : fallback;
    input.value = String(value);
  }else{
    value = input.value;
  }
  settings.params[param.key] = value;
  if(display){
    const numeric = Number(value);
    display.textContent = formatAdvancedDisplayValue(param, Number.isFinite(numeric) ? numeric : Number(input.value));
  }
  fastRender(true);
}

function formatAdvancedDisplayValue(param, value){
  if(typeof value !== 'number' || Number.isNaN(value)){
    return '';
  }
  const step = typeof param.step === 'number' ? param.step : 0.1;
  const decimals = step < 1 ? Math.max(0, Math.ceil(Math.abs(Math.log10(step)))) : 0;
  return value.toFixed(decimals);
}

function cloneAdvancedDefaults(defaults){
  if(!defaults) return {};
  return JSON.parse(JSON.stringify(defaults));
}

function updateAdvancedDitherVisibility(){
  const panel = $('ditherAdvancedPanel');
  const mode = controls.dither ? controls.dither.value : 'none';
  const def = getAdvancedDitherDefinition(mode);
  if(!panel){
    return;
  }
  panel.hidden = !def;
  for(const [id, refs] of state.advancedDitherControls){
    refs.root.hidden = !def || def.id !== id;
  }
  if(def){
    syncAdvancedDitherControls(def.id);
  }
}

function syncAdvancedDitherControls(id){
  const refs = state.advancedDitherControls.get(id);
  const settings = state.advancedDitherSettings[id];
  if(!refs || !settings) return;
  for(const [key, ref] of refs.params){
    const paramDef = ref.definition;
    const value = settings.params[key];
    if(paramDef.type === 'checkbox'){
      ref.input.checked = Boolean(value);
    }else if(paramDef.type === 'select'){
      ref.input.value = String(value);
    }else if(paramDef.key === 'palette'){
      ref.input.value = stringifyPalette(value);
    }else if(paramDef.key === 'angles'){
      ref.input.value = Array.isArray(value) ? value.join(',') : '';
    }else{
      ref.input.value = value != null ? String(value) : '';
    }
    if(ref.display){
      const numeric = Number(ref.input.value);
      ref.display.textContent = formatAdvancedDisplayValue(paramDef, Number.isFinite(numeric) ? numeric : 0);
    }
  }
}

function getAdvancedDitherDefinition(id){
  return ADVANCED_DITHER_DEFS.find((def) => def.id === id);
}

function prepareAdvancedDitherParams(def, params){
  const output = {};
  for(const param of def.params || []){
    const value = params[param.key];
    if(param.type === 'checkbox'){
      output[param.key] = Boolean(value);
    }else if(param.key === 'palette'){
      output[param.key] = parsePaletteValue(value, def.defaults && def.defaults.palette);
    }else if(param.key === 'angles'){
      output[param.key] = parseAnglesValue(value, def.defaults && def.defaults.angles);
    }else if(param.type === 'range' || param.type === 'number'){
      const num = Number(value);
      output[param.key] = Number.isFinite(num) ? num : Number(param.min || 0);
    }else if(param.type === 'select'){
      if(typeof value === 'string'){
        const numeric = Number(value);
        output[param.key] = Number.isNaN(numeric) ? value : numeric;
      }else{
        output[param.key] = value;
      }
    }else{
      output[param.key] = value;
    }
  }
  return output;
}

function buildAdvancedDitherChain(){
  const mode = controls.dither ? controls.dither.value : 'none';
  const def = getAdvancedDitherDefinition(mode);
  if(!def) return [];
  const settings = state.advancedDitherSettings[def.id];
  if(!settings) return [];
  const params = prepareAdvancedDitherParams(def, settings.params);
  const base = collectRenderOptions();
  const globals = {
    pixelSize: base.px,
    threshold: base.thr,
    blur: base.blurPx,
    grain: base.grain,
    blackPoint: base.bp,
    whitePoint: base.wp,
    gamma: base.gam,
    brightness: base.bri,
    contrast: base.con,
    invertMode: base.invertMode,
    background: base.bg,
    foreground: base.fg
  };
  return [{ name: def.id, params: { ...params, _globals: globals } }];
}

async function applyAdvancedDitherToCanvas(canvas, { preview = false, token = null } = {}){
  if(!canvas) return;
  const effects = buildAdvancedDitherChain();
  if(!effects.length) return;
  try{
    const shouldAbort = token == null
      ? undefined
      : () => state.advancedDitherPreviewTokens.get(canvas) !== token;
    await applyToCanvas(canvas, effects, {
      preview,
      maxDimension: preview ? 1024 : undefined,
      shouldAbort
    });
  }catch(err){
    console.warn('[dither] applicazione avanzata fallita', err);
  }
}

function scheduleAdvancedDitherPreview(canvas){
  state.advancedDitherActiveCanvas = canvas || null;
  const effects = buildAdvancedDitherChain();
  if(!effects.length || !canvas){
    if(canvas){
      state.advancedDitherPreviewTokens.delete(canvas);
    }
    return;
  }
  const token = ++state.advancedDitherJobCounter;
  state.advancedDitherPreviewTokens.set(canvas, token);
  requestAnimationFrame(() => {
    if(state.advancedDitherActiveCanvas !== canvas) return;
    if(state.advancedDitherPreviewTokens.get(canvas) !== token) return;
    applyAdvancedDitherToCanvas(canvas, { preview: true, token });
  });
}

function isAdvancedDitherMode(mode){
  return Boolean(getAdvancedDitherDefinition(mode));
}

function parsePaletteValue(value, fallback){
  if(Array.isArray(value)){
    return value;
  }
  if(typeof value !== 'string'){
    return Array.isArray(fallback) && fallback.length ? fallback : [[0,0,0],[255,255,255]];
  }
  const parts = value.split(/[;,\s]+/).map((part) => part.trim()).filter(Boolean);
  if(!parts.length){
    return Array.isArray(fallback) && fallback.length ? fallback : [[0,0,0],[255,255,255]];
  }
  const palette = [];
  for(const part of parts){
    const hex = part.replace('#','');
    if(hex.length === 6){
      const r = parseInt(hex.slice(0,2), 16);
      const g = parseInt(hex.slice(2,4), 16);
      const b = parseInt(hex.slice(4,6), 16);
      if(Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)){
        palette.push([r, g, b]);
      }
    }
  }
  return palette.length ? palette : (Array.isArray(fallback) && fallback.length ? fallback : [[0,0,0],[255,255,255]]);
}

function stringifyPalette(palette){
  if(!Array.isArray(palette)) return '';
  return palette.map((color) => {
    if(!Array.isArray(color) || color.length < 3) return '#000000';
    const [r, g, b] = color;
    const toHex = (val) => {
      const clamped = Math.max(0, Math.min(255, Math.round(val || 0)));
      return clamped.toString(16).padStart(2, '0');
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }).join(',');
}

function parseAnglesValue(value, fallback){
  if(Array.isArray(value)){
    return value;
  }
  if(typeof value !== 'string'){
    return Array.isArray(fallback) && fallback.length ? fallback : [0,45,90,135];
  }
  const parts = value.split(/[;,]+/).map((part) => Number(part.trim())).filter((num) => Number.isFinite(num));
  return parts.length ? parts : (Array.isArray(fallback) && fallback.length ? fallback : [0,45,90,135]);
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

function normalizeCustomASCIIString(input){
  let chars = Array.from(typeof input === 'string' ? input : '');
  chars = chars.filter((ch) => ch !== '\r' && ch !== '\n');
  if(chars.length === 0){
    chars = Array.from(DEFAULT_ASCII_CUSTOM);
  }
  if(!chars.includes(' ')){
    chars.unshift(' ');
  }
  if(chars.length > ASCII_CUSTOM_MAX){
    chars.length = ASCII_CUSTOM_MAX;
  }
  return chars.join('');
}

function normalizeASCIIWordString(input){
  let value = typeof input === 'string' ? input : '';
  value = value.replace(/\s+/g, '');
  if(!value){
    value = DEFAULT_ASCII_WORD;
  }
  if(value.length > ASCII_WORD_MAX){
    value = value.slice(0, ASCII_WORD_MAX);
  }
  return value.toUpperCase();
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
  const asciiCustom = state.customASCIIString;
  const asciiWord = state.asciiWordString;
  return {px, thr, blurPx, grain, glow, bp, wp, gam, bri, con, style, thick, mode, invertMode, bg, fg, scale, asciiCustom, asciiWord};
}

function buildWorkerOptions(options){
  const advanced = isAdvancedDitherMode(options.mode);
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
    dither: advanced ? 'advanced_base' : options.mode,
    invertMode: options.invertMode,
    asciiCustom: options.asciiCustom,
    asciiWord: options.asciiWord,
    mode: options.mode,
    advanced
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
  const frameData = createFrameData(result, options);
  if(frameData && frameData.kind === 'ascii'){
    result.lines = frameData.lines;
    result.charsetKey = frameData.charsetKey;
    result.charsetString = frameData.charsetString;
    result.tile = frameData.tile;
    result.outputWidth = frameData.outputWidth;
    result.outputHeight = frameData.outputHeight;
    result.ascii = frameData.ascii;
  }
  state.lastResult = {type: 'image', options, frame: result, frameData};
  state.lastResultId = jobId;
  state.lastSVG = '';
  state.lastSVGJob = 0;
  const previewData = buildPreviewData(frameData, options);
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
    frames.push(createFrameData(result, options));
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

function getASCIICharset(key, customString){
  if(key === 'ascii_custom'){
    const normalized = normalizeCustomASCIIString(typeof customString === 'string' ? customString : state.customASCIIString);
    return Array.from(normalized);
  }
  if(key === 'ascii_word'){
    const normalized = normalizeASCIIWordString(
      typeof customString === 'string' && customString.length
        ? customString
        : state.asciiWordString
    );
    return Array.from(` ${normalized}`);
  }
  return ASCII_CHARSETS[key] || ASCII_CHARSETS.ascii_simple;
}

function ensureUint8Array(buffer){
  if(!buffer) return null;
  if(buffer instanceof Uint8Array) return buffer;
  if(ArrayBuffer.isView(buffer)){
    return new Uint8Array(buffer.buffer, buffer.byteOffset || 0, buffer.byteLength);
  }
  if(buffer instanceof ArrayBuffer) return new Uint8Array(buffer);
  if(Array.isArray(buffer)) return Uint8Array.from(buffer);
  return null;
}

function ensureASCIIArray(buffer){
  return ensureUint8Array(buffer);
}

function asciiBufferToLines(buffer, width, height, charset){
  const data = ensureASCIIArray(buffer);
  if(!data || !charset){
    return [];
  }
  const lines = new Array(height);
  const fallback = charset.length ? charset[charset.length-1] : ' ';
  for(let y=0;y<height;y++){
    const row = new Array(width);
    const rowOffset = y*width;
    for(let x=0;x<width;x++){
      const idx = data[rowOffset + x];
      row[x] = charset[idx] || fallback;
    }
    lines[y] = row.join('');
  }
  return lines;
}

function adjustDimensionsForAspect(width, height, aspectWidth, aspectHeight){
  const widthValue = typeof width === 'number' ? width : parseFloat(width);
  const heightValue = typeof height === 'number' ? height : parseFloat(height);
  const aspectWidthValue = typeof aspectWidth === 'number' ? aspectWidth : parseFloat(aspectWidth);
  const aspectHeightValue = typeof aspectHeight === 'number' ? aspectHeight : parseFloat(aspectHeight);
  let w = Math.max(1, Math.round(Number.isFinite(widthValue) ? widthValue : 0));
  let h = Math.max(1, Math.round(Number.isFinite(heightValue) ? heightValue : 0));
  const aw = Math.max(0, Math.round(Number.isFinite(aspectWidthValue) ? aspectWidthValue : 0));
  const ah = Math.max(0, Math.round(Number.isFinite(aspectHeightValue) ? aspectHeightValue : 0));
  if(aw > 0 && ah > 0){
    const ratio = aw / ah;
    const candidates = [];
    const widthScale = aw > 0 ? (w / aw) : 0;
    if(widthScale > 0 && Number.isFinite(widthScale)){
      const scaledW = Math.max(1, Math.round(aw * widthScale));
      const scaledH = Math.max(1, Math.round(ah * widthScale));
      candidates.push({width: scaledW, height: scaledH, delta: Math.abs(scaledW - w) + Math.abs(scaledH - h)});
    }
    const heightScale = ah > 0 ? (h / ah) : 0;
    if(heightScale > 0 && Number.isFinite(heightScale)){
      const scaledW = Math.max(1, Math.round(aw * heightScale));
      const scaledH = Math.max(1, Math.round(ah * heightScale));
      candidates.push({width: scaledW, height: scaledH, delta: Math.abs(scaledW - w) + Math.abs(scaledH - h)});
    }
    if(!candidates.length){
      const fallbackScale = Math.max(widthScale, heightScale, 1);
      if(Number.isFinite(fallbackScale) && fallbackScale > 0){
        const scaledW = Math.max(1, Math.round(aw * fallbackScale));
        const scaledH = Math.max(1, Math.round(ah * fallbackScale));
        candidates.push({width: scaledW, height: scaledH, delta: Math.abs(scaledW - w) + Math.abs(scaledH - h)});
      }
    }
    if(candidates.length){
      candidates.sort((a, b) => a.delta - b.delta);
      const chosen = candidates[0];
      w = chosen.width;
      h = chosen.height;
    }
    return {width: w, height: h, ratio};
  }
  return {width: w, height: h, ratio: h>0 ? w/h : 1};
}

function resolvePaletteFromResult(result){
  if(!result) return null;
  if(result.palette){
    const paletteArray = ensureUint8Array(result.palette);
    if(paletteArray && paletteArray.length) return paletteArray;
  }
  if(result.paletteKey){
    const palette = getPaletteByKey(result.paletteKey);
    if(palette) return palette;
  }
  if(result.kind === 'thermal' || result.mode === 'thermal'){
    return THERMAL_PALETTE;
  }
  return null;
}

function createFrameData(result, options){
  if(!result){
    return null;
  }
  const tile = result.tile != null ? result.tile : Math.max(1, options.px);
  const outputWidth = Math.round(result.outputWidth || (result.gridWidth * tile));
  const outputHeight = Math.round(result.outputHeight || (result.gridHeight * tile));
  const kind = result.kind || (result.ascii ? 'ascii' : 'mask');
  const aspectWidth = result.aspectWidth || state.sourceWidth || state.lastSize.width || outputWidth;
  const aspectHeight = result.aspectHeight || state.sourceHeight || state.lastSize.height || outputHeight;
  const adjusted = adjustDimensionsForAspect(outputWidth, outputHeight, aspectWidth, aspectHeight);
  if(kind === 'ascii'){
    const charsetKey = result.charsetKey || result.charset || options.mode || 'ascii_simple';
    const asciiArray = ensureASCIIArray(result.ascii);
    const charsetString = typeof result.charsetString === 'string'
      ? result.charsetString
      : (charsetKey === 'ascii_custom'
        ? options.asciiCustom
        : (charsetKey === 'ascii_word' ? options.asciiWord : ''));
    const effectiveCharset = getASCIICharset(charsetKey, charsetString);
    const lines = result.lines && result.lines.length
      ? result.lines
      : asciiBufferToLines(asciiArray, result.gridWidth, result.gridHeight, effectiveCharset);
    const effectiveTile = Math.max(tile, ASCII_MIN_TILE);
    const finalWidth = adjusted.width;
    const finalHeight = adjusted.height;
    let normalizedCharsetString;
    if(charsetKey === 'ascii_custom'){
      normalizedCharsetString = normalizeCustomASCIIString(charsetString || options.asciiCustom || state.customASCIIString);
    }else if(charsetKey === 'ascii_word'){
      const word = normalizeASCIIWordString(charsetString || options.asciiWord || state.asciiWordString);
      normalizedCharsetString = ` ${word}`;
    }else{
      normalizedCharsetString = effectiveCharset.join('');
    }
    const colorArray = result.colors ? ensureUint8Array(result.colors) : null;
    return {
      kind: 'ascii',
      gridWidth: result.gridWidth,
      gridHeight: result.gridHeight,
      tile: effectiveTile,
      ascii: asciiArray,
      lines,
      charsetKey,
      charsetString: normalizedCharsetString,
      colors: colorArray,
      outputWidth: finalWidth,
      outputHeight: finalHeight,
      aspectWidth,
      aspectHeight,
      aspectRatio: adjusted.ratio,
      mode: result.mode || options.mode || 'ascii_simple'
    };
  }
  if(kind === 'thermal'){
    const indexes = ensureUint8Array(result.indexes);
    let palette = resolvePaletteFromResult(result);
    if(!palette){
      palette = THERMAL_PALETTE;
    }
    const paletteKey = result.paletteKey || (palette === THERMAL_PALETTE ? THERMAL_PALETTE_KEY : undefined);
    return {
      kind: 'thermal',
      gridWidth: result.gridWidth,
      gridHeight: result.gridHeight,
      tile,
      indexes,
      palette,
      paletteKey,
      outputWidth: adjusted.width,
      outputHeight: adjusted.height,
      aspectWidth,
      aspectHeight,
      aspectRatio: adjusted.ratio,
      mode: result.mode || options.mode || 'thermal'
    };
  }
  if(kind === 'advanced-base'){
    const tonal = ensureUint8Array(result.tonal);
    const colors = ensureUint8Array(result.colors);
    return {
      kind: 'advanced-base',
      gridWidth: result.gridWidth,
      gridHeight: result.gridHeight,
      tile,
      tonal,
      colors,
      threshold: result.threshold != null ? result.threshold : options.thr,
      invert: !!result.invert,
      outputWidth: adjusted.width,
      outputHeight: adjusted.height,
      aspectWidth,
      aspectHeight,
      aspectRatio: adjusted.ratio,
      mode: result.mode || options.mode || 'advanced-base'
    };
  }
  return {
    kind: 'mask',
    gridWidth: result.gridWidth,
    gridHeight: result.gridHeight,
    tile,
    mask: result.mask,
    outputWidth: adjusted.width,
    outputHeight: adjusted.height,
    aspectWidth,
    aspectHeight,
    aspectRatio: adjusted.ratio,
    mode: result.mode || options.mode || 'none'
  };
}

function buildPreviewData(frame, options){
  if(!frame){
    return null;
  }
  if(frame.kind === 'ascii'){
    return {
      type: 'ascii',
      mode: frame.mode,
      width: frame.outputWidth,
      height: frame.outputHeight,
      gridWidth: frame.gridWidth,
      gridHeight: frame.gridHeight,
      tile: frame.tile,
      lines: frame.lines,
      charsetKey: frame.charsetKey,
      charsetString: frame.charsetString,
      colors: frame.colors,
      bg: options.bg,
      fg: options.fg,
      glow: options.glow
    };
  }
  if(frame.kind === 'thermal'){
    const palette = frame.palette || getPaletteByKey(frame.paletteKey) || THERMAL_PALETTE;
    return {
      type: 'thermal',
      mode: frame.mode,
      width: frame.outputWidth,
      height: frame.outputHeight,
      gridWidth: frame.gridWidth,
      gridHeight: frame.gridHeight,
      tile: frame.tile,
      indexes: frame.indexes,
      palette,
      paletteKey: frame.paletteKey || (palette === THERMAL_PALETTE ? THERMAL_PALETTE_KEY : undefined),
      bg: options.bg,
      fg: options.fg,
      glow: options.glow
    };
  }
  if(frame.kind === 'advanced-base'){
    return {
      type: 'advanced-base',
      mode: frame.mode,
      width: frame.outputWidth,
      height: frame.outputHeight,
      gridWidth: frame.gridWidth,
      gridHeight: frame.gridHeight,
      tile: frame.tile,
      tonal: frame.tonal,
      colors: frame.colors,
      threshold: frame.threshold,
      invert: frame.invert,
      bg: options.bg,
      fg: options.fg,
      glow: options.glow
    };
  }
  return {
    type: 'mask',
    mode: frame.mode,
    width: frame.outputWidth,
    height: frame.outputHeight,
    gridWidth: frame.gridWidth,
    gridHeight: frame.gridHeight,
    tile: frame.tile,
    mask: frame.mask,
    bg: options.bg,
    fg: options.fg,
    glow: options.glow
  };
}

function buildAnimationPreviewData(frames, options, durations, fps){
  if(!frames || !frames.length){
    return null;
  }
  const first = frames[0];
  const width = Math.max(1, Math.round(first.outputWidth));
  const height = Math.max(1, Math.round(first.outputHeight));
  const previewFrames = frames.map((frame) => ({
    ...frame,
    type: frame.kind
  }));
  const effectiveDurations = durations.slice(0, previewFrames.length);
  const total = effectiveDurations.reduce((sum, val) => sum + val, 0) || (previewFrames.length * 1000/VIDEO_PREVIEW_FPS);
  const derivedFPS = total > 0 ? (previewFrames.length / (total/1000)) : (fps || VIDEO_PREVIEW_FPS);
  return {
    type: 'animation',
    width,
    height,
    frames: previewFrames,
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

function buildIndexedSVGString(indexes, width, height, tile, palette, bg, paletteKey){
  const effectivePalette = palette || getPaletteByKey(paletteKey) || THERMAL_PALETTE;
  if(!indexes || !effectivePalette) return '';
  const unit = tile || 1;
  const svgW = Math.max(1, Math.round(width * unit));
  const svgH = Math.max(1, Math.round(height * unit));
  const paletteSize = effectivePalette.length / 3;
  const paths = new Array(paletteSize).fill('');
  for(let y=0;y<height;y++){
    const rowOffset = y*width;
    let runColor = -1;
    let runStart = 0;
    for(let x=0;x<=width;x++){
      const idx = x<width ? indexes[rowOffset + x] : -1;
      if(idx === runColor){
        continue;
      }
      if(runColor >= 0 && runColor < paletteSize){
        const length = x - runStart;
        if(length > 0){
          const rectWidth = length * unit;
          const rectX = runStart * unit;
          const rectY = y * unit;
          paths[runColor] += `M${formatNumber(rectX)} ${formatNumber(rectY)}h${formatNumber(rectWidth)}v${formatNumber(unit)}h-${formatNumber(rectWidth)}z`;
        }
      }
      runColor = idx;
      runStart = x;
    }
  }
  const colorCache = new Array(paletteSize);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">`;
  if(bg && bg !== 'transparent'){
    svg += `<rect width="100%" height="100%" fill="${bg}"/>`;
  }
  for(let i=0;i<paths.length;i++){
    const path = paths[i];
    if(!path) continue;
    let color = colorCache[i];
    if(!color){
      const base = i*3;
      const r = effectivePalette[base];
      const g = effectivePalette[base+1];
      const b = effectivePalette[base+2];
      color = `rgb(${r},${g},${b})`;
      colorCache[i] = color;
    }
    svg += `<path fill="${color}" d="${path}"/>`;
  }
  svg += '</svg>';
  return svg;
}

function buildAsciiSVGString(frame, options){
  const width = Math.max(1, Math.round(frame.outputWidth || (frame.gridWidth * (frame.tile || 1))));
  const height = Math.max(1, Math.round(frame.outputHeight || (frame.gridHeight * (frame.tile || 1))));
  const cellWidth = width / Math.max(1, frame.gridWidth);
  const cellHeight = height / Math.max(1, frame.gridHeight);
  const lines = frame.lines && frame.lines.length
    ? frame.lines
    : asciiBufferToLines(frame.ascii, frame.gridWidth, frame.gridHeight, getASCIICharset(frame.charsetKey, frame.charsetString));
  const colorArray = frame.colors ? ensureUint8Array(frame.colors) : null;
  const asciiElements = asciiLinesToSVGElements(lines, cellWidth, cellHeight, {
    colors: colorArray,
    gridWidth: frame.gridWidth,
    mode: frame.mode || options.mode || 'ascii_simple'
  });
  const usesPerGlyphFill = asciiElements.usesPerGlyphFill;
  const textMarkup = asciiElements.textMarkup;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  if(options.bg && options.bg !== 'transparent'){
    svg += `<rect width="100%" height="100%" fill="${options.bg}"/>`;
  }
  if(asciiElements.backgroundMarkup){
    svg += asciiElements.backgroundMarkup;
  }
  if(!textMarkup){
    svg += '</svg>';
    return svg;
  }
  const fontSize = Math.max(2, Math.min(cellWidth, cellHeight) * 0.92);
  const fgColor = options.fg || '#000000';
  const glowAmount = Math.max(0, options.glow || 0);
  if(glowAmount > 0 && !usesPerGlyphFill){
    const fgRGB = hexToRGB(fgColor);
    const glowRGB = lightenColor(fgRGB, 0.4);
    const blurRadius = Math.max(0.2, Math.sqrt(cellWidth*cellWidth + cellHeight*cellHeight) * (0.4 + glowAmount/90));
    const glowOpacity = Math.min(1, 0.18 + glowAmount/120);
    svg += `<defs><filter id="asciiGlow" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="${formatNumber(blurRadius)}" result="blur"/></filter></defs>`;
    svg += `<g filter="url(#asciiGlow)" opacity="${formatNumber(glowOpacity)}" fill="rgb(${glowRGB[0]},${glowRGB[1]},${glowRGB[2]})" font-family="${ASCII_FONT_STACK}" font-size="${formatNumber(fontSize)}" letter-spacing="0">${textMarkup}</g>`;
  }
  const groupAttrs = `font-family="${ASCII_FONT_STACK}" font-size="${formatNumber(fontSize)}" letter-spacing="0"`;
  if(usesPerGlyphFill){
    svg += `<g ${groupAttrs}>${textMarkup}</g>`;
  }else{
    svg += `<g fill="${fgColor}" ${groupAttrs}>${textMarkup}</g>`;
  }
  svg += '</svg>';
  return svg;
}

function asciiLinesToSVGElements(lines, cellWidth, cellHeight, options={}){
  if(!lines || !lines.length){
    return {textMarkup: '', backgroundMarkup: '', usesPerGlyphFill: false};
  }
  const gridWidth = Math.max(0, options.gridWidth || (lines[0] ? lines[0].length : 0));
  const colorArray = options.colors && gridWidth
    ? ensureUint8Array(options.colors)
    : null;
  const totalCells = gridWidth * lines.length;
  const hasColors = colorArray && colorArray.length >= totalCells * 3;
  const mode = options.mode || 'ascii_simple';
  const asciiPixel = mode === 'ascii_pixel';
  const offsetX = cellWidth / 2;
  const offsetY = cellHeight / 2;
  const stepX = cellWidth;
  const stepY = cellHeight;
  const textColorCache = hasColors && !asciiPixel ? new Map() : null;
  const asciiPixelCache = asciiPixel && hasColors ? new Map() : null;
  const asciiPixelThreshold = options.asciiPixelThreshold != null ? options.asciiPixelThreshold : 150;
  const asciiPixelLight = options.asciiPixelLight || 'rgba(245,245,245,0.95)';
  const asciiPixelDark = options.asciiPixelDark || 'rgba(16,16,16,0.88)';
  let textMarkup = '';
  for(let y=0;y<lines.length;y++){
    const line = lines[y];
    if(!line) continue;
    const baseY = offsetY + y*stepY;
    for(let x=0;x<gridWidth;x++){
      const ch = line.charAt(x);
      if(!ch || ch === ' '){
        continue;
      }
      const baseX = offsetX + x*stepX;
      let fillAttr = '';
      if(asciiPixel && hasColors){
        const idx = (y*gridWidth + x) * 3;
        const r = colorArray[idx];
        const g = colorArray[idx+1];
        const b = colorArray[idx+2];
        const luminance = 0.2126*r + 0.7152*g + 0.0722*b;
        const bucket = luminance >= asciiPixelThreshold ? 1 : 0;
        let fill = asciiPixelCache.get(bucket);
        if(!fill){
          fill = bucket ? asciiPixelDark : asciiPixelLight;
          asciiPixelCache.set(bucket, fill);
        }
        fillAttr = ` fill="${fill}"`;
      }else if(hasColors){
        const idx = (y*gridWidth + x) * 3;
        const r = colorArray[idx];
        const g = colorArray[idx+1];
        const b = colorArray[idx+2];
        const key = (r << 16) | (g << 8) | b;
        let fill = textColorCache.get(key);
        if(!fill){
          fill = `rgb(${r},${g},${b})`;
          textColorCache.set(key, fill);
        }
        fillAttr = ` fill="${fill}"`;
      }
      textMarkup += `<text x="${formatNumber(baseX)}" y="${formatNumber(baseY)}" text-anchor="middle" dominant-baseline="middle"${fillAttr}>${escapeXML(ch)}</text>`;
    }
  }
  let backgroundMarkup = '';
  if(asciiPixel && hasColors && gridWidth > 0){
    const pathMap = new Map();
    const buildEntry = (colorKey) => {
      let entry = pathMap.get(colorKey);
      if(!entry){
        entry = {
          path: '',
          r: (colorKey >> 16) & 0xFF,
          g: (colorKey >> 8) & 0xFF,
          b: colorKey & 0xFF
        };
        pathMap.set(colorKey, entry);
      }
      return entry;
    };
    for(let y=0;y<lines.length;y++){
      let runColor = -1;
      let runStart = 0;
      const flushRun = (colorKey, start, end) => {
        if(colorKey === -1) return;
        const length = end - start;
        if(length <= 0) return;
        const entry = buildEntry(colorKey);
        const rectWidth = length * stepX;
        const rectHeight = stepY;
        const rectX = start * stepX;
        const rectY = y * stepY;
        entry.path += `M${formatNumber(rectX)} ${formatNumber(rectY)}h${formatNumber(rectWidth)}v${formatNumber(rectHeight)}h-${formatNumber(rectWidth)}z`;
      };
      for(let x=0;x<=gridWidth;x++){
        let colorKey = -1;
        if(x < gridWidth){
          const idx = (y*gridWidth + x) * 3;
          const r = colorArray[idx];
          const g = colorArray[idx+1];
          const b = colorArray[idx+2];
          colorKey = (r << 16) | (g << 8) | b;
        }
        if(colorKey !== runColor){
          flushRun(runColor, runStart, x);
          runColor = colorKey;
          runStart = x;
        }
      }
    }
    pathMap.forEach((entry) => {
      backgroundMarkup += `<path fill="rgb(${entry.r},${entry.g},${entry.b})" d="${entry.path}"/>`;
    });
  }
  return {
    textMarkup,
    backgroundMarkup,
    usesPerGlyphFill: asciiPixel || hasColors
  };
}

function buildExportSVG(result, options){
  if(!result) return '';
  const frame = createFrameData(result, options);
  if(!frame) return '';
  const tile = frame.tile != null ? frame.tile : Math.max(1, options.px);
  if(frame.kind === 'ascii'){
    return buildAsciiSVGString(frame, options);
  }
  if(frame.kind === 'thermal'){
    return buildIndexedSVGString(frame.indexes, frame.gridWidth, frame.gridHeight, tile, frame.palette, options.bg, frame.paletteKey);
  }
  if(frame.kind === 'advanced-base'){
    return buildAdvancedBaseSVG(frame, tile, options);
  }
  return buildMaskSVGString(frame.mask, frame.gridWidth, frame.gridHeight, tile, options.bg, options.fg, {glow: options.glow});
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

function buildAdvancedBaseSVG(frame, tile, options){
  const width = Math.max(1, frame.gridWidth || 0);
  const height = Math.max(1, frame.gridHeight || 0);
  const unit = tile || 1;
  const svgW = Math.max(1, Math.round(width * unit));
  const svgH = Math.max(1, Math.round(height * unit));
  const tonal = frame.tonal ? ensureUint8Array(frame.tonal) : null;
  const colors = frame.colors ? ensureUint8Array(frame.colors) : null;
  const hasColors = colors && colors.length >= width * height * 3;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">`;
  const bg = options.bg;
  if(bg && bg !== 'transparent'){
    svg += `<rect width="100%" height="100%" fill="${escapeXML(bg)}"/>`;
  }
  const stepX = unit;
  const stepY = unit;
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const idx = y * width + x;
      let fill = '';
      if(hasColors){
        const base = idx * 3;
        const r = colors[base];
        const g = colors[base + 1];
        const b = colors[base + 2];
        fill = `rgb(${r},${g},${b})`;
      }else if(tonal && tonal.length > idx){
        const tone = tonal[idx];
        fill = `rgb(${tone},${tone},${tone})`;
      }else{
        continue;
      }
      const rectX = x * stepX;
      const rectY = y * stepY;
      svg += `<rect x="${formatNumber(rectX)}" y="${formatNumber(rectY)}" width="${formatNumber(stepX)}" height="${formatNumber(stepY)}" fill="${fill}"/>`;
    }
  }
  svg += '</svg>';
  return svg;
}

function formatNumber(value){
  if(!Number.isFinite(value)) return '0';
  const fixed = value.toFixed(3);
  if(fixed.indexOf('.') === -1) return fixed;
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function escapeXML(str){
  return str.replace(/[&<>"']/g, (ch) => {
    switch(ch){
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return ch;
    }
  });
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

function startPreviewAnimation(canvas, data, width, height, dpr){
  const ctx = canvas.getContext('2d', {alpha: !data.bg || data.bg === 'transparent'});
  if(!ctx || !data.frames || !data.frames.length) return;
  if(typeof ctx.resetTransform === 'function'){
    ctx.resetTransform();
  }else{
    ctx.setTransform(1,0,0,1,0,0);
  }
  if(dpr && dpr !== 1){
    ctx.scale(dpr, dpr);
  }
  const player = {
    canvas,
    ctx,
    data,
    frameIndex: 0,
    accumulator: 0,
    lastTime: 0,
    playing: true,
    rafId: 0,
    width,
    height
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
  const frameData = {
    ...frame,
    type: frame.type || frame.kind,
    bg: player.data.bg,
    fg: player.data.fg,
    glow: player.data.glow
  };
  paintFrame(player.ctx, frameData, player.width || player.canvas.width, player.height || player.canvas.height);
  scheduleAdvancedDitherPreview(player.canvas);
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
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  if(previewData.type === 'mask' || previewData.type === 'ascii' || previewData.type === 'thermal' || previewData.type === 'advanced-base'){
    const canvas = document.createElement('canvas');
    const cssWidth = Math.max(1, dims.width);
    const cssHeight = Math.max(1, dims.height);
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    drawPreviewFrame(canvas, previewData, cssWidth, cssHeight, dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.style.imageRendering = 'pixelated';
    frame.appendChild(canvas);
    scheduleAdvancedDitherPreview(canvas);
    updatePlaybackButton(false);
  }else if(previewData.type === 'animation'){
    const canvas = document.createElement('canvas');
    const cssWidth = Math.max(1, dims.width);
    const cssHeight = Math.max(1, dims.height);
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.style.imageRendering = 'pixelated';
    frame.appendChild(canvas);
    startPreviewAnimation(canvas, previewData, cssWidth, cssHeight, dpr);
  }
  preview.appendChild(frame);
}

let glowHelperCanvas = null;
let glowHelperCtx = null;

function paintFrame(ctx, data, outWidth, outHeight){
  if(!ctx || !data) return;
  const type = data.type || data.kind || (data.mask ? 'mask' : 'ascii');
  if(type === 'ascii'){
    paintAscii(ctx, data, outWidth, outHeight);
  }else if(type === 'thermal'){
    paintThermal(ctx, data, outWidth, outHeight);
  }else if(type === 'advanced-base'){
    paintAdvancedBase(ctx, data, outWidth, outHeight);
  }else{
    paintMask(ctx, data, outWidth, outHeight);
  }
}

function paintMask(ctx, data, outWidth, outHeight){
  if(!ctx || !data) return;
  ctx.save();
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

function paintThermal(ctx, data, outWidth, outHeight){
  if(!ctx || !data) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const bg = data.bg;
  if(bg && bg !== 'transparent'){
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, outWidth, outHeight);
  }else{
    ctx.clearRect(0, 0, outWidth, outHeight);
  }
  const indexes = data.indexes;
  const palette = data.palette || getPaletteByKey(data.paletteKey) || THERMAL_PALETTE;
  if(!indexes || !palette) {
    ctx.restore();
    return;
  }
  const gridWidth = Math.max(1, data.gridWidth || 0);
  const gridHeight = Math.max(1, data.gridHeight || 0);
  const tile = data.tile != null ? data.tile : 1;
  const baseWidth = gridWidth * tile;
  const baseHeight = gridHeight * tile;
  const scaleX = baseWidth ? outWidth / baseWidth : 1;
  const scaleY = baseHeight ? outHeight / baseHeight : 1;
  const cellWidth = tile * scaleX;
  const cellHeight = tile * scaleY;
  const paletteSize = palette.length / 3;
  const colorCache = new Array(paletteSize);
  for(let y=0;y<gridHeight;y++){
    const rowOffset = y*gridWidth;
    const drawY = y * cellHeight;
    for(let x=0;x<gridWidth;x++){
      const idx = indexes[rowOffset + x] || 0;
      const base = idx * 3;
      if(base + 2 >= palette.length) continue;
      let color = colorCache[idx];
      if(!color){
        const r = palette[base];
        const g = palette[base+1];
        const b = palette[base+2];
        color = `rgb(${r},${g},${b})`;
        colorCache[idx] = color;
      }
      ctx.fillStyle = color;
      const drawX = x * cellWidth;
      ctx.fillRect(drawX, drawY, cellWidth, cellHeight);
    }
  }
  ctx.restore();
}

function paintAdvancedBase(ctx, data, outWidth, outHeight){
  if(!ctx || !data) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const bg = data.bg;
  if(bg && bg !== 'transparent'){
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, outWidth, outHeight);
  }else{
    ctx.clearRect(0, 0, outWidth, outHeight);
  }
  const gridWidth = Math.max(1, data.gridWidth || 0);
  const gridHeight = Math.max(1, data.gridHeight || 0);
  const tile = data.tile != null ? data.tile : 1;
  const tonal = data.tonal ? ensureUint8Array(data.tonal) : null;
  const colors = data.colors ? ensureUint8Array(data.colors) : null;
  if((!tonal || tonal.length < gridWidth * gridHeight) && (!colors || colors.length < gridWidth * gridHeight * 3)){
    ctx.restore();
    return;
  }
  const baseWidth = gridWidth * tile;
  const baseHeight = gridHeight * tile;
  const scaleX = baseWidth ? outWidth / baseWidth : 1;
  const scaleY = baseHeight ? outHeight / baseHeight : 1;
  for(let y=0;y<gridHeight;y++){
    const rowOffset = y * gridWidth;
    const drawY = y * tile * scaleY;
    for(let x=0;x<gridWidth;x++){
      const idx = rowOffset + x;
      let r = 0;
      let g = 0;
      let b = 0;
      if(colors && colors.length >= (idx * 3 + 3)){
        const base = idx * 3;
        r = colors[base];
        g = colors[base + 1];
        b = colors[base + 2];
      }else if(tonal && tonal.length > idx){
        const tone = tonal[idx];
        r = g = b = tone;
      }
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      const drawX = x * tile * scaleX;
      ctx.fillRect(drawX, drawY, tile * scaleX, tile * scaleY);
    }
  }
  ctx.restore();
}

function paintAscii(ctx, data, outWidth, outHeight){
  if(!ctx || !data) return;
  ctx.save();
  const bg = data.bg;
  if(bg && bg !== 'transparent'){
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, outWidth, outHeight);
  }else{
    ctx.clearRect(0, 0, outWidth, outHeight);
  }
  const lines = data.lines;
  const gridWidth = Math.max(1, data.gridWidth || (lines && lines[0] ? lines[0].length : 0));
  const gridHeight = Math.max(1, data.gridHeight || (lines ? lines.length : 0));
  if(!lines || !lines.length || !gridWidth || !gridHeight){
    ctx.restore();
    return;
  }
  const cellWidth = outWidth / gridWidth;
  const cellHeight = outHeight / gridHeight;
  const baseSize = Math.min(cellWidth, cellHeight);
  const fontSize = Math.max(2, baseSize * 0.92);
  ctx.font = `${fontSize}px ${ASCII_FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.imageSmoothingEnabled = false;
  const offsetX = cellWidth / 2;
  const offsetY = cellHeight / 2;
  const colorArray = data.colors ? ensureUint8Array(data.colors) : null;
  const hasColors = colorArray && colorArray.length >= gridWidth*gridHeight*3;
  const mode = data.mode || data.kind || 'ascii_simple';
  const isAsciiPixel = mode === 'ascii_pixel';
  const glowAmount = Math.max(0, data.glow || 0);
  if(glowAmount > 0 && (!hasColors || !isAsciiPixel)){
    const fgRGB = hexToRGB(data.fg || '#000000');
    const glowRGB = lightenColor(fgRGB, 0.4);
    ctx.save();
    ctx.fillStyle = `rgb(${glowRGB[0]},${glowRGB[1]},${glowRGB[2]})`;
    ctx.shadowColor = `rgba(${glowRGB[0]},${glowRGB[1]},${glowRGB[2]},0.85)`;
    ctx.shadowBlur = Math.max(2, Math.sqrt(cellWidth*cellWidth + cellHeight*cellHeight) * (0.45 + glowAmount/80));
    drawAsciiLines(ctx, lines, gridWidth, offsetX, offsetY, cellWidth, cellHeight);
    ctx.restore();
  }
  if(isAsciiPixel && hasColors){
    const backgroundCache = new Map();
    for(let y=0;y<gridHeight;y++){
      const rowOffset = y*gridWidth;
      const drawY = y * cellHeight;
      for(let x=0;x<gridWidth;x++){
        const idx = (rowOffset + x) * 3;
        const r = colorArray[idx];
        const g = colorArray[idx+1];
        const b = colorArray[idx+2];
        const key = (r << 16) | (g << 8) | b;
        let fill = backgroundCache.get(key);
        if(!fill){
          fill = `rgb(${r},${g},${b})`;
          backgroundCache.set(key, fill);
        }
        const drawX = x * cellWidth;
        ctx.fillStyle = fill;
        ctx.fillRect(drawX, drawY, cellWidth, cellHeight);
      }
    }
    const asciiPixelCache = new Map();
    drawAsciiLines(ctx, lines, gridWidth, offsetX, offsetY, cellWidth, cellHeight, {
      colors: colorArray,
      asciiPixel: true,
      asciiPixelCache,
      asciiPixelLight: data.asciiPixelLight || 'rgba(248,248,248,0.95)',
      asciiPixelDark: data.asciiPixelDark || 'rgba(16,16,16,0.88)'
    });
  }else if(hasColors){
    const colorCache = new Map();
    drawAsciiLines(ctx, lines, gridWidth, offsetX, offsetY, cellWidth, cellHeight, {
      colors: colorArray,
      colorCache
    });
  }else{
    ctx.fillStyle = data.fg || '#000000';
    drawAsciiLines(ctx, lines, gridWidth, offsetX, offsetY, cellWidth, cellHeight);
  }
  ctx.restore();
}

function drawAsciiLines(ctx, lines, gridWidth, offsetX, offsetY, cellWidth, cellHeight, options = {}){
  const colors = options.colors;
  const totalCells = gridWidth * lines.length;
  const hasColors = colors && colors.length >= totalCells * 3;
  const asciiPixel = Boolean(options.asciiPixel && hasColors);
  const colorCache = hasColors && !asciiPixel ? (options.colorCache || new Map()) : null;
  const asciiPixelCache = asciiPixel ? (options.asciiPixelCache || new Map()) : null;
  const asciiPixelLight = options.asciiPixelLight || 'rgba(245,245,245,0.95)';
  const asciiPixelDark = options.asciiPixelDark || 'rgba(16,16,16,0.88)';
  const asciiPixelThreshold = options.asciiPixelThreshold != null ? options.asciiPixelThreshold : 150;
  for(let y=0;y<lines.length;y++){
    const line = lines[y];
    if(!line) continue;
    const posY = Math.round((y*cellHeight + offsetY) * 10) / 10;
    for(let x=0;x<gridWidth;x++){
      const ch = line.charAt(x);
      if(!ch || ch === ' '){
        continue;
      }
      if(asciiPixel){
        const idx = (y*gridWidth + x) * 3;
        const r = colors[idx];
        const g = colors[idx+1];
        const b = colors[idx+2];
        const luminance = 0.2126*r + 0.7152*g + 0.0722*b;
        const bucket = luminance >= asciiPixelThreshold ? 1 : 0;
        let fill = asciiPixelCache.get(bucket);
        if(!fill){
          fill = bucket ? asciiPixelDark : asciiPixelLight;
          asciiPixelCache.set(bucket, fill);
        }
        ctx.fillStyle = fill;
      }else if(hasColors){
        const idx = (y*gridWidth + x) * 3;
        const r = colors[idx];
        const g = colors[idx+1];
        const b = colors[idx+2];
        const key = (r << 16) | (g << 8) | b;
        let fill = colorCache.get(key);
        if(!fill){
          fill = `rgb(${r},${g},${b})`;
          colorCache.set(key, fill);
        }
        ctx.fillStyle = fill;
      }
      const posX = Math.round((x*cellWidth + offsetX) * 10) / 10;
      ctx.fillText(ch, posX, posY);
    }
  }
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

function drawPreviewFrame(canvas, data, width, height, dpr){
  const alpha = !data.bg || data.bg === 'transparent';
  const ctx = canvas.getContext('2d', {alpha});
  if(!ctx) return;
  if(typeof ctx.resetTransform === 'function'){
    ctx.resetTransform();
  }else{
    ctx.setTransform(1,0,0,1,0,0);
  }
  if(dpr && dpr !== 1){
    ctx.scale(dpr, dpr);
  }
  paintFrame(ctx, data, width, height);
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
  await applyAdvancedDitherToCanvas(canvas, { preview: false });
  const quality = format === 'image/jpeg' ? getJPEGQuality() : undefined;
  const blob = await canvasToBlobWithDPI(canvas, format, quality, dpi);
  triggerDownload(blob, format === 'image/png' ? 'bitmap.png' : 'bitmap.jpg');
}

async function downloadGIF(){
  if(state.sourceKind !== 'video' || !state.videoSource) return;
  const options = collectRenderOptions();
  const exportData = await getVideoExportData(options);
  const dims = alignVideoExportDimensions(getExportDimensions(), exportData.baseWidth, exportData.baseHeight);
  const indexedFrames = [];
  for(const frame of exportData.frames){
    indexedFrames.push(await frameToIndexedFrame(frame, dims.width, dims.height, options));
  }
  if(!indexedFrames.length){
    throw new Error('Nessun frame disponibile per la GIF');
  }
  const referencePalette = indexedFrames[0].palette;
  const transparentIndex = indexedFrames[0].transparentIndex;
  for(let i=1;i<indexedFrames.length;i++){
    if(!palettesMatch(referencePalette, indexedFrames[i].palette)){
      throw new Error('Palette incoerenti tra i frame GIF');
    }
  }
  const gifBytes = encodeIndexedGif(
    indexedFrames.map((f) => f.indexes),
    dims.width,
    dims.height,
    exportData.durations,
    referencePalette,
    transparentIndex
  );
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
    const frameData = {
      ...frame,
      type: frame.kind,
      bg: videoBg,
      fg: options.fg,
      glow: options.glow
    };
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0, 0, dims.width, dims.height);
    paintFrame(ctx, frameData, dims.width, dims.height);
    await applyAdvancedDitherToCanvas(canvas, { preview: false });
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
    const frameData = createFrameData(result, options);
    if(!frameData){
      throw new Error('Frame video non valido');
    }
    frames.push(frameData);
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

function renderAsciiFrameImageData(frame, outWidth, outHeight, options, overrides={}){
  const width = Math.max(1, Math.round(outWidth || frame.outputWidth || 1));
  const height = Math.max(1, Math.round(outHeight || frame.outputHeight || 1));
  const canvas = createExportCanvas(width, height, {forceDOM: true});
  const ctx = canvas.getContext('2d', {alpha: true});
  if(!ctx) return null;
  const charsetKey = frame.charsetKey || (options && options.mode) || 'ascii_simple';
  const charsetSource = typeof frame.charsetString === 'string'
    ? frame.charsetString
    : (charsetKey === 'ascii_custom'
      ? (options && options.asciiCustom)
      : (charsetKey === 'ascii_word' ? (options && options.asciiWord) : ''));
  const lines = frame.lines && frame.lines.length
    ? frame.lines
    : asciiBufferToLines(
      frame.ascii,
      frame.gridWidth,
      frame.gridHeight,
      getASCIICharset(charsetKey, charsetSource)
    );
  paintAscii(ctx, {
    type: 'ascii',
    lines,
    gridWidth: frame.gridWidth,
    gridHeight: frame.gridHeight,
    tile: frame.tile,
    mode: frame.mode || charsetKey,
    bg: overrides.bg != null ? overrides.bg : (options && options.bg != null ? options.bg : 'transparent'),
    fg: overrides.fg != null ? overrides.fg : (options && options.fg != null ? options.fg : '#ffffff'),
    glow: overrides.glow != null ? overrides.glow : 0,
    colors: frame.colors
  }, width, height);
  return ctx.getImageData(0, 0, width, height);
}

function asciiFrameToBinaryFrame(frame, outWidth, outHeight, options){
  const imageData = renderAsciiFrameImageData(frame, outWidth, outHeight, options, {bg: 'transparent', fg: '#ffffff', glow: 0});
  if(!imageData){
    const width = Math.max(1, Math.round(outWidth || frame.outputWidth || 1));
    const height = Math.max(1, Math.round(outHeight || frame.outputHeight || 1));
    return new Uint8Array(width*height);
  }
  const { data, width, height } = imageData;
  const binary = new Uint8Array(width*height);
  for(let i=0, p=0;i<data.length;i+=4,p++){
    binary[p] = data[i+3] > 32 ? 1 : 0;
  }
  return binary;
}

async function frameToIndexedFrame(frame, outWidth, outHeight, options){
  if(!frame){
    return {
      indexes: new Uint8Array(Math.max(1, Math.round(outWidth || 1)) * Math.max(1, Math.round(outHeight || 1))),
      palette: new Uint8Array([0,0,0,255,255,255]),
      transparentIndex: 0
    };
  }
  const tile = frame.tile != null ? frame.tile : (options && options.px != null ? options.px : 1);
  const width = Math.max(1, Math.round(outWidth || frame.outputWidth || (frame.gridWidth * tile) || 1));
  const height = Math.max(1, Math.round(outHeight || frame.outputHeight || (frame.gridHeight * tile) || 1));
  if(buildAdvancedDitherChain().length){
    const canvas = createExportCanvas(width, height, {forceDOM: true});
    const ctx = canvas.getContext('2d', {alpha: options && options.bg === 'transparent'});
    if(ctx){
      const frameData = {
        ...frame,
        type: frame.kind,
        bg: options && options.bg != null ? options.bg : 'transparent',
        fg: options && options.fg != null ? options.fg : '#000000',
        glow: options && options.glow != null ? options.glow : 0
      };
      paintFrame(ctx, frameData, width, height);
      await applyAdvancedDitherToCanvas(canvas, { preview: false });
      let imageData = null;
      try{
        imageData = ctx.getImageData(0, 0, width, height);
      }catch(err){
        imageData = null;
      }
      if(imageData){
        const samples = [];
        const hasTrans = collectGifColorSamples(imageData, samples, options && options.bg === 'transparent');
        const paletteInfo = buildGifPalette(samples, hasTrans);
        const indexes = imageDataToPaletteIndexes(imageData, paletteInfo.palette, paletteInfo.transparentIndex);
        return {indexes, palette: paletteInfo.palette, transparentIndex: paletteInfo.transparentIndex};
      }
    }
  }
  if(frame.kind === 'thermal'){
    const palette = ensureUint8Array(frame.palette) || getPaletteByKey(frame.paletteKey) || THERMAL_PALETTE;
    const indexes = resamplePaletteFrame(
      ensureUint8Array(frame.indexes),
      frame.gridWidth,
      frame.gridHeight,
      width,
      height,
      tile
    );
    return {indexes, palette, transparentIndex: -1, paletteKey: frame.paletteKey || (palette === THERMAL_PALETTE ? THERMAL_PALETTE_KEY : undefined)};
  }
  if(frame.kind === 'ascii'){
    const hasColors = frame.colors && frame.colors.length;
    const asciiOverrides = hasColors
      ? { bg: options && options.bg != null ? options.bg : 'transparent', fg: options && options.fg, glow: 0 }
      : { bg: 'transparent', fg: '#ffffff', glow: 0 };
    const imageData = renderAsciiFrameImageData(frame, width, height, options, asciiOverrides);
    if(!imageData){
      const fallbackIndexes = asciiFrameToBinaryFrame(frame, width, height, options);
      const fallbackPalette = buildBinaryPalette(options && options.bg, options && options.fg);
      return {indexes: fallbackIndexes, palette: fallbackPalette.palette, transparentIndex: fallbackPalette.transparentIndex};
    }
    if(hasColors){
      const samples = [];
      const hasTrans = collectGifColorSamples(imageData, samples, options && options.bg === 'transparent');
      const paletteInfo = buildGifPalette(samples, hasTrans);
      const palette = paletteInfo.palette;
      const transparentIndex = paletteInfo.transparentIndex;
      const indexes = imageDataToPaletteIndexes(imageData, palette, transparentIndex);
      return {indexes, palette, transparentIndex};
    }
    const binary = new Uint8Array(imageData.width * imageData.height);
    const pixels = imageData.data;
    for(let i=0, p=0;i<pixels.length;i+=4,p++){
      binary[p] = pixels[i+3] > 32 ? 1 : 0;
    }
    const paletteInfo = buildBinaryPalette(options && options.bg, options && options.fg);
    return {indexes: binary, palette: paletteInfo.palette, transparentIndex: paletteInfo.transparentIndex};
  }
  const indexes = maskToBinaryFrame(
    frame.mask,
    frame.gridWidth,
    frame.gridHeight,
    width,
    height,
    tile
  );
  const paletteInfo = buildBinaryPalette(options && options.bg, options && options.fg);
  return {indexes, palette: paletteInfo.palette, transparentIndex: paletteInfo.transparentIndex};
}

function collectGifColorSamples(imageData, samples, hasTransparency){
  if(!imageData || !imageData.data) return hasTransparency;
  const { data, width, height } = imageData;
  const totalPixels = width * height;
  if(totalPixels <= 0) return hasTransparency;
  const limit = 65536;
  const step = Math.max(1, Math.floor(Math.sqrt(totalPixels / 4096)));
  outer: for(let y=0;y<height;y+=step){
    for(let x=0;x<width;x+=step){
      const idx = (y * width + x) * 4;
      const alpha = data[idx+3];
      if(alpha < 32){
        hasTransparency = true;
        continue;
      }
      const color = (data[idx] << 16) | (data[idx+1] << 8) | data[idx+2];
      samples.push(color);
      if(samples.length >= limit){
        break outer;
      }
    }
  }
  return hasTransparency;
}

function buildGifPalette(samples, hasTransparency){
  const targetColors = Math.max(1, Math.min(256 - (hasTransparency ? 1 : 0), samples.length || 1));
  const paletteColors = medianCutQuantize(samples, targetColors);
  const totalColors = paletteColors.length + (hasTransparency ? 1 : 0);
  const finalColors = Math.max(2, totalColors);
  const palette = new Uint8Array(finalColors * 3);
  let offset = 0;
  let transparentIndex = -1;
  if(hasTransparency){
    transparentIndex = 0;
    palette[offset++] = 0;
    palette[offset++] = 0;
    palette[offset++] = 0;
  }
  for(let i=0;i<paletteColors.length && offset < palette.length;i++){
    const color = paletteColors[i];
    palette[offset++] = (color >> 16) & 0xFF;
    palette[offset++] = (color >> 8) & 0xFF;
    palette[offset++] = color & 0xFF;
  }
  if(offset < palette.length){
    const fallbackColor = paletteColors.length
      ? paletteColors[paletteColors.length - 1]
      : 0;
    const r = (fallbackColor >> 16) & 0xFF;
    const g = (fallbackColor >> 8) & 0xFF;
    const b = fallbackColor & 0xFF;
    while(offset < palette.length){
      palette[offset++] = r;
      palette[offset++] = g;
      palette[offset++] = b;
    }
  }
  return { palette, transparentIndex };
}

function medianCutQuantize(colors, maxColors){
  if(!colors || !colors.length){
    return [0];
  }
  const boxes = [createColorBox(colors.slice())];
  while(boxes.length < maxColors){
    boxes.sort((a, b) => colorBoxRange(b) - colorBoxRange(a));
    const box = boxes.shift();
    if(!box || box.colors.length <= 1){
      if(box){
        boxes.push(box);
      }
      break;
    }
    const channel = boxWidestChannel(box);
    const sorted = box.colors.slice().sort((a, b) => channelValue(a, channel) - channelValue(b, channel));
    const mid = Math.floor(sorted.length / 2);
    if(mid <= 0 || mid >= sorted.length){
      boxes.push(box);
      break;
    }
    boxes.push(createColorBox(sorted.slice(0, mid)));
    boxes.push(createColorBox(sorted.slice(mid)));
  }
  return boxes.slice(0, maxColors).map((box) => averageColor(box.colors));
}

function createColorBox(colors){
  const box = {
    colors,
    rMin: 255,
    rMax: 0,
    gMin: 255,
    gMax: 0,
    bMin: 255,
    bMax: 0
  };
  for(let i=0;i<colors.length;i++){
    const color = colors[i];
    const r = (color >> 16) & 0xFF;
    const g = (color >> 8) & 0xFF;
    const b = color & 0xFF;
    if(r < box.rMin) box.rMin = r;
    if(r > box.rMax) box.rMax = r;
    if(g < box.gMin) box.gMin = g;
    if(g > box.gMax) box.gMax = g;
    if(b < box.bMin) box.bMin = b;
    if(b > box.bMax) box.bMax = b;
  }
  return box;
}

function colorBoxRange(box){
  return Math.max(box.rMax - box.rMin, box.gMax - box.gMin, box.bMax - box.bMin);
}

function boxWidestChannel(box){
  const rRange = box.rMax - box.rMin;
  const gRange = box.gMax - box.gMin;
  const bRange = box.bMax - box.bMin;
  if(rRange >= gRange && rRange >= bRange) return 'r';
  if(gRange >= rRange && gRange >= bRange) return 'g';
  return 'b';
}

function channelValue(color, channel){
  if(channel === 'r') return (color >> 16) & 0xFF;
  if(channel === 'g') return (color >> 8) & 0xFF;
  return color & 0xFF;
}

function averageColor(colors){
  if(!colors.length){
    return 0;
  }
  let r = 0;
  let g = 0;
  let b = 0;
  for(let i=0;i<colors.length;i++){
    const color = colors[i];
    r += (color >> 16) & 0xFF;
    g += (color >> 8) & 0xFF;
    b += color & 0xFF;
  }
  const count = colors.length;
  return ((Math.round(r / count) & 0xFF) << 16) |
         ((Math.round(g / count) & 0xFF) << 8) |
         (Math.round(b / count) & 0xFF);
}

function imageDataToPaletteIndexes(imageData, palette, transparentIndex){
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const total = width * height;
  const indexes = new Uint8Array(total);
  const paletteLength = Math.max(1, Math.floor(palette.length / 3));
  const skip = transparentIndex >= 0 ? 1 : 0;
  const cache = new Map();
  for(let i=0, p=0;i<data.length;i+=4,p++){
    const alpha = data[i+3];
    if(transparentIndex >= 0 && alpha < 32){
      indexes[p] = transparentIndex;
      continue;
    }
    const color = (data[i] << 16) | (data[i+1] << 8) | data[i+2];
    let idx = cache.get(color);
    if(idx == null){
      idx = findNearestPaletteIndex(color, palette, skip, paletteLength);
      cache.set(color, idx);
    }
    indexes[p] = idx;
  }
  return indexes;
}

function findNearestPaletteIndex(color, palette, offset, paletteLength){
  const r = (color >> 16) & 0xFF;
  const g = (color >> 8) & 0xFF;
  const b = color & 0xFF;
  let best = offset < paletteLength ? offset : 0;
  let bestDist = Infinity;
  for(let i=offset;i<paletteLength;i++){
    const base = i * 3;
    const pr = palette[base] || 0;
    const pg = palette[base+1] || 0;
    const pb = palette[base+2] || 0;
    const dr = pr - r;
    const dg = pg - g;
    const db = pb - b;
    const dist = dr*dr + dg*dg + db*db;
    if(dist < bestDist){
      bestDist = dist;
      best = i;
      if(dist === 0) break;
    }
  }
  return best;
}

function buildBinaryPalette(bgColor, fgColor){
  const palette = new Uint8Array(6);
  let transparentIndex = -1;
  const bg = (!bgColor || bgColor === 'transparent') ? [0,0,0] : hexToRGB(bgColor);
  if(!bgColor || bgColor === 'transparent'){
    transparentIndex = 0;
  }
  const fg = hexToRGB(fgColor || '#000000');
  palette.set(bg, 0);
  palette.set(fg, 3);
  return {palette, transparentIndex};
}

function palettesMatch(a, b){
  if(a === b) return true;
  if(!a || !b) return false;
  if(a.length !== b.length) return false;
  for(let i=0;i<a.length;i++){
    if(a[i] !== b[i]) return false;
  }
  return true;
}

function resamplePaletteFrame(indexes, gridWidth, gridHeight, outWidth, outHeight, tile){
  if(!gridWidth || !gridHeight){
    const width = Math.max(1, Math.round(outWidth || 1));
    const height = Math.max(1, Math.round(outHeight || 1));
    return new Uint8Array(width * height);
  }
  const unit = Math.max(1e-3, Math.abs(tile || 1));
  const baseWidth = Math.max(1, Math.round(gridWidth * unit));
  const baseHeight = Math.max(1, Math.round(gridHeight * unit));
  const targetWidth = Math.max(1, Math.round(outWidth || baseWidth));
  const targetHeight = Math.max(1, Math.round(outHeight || baseHeight));
  const cellWidthPx = baseWidth / gridWidth;
  const cellHeightPx = baseHeight / gridHeight;
  const source = ensureUint8Array(indexes) || new Uint8Array(gridWidth * gridHeight);
  const output = new Uint8Array(targetWidth * targetHeight);
  for(let y=0;y<targetHeight;y++){
    const srcYPx = Math.min(baseHeight - 1, Math.floor(y * baseHeight / targetHeight));
    const cellY = Math.min(gridHeight - 1, Math.floor(srcYPx / cellHeightPx));
    const rowOffset = cellY * gridWidth;
    for(let x=0;x<targetWidth;x++){
      const srcXPx = Math.min(baseWidth - 1, Math.floor(x * baseWidth / targetWidth));
      const cellX = Math.min(gridWidth - 1, Math.floor(srcXPx / cellWidthPx));
      output[y*targetWidth + x] = source[rowOffset + cellX] || 0;
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

function encodeIndexedGif(frames, width, height, durations, palette, transparentIndex){
  const bytes = [];
  const writeByte = (b) => bytes.push(b & 0xFF);
  const writeWord = (w) => { writeByte(w & 0xFF); writeByte((w >> 8) & 0xFF); };
  const pushString = (str) => { for(let i=0;i<str.length;i++) writeByte(str.charCodeAt(i)); };
  const paletteSize = Math.max(1, Math.floor((palette ? palette.length : 0) / 3));
  const tableSize = 1 << Math.ceil(Math.log2(Math.max(2, paletteSize)));
  const gctBits = Math.max(0, Math.ceil(Math.log2(tableSize)) - 1);
  pushString('GIF89a');
  writeWord(width);
  writeWord(height);
  const packedFields = 0x80 | (gctBits << 4) | gctBits;
  writeByte(packedFields);
  writeByte(Math.max(0, transparentIndex));
  writeByte(0x00);
  const globalTable = new Uint8Array(tableSize * 3);
  if(palette){
    globalTable.set(palette.subarray(0, Math.min(palette.length, globalTable.length)));
  }
  for(let i=0;i<globalTable.length;i++){
    writeByte(globalTable[i]);
  }
  writeByte(0x21); writeByte(0xFF); writeByte(0x0B);
  pushString('NETSCAPE2.0');
  writeByte(0x03); writeByte(0x01); writeWord(0x0000); writeByte(0x00);
  for(let i=0;i<frames.length;i++){
    const delay = Math.max(1, Math.round((durations[i] || 100) / 10));
    writeByte(0x21); writeByte(0xF9); writeByte(0x04);
    writeByte(transparentIndex >= 0 ? 0x01 : 0x00);
    writeWord(delay);
    writeByte(transparentIndex >= 0 ? transparentIndex : 0);
    writeByte(0x00);
    writeByte(0x2C);
    writeWord(0); writeWord(0);
    writeWord(width); writeWord(height);
    writeByte(0x00);
    writeIndexedImageData(frames[i], tableSize);
  }
  writeByte(0x3B);
  return new Uint8Array(bytes);

  function writeIndexedImageData(indexes, tableSize){
    const minCodeSize = Math.max(2, Math.ceil(Math.log2(Math.max(2, tableSize))));
    writeByte(minCodeSize);
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let dictSize = eoiCode + 1;
    const dictionary = new Map();
    const dataBytes = [];
    let buffer = 0;
    let bits = 0;

    const pushDataByte = (byte) => {
      dataBytes.push(byte & 0xFF);
    };

    const emitCode = (code) => {
      buffer |= code << bits;
      bits += codeSize;
      while(bits >= 8){
        pushDataByte(buffer & 0xFF);
        buffer >>= 8;
        bits -= 8;
      }
    };

    const resetDictionary = () => {
      dictionary.clear();
      codeSize = minCodeSize + 1;
      dictSize = eoiCode + 1;
      emitCode(clearCode);
    };

    resetDictionary();

    if(!indexes || !indexes.length){
      emitCode(eoiCode);
    }else{
      let prefix = indexes[0] || 0;
      for(let i=1;i<indexes.length;i++){
        const value = indexes[i] || 0;
        const key = (prefix << 12) | value;
        if(dictionary.has(key)){
          prefix = dictionary.get(key);
          continue;
        }
        emitCode(prefix);
        if(dictSize < 4096){
          dictionary.set(key, dictSize++);
          if(dictSize === (1 << codeSize) && codeSize < 12){
            codeSize++;
          }
          if(dictSize >= 4096){
            resetDictionary();
          }
        }else{
          resetDictionary();
        }
        prefix = value;
      }
      emitCode(prefix);
      emitCode(eoiCode);
    }
    if(bits > 0){
      pushDataByte(buffer & 0xFF);
    }
    let offset = 0;
    while(offset < dataBytes.length){
      const size = Math.min(255, dataBytes.length - offset);
      writeByte(size);
      for(let i=0;i<size;i++){
        writeByte(dataBytes[offset++]);
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
    placeholderCanvas.width = 1200;
    placeholderCanvas.height = 600;
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
