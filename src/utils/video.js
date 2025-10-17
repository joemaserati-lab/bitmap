let captureCanvas = null;
let captureCtx = null;

function ensureCaptureContext(width, height){
  if(!captureCanvas){
    captureCanvas = document.createElement('canvas');
  }
  if(captureCanvas.width !== width || captureCanvas.height !== height){
    captureCanvas.width = width;
    captureCanvas.height = height;
    captureCtx = null;
  }
  if(!captureCtx){
    captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
  }
  return captureCtx;
}

async function waitForVideoData(videoEl){
  if(!videoEl) return;
  if(videoEl.readyState >= 2){
    return;
  }
  await new Promise((resolve) => {
    const onData = () => {
      videoEl.removeEventListener('loadeddata', onData);
      videoEl.removeEventListener('canplay', onData);
      resolve();
    };
    videoEl.addEventListener('loadeddata', onData, { once: true });
    videoEl.addEventListener('canplay', onData, { once: true });
  });
}

export async function captureVideoFrameImageData(videoEl, maxSide = 3000){
  if(!videoEl){
    throw new Error('captureVideoFrameImageData: no video element');
  }
  await waitForVideoData(videoEl);
  const vw = Math.max(1, Math.round(videoEl.videoWidth || videoEl.width || 1));
  const vh = Math.max(1, Math.round(videoEl.videoHeight || videoEl.height || 1));
  const maxDim = Math.max(vw, vh);
  const scale = maxDim > maxSide ? (maxSide / maxDim) : 1;
  const width = Math.max(1, Math.round(vw * scale));
  const height = Math.max(1, Math.round(vh * scale));
  const ctx = ensureCaptureContext(width, height);
  if(!ctx){
    throw new Error('captureVideoFrameImageData: unable to acquire 2D context');
  }
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(videoEl, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}
