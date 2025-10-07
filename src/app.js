
const $ = id => document.getElementById(id);
const preview = $('preview'), meta = $('meta');
const ids = ['pixelSize','pixelSizeNum','threshold','thresholdNum','blur','blurNum','blackPoint','blackPointNum','whitePoint','whitePointNum','gammaVal','gammaValNum','brightness','brightnessNum','contrast','contrastNum','style','thickness','thicknessNum','dither','invert','bg','fg','scale','scaleNum','fmt','dpi','outW','outH','lockAR','jpegQ','jpegQNum','rasterBG'];
const el = {}; ids.forEach(id=>el[id]=$(id));
// link sliders and numeric inputs
[['pixelSize','pixelSizeNum'],['threshold','thresholdNum'],['blur','blurNum'],['blackPoint','blackPointNum'],['whitePoint','whitePointNum'],['gammaVal','gammaValNum'],['brightness','brightnessNum'],['contrast','contrastNum'],['thickness','thicknessNum'],['scale','scaleNum'],['jpegQ','jpegQNum']].forEach(pair=>{
  const r=$(pair[0]), n=$(pair[1]); if(r&&n){ r.addEventListener('input',()=>{ n.value=r.value; fastRender(); }); n.addEventListener('input',()=>{ r.value=n.value; fastRender(); }); }
});
['dither','invert','bg','fg','style','fmt','dpi','lockAR'].forEach(k=>{ const e=$(k); if(e) e.addEventListener('change',()=>fastRender()); });
['fileGallery','fileCamera'].forEach(id=>{ const f=$(id); if(f) f.addEventListener('change', async ()=>{ if(f.files && f.files[0]) await loadImageFile(f.files[0]); fastRender(); f.value=''; }); });
const dropzone=document.getElementById('dropzone');
const galleryInput=$('fileGallery');
if(dropzone){
  const openPicker=()=>{ if(galleryInput) galleryInput.click(); };
  dropzone.addEventListener('click', openPicker);
  dropzone.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '||e.key==='Spacebar'){ e.preventDefault(); openPicker(); } });
  dropzone.addEventListener('dragenter', e=>{ e.preventDefault(); dropzone.classList.add('is-dragover'); });
  dropzone.addEventListener('dragover', e=>{ e.preventDefault(); dropzone.classList.add('is-dragover'); if(e.dataTransfer) e.dataTransfer.dropEffect='copy'; });
  dropzone.addEventListener('dragleave', e=>{ const rel=e.relatedTarget; if(!rel || !dropzone.contains(rel)) dropzone.classList.remove('is-dragover'); });
  dropzone.addEventListener('drop', async e=>{ e.preventDefault(); dropzone.classList.remove('is-dragover'); if(e.dataTransfer.files && e.dataTransfer.files[0]){ await loadImageFile(e.dataTransfer.files[0]); fastRender(); } });
}
let img=null, lastSVG='', lastSize={w:800,h:400};
const work=document.createElement('canvas'); const wctx=work.getContext('2d',{willReadFrequently:true});
async function loadImageFile(file){ return new Promise(res=>{ const i=new Image(); i.onload=()=>{ img=i; res(); }; i.onerror=()=>{ res(); }; i.src=URL.createObjectURL(file); }); }

// throttle with rAF for faster live preview
let ticking=false;
function fastRender(){ if(ticking) return; ticking=true; requestAnimationFrame(()=>{ generate(); ticking=false; }); }

function generate(){
  try{
    const px = clampInt(el.pixelSize.value||10,2,200);
    const thr = clampInt(el.threshold.value||180,0,255);
    const blurPx = Math.max(0, parseFloat(el.blur.value||0));
    const bp = clampInt(el.blackPoint.value||0,0,255);
    const wp = clampInt(el.whitePoint.value||255,1,255);
    const gam = Math.max(0.1, Math.min(3, parseFloat(el.gammaVal.value||1)));
    const bri = Math.max(-100, Math.min(100, parseInt(el.brightness.value||'0',10)));
    const con = Math.max(-100, Math.min(100, parseInt(el.contrast.value||'0',10)));
    const style = el.style.value||'solid';
    const thick = clampInt(el.thickness.value||2,1,6);
    const mode = el.dither.value||'none';
    const invertMode = el.invert.value||'auto';
    const bg = el.bg.value||'#fff'; const fg = el.fg.value||'#000';

    // source canvas
    const src = document.createElement('canvas'); let sctx = src.getContext('2d');
    if(img){ src.width = img.naturalWidth; src.height = img.naturalHeight; sctx.filter = blurPx>0?`blur(${blurPx}px)`:'none'; sctx.drawImage(img,0,0); sctx.filter='none'; }
    else { src.width = 800; src.height = 400; sctx.fillStyle='#fff'; sctx.fillRect(0,0,src.width,src.height); sctx.fillStyle='#000'; sctx.font='700 140px JetBrains Mono'; sctx.fillText('Aa',20,160); }

    const gridW = Math.max(1, Math.round(src.width/px)), gridH = Math.max(1, Math.round(src.height/px));
    work.width = gridW; work.height = gridH; wctx.clearRect(0,0,gridW,gridH); wctx.drawImage(src,0,0,gridW,gridH);
    const d = wctx.getImageData(0,0,gridW,gridH).data;
    const gray = new Float32Array(gridW*gridH); let sum=0;
    for(let i=0,p=0;i<d.length;i+=4,p++){ const l=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; gray[p]=l; sum+=l; }
    const avg = sum/(gridW*gridH);
    // tonal mapping (black/white/gamma/brightness/contrast)
    for(let p=0;p<gray.length;p++) gray[p]=applyTonal(gray[p], bp, wp, gam, bri, con);

    let invert=false; if(invertMode==='yes') invert=true; else if(invertMode==='no') invert=false; else invert = avg>128;

    let mask;
    if(mode==='none') mask = thresholdMask(gray,gridW,gridH,thr,invert);
    else if(mode.startsWith('ascii')) { /* handled below */ mask = null; }
    else if(mode==='bayer4'||mode==='bayer8'||mode==='cross') mask = orderedDither(gray,gridW,gridH,thr,invert,mode);
    else mask = errorDiffuse(gray,gridW,gridH,thr,invert,mode);

    let outMask = mask;
    if(style==='outline' && mask) outMask = boundary(mask,gridW,gridH,thick);
    else if(style==='ring' && mask){ const dil=dilate(mask,gridW,gridH,thick), ero=erode(mask,gridW,gridH,thick); outMask=subtract(dil,ero); }

    // ASCII modes
    if(mode.startsWith('ascii')){
      lastSVG = buildASCII(gray, gridW, gridH, px, bg, fg, mode);
    } else {
      lastSVG = buildSVG(outMask, gridW, gridH, px, bg, fg);
    }
    lastSize = { w: Math.round(gridW*px), h: Math.round(gridH*px) };
    renderPreview(lastSVG, parseFloat(el.scale.value||1));
  }catch(e){ console.error(e); }
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

function renderPreview(svg,scale=1){ preview.innerHTML=''; const wrapper=document.createElement('div'); wrapper.innerHTML=svg; const node=wrapper.firstChild; node.style.transformOrigin='top left'; node.style.transform=`scale(${scale})`; preview.appendChild(node); meta.textContent=`${lastSize.w}×${lastSize.h}px`; }

// EXPORT (simple)
document.getElementById('dlSVG').addEventListener('click', ()=>{ if(!lastSVG) return; const blob=new Blob([lastSVG],{type:'image/svg+xml'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='bitmap.svg'; a.click(); });
document.getElementById('dlPNG').addEventListener('click', ()=>{ if(!lastSVG) return; const img=new Image(); img.onload=()=>{ const c=document.createElement('canvas'); c.width=lastSize.w; c.height=lastSize.h; const cx=c.getContext('2d'); cx.fillStyle=el.rasterBG.value||'#fff'; cx.fillRect(0,0,c.width,c.height); cx.drawImage(img,0,0); c.toBlob(b=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='bitmap.png'; a.click(); }); }; img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(lastSVG); });
document.getElementById('dlJPG').addEventListener('click', ()=>{ if(!lastSVG) return; const img=new Image(); img.onload=()=>{ const c=document.createElement('canvas'); c.width=lastSize.w; c.height=lastSize.h; const cx=c.getContext('2d'); cx.fillStyle=el.rasterBG.value||'#fff'; cx.fillRect(0,0,c.width,c.height); cx.drawImage(img,0,0); c.toBlob(b=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='bitmap.jpg'; a.click(); }, 'image/jpeg', parseFloat(el.jpegQ.value||0.9)); }; img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(lastSVG); });

// initial render
fastRender();
