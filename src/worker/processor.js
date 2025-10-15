const ctx = self;

let sourceCanvas = null;
let sourceCtx = null;
let sourceWidth = 0;
let sourceHeight = 0;
let currentSourceKey = '';
let workCanvas = null;
let workCtx = null;
let workWidth = 0;
let workHeight = 0;
let baseGray = null;
let baseSource = null;
let baseGrid = null;
let baseColorGrid = null;
let lastGridWidth = 0;
let lastGridHeight = 0;
let lastColorWidth = 0;
let lastColorHeight = 0;

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
    const local = Math.min(1, Math.max(0, span > 0 ? (t - a.t) / span : 0));
    const r = Math.round(lerp(a.r, b.r, local));
    const g = Math.round(lerp(a.g, b.g, local));
    const bVal = Math.round(lerp(a.b, b.b, local));
    palette[i*3] = clamp255(r);
    palette[i*3 + 1] = clamp255(g);
    palette[i*3 + 2] = clamp255(bVal);
  }
  return palette;
}

const ASCII_DEFAULT_CUSTOM = ' .:-=+*#%@';
const ASCII_DEFAULT_WORD = 'PIXEL';
const ASCII_MIN_TILE = 8;
const ASCII_CUSTOM_MAX = 64;
const ASCII_WORD_MAX = 32;

const BAYER4_MATRIX = [
  [0,8,2,10],
  [12,4,14,6],
  [3,11,1,9],
  [15,7,13,5]
];

const DIFFUSION_KERNELS = {
  fs:{div:16,taps:[{dx:1,dy:0,w:7},{dx:-1,dy:1,w:3},{dx:0,dy:1,w:5},{dx:1,dy:1,w:1}]},
  atkinson:{div:8,taps:[{dx:1,dy:0,w:1},{dx:2,dy:0,w:1},{dx:-1,dy:1,w:1},{dx:0,dy:1,w:1},{dx:1,dy:1,w:1},{dx:0,dy:2,w:1}]},
  jjn:{div:48,taps:[{dx:1,dy:0,w:7},{dx:2,dy:0,w:5},{dx:-2,dy:1,w:3},{dx:-1,dy:1,w:5},{dx:0,dy:1,w:7},{dx:1,dy:1,w:5},{dx:2,dy:1,w:3},{dx:-2,dy:2,w:1},{dx:-1,dy:2,w:3},{dx:0,dy:2,w:5},{dx:1,dy:2,w:3},{dx:2,dy:2,w:1}]},
  stucki:{div:42,taps:[{dx:1,dy:0,w:8},{dx:2,dy:0,w:4},{dx:-2,dy:1,w:2},{dx:-1,dy:1,w:4},{dx:0,dy:1,w:8},{dx:1,dy:1,w:4},{dx:2,dy:1,w:2},{dx:-2,dy:2,w:1},{dx:-1,dy:2,w:2},{dx:0,dy:2,w:4},{dx:1,dy:2,w:2},{dx:2,dy:2,w:1}]},
  burkes:{div:32,taps:[{dx:1,dy:0,w:8},{dx:2,dy:0,w:4},{dx:-2,dy:1,w:2},{dx:-1,dy:1,w:4},{dx:0,dy:1,w:8},{dx:1,dy:1,w:4},{dx:2,dy:1,w:2}]},
  sierra2:{div:32,taps:[{dx:1,dy:0,w:4},{dx:2,dy:0,w:3},{dx:-2,dy:1,w:1},{dx:-1,dy:1,w:2},{dx:0,dy:1,w:3},{dx:1,dy:1,w:2},{dx:2,dy:1,w:1}]}
};

const ASCII_SETS = {
  ascii_simple: [' ','.',':','-','=','+','#','@'],
  ascii_pixel: [' ','.',':','-','=','+','#','@'],
  ascii_unicode: [' ','·',':','-','=','+','*','#','%','@'],
  ascii_word: [' ','P','I','X','E','L']
};

function normalizeCustomCharset(input){
  let chars = Array.from(typeof input === 'string' ? input : '');
  chars = chars.filter((ch) => ch !== '\r' && ch !== '\n');
  if(chars.length === 0){
    chars = Array.from(ASCII_DEFAULT_CUSTOM);
  }
  if(!chars.includes(' ')){
    chars.unshift(' ');
  }
  if(chars.length > ASCII_CUSTOM_MAX){
    chars.length = ASCII_CUSTOM_MAX;
  }
  return chars.join('');
}

function normalizeWordString(input){
  let value = typeof input === 'string' ? input : '';
  value = value.replace(/\s+/g, '');
  if(!value){
    value = ASCII_DEFAULT_WORD;
  }
  if(value.length > ASCII_WORD_MAX){
    value = value.slice(0, ASCII_WORD_MAX);
  }
  return value.toUpperCase();
}

function resolveCharset(key, customString){
  if(key === 'ascii_custom'){
    const normalized = normalizeCustomCharset(customString);
    return {chars: Array.from(normalized), key: 'ascii_custom', charsetString: normalized};
  }
  if(key === 'ascii_word'){
    const normalizedWord = normalizeWordString(customString);
    const charsetString = ` ${normalizedWord}`;
    return {chars: Array.from(charsetString), key: 'ascii_word', charsetString};
  }
  const base = ASCII_SETS[key];
  if(base){
    return {chars: base, key, charsetString: base.join('')};
  }
  const fallback = ASCII_SETS.ascii_simple;
  return {chars: fallback, key: 'ascii_simple', charsetString: fallback.join('')};
}

ctx.postMessage({type:'ready'});

ctx.addEventListener('message', (event) => {
  const data = event.data;
  if(!data) return;
  if(data.type === 'load-source'){
    handleLoadSource(data);
    return;
  }
  if(data.type === 'process'){
    handleProcess(data);
  }
});

function handleLoadSource({image, offscreen, width, height, version, key}){
  if(!width || !height) return;
  currentSourceKey = key || '';
  if(offscreen){
    sourceCanvas = offscreen;
    sourceCtx = sourceCanvas.getContext('2d', {alpha:false, desynchronized:true});
  }else if(image){
    if(!sourceCanvas || sourceCanvas.width !== width || sourceCanvas.height !== height){
      sourceCanvas = new OffscreenCanvas(width, height);
      sourceCtx = sourceCanvas.getContext('2d', {alpha:false, desynchronized:true});
    }else{
      sourceCtx.clearRect(0,0,width,height);
    }
    sourceCtx.drawImage(image, 0, 0, width, height);
    if(typeof image.close === 'function'){
      try{ image.close(); }catch(e){ /* ignore */ }
    }
  }else{
    return;
  }
  sourceWidth = width;
  sourceHeight = height;
  workWidth = 0;
  workHeight = 0;
  baseGray = null;
  baseSource = null;
  baseGrid = null;
  baseColorGrid = null;
  lastGridWidth = 0;
  lastGridHeight = 0;
  lastColorWidth = 0;
  lastColorHeight = 0;
  ctx.postMessage({type:'source-loaded', version, key: currentSourceKey});
}

function handleProcess({jobId, options}){
  try{
    const result = processImage(options||{});
    const transfers = [];
    if(result.mask) transfers.push(result.mask.buffer);
    if(result.tonal) transfers.push(result.tonal.buffer);
    if(result.indexes) transfers.push(result.indexes.buffer);
    if(result.palette) transfers.push(result.palette.buffer);
    if(result.ascii) transfers.push(result.ascii.buffer);
    if(result.colors) transfers.push(result.colors.buffer);
    ctx.postMessage({...result, type:'result', jobId}, transfers);
  }catch(error){
    ctx.postMessage({type:'error', jobId, message: error && error.message ? error.message : String(error)});
  }
}

function ensureWorkContext(width, height){
  if(!workCanvas || workCanvas.width !== width || workCanvas.height !== height){
    workCanvas = new OffscreenCanvas(width, height);
    workCtx = workCanvas.getContext('2d', {alpha:false, desynchronized:true});
  }else{
    workCtx.clearRect(0,0,width,height);
  }
  return workCtx;
}

function processImage(options){
  if(!sourceCanvas){
    throw new Error('Nessuna immagine sorgente');
  }
  prepareBaseGray();
  const pixelSize = Math.max(1, Math.round(options.pixelSize||10));
  const targetWidth = sourceWidth > 0 ? (sourceWidth / pixelSize) : 0;
  const targetHeight = sourceHeight > 0 ? (sourceHeight / pixelSize) : 0;
  let baseWidth = Math.max(1, Math.round(targetWidth));
  let baseHeight = Math.max(1, Math.round(targetHeight));
  if(sourceWidth > 0 && sourceHeight > 0){
    const refined = refineGridSize(baseWidth, baseHeight, targetWidth, targetHeight, sourceWidth / sourceHeight);
    baseWidth = refined.width;
    baseHeight = refined.height;
  }
  const total = baseWidth*baseHeight;
  const base = ensureGridBase(baseWidth, baseHeight);
  const working = new Float32Array(base);
  const grain = Math.max(0, Math.min(100, options.grain||0));
  if(grain>0){
    for(let i=0;i<working.length;i++){
      const noise = (Math.random()-0.5)*2*grain;
      working[i] = clamp255(working[i] + noise);
    }
  }
  const blurAmount = Math.max(0, options.blur||0);
  if(blurAmount>0){
    const radius = Math.max(1, Math.round(blurAmount / Math.max(1, pixelSize/2)));
    applyGaussianBlur(working, baseWidth, baseHeight, radius);
  }

  const tonal = new Uint8Array(total);
  const tonalLUT = buildTonalLUT(options.blackPoint, options.whitePoint, options.gamma, options.brightness, options.contrast);
  let sum = 0;
  for(let i=0;i<total;i++){
    const baseValue = clamp255(Math.round(working[i]));
    const value = tonalLUT[baseValue];
    tonal[i] = value;
    sum += value;
  }
  const avg = sum/total;
  let invert = false;
  const invertMode = options.invertMode || 'auto';
  if(invertMode === 'yes') invert = true;
  else if(invertMode === 'no') invert = false;
  else invert = avg > 128;

  const dither = options.dither || 'none';
  let mask = null;
  let gridWidth = baseWidth;
  let gridHeight = baseHeight;
  let tile = pixelSize;

  const isAscii = dither === 'ascii_simple' || dither === 'ascii_unicode' || dither === 'ascii_custom' || dither === 'ascii_pixel' || dither === 'ascii_word';
  if(isAscii){
    const ascii = asciiDither(tonal, baseWidth, baseHeight, invert, dither, options.asciiCustom, options.asciiWord, options.threshold);
    const asciiTile = Math.max(pixelSize, ASCII_MIN_TILE);
    const payload = {
      kind: 'ascii',
      gridWidth: baseWidth,
      gridHeight: baseHeight,
      mode: dither,
      outputWidth: Math.round(baseWidth*asciiTile),
      outputHeight: Math.round(baseHeight*asciiTile),
      tile: asciiTile,
      ascii: ascii.data,
      charsetKey: ascii.key,
      charsetString: ascii.charsetString,
      aspectWidth: sourceWidth,
      aspectHeight: sourceHeight
    };
    if(dither === 'ascii_pixel'){
      const colors = ensureColorGrid(baseWidth, baseHeight);
      payload.colors = colors ? new Uint8Array(colors) : null;
    }
    if(ascii.lines){
      payload.lines = ascii.lines;
    }
    return payload;
  }

  if(dither === 'advanced_base'){
    const thrRaw = typeof options.threshold === 'number' ? options.threshold : parseFloat(options.threshold);
    const thr = Math.max(0, Math.min(255, Number.isFinite(thrRaw) ? thrRaw : 128));
    const tonalOut = new Uint8Array(total);
    const bias = Math.round(128 - thr);
    const colorSource = ensureColorGrid(baseWidth, baseHeight);
    const colorOut = colorSource ? new Uint8Array(colorSource.length) : null;
    for(let i=0;i<total;i++){
      const baseTone = tonal[i];
      let tone = invert ? (255 - baseTone) : baseTone;
      tone = clamp255(Math.round(tone + bias));
      tonalOut[i] = tone;
      if(colorOut && colorSource){
        const offset = i*3;
        let r = colorSource[offset];
        let g = colorSource[offset + 1];
        let b = colorSource[offset + 2];
        r = tonalLUT[r];
        g = tonalLUT[g];
        b = tonalLUT[b];
        if(invert){
          r = 255 - r;
          g = 255 - g;
          b = 255 - b;
        }
        r = clamp255(r + bias);
        g = clamp255(g + bias);
        b = clamp255(b + bias);
        colorOut[offset] = r;
        colorOut[offset + 1] = g;
        colorOut[offset + 2] = b;
      }
    }
    return {
      kind: 'advanced-base',
      gridWidth: baseWidth,
      gridHeight: baseHeight,
      tile: pixelSize,
      tonal: tonalOut,
      colors: colorOut,
      threshold: thr,
      invert,
      outputWidth: Math.round(baseWidth*pixelSize),
      outputHeight: Math.round(baseHeight*pixelSize),
      aspectWidth: sourceWidth,
      aspectHeight: sourceHeight,
      mode: options.mode || 'advanced-base'
    };
  }

  if(dither === 'thermal'){
    const thermal = thermalPixelize(tonal, baseWidth, baseHeight, invert);
    return {
      kind: 'thermal',
      gridWidth: baseWidth,
      gridHeight: baseHeight,
      mode: dither,
      outputWidth: Math.round(baseWidth*pixelSize),
      outputHeight: Math.round(baseHeight*pixelSize),
      tile: pixelSize,
      indexes: thermal.indexes,
      paletteKey: thermal.paletteKey,
      aspectWidth: sourceWidth,
      aspectHeight: sourceHeight
    };
  }

  if(dither === 'halftone' || dither === 'halftone_motion'){
    const halftone = halftoneDither(tonal, baseWidth, baseHeight, options.threshold, invert, dither, pixelSize);
    mask = halftone.mask;
    gridWidth = halftone.width;
    gridHeight = halftone.height;
    tile = pixelSize / halftone.scale;
  }else if(dither === 'none'){
    mask = thresholdMask(tonal, baseWidth, baseHeight, options.threshold, invert);
  }else if(dither === 'bayer4' || dither === 'bayer8' || dither === 'cross'){
    mask = orderedDither(tonal, baseWidth, baseHeight, options.threshold, invert, dither);
  }else{
    mask = errorDiffuse(tonal, baseWidth, baseHeight, options.threshold, invert, dither);
  }

  if(mask){
    const thick = Math.max(1, Math.round(options.thickness||1));
    const style = options.style || 'solid';
    if(style === 'outline'){
      mask = boundary(mask, gridWidth, gridHeight, thick);
    }else if(style === 'ring'){
      const dil = dilate(mask, gridWidth, gridHeight, thick);
      const ero = erode(mask, gridWidth, gridHeight, thick);
      mask = subtract(dil, ero);
    }
  }

  return {
    kind: 'mask',
    gridWidth,
    gridHeight,
    mode: dither,
    outputWidth: Math.round(baseWidth*pixelSize),
    outputHeight: Math.round(baseHeight*pixelSize),
    tile,
    mask,
    aspectWidth: sourceWidth,
    aspectHeight: sourceHeight
  };
}

function refineGridSize(widthGuess, heightGuess, targetWidth, targetHeight, ratio){
  let bestWidth = Math.max(1, widthGuess);
  let bestHeight = Math.max(1, heightGuess);
  let bestScore = score(bestWidth, bestHeight);
  for(let dw=-3; dw<=3; dw++){
    for(let dh=-3; dh<=3; dh++){
      const candidateW = Math.max(1, widthGuess + dw);
      const candidateH = Math.max(1, heightGuess + dh);
      const candidateScore = score(candidateW, candidateH);
      if(candidateScore < bestScore){
        bestScore = candidateScore;
        bestWidth = candidateW;
        bestHeight = candidateH;
      }
    }
  }
  return {width: bestWidth, height: bestHeight};

  function score(w, h){
    const ratioVal = h > 0 ? w / h : ratio;
    const ratioError = ratio > 0 ? Math.abs(ratioVal - ratio) : 0;
    const widthError = Math.abs(w - targetWidth);
    const heightError = Math.abs(h - targetHeight);
    return (ratioError * 1000) + widthError + heightError;
  }
}

function asciiDither(gray, width, height, invert, key, customString, wordString, threshold){
  if(key === 'ascii_word'){
    return asciiWordDither(gray, width, height, invert, wordString, threshold);
  }
  const charsetInfo = resolveCharset(key, customString);
  const charset = charsetInfo.chars;
  const maxIndex = charset.length > 0 ? charset.length - 1 : 0;
  const buffer = new Uint8Array(width*height);
  for(let i=0;i<buffer.length;i++){
    const value = invert ? (255 - gray[i]) : gray[i];
    let idx = maxIndex > 0 ? Math.round((value/255) * maxIndex) : 0;
    if(idx < 0) idx = 0;
    else if(idx > maxIndex) idx = maxIndex;
    buffer[i] = idx;
  }
  return {data: buffer, key: charsetInfo.key, charsetString: charsetInfo.charsetString};
}

function asciiWordDither(gray, width, height, invert, wordInput, threshold){
  const word = normalizeWordString(wordInput);
  const letters = word.length ? Array.from(word) : Array.from(ASCII_DEFAULT_WORD);
  const charsetString = ` ${word}`;
  const buffer = new Uint8Array(width*height);
  const lines = new Array(height);
  const thrValue = Math.max(0, Math.min(255, parseInt(threshold, 10))); // might be NaN
  const effectiveThreshold = Number.isFinite(thrValue) ? thrValue : 180;
  const letterCount = letters.length || 1;
  let pointer = 0;
  for(let y=0;y<height;y++){
    const row = new Array(width);
    const rowOffset = y*width;
    for(let x=0;x<width;x++){
      const idx = rowOffset + x;
      const value = invert ? (255 - gray[idx]) : gray[idx];
      if(value < effectiveThreshold){
        const letterIndex = pointer % letterCount;
        pointer++;
        buffer[idx] = letterIndex + 1;
        row[x] = letters[letterIndex];
      }else{
        buffer[idx] = 0;
        row[x] = ' ';
      }
    }
    lines[y] = row.join('');
  }
  return {data: buffer, key: 'ascii_word', charsetString, lines};
}


function prepareBaseGray(){
  if(baseGray && workWidth>0 && workHeight>0) return;
  const longSide = Math.max(sourceWidth, sourceHeight);
  let targetLong = longSide;
  if(longSide > 1536){
    targetLong = 1536;
  }
  const scale = targetLong / longSide;
  workWidth = Math.max(1, Math.round(sourceWidth * scale));
  workHeight = Math.max(1, Math.round(sourceHeight * scale));
  const ctx = ensureWorkContext(workWidth, workHeight);
  ctx.drawImage(sourceCanvas, 0, 0, workWidth, workHeight);
  const imageData = ctx.getImageData(0,0,workWidth,workHeight);
  const data = imageData.data;
  baseSource = new Uint8ClampedArray(data);
  baseGray = new Float32Array(workWidth*workHeight);
  for(let i=0,j=0;i<data.length;i+=4,j++){
    baseGray[j] = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
  }
  baseGrid = null;
  baseColorGrid = null;
  lastGridWidth = 0;
  lastGridHeight = 0;
  lastColorWidth = 0;
  lastColorHeight = 0;
}

function ensureGridBase(gridWidth, gridHeight){
  if(!baseGray) prepareBaseGray();
  if(baseGrid && gridWidth === lastGridWidth && gridHeight === lastGridHeight){
    return baseGrid;
  }
  baseGrid = new Float32Array(gridWidth*gridHeight);
  const scaleX = workWidth / gridWidth;
  const scaleY = workHeight / gridHeight;
  for(let y=0;y<gridHeight;y++){
    const srcY = (y + 0.5) * scaleY - 0.5;
    const y0 = Math.max(0, Math.floor(srcY));
    const y1 = Math.min(workHeight - 1, y0 + 1);
    const fy = srcY - y0;
    for(let x=0;x<gridWidth;x++){
      const srcX = (x + 0.5) * scaleX - 0.5;
      const x0 = Math.max(0, Math.floor(srcX));
      const x1 = Math.min(workWidth - 1, x0 + 1);
      const fx = srcX - x0;
      const i00 = baseGray[y0*workWidth + x0];
      const i10 = baseGray[y0*workWidth + x1];
      const i01 = baseGray[y1*workWidth + x0];
      const i11 = baseGray[y1*workWidth + x1];
      const top = i00 + (i10 - i00) * fx;
      const bottom = i01 + (i11 - i01) * fx;
      baseGrid[y*gridWidth + x] = top + (bottom - top) * fy;
    }
  }
  lastGridWidth = gridWidth;
  lastGridHeight = gridHeight;
  return baseGrid;
}

function ensureColorGrid(gridWidth, gridHeight){
  if(!baseSource) prepareBaseGray();
  if(baseColorGrid && gridWidth === lastColorWidth && gridHeight === lastColorHeight){
    return baseColorGrid;
  }
  const total = gridWidth * gridHeight;
  const targetSize = total * 3;
  if(!baseColorGrid || baseColorGrid.length !== targetSize){
    baseColorGrid = new Uint8Array(targetSize);
  }
  const scaleX = workWidth / gridWidth;
  const scaleY = workHeight / gridHeight;
  for(let y=0;y<gridHeight;y++){
    const srcY = (y + 0.5) * scaleY - 0.5;
    const y0 = Math.max(0, Math.floor(srcY));
    const y1 = Math.min(workHeight - 1, y0 + 1);
    const fy = srcY - y0;
    for(let x=0;x<gridWidth;x++){
      const srcX = (x + 0.5) * scaleX - 0.5;
      const x0 = Math.max(0, Math.floor(srcX));
      const x1 = Math.min(workWidth - 1, x0 + 1);
      const fx = srcX - x0;
      const base00 = ((y0*workWidth) + x0) * 4;
      const base10 = ((y0*workWidth) + x1) * 4;
      const base01 = ((y1*workWidth) + x0) * 4;
      const base11 = ((y1*workWidth) + x1) * 4;
      const rTop = baseSource[base00] + (baseSource[base10] - baseSource[base00]) * fx;
      const gTop = baseSource[base00 + 1] + (baseSource[base10 + 1] - baseSource[base00 + 1]) * fx;
      const bTop = baseSource[base00 + 2] + (baseSource[base10 + 2] - baseSource[base00 + 2]) * fx;
      const rBottom = baseSource[base01] + (baseSource[base11] - baseSource[base01]) * fx;
      const gBottom = baseSource[base01 + 1] + (baseSource[base11 + 1] - baseSource[base01 + 1]) * fx;
      const bBottom = baseSource[base01 + 2] + (baseSource[base11 + 2] - baseSource[base01 + 2]) * fx;
      const r = Math.round(clamp255(rTop + (rBottom - rTop) * fy));
      const g = Math.round(clamp255(gTop + (gBottom - gTop) * fy));
      const b = Math.round(clamp255(bTop + (bBottom - bTop) * fy));
      const offset = (y*gridWidth + x) * 3;
      baseColorGrid[offset] = r;
      baseColorGrid[offset + 1] = g;
      baseColorGrid[offset + 2] = b;
    }
  }
  lastColorWidth = gridWidth;
  lastColorHeight = gridHeight;
  return baseColorGrid;
}

function lerp(a, b, t){
  return a + (b - a) * t;
}

function clamp255(value){
  if(value<0) return 0;
  if(value>255) return 255;
  return value;
}

function clamp01(value){
  if(value<0) return 0;
  if(value>1) return 1;
  return value;
}

function buildTonalLUT(bp, wp, gamma, bright, contrast){
  const lut = new Uint8Array(256);
  const bpv = Math.max(0, Math.min(255, typeof bp === 'number' ? bp : parseFloat(bp)||0));
  const rawWp = typeof wp === 'number' ? wp : parseFloat(wp);
  const wpv = Math.max(bpv+1, Math.min(255, Number.isFinite(rawWp) ? rawWp : 255));
  const brightVal = parseFloat(bright)||0;
  const contrastVal = Math.max(-100, Math.min(100, parseFloat(contrast)||0));
  const gammaVal = Math.max(0.1, parseFloat(gamma)||1);
  for(let i=0;i<256;i++){
    let L = i + brightVal;
    L = (L - 128) * (1 + contrastVal/100) + 128;
    let n = (L - bpv) / (wpv - bpv);
    if(n<0) n=0; else if(n>1) n=1;
    if(Math.abs(gammaVal-1)>1e-3){
      n = Math.pow(n, 1/gammaVal);
    }
    lut[i] = clamp255(Math.round(n*255));
  }
  return lut;
}

function thresholdMask(gray, width, height, threshold, invert){
  const thr = Math.max(0, Math.min(255, parseInt(threshold,10)||0));
  const out = new Uint8Array(width*height);
  for(let i=0;i<out.length;i++){
    const v = invert ? (gray[i] > thr) : (gray[i] < thr);
    out[i] = v ? 1 : 0;
  }
  return out;
}

function orderedDither(gray, width, height, threshold, invert, mode){
  if(mode === 'bayer8'){
    return orderedDither(gray, width, height, threshold, invert, 'bayer4');
  }
  if(mode === 'cross'){
    return crosshatchDither(gray, width, height, threshold, invert);
  }
  const out = new Uint8Array(width*height);
  const thr = Math.max(0, Math.min(255, parseInt(threshold,10)||0));
  const N = 16;
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const i = y*width+x;
      const thresholdMatrix = (BAYER4_MATRIX[y%4][x%4]+0.5)/N;
      const g = (gray[i]-thr)/255+0.5;
      const on = invert ? (g > thresholdMatrix) : (g < thresholdMatrix);
      out[i] = on ? 1 : 0;
    }
  }
  return out;
}

function halftoneDither(gray, width, height, threshold, invert, mode, pixelSize){
  const thrRaw = parseFloat(threshold);
  let thr = Number.isFinite(thrRaw) ? thrRaw : 128;
  if(thr < 0) thr = 0;
  if(thr > 255) thr = 255;
  const bias = (thr - 128) / 255;
  const baseScale = Math.max(4, Math.min(12, Math.round(pixelSize * 0.75)));
  const scale = mode === 'halftone_motion' ? Math.max(baseScale, Math.round(pixelSize)) : baseScale;
  const outWidth = width * scale;
  const outHeight = height * scale;
  const mask = new Uint8Array(outWidth * outHeight);
  const half = scale / 2;
  const jitter = 0.04;
  for(let y=0;y<height;y++){
    const rowOffset = y*width;
    for(let x=0;x<width;x++){
      const idx = rowOffset + x;
      const baseVal = gray[idx] / 255;
      let smooth = baseVal;
      if(mode === 'halftone_motion'){
        let sum = baseVal * 0.65;
        let weight = 0.65;
        if(x>0){
          sum += (gray[idx-1]/255) * 0.25;
          weight += 0.25;
        }
        if(x<width-1){
          sum += (gray[idx+1]/255) * 0.18;
          weight += 0.18;
        }
        smooth = sum / weight;
      }
      let whiteness = clamp01(smooth + bias + (((x + y) & 1) ? jitter : -jitter));
      if(invert){
        whiteness = 1 - whiteness;
      }
      const density = clamp01(1 - whiteness);
      if(density <= 0.005){
        continue;
      }
      const radiusBase = Math.max(0.35, Math.sqrt(density)) * half;
      let radiusX = radiusBase * (mode === 'halftone_motion' ? 1.7 : 1.05);
      let radiusY = radiusBase * (mode === 'halftone_motion' ? 0.75 : 1.0);
      const gradient = mode === 'halftone_motion'
        ? ((x<width-1 ? gray[idx+1] : gray[idx]) - (x>0 ? gray[idx-1] : gray[idx])) / 255
        : 0;
      const shift = gradient * (scale * 0.12);
      if(radiusX < 0.5) radiusX = 0.5;
      if(radiusY < 0.5) radiusY = 0.5;
      const baseX = x * scale;
      const baseY = y * scale;
      for(let sy=0; sy<scale; sy++){
        const yy = baseY + sy;
        const relY = (sy + 0.5) - half;
        for(let sx=0; sx<scale; sx++){
          const xx = baseX + sx;
          const relX = (sx + 0.5) - half - shift;
          const norm = (relX*relX)/(radiusX*radiusX) + (relY*relY)/(radiusY*radiusY);
          if(norm <= 1){
            mask[yy*outWidth + xx] = 1;
          }
        }
      }
    }
  }
  return {mask, width: outWidth, height: outHeight, scale};
}

function thermalPixelize(gray, width, height, invert){
  const total = width * height;
  const indexes = new Uint8Array(total);
  const paletteSize = THERMAL_PALETTE.length / 3;
  if(paletteSize <= 0){
    return {indexes, paletteKey: THERMAL_PALETTE_KEY};
  }
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const idx = y*width + x;
      let value = gray[idx];
      let weight = 1;
      if(x>0){ value += gray[idx-1] * 0.4; weight += 0.4; }
      if(x<width-1){ value += gray[idx+1] * 0.4; weight += 0.4; }
      if(y>0){ value += gray[idx-width] * 0.25; weight += 0.25; }
      if(y<height-1){ value += gray[idx+width] * 0.25; weight += 0.25; }
      value /= weight;
      if(invert){
        value = 255 - value;
      }
      let normalized = clamp01(value / 255);
      normalized = Math.pow(normalized, 0.85);
      const paletteIndex = Math.max(0, Math.min(paletteSize - 1, Math.round(normalized * (paletteSize - 1))));
      indexes[idx] = paletteIndex;
    }
  }
  return {indexes, paletteKey: THERMAL_PALETTE_KEY};
}

function crosshatchDither(gray, width, height, threshold, invert){
  const out = new Uint8Array(width*height);
  const thr = Math.max(0, Math.min(255, parseInt(threshold,10)||0));
  const bias = thr - 128;
  for(let y=0;y<height;y++){
    const modY = y & 3;
    for(let x=0;x<width;x++){
      const idx = y*width + x;
      const modX = x & 3;
      const value = gray[idx];
      let tone = invert ? value : (255 - value);
      tone = clamp255(tone + bias);
      let level = Math.floor((tone/255) * 6);
      if(level < 0) level = 0;
      else if(level > 5) level = 5;

      let on = false;
      if(level >= 5){
        on = true;
      }else{
        const diagA = modX === modY;
        const diagB = (modX + modY) === 3;
        const horiz = (modY === 0) || (modY === 2);
        const vert = (modX === 0) || (modX === 2);
        if(level === 4){
          on = diagA || diagB || horiz || vert;
        }else if(level === 3){
          on = diagA || diagB || horiz;
        }else if(level === 2){
          on = diagA || diagB;
        }else if(level === 1){
          on = diagA;
        }
      }
      out[idx] = on ? 1 : 0;
    }
  }
  return out;
}

function errorDiffuse(gray, width, height, threshold, invert, method){
  const thr = Math.max(0, Math.min(255, parseInt(threshold,10)||0));
  const buf = new Float32Array(gray);
  const out = new Uint8Array(width*height);
  const kernel = DIFFUSION_KERNELS[method] || DIFFUSION_KERNELS.fs;
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const i = y*width+x;
      const oldVal = buf[i];
      const on = invert ? (oldVal > thr) : (oldVal < thr);
      out[i] = on ? 1 : 0;
      const target = on ? 0 : 255;
      const err = oldVal - target;
      for(const tap of kernel.taps){
        const xx = x + tap.dx;
        const yy = y + tap.dy;
        if(xx<0 || xx>=width || yy<0 || yy>=height) continue;
        buf[yy*width+xx] += err * (tap.w / kernel.div);
      }
    }
  }
  return out;
}

function erode(mask, width, height, radius){
  let current = mask;
  for(let iter=0; iter<radius; iter++){
    const next = new Uint8Array(width*height);
    for(let y=0;y<height;y++){
      for(let x=0;x<width;x++){
        let keep = 1;
        for(let dy=-1; dy<=1; dy++){
          for(let dx=-1; dx<=1; dx++){
            const xx = x+dx;
            const yy = y+dy;
            if(xx<0 || xx>=width || yy<0 || yy>=height || current[yy*width+xx]===0){
              keep = 0;
              break;
            }
          }
          if(!keep) break;
        }
        next[y*width+x] = keep ? 1 : 0;
      }
    }
    current = next;
  }
  return current;
}

function dilate(mask, width, height, radius){
  let current = mask;
  for(let iter=0; iter<radius; iter++){
    const next = new Uint8Array(width*height);
    for(let y=0;y<height;y++){
      for(let x=0;x<width;x++){
        let on = current[y*width+x];
        if(on){
          next[y*width+x] = 1;
          continue;
        }
        for(let dy=-1; dy<=1 && !on; dy++){
          for(let dx=-1; dx<=1; dx++){
            const xx = x+dx;
            const yy = y+dy;
            if(xx<0 || xx>=width || yy<0 || yy>=height) continue;
            if(current[yy*width+xx]){
              on = 1;
              break;
            }
          }
        }
        next[y*width+x] = on ? 1 : 0;
      }
    }
    current = next;
  }
  return current;
}

function boundary(mask, width, height, radius){
  const dil = dilate(mask, width, height, radius);
  const ero = erode(mask, width, height, radius);
  const out = new Uint8Array(width*height);
  for(let i=0;i<out.length;i++){
    out[i] = dil[i] && !ero[i] ? 1 : 0;
  }
  return out;
}

function subtract(a, b){
  const out = new Uint8Array(a.length);
  for(let i=0;i<a.length;i++){
    out[i] = a[i] && !b[i] ? 1 : 0;
  }
  return out;
}

function applyGaussianBlur(buffer, width, height, radius){
  if(radius <= 0) return;
  const kernel = buildGaussianKernel(radius);
  const temp = new Float32Array(buffer.length);
  const half = radius;
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      let sum = 0;
      let weight = 0;
      for(let k=-half;k<=half;k++){
        const xx = x+k;
        if(xx<0 || xx>=width) continue;
        const w = kernel[k+half];
        sum += buffer[y*width+xx]*w;
        weight += w;
      }
      temp[y*width+x] = weight>0 ? sum/weight : buffer[y*width+x];
    }
  }
  for(let x=0;x<width;x++){
    for(let y=0;y<height;y++){
      let sum = 0;
      let weight = 0;
      for(let k=-half;k<=half;k++){
        const yy = y+k;
        if(yy<0 || yy>=height) continue;
        const w = kernel[k+half];
        sum += temp[yy*width+x]*w;
        weight += w;
      }
      buffer[y*width+x] = weight>0 ? sum/weight : temp[y*width+x];
    }
  }
}

function buildGaussianKernel(radius){
  const size = radius*2+1;
  const sigma = radius<=1 ? 1 : radius/2;
  const denom = 2*sigma*sigma;
  const kernel = new Float32Array(size);
  let sum = 0;
  for(let i=-radius;i<=radius;i++){
    const value = Math.exp(-(i*i)/denom);
    kernel[i+radius] = value;
    sum += value;
  }
  for(let i=0;i<kernel.length;i++){
    kernel[i] /= sum;
  }
  return kernel;
}
