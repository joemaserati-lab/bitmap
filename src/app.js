
const $ = id => document.getElementById(id);
const preview = $('preview'), meta = $('meta');
const MAX_UPLOAD_DIMENSION = 800;
const ids = ['pixelSize','pixelSizeNum','threshold','thresholdNum','blur','blurNum','grain','grainNum','blackPoint','blackPointNum','whitePoint','whitePointNum','gammaVal','gammaValNum','brightness','brightnessNum','contrast','contrastNum','style','thickness','thicknessNum','dither','invert','bg','fg','scale','scaleNum','fmt','dpi','outW','outH','lockAR','jpegQ','jpegQNum','rasterBG'];
const el = {}; ids.forEach(id=>el[id]=$(id));
const uploadMessage = $('uploadMessage');
const progressWrap = $('uploadProgressWrapper');
const progressBar = $('uploadProgressBar');
// link sliders and numeric inputs
[['pixelSize','pixelSizeNum'],['threshold','thresholdNum'],['blur','blurNum'],['grain','grainNum'],['blackPoint','blackPointNum'],['whitePoint','whitePointNum'],['gammaVal','gammaValNum'],['brightness','brightnessNum'],['contrast','contrastNum'],['thickness','thicknessNum'],['scale','scaleNum'],['jpegQ','jpegQNum']].forEach(pair=>{
  const r=$(pair[0]), n=$(pair[1]); if(r&&n){ r.addEventListener('input',()=>{ n.value=r.value; fastRender(); }); n.addEventListener('input',()=>{ r.value=n.value; fastRender(); }); }
});
['dither','invert','bg','fg','style','fmt','dpi','lockAR'].forEach(k=>{ const e=$(k); if(e) e.addEventListener('change',()=>fastRender()); });
['fileGallery','fileCamera'].forEach(id=>{
  const f=$(id);
  if(!f) return;
  f.addEventListener('change', async ()=>{
    if(f.files && f.files[0]) await handleFile(f.files[0]);
    f.value='';
  });
});
const dropzone=document.getElementById('dropzone');
const galleryInput=$('fileGallery');
if(dropzone){
  const openPicker=()=>{ if(galleryInput) galleryInput.click(); };
  dropzone.addEventListener('click', openPicker);
  dropzone.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '||e.key==='Spacebar'){ e.preventDefault(); openPicker(); } });
  dropzone.addEventListener('dragenter', e=>{ e.preventDefault(); dropzone.classList.add('is-dragover'); });
  dropzone.addEventListener('dragover', e=>{ e.preventDefault(); dropzone.classList.add('is-dragover'); if(e.dataTransfer) e.dataTransfer.dropEffect='copy'; });
  dropzone.addEventListener('dragleave', e=>{ const rel=e.relatedTarget; if(!rel || !dropzone.contains(rel)) dropzone.classList.remove('is-dragover'); });
  dropzone.addEventListener('drop', async e=>{
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
    if(e.dataTransfer.files && e.dataTransfer.files[0]){
      await handleFile(e.dataTransfer.files[0]);
    }
  });
}
let mediaSource=null;
let lastSVG='';
let lastAnimation=null;
let lastSize={w:800,h:400};
const work=document.createElement('canvas');
const wctx=work.getContext('2d',{willReadFrequently:true});
const srcCanvas=document.createElement('canvas');
const srcCtx=srcCanvas.getContext('2d',{willReadFrequently:true});
let animationTimer=null;
let animationFrameIndex=0;

function resetAnimationPreview(){
  if(animationTimer){
    clearTimeout(animationTimer);
    animationTimer=null;
  }
  animationFrameIndex=0;
}
function beginUpload(name=''){
  if(uploadMessage) uploadMessage.textContent = name ? `Caricamento di ${name}...` : 'Caricamento in corso...';
  if(progressWrap){
    progressWrap.hidden = false;
    progressWrap.removeAttribute('hidden');
    progressWrap.classList.remove('is-indeterminate');
    progressWrap.setAttribute('aria-valuenow','0');
    progressWrap.setAttribute('aria-valuetext','0%');
  }
  if(progressBar) progressBar.style.width = '0%';
}
function updateUploadProgress(value){
  if(!progressWrap || !progressBar) return;
  progressWrap.classList.remove('is-indeterminate');
  const pct = Math.max(0, Math.min(1, value||0));
  progressBar.style.width = `${Math.round(pct*100)}%`;
  const percentText = `${Math.round(pct*100)}%`;
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
    const dimsInfo = (mediaSource && mediaSource.width && mediaSource.height)
      ? (()=>{
          const base = `${mediaSource.width}×${mediaSource.height}`;
          if(mediaSource.type==='animation' && mediaSource.frames){
            const frames = mediaSource.frames.length;
            const duration = mediaSource.duration ? ` · ${(mediaSource.duration/1000).toFixed(2)}s` : '';
            return ` (${base}px · ${frames} fotogrammi${duration})`;
          }
          return ` (${base}px)`;
        })()
      : '';
    uploadMessage.textContent = name ? `File presente: ${name}${dimsInfo}` : `File presente${dimsInfo}`;
  }
}
function uploadError(){
  if(uploadMessage) uploadMessage.textContent = 'Errore durante il caricamento';
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
    if(type.startsWith('video/') || /\.mp4$/i.test(file.name||'')){
      await loadVideoFile(file);
    }else if(type==='image/gif' || /\.gif$/i.test(file.name||'')){
      await loadGifFile(file);
    }else{
      await loadImageFile(file);
    }
    finishUpload(file.name||'');
    fastRender();
  }catch(err){
    console.error(err);
    uploadError();
  }
}

async function loadImageFile(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onprogress = e=>{
      if(e.lengthComputable) updateUploadProgress(e.loaded/e.total);
      else setUploadIndeterminate();
    };
    reader.onerror = ()=>{ reject(reader.error||new Error('Errore durante la lettura del file')); };
    reader.onload = async ()=>{
      const data = reader.result;
      const i=new Image();
      i.onload=async ()=>{
        try{
          const finalCanvas = rasterizeImageToCanvas(i, MAX_UPLOAD_DIMENSION);
          mediaSource = {
            type:'image',
            width: finalCanvas.width,
            height: finalCanvas.height,
            frames:[{canvas: finalCanvas, delay: 0}],
            duration: 0
          };
          updateUploadProgress(1);
          resolve();
        }catch(err){
          reject(err);
        }
      };
      i.onerror=err=>{ reject(err||new Error('Impossibile caricare l\'immagine')); };
      if(typeof data==='string') i.src=data; else reject(new Error('Formato file non supportato'));
    };
    try{ reader.readAsDataURL(file); }
    catch(err){ reject(err); }
  });
}

async function loadVideoFile(file){
  const url = URL.createObjectURL(file);
  try{
    const video=document.createElement('video');
    video.preload='auto';
    video.playsInline=true;
    video.muted=true;
    video.src=url;
    await once(video,'loadedmetadata');
    if(video.readyState < 2){
      try{ await once(video,'loadeddata'); }
      catch(e){ /* ignore */ }
    }
    const framesData = await extractVideoFrames(video, MAX_UPLOAD_DIMENSION, progress=>updateUploadProgress(progress));
    mediaSource={
      type:'animation',
      width: framesData.width,
      height: framesData.height,
      frames: framesData.frames,
      duration: framesData.duration
    };
    updateUploadProgress(1);
  }finally{
    URL.revokeObjectURL(url);
  }
}

async function loadGifFile(file){
  if('ImageDecoder' in window){
    const buffer = await file.arrayBuffer();
    const type = file.type || 'image/gif';
    const decoder = new ImageDecoder({data: buffer, type});
    const track = decoder.tracks && decoder.tracks.length ? decoder.tracks[0] : null;
    const frameCount = track ? track.frameCount : decoder.frameCount || 1;
    const frames=[];
    let totalDuration=0;
    for(let i=0;i<frameCount;i++){
      const {image} = await decoder.decode({frameIndex:i});
      const dims = scaleDimensions(image.displayWidth||image.codedWidth||image.width, image.displayHeight||image.codedHeight||image.height, MAX_UPLOAD_DIMENSION);
      const canvas=document.createElement('canvas');
      canvas.width=dims.w;
      canvas.height=dims.h;
      const ctx=canvas.getContext('2d');
      ctx.drawImage(image,0,0,dims.w,dims.h);
      const delay = normalizeFrameDelay(image.duration);
      frames.push({canvas, delay});
      totalDuration += delay;
      updateUploadProgress((i+1)/frameCount);
      if(typeof image.close==='function') image.close();
    }
    mediaSource={ type:'animation', width: frames[0].canvas.width, height: frames[0].canvas.height, frames, duration: totalDuration };
  }else{
    await loadImageFile(file);
  }
}

function scaleDimensions(width,height,maxDim){
  const maxSide=Math.max(width,height);
  if(maxSide<=maxDim) return {w:Math.max(1,Math.round(width)),h:Math.max(1,Math.round(height))};
  const scale=maxDim/maxSide;
  return {
    w:Math.max(1,Math.round(width*scale)),
    h:Math.max(1,Math.round(height*scale))
  };
}

function rasterizeImageToCanvas(image, maxDim){
  const dims=scaleDimensions(image.naturalWidth||image.width, image.naturalHeight||image.height, maxDim);
  const canvas=document.createElement('canvas');
  canvas.width=dims.w;
  canvas.height=dims.h;
  const ctx=canvas.getContext('2d');
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';
  ctx.drawImage(image,0,0,dims.w,dims.h);
  return canvas;
}

function cloneCanvas(source){
  const canvas=document.createElement('canvas');
  canvas.width=source.width;
  canvas.height=source.height;
  const ctx=canvas.getContext('2d');
  ctx.drawImage(source,0,0);
  return canvas;
}

async function extractVideoFrames(video, maxDim, progressCb){
  const dims=scaleDimensions(video.videoWidth||video.width, video.videoHeight||video.height, maxDim);
  const canvas=document.createElement('canvas');
  canvas.width=dims.w;
  canvas.height=dims.h;
  const ctx=canvas.getContext('2d');
  const fps=Math.max(1,Math.min(30,Math.round(video.frameRate||24)));
  const duration=Number.isFinite(video.duration)?video.duration:0;
  const totalFrames=duration?Math.max(1,Math.floor(duration*fps)):1;
  const frames=[];
  for(let i=0;i<totalFrames;i++){
    const targetTime=duration?Math.min(duration, i/fps):0;
    if(duration){
      const needsSeek = Math.abs(video.currentTime - targetTime) > 1e-3;
      if(needsSeek){
        video.currentTime=targetTime;
        await once(video,'seeked');
      }
    }
    ctx.clearRect(0,0,dims.w,dims.h);
    ctx.drawImage(video,0,0,dims.w,dims.h);
    frames.push({canvas: cloneCanvas(canvas), delay: Math.max(10, Math.round(1000/fps))});
    if(progressCb) progressCb((i+1)/totalFrames);
  }
  const totalDuration=frames.reduce((sum,f)=>sum+f.delay,0);
  return {frames,width:dims.w,height:dims.h,duration:totalDuration};
}

function once(target,event){
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{
      target.removeEventListener(event,onEvent);
      target.removeEventListener('error',onError);
    };
    const onEvent=()=>{ cleanup(); resolve(); };
    const onError=()=>{ cleanup(); reject(target.error||new Error('Errore caricamento media')); };
    target.addEventListener(event,onEvent);
    target.addEventListener('error',onError);
  });
}

function normalizeFrameDelay(raw){
  if(!raw) return 100;
  let value = raw;
  if(value > 1000){
    value = value/1000;
  }else if(value < 1){
    value = value*1000;
  }
  return Math.max(10, Math.round(value));
}

function updateExportButtons(){
  const hasStatic = !!(lastSVG && lastSVG.length);
  const hasAnimation = !!(lastAnimation && lastAnimation.svgs && lastAnimation.svgs.length);
  ['dlSVG','dlPNG','dlJPG'].forEach(id=>{
    const btn=$(id);
    if(!btn) return;
    const enabled = hasStatic || hasAnimation;
    btn.disabled = !enabled;
    btn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  });
  ['dlGIF','dlMP4'].forEach(id=>{
    const btn=$(id);
    if(!btn) return;
    const enabled = hasAnimation;
    btn.disabled = !enabled;
    btn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  });
}

function getExportDimensions(){
  const baseW = lastSize.w || 1;
  const baseH = lastSize.h || 1;
  const aspect = baseH ? baseW / baseH : 1;
  const maxSide = 3000;
  let outW = parseInt(el.outW.value, 10);
  let outH = parseInt(el.outH.value, 10);
  if(Number.isNaN(outW)) outW = null;
  if(Number.isNaN(outH)) outH = null;
  const lock = el.lockAR ? el.lockAR.checked : true;
  if(lock){
    if(outW && !outH){
      outH = Math.round(outW / aspect);
    }else if(!outW && outH){
      outW = Math.round(outH * aspect);
    }else if(outW && outH){
      outH = Math.round(outW / aspect);
    }else{
      outW = baseW;
      outH = baseH;
    }
  }else{
    if(!outW && !outH){
      outW = baseW;
      outH = baseH;
    }else if(!outW){
      outW = Math.round(outH * aspect);
    }else if(!outH){
      outH = Math.round(outW / aspect);
    }
  }
  outW = Math.max(1, Math.min(maxSide, Math.round(outW || baseW)));
  outH = Math.max(1, Math.min(maxSide, Math.round(outH || baseH)));
  return {width: outW, height: outH};
}

function svgToCanvas(svg, width, height, background){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>{
      const canvas=document.createElement('canvas');
      canvas.width=width;
      canvas.height=height;
      const ctx=canvas.getContext('2d');
      if(background){
        ctx.fillStyle=background;
        ctx.fillRect(0,0,width,height);
      }else{
        ctx.clearRect(0,0,width,height);
      }
      ctx.drawImage(img,0,0,width,height);
      resolve(canvas);
    };
    img.onerror=()=>reject(new Error('Impossibile rasterizzare SVG'));
    img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  });
}

function canvasToBlob(canvas, type, quality){
  return new Promise((resolve,reject)=>{
    canvas.toBlob(blob=>{
      if(blob) resolve(blob);
      else reject(new Error('Impossibile generare il file richiesto'));
    }, type, quality);
  });
}

function pushString(target,str){
  for(let i=0;i<str.length;i++) target.push(str.charCodeAt(i) & 0xff);
}

function writeWord(target,value){
  target.push(value & 0xff, (value>>8) & 0xff);
}

function buildPalette(imageDatas){
  const map=new Map();
  const palette=[];
  for(const data of imageDatas){
    const arr=data.data;
    for(let i=0;i<arr.length;i+=4){
      const a=arr[i+3];
      if(a<5) continue;
      const key=(arr[i]<<16)|(arr[i+1]<<8)|arr[i+2];
      if(!map.has(key)){
        if(palette.length===256) return {palette,map};
        map.set(key,palette.length);
        palette.push([arr[i],arr[i+1],arr[i+2]]);
      }
    }
  }
  if(palette.length===0){
    palette.push([0,0,0]);
    map.set(0,0);
  }
  return {palette,map};
}

function mapPixelsToIndices(imageData,paletteMap){
  const arr=imageData.data;
  const out=new Uint8Array(imageData.width*imageData.height);
  for(let i=0,p=0;i<arr.length;i+=4,p++){
    const key=(arr[i]<<16)|(arr[i+1]<<8)|arr[i+2];
    const idx=paletteMap.has(key)?paletteMap.get(key):0;
    out[p]=idx;
  }
  return out;
}

function lzwCompress(minCodeSize,data){
  const clear = 1<<minCodeSize;
  const end = clear+1;
  let dict=new Map();
  let dictSize;
  let codeSize;
  const reset=()=>{
    dict=new Map();
    for(let i=0;i<clear;i++) dict.set(i.toString(), i);
    dictSize=end+1;
    codeSize=minCodeSize+1;
  };
  reset();
  const bytes=[];
  let bitBuffer=0;
  let bitCount=0;
  const emit=code=>{
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while(bitCount>=8){
      bytes.push(bitBuffer & 0xff);
      bitBuffer >>=8;
      bitCount -=8;
    }
  };
  emit(clear);
  if(!data || !data.length){
    emit(end);
    if(bitCount>0) bytes.push(bitBuffer & 0xff);
    return bytes;
  }
  let prefix=data[0].toString();
  for(let i=1;i<data.length;i++){
    const k=data[i];
    const key=prefix+','+k;
    if(dict.has(key)){
      prefix=key;
    }else{
      emit(dict.get(prefix));
      if(dictSize<4096){
        dict.set(key, dictSize++);
        if(dictSize === (1<<codeSize) && codeSize<12){
          codeSize++;
        }
      }else{
        emit(clear);
        reset();
      }
      prefix=k.toString();
    }
  }
  emit(dict.get(prefix));
  emit(end);
  if(bitCount>0) bytes.push(bitBuffer & 0xff);
  return bytes;
}

function buildAnimatedGIF(frames,width,height){
  if(!frames.length) throw new Error('Nessun frame disponibile');
  const imageDatas=frames.map(f=>f.data);
  const delays=frames.map(f=>Math.max(10, f.delay||100));
  const {palette,map}=buildPalette(imageDatas);
  const paletteBits=Math.max(1, Math.ceil(Math.log2(Math.max(2, palette.length))));
  const paletteSize=1<<paletteBits;
  const paletteCopy=palette.slice();
  while(paletteCopy.length<paletteSize){
    const last=paletteCopy[paletteCopy.length-1]||[0,0,0];
    paletteCopy.push(last.slice());
  }
  const indicesList=imageDatas.map(data=>mapPixelsToIndices(data,map));
  const stream=[];
  pushString(stream,'GIF89a');
  writeWord(stream,width);
  writeWord(stream,height);
  const packed=0x80 | ((paletteBits-1)<<4) | (paletteBits-1);
  stream.push(packed);
  stream.push(0x00,0x00);
  for(const color of paletteCopy){
    stream.push(color[0],color[1],color[2]);
  }
  stream.push(0x21,0xFF,0x0B);
  pushString(stream,'NETSCAPE2.0');
  stream.push(0x03,0x01,0x00,0x00,0x00);
  for(let i=0;i<indicesList.length;i++){
    const delayUnits=Math.max(1, Math.round(delays[i]/10));
    stream.push(0x21,0xF9,0x04,0x00, delayUnits & 0xff, (delayUnits>>8)&0xff, 0x00, 0x00);
    stream.push(0x2C,0x00,0x00,0x00,0x00);
    writeWord(stream,width);
    writeWord(stream,height);
    stream.push(0x00);
    const minCodeSize=Math.max(2,paletteBits);
    stream.push(minCodeSize);
    const compressed=lzwCompress(minCodeSize, indicesList[i]);
    let offset=0;
    while(offset<compressed.length){
      const block=Math.min(255, compressed.length-offset);
      stream.push(block);
      for(let b=0;b<block;b++) stream.push(compressed[offset+b]);
      offset+=block;
    }
    stream.push(0x00);
  }
  stream.push(0x3B);
  return new Blob([new Uint8Array(stream)], {type:'image/gif'});
}

async function exportAnimatedGIF(){
  if(!lastAnimation || !lastAnimation.svgs || !lastAnimation.svgs.length) throw new Error('Nessuna animazione disponibile');
  const dims=getExportDimensions();
  const bg = el.rasterBG ? el.rasterBG.value : '#ffffff';
  const canvases=await Promise.all(lastAnimation.svgs.map(svg=>svgToCanvas(svg,dims.width,dims.height,bg)));
  const delays = lastAnimation.delays && lastAnimation.delays.length===canvases.length ? lastAnimation.delays : new Array(canvases.length).fill(100);
  const frames=canvases.map((canvas,i)=>({data: canvas.getContext('2d').getImageData(0,0,dims.width,dims.height), delay: delays[i]}));
  return buildAnimatedGIF(frames,dims.width,dims.height);
}

async function recordCanvasToVideo(canvases, delays, width, height){
  if(typeof MediaRecorder==='undefined') throw new Error('MediaRecorder non supportato dal browser');
  const avgDelay = delays.reduce((sum,v)=>sum+Math.max(16,v||100),0)/delays.length;
  const fps = Math.max(1, Math.min(30, Math.round(1000/Math.max(16, avgDelay))));
  const canvas=document.createElement('canvas');
  canvas.width=width;
  canvas.height=height;
  const ctx=canvas.getContext('2d');
  const stream=canvas.captureStream(fps);
  const mimeCandidates=['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
  const mime=mimeCandidates.find(type=>MediaRecorder.isTypeSupported(type));
  if(!mime) throw new Error('Nessun formato video supportato per l\'esportazione');
  const recorder=new MediaRecorder(stream,{mimeType:mime, videoBitsPerSecond:6000000});
  const chunks=[];
  const stopped=new Promise((resolve,reject)=>{
    recorder.onstop=resolve;
    recorder.onerror=e=>reject(e.error||new Error('Registrazione video fallita'));
  });
  recorder.ondataavailable=e=>{ if(e.data && e.data.size) chunks.push(e.data); };
  recorder.start();
  for(let i=0;i<canvases.length;i++){
    ctx.clearRect(0,0,width,height);
    ctx.drawImage(canvases[i],0,0,width,height);
    await wait(Math.max(16, delays[i]||100));
  }
  await wait(Math.max(1000/fps, 30));
  recorder.stop();
  await stopped;
  return {blob: new Blob(chunks,{type:mime}), mime};
}

async function exportAnimatedVideo(){
  if(!lastAnimation || !lastAnimation.svgs || !lastAnimation.svgs.length) throw new Error('Nessuna animazione disponibile');
  const dims=getExportDimensions();
  const bg = el.rasterBG ? el.rasterBG.value : '#ffffff';
  const canvases=await Promise.all(lastAnimation.svgs.map(svg=>svgToCanvas(svg,dims.width,dims.height,bg)));
  const delays = lastAnimation.delays && lastAnimation.delays.length===canvases.length ? lastAnimation.delays : new Array(canvases.length).fill(100);
  return recordCanvasToVideo(canvases, delays, dims.width, dims.height);
}

function wait(ms){
  return new Promise(resolve=>setTimeout(resolve, ms));
}

function triggerDownload(blob, filename){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=filename;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
}

// throttle with rAF for faster live preview
let ticking=false;
function fastRender(){ if(ticking) return; ticking=true; requestAnimationFrame(()=>{ generate(); ticking=false; }); }

function clampInt(value, min, max){
  const parsed = parseInt(value, 10);
  if(Number.isNaN(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function generate(){
  try{
    const options = collectRenderOptions();
    const hasFrames = mediaSource && mediaSource.frames && mediaSource.frames.length;
    if(mediaSource && mediaSource.type==='animation' && hasFrames){
      const svgs=[];
      const delays = mediaSource.frames.map(f=>f.delay||100);
      let size={w:0,h:0};
      for(const frame of mediaSource.frames){
        const result = processFrame(frame.canvas, options);
        svgs.push(result.svg);
        size = result.size;
      }
      lastAnimation={svgs, delays, duration: mediaSource.duration||delays.reduce((a,b)=>a+b,0)};
      lastSize=size;
      lastSVG=svgs[0]||'';
      renderAnimationPreview(lastAnimation, options.scale);
    }else{
      const frameCanvas = hasFrames ? mediaSource.frames[0].canvas : null;
      const result = processFrame(frameCanvas, options);
      lastSVG=result.svg;
      lastSize=result.size;
      lastAnimation=null;
      renderStaticPreview(lastSVG, options.scale);
    }
    updateExportButtons();
  }catch(e){ console.error(e); }
}

function collectRenderOptions(){
  const px = clampInt(el.pixelSize.value||10,2,200);
  const thr = clampInt(el.threshold.value||180,0,255);
  const blurPx = Math.max(0, parseFloat(el.blur.value||0));
  const grain = Math.max(0, Math.min(100, parseInt(el.grain.value||'0',10)));
  const bp = clampInt(el.blackPoint.value||0,0,255);
  const wp = clampInt(el.whitePoint.value||255,1,255);
  const gam = Math.max(0.1, Math.min(3, parseFloat(el.gammaVal.value||1)));
  const bri = Math.max(-100, Math.min(100, parseInt(el.brightness.value||'0',10)));
  const con = Math.max(-100, Math.min(100, parseInt(el.contrast.value||'0',10)));
  const style = el.style.value||'solid';
  const thick = clampInt(el.thickness.value||2,1,6);
  const mode = el.dither.value||'none';
  const invertMode = el.invert.value||'auto';
  const bg = el.bg.value||'#fff';
  const fg = el.fg.value||'#000';
  const scaleVal = parseFloat(el.scale.value||'1');
  const scale = Number.isFinite(scaleVal) && scaleVal>0 ? scaleVal : 1;
  return {px, thr, blurPx, grain, bp, wp, gam, bri, con, style, thick, mode, invertMode, bg, fg, scale};
}

function processFrame(frameCanvas, options){
  const baseCanvas = frameCanvas || getPlaceholderCanvas();
  srcCanvas.width = baseCanvas.width;
  srcCanvas.height = baseCanvas.height;
  srcCtx.setTransform(1,0,0,1,0,0);
  srcCtx.clearRect(0,0,srcCanvas.width,srcCanvas.height);
  if(options.blurPx>0){
    srcCtx.filter=`blur(${options.blurPx}px)`;
  }
  srcCtx.drawImage(baseCanvas,0,0,srcCanvas.width,srcCanvas.height);
  if(options.blurPx>0) srcCtx.filter='none';

  const gridW = Math.max(1, Math.round(srcCanvas.width/options.px));
  const gridH = Math.max(1, Math.round(srcCanvas.height/options.px));
  work.width = gridW;
  work.height = gridH;
  wctx.clearRect(0,0,gridW,gridH);
  wctx.drawImage(srcCanvas,0,0,gridW,gridH);
  const d = wctx.getImageData(0,0,gridW,gridH).data;
  const gray = new Float32Array(gridW*gridH); let sum=0;
  const grainAmount = Math.max(0, options.grain||0);
  for(let i=0,p=0;i<d.length;i+=4,p++){
    let l=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
    if(grainAmount>0){
      const noise=(Math.random()-0.5)*2*grainAmount;
      l = Math.max(0, Math.min(255, l + noise));
    }
    gray[p]=l;
    sum+=l;
  }
  const avg = sum/(gridW*gridH);
  for(let p=0;p<gray.length;p++) gray[p]=applyTonal(gray[p], options.bp, options.wp, options.gam, options.bri, options.con);

  let invert=false;
  if(options.invertMode==='yes') invert=true;
  else if(options.invertMode==='no') invert=false;
  else invert = avg>128;

  let mask;
  if(options.mode==='none') mask = thresholdMask(gray,gridW,gridH,options.thr,invert);
  else if(options.mode.startsWith('ascii')) mask=null;
  else if(options.mode==='bayer4'||options.mode==='bayer8'||options.mode==='cross') mask = orderedDither(gray,gridW,gridH,options.thr,invert,options.mode);
  else mask = errorDiffuse(gray,gridW,gridH,options.thr,invert,options.mode);

  let svg;
  if(options.mode.startsWith('ascii')){
    svg = buildASCII(gray, gridW, gridH, options.px, options.bg, options.fg, options.mode);
  }else{
    let outMask = mask;
    if(options.style==='outline' && mask) outMask = boundary(mask,gridW,gridH,options.thick);
    else if(options.style==='ring' && mask){
      const dil=dilate(mask,gridW,gridH,options.thick);
      const ero=erode(mask,gridW,gridH,options.thick);
      outMask=subtract(dil,ero);
    }
    svg = buildSVG(outMask, gridW, gridH, options.px, options.bg, options.fg);
  }
  return {svg, size:{w: Math.round(gridW*options.px), h: Math.round(gridH*options.px)}};
}

let placeholderCanvas=null;
function getPlaceholderCanvas(){
  if(!placeholderCanvas){
    placeholderCanvas=document.createElement('canvas');
    placeholderCanvas.width=800;
    placeholderCanvas.height=400;
    const ctx=placeholderCanvas.getContext('2d');
    ctx.fillStyle='#ffffff';
    ctx.fillRect(0,0,placeholderCanvas.width,placeholderCanvas.height);
    ctx.fillStyle='#000000';
    ctx.font='700 140px "JetBrains Mono", monospace';
    ctx.fillText('Aa',20,160);
  }
  return placeholderCanvas;
}

function applyTonal(l,bp,wp,gamma,bright,contrast){
  let L = l + (bright|0);
  const c = Math.max(-100, Math.min(100, parseFloat(contrast)||0));
  L = (L - 128) * (1 + c/100) + 128;
  wp = Math.max(bp+1, wp);
  let n = (L - bp) / (wp - bp); if(n<0) n=0; else if(n>1) n=1;
  const g = Math.max(0.1, parseFloat(gamma)||1); if(Math.abs(g-1)>1e-3) n = Math.pow(n, 1/g);
  return Math.max(0, Math.min(255, Math.round(n*255)));
}

function thresholdMask(gray,w,h,thr,invert){ const out=new Uint8Array(w*h); for(let i=0;i<out.length;i++){ const v = invert ? (gray[i] > thr) : (gray[i] < thr); out[i]=v?1:0; } return out; }

function orderedDither(gray,w,h,thr,invert,mode){
  // bayer 4 & 8 implemented, cross simple pattern
  if(mode==='bayer4'){ const M=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]], N=16; const out=new Uint8Array(w*h); for(let y=0;y<h;y++){ for(let x=0;x<w;x++){ const i=y*w+x; const t=(M[y%4][x%4]+0.5)/N; const g=(gray[i]-thr)/255+0.5; out[i]=(g<t)?1:0; } } return out; }
  if(mode==='bayer8'){ /* simplified reuse bayer4 for speed */ return orderedDither(gray,w,h,thr,invert,'bayer4'); }
  if(mode==='cross'){ const out=new Uint8Array(w*h); for(let y=0;y<h;y++){ for(let x=0;x<w;x++){ const i=y*w+x; out[i] = ((x+y)%2===0)?1:0; } } return out; }
  return thresholdMask(gray,w,h,thr,invert);
}

function errorDiffuse(gray,w,h,thr,invert,method){
  const buf=new Float32Array(gray); const out=new Uint8Array(w*h);
  const kernels={ fs:{div:16,taps:[{dx:1,dy:0,w:7},{dx:-1,dy:1,w:3},{dx:0,dy:1,w:5},{dx:1,dy:1,w:1}]}, atkinson:{div:8,taps:[{dx:1,dy:0,w:1},{dx:2,dy:0,w:1},{dx:-1,dy:1,w:1},{dx:0,dy:1,w:1},{dx:1,dy:1,w:1},{dx:0,dy:2,w:1}]}, jjn:{div:48,taps:[{dx:1,dy:0,w:7},{dx:2,dy:0,w:5},{dx:-2,dy:1,w:3},{dx:-1,dy:1,w:5},{dx:0,dy:1,w:7},{dx:1,dy:1,w:5},{dx:2,dy:1,w:3},{dx:-2,dy:2,w:1},{dx:-1,dy:2,w:3},{dx:0,dy:2,w:5},{dx:1,dy:2,w:3},{dx:2,dy:2,w:1}]}, stucki:{div:42,taps:[{dx:1,dy:0,w:8},{dx:2,dy:0,w:4},{dx:-2,dy:1,w:2},{dx:-1,dy:1,w:4},{dx:0,dy:1,w:8},{dx:1,dy:1,w:4},{dx:2,dy:1,w:2},{dx:-2,dy:2,w:1},{dx:-1,dy:2,w:2},{dx:0,dy:2,w:4},{dx:1,dy:2,w:2},{dx:2,dy:2,w:1}]}, burkes:{div:32,taps:[{dx:1,dy:0,w:8},{dx:2,dy:0,w:4},{dx:-2,dy:1,w:2},{dx:-1,dy:1,w:4},{dx:0,dy:1,w:8},{dx:1,dy:1,w:4},{dx:2,dy:1,w:2}]}, sierra2:{div:32,taps:[{dx:1,dy:0,w:4},{dx:2,dy:0,w:3},{dx:-2,dy:1,w:1},{dx:-1,dy:1,w:2},{dx:0,dy:1,w:3},{dx:1,dy:1,w:2},{dx:2,dy:1,w:1}]} };
  const k = kernels[method]||kernels.fs;
  for(let y=0;y<h;y++){ for(let x=0;x<w;x++){ const i=y*w+x; const old=buf[i]; const on = invert ? (old>thr) : (old<thr); out[i]=on?1:0; const target = on?0:255; const err = old-target; for(const t of k.taps){ const xx=x+t.dx, yy=y+t.dy; if(xx<0||xx>=w||yy<0||yy>=h) continue; buf[yy*w+xx] += err*(t.w/k.div); } } } return out;
}

function erode(mask,w,h,r=1){ let out = mask.slice(); for(let it=0; it<r; it++){ const next=new Uint8Array(w*h); for(let y=0;y<h;y++){ for(let x=0;x<w;x++){ let keep=1; for(let dy=-1; dy<=1; dy++){ for(let dx=-1; dx<=1; dx++){ const xx=x+dx, yy=y+dy; if(xx<0||yy<0||xx>=w||yy>=h){ keep=0; break; } if(out[yy*w+xx]===0){ keep=0; break; } } if(!keep) break; } next[y*w+x]=keep?1:0; } } out=next; } return out; }
function dilate(mask,w,h,r=1){ let out=mask.slice(); for(let it=0;it<r;it++){ const next=new Uint8Array(w*h); for(let y=0;y<h;y++){ for(let x=0;x<w;x++){ let on=out[y*w+x]; if(on){ next[y*w+x]=1; continue; } for(let dy=-1; dy<=1; dy++){ for(let dx=-1; dx<=1; dx++){ const xx=x+dx, yy=y+dy; if(xx<0||yy<0||xx>=w||yy>=h) continue; if(out[yy*w+xx]){ on=1; break; } } if(on) break; } next[y*w+x]=on?1:0; } } out=next; } return out; }
function boundary(mask,w,h,t=1){ const dil=dilate(mask,w,h,t), ero=erode(mask,w,h,t); const out=new Uint8Array(w*h); for(let i=0;i<out.length;i++) out[i]=(dil[i]&&!ero[i])?1:0; return out; }
function subtract(a,b){ const out=new Uint8Array(a.length); for(let i=0;i<a.length;i++) out[i]=a[i]&&!b[i]?1:0; return out; }

function buildSVG(mask,w,h,px,bg,fg){ const tile=px, svgW=Math.round(w*tile), svgH=Math.round(h*tile); let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">`; if(bg) svg+=`<rect width="100%" height="100%" fill="${bg}"/>`; svg+=`<g fill="${fg}">`; for(let y=0;y<h;y++){ for(let x=0;x<w;x++){ if(mask[y*w+x]) svg+=`<rect x="${x*tile}" y="${y*tile}" width="${tile}" height="${tile}"/>`; } } svg+=`</g></svg>`; return svg; }

function buildASCII(gray,w,h,px,bg,fg,mode){
  const sets={ ascii_simple:[' ','.',':','-','=','+','#','@'], ascii_unicode8:[' ','·',':','-','=','+','*','#','%','@'], ascii_chinese:['　','丶','丿','ノ','乙','人','口','回','田','国'] };
  const charset = sets[mode]||sets['ascii_simple'];
  const svgW=Math.round(w*px), svgH=Math.round(h*px);
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">`;
  if(bg) svg+=`<rect width="100%" height="100%" fill="${bg}"/>`;
  svg+=`<g fill="${fg}" font-family="JetBrains Mono, monospace" font-size="${px}" text-anchor="middle">`;
  for(let y=0;y<h;y++){ for(let x=0;x<w;x++){ const v=gray[y*w+x]; const idx=Math.floor((v/255)*(charset.length-1)); const ch=charset[charset.length-1-idx]; const cx=Math.round(x*px + px/2), cy=Math.round(y*px + px*0.85); svg+=`<text x="${cx}" y="${cy}">${ch}</text>`; } }
  svg+=`</g></svg>`; return svg;
}

function computePreviewSize(scale){
  const hostRect = preview.getBoundingClientRect();
  const availableW = Math.max(1, preview.clientWidth || hostRect.width || lastSize.w);
  const availableH = Math.max(1, preview.clientHeight || hostRect.height || lastSize.h);
  const ratio = lastSize.h ? lastSize.w / lastSize.h : 1;
  const userScale = Number.isFinite(scale) && scale>0 ? scale : 1;
  let baseW = availableW;
  let baseH = ratio ? baseW / ratio : availableH;
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

function renderStaticPreview(svg, scale=1){
  resetAnimationPreview();
  preview.innerHTML='';
  if(!svg){
    meta.textContent='';
    return;
  }
  const size = computePreviewSize(scale);
  const frame=document.createElement('div');
  frame.className='preview-frame';
  frame.style.width=`${size.width}px`;
  frame.style.height=`${size.height}px`;
  const wrapper=document.createElement('div');
  wrapper.innerHTML=svg;
  const node=wrapper.firstChild;
  if(node){
    node.setAttribute('width','100%');
    node.setAttribute('height','100%');
    node.setAttribute('preserveAspectRatio','xMidYMid meet');
    node.style.width='100%';
    node.style.height='100%';
    frame.appendChild(node);
  }
  preview.appendChild(frame);
  meta.textContent=`${lastSize.w}×${lastSize.h}px`;
}

function renderAnimationPreview(animation, scale=1){
  resetAnimationPreview();
  preview.innerHTML='';
  if(!animation || !animation.svgs || !animation.svgs.length){
    meta.textContent='';
    return;
  }
  const size = computePreviewSize(scale);
  const frame=document.createElement('div');
  frame.className='preview-frame';
  frame.style.width=`${size.width}px`;
  frame.style.height=`${size.height}px`;
  const img=document.createElement('img');
  img.alt='Anteprima animazione';
  img.decoding='async';
  img.draggable=false;
  img.style.width='100%';
  img.style.height='100%';
  frame.appendChild(img);
  preview.appendChild(frame);

  const delays = animation.delays && animation.delays.length ? animation.delays : new Array(animation.svgs.length).fill(100);
  const totalDuration = animation.duration || delays.reduce((a,b)=>a+b,0);

  const updateFrame=index=>{
    const svg = animation.svgs[index];
    img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  };

  animationFrameIndex=0;
  updateFrame(animationFrameIndex);

  if(animation.svgs.length>1){
    const step=()=>{
      animationFrameIndex=(animationFrameIndex+1)%animation.svgs.length;
      updateFrame(animationFrameIndex);
      const delay = Math.max(16, delays[animationFrameIndex] || delays[0] || 100);
      animationTimer=setTimeout(step, delay);
    };
    const firstDelay = Math.max(16, delays[0] || 100);
    animationTimer=setTimeout(step, firstDelay);
  }

  meta.textContent=`${lastSize.w}×${lastSize.h}px · ${animation.svgs.length} fotogrammi · ${(totalDuration/1000).toFixed(2)}s`;
}

let resizeRaf=null;
window.addEventListener('resize',()=>{
  const hasAnimation = lastAnimation && lastAnimation.svgs && lastAnimation.svgs.length;
  if(!hasAnimation && !lastSVG) return;
  if(resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf=requestAnimationFrame(()=>{
    resizeRaf=null;
    const scale=parseFloat(el.scale.value||'1');
    if(hasAnimation){
      renderAnimationPreview(lastAnimation, scale);
    }else{
      renderStaticPreview(lastSVG, scale);
    }
  });
});

// EXPORT
const svgBtn=$('dlSVG');
if(svgBtn){
  svgBtn.addEventListener('click',()=>{
    const svgSource = (lastAnimation && lastAnimation.svgs && lastAnimation.svgs.length) ? lastAnimation.svgs[0] : lastSVG;
    if(!svgSource) return;
    const blob=new Blob([svgSource],{type:'image/svg+xml'});
    triggerDownload(blob,'bitmap.svg');
  });
}

const pngBtn=$('dlPNG');
if(pngBtn){
  pngBtn.addEventListener('click',async()=>{
    const svgSource = (lastAnimation && lastAnimation.svgs && lastAnimation.svgs.length) ? lastAnimation.svgs[0] : lastSVG;
    if(!svgSource) return;
    try{
      const dims=getExportDimensions();
      const canvas=await svgToCanvas(svgSource,dims.width,dims.height, el.rasterBG ? el.rasterBG.value : '#ffffff');
      const blob=await canvasToBlob(canvas,'image/png');
      triggerDownload(blob,'bitmap.png');
    }catch(err){ console.error(err); }
  });
}

const jpgBtn=$('dlJPG');
if(jpgBtn){
  jpgBtn.addEventListener('click',async()=>{
    const svgSource = (lastAnimation && lastAnimation.svgs && lastAnimation.svgs.length) ? lastAnimation.svgs[0] : lastSVG;
    if(!svgSource) return;
    try{
      const dims=getExportDimensions();
      const canvas=await svgToCanvas(svgSource,dims.width,dims.height, el.rasterBG ? el.rasterBG.value : '#ffffff');
      const quality=parseFloat(el.jpegQ.value||'0.9');
      const blob=await canvasToBlob(canvas,'image/jpeg', Math.min(0.95, Math.max(0.6, quality||0.9)));
      triggerDownload(blob,'bitmap.jpg');
    }catch(err){ console.error(err); }
  });
}

const gifBtn=$('dlGIF');
if(gifBtn){
  gifBtn.addEventListener('click',async()=>{
    if(!lastAnimation || !lastAnimation.svgs || !lastAnimation.svgs.length) return;
    try{
      const blob=await exportAnimatedGIF();
      triggerDownload(blob,'bitmap.gif');
    }catch(err){ console.error(err); }
  });
}

const videoBtn=$('dlMP4');
if(videoBtn){
  videoBtn.addEventListener('click',async()=>{
    if(!lastAnimation || !lastAnimation.svgs || !lastAnimation.svgs.length) return;
    try{
      const {blob,mime}=await exportAnimatedVideo();
      const ext = mime.includes('mp4') ? 'mp4' : (mime.includes('webm') ? 'webm' : 'mp4');
      triggerDownload(blob,`bitmap.${ext}`);
    }catch(err){ console.error(err); }
  });
}

// initial render
fastRender();
