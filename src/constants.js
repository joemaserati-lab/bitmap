function hexToRgbArray(color){
  if(typeof color !== 'string'){
    return [255, 255, 255];
  }
  let value = color.trim();
  if(value.startsWith('#')){
    value = value.slice(1);
  }
  if(value.length === 3){
    value = value.split('').map((ch) => ch + ch).join('');
  }
  if(value.length !== 6){
    return [255, 255, 255];
  }
  const intVal = parseInt(value, 16);
  if(Number.isNaN(intVal)){
    return [255, 255, 255];
  }
  return [
    (intVal >> 16) & 0xFF,
    (intVal >> 8) & 0xFF,
    intVal & 0xFF
  ];
}

function gradientStops(...colors){
  const stops = colors.map((color) => hexToRgbArray(color));
  return stops.length >= 2 ? stops : [[0, 0, 0], [255, 255, 255]];
}

export const CPU_ONLY_EFFECTS = [
  'blueNoise',
  'clusteredDot',
  'dotDiffusion',
  'edKernels',
  'paletteDither',
  'autoQuant',
  'cmykHalftone',
  'halftoneShapes',
  'lineDither',
  'hatching',
  'stippling'
];

export const GRADIENT_MAPS = [
  { id: 'none', name: 'None', gradient: '' }
];

for(const entry of GRADIENT_MAPS){
  if(!entry || typeof entry !== 'object'){
    continue;
  }
  if(entry.id === 'none'){
    entry.stops = [];
    continue;
  }
  if(Array.isArray(entry.stops) && entry.stops.length >= 2){
    continue;
  }
  const gradient = typeof entry.gradient === 'string' ? entry.gradient : '';
  const matches = gradient.match(/#[0-9a-fA-F]{3,8}/g);
  if(matches && matches.length >= 2){
    entry.stops = gradientStops(...matches);
  }
}
