export function computeExportBaseSize(context = {}){
  const {
    sourceKind = '',
    videoSource = null,
    lastResult = null,
    sourceWidth = 0,
    sourceHeight = 0,
    lastSize = {}
  } = context || {};

  const safeRound = (value) => {
    const num = Number(value);
    if(!Number.isFinite(num)) return 0;
    const rounded = Math.round(num);
    return rounded > 0 ? rounded : 0;
  };

  const ensureSize = (width, height) => {
    const w = safeRound(width);
    const h = safeRound(height);
    if(w > 0 && h > 0){
      return {width: w, height: h};
    }
    return null;
  };

  if(sourceKind === 'video' && videoSource){
    const videoSize = ensureSize(videoSource.exportWidth, videoSource.exportHeight);
    if(videoSize){
      return videoSize;
    }
  }

  if(lastResult){
    if(lastResult.type === 'image' && lastResult.frame){
      const frameSize = ensureSize(lastResult.frame.outputWidth, lastResult.frame.outputHeight);
      if(frameSize){
        return frameSize;
      }
    }
    if(lastResult.type === 'video' && Array.isArray(lastResult.frames) && lastResult.frames.length){
      const frame = lastResult.frames[0];
      const frameSize = ensureSize(frame.outputWidth, frame.outputHeight);
      if(frameSize){
        return frameSize;
      }
      if(sourceKind === 'video' && videoSource){
        const videoSize = ensureSize(videoSource.exportWidth, videoSource.exportHeight);
        if(videoSize){
          return videoSize;
        }
      }
    }
  }

  const sourceSize = ensureSize(sourceWidth, sourceHeight);
  if(sourceSize){
    return sourceSize;
  }

  const lastKnownSize = ensureSize(lastSize && lastSize.width, lastSize && lastSize.height);
  if(lastKnownSize){
    return lastKnownSize;
  }

  return {width: 1024, height: 1024};
}
