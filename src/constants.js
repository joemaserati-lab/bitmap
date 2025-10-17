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
  { id: 'none', name: 'None', gradient: '' },
  { id: 'arctic', name: 'Arctic', gradient: 'linear-gradient(135deg, #d76435 0%, #e4be35 33%, #f9fbf0 66%, #000000 100%)' },
  { id: 'acid', name: 'Acid', gradient: 'linear-gradient(135deg, #dbdddc 0%, #fefefe 33%, #4c4d65 66%, #0c208b 100%)' },
  { id: 'fire', name: 'Fire', gradient: 'linear-gradient(135deg, #ddeeef 0%, #020000 33%, #5e122a 66%, #71030e 100%)' },
  { id: 'ember', name: 'Ember', gradient: 'linear-gradient(135deg, #f8f5cb 0%, #663a24 33%, #966954 66%, #ccb7ab 100%)' },
  { id: 'velvet', name: 'Velvet', gradient: 'linear-gradient(135deg, #ba6e86 0%, #c43964 33%, #ee96b7 66%, #040404 100%)' },
  { id: 'neon', name: 'Neon', gradient: 'linear-gradient(135deg, #62696e 0%, #a2a6b0 33%, #000000 66%, #8e78af 100%)' },
  { id: 'aurora', name: 'Aurora', gradient: 'linear-gradient(135deg, #bedffc 0%, #cacbcb 33%, #643950 66%, #5d1732 100%)' },
  { id: 'cobalt', name: 'Cobalt', gradient: 'linear-gradient(135deg, #999345 0%, #3a1c1f 33%, #8b3d3d 66%, #b6673c 100%)' },
  { id: 'rust', name: 'Rust', gradient: 'linear-gradient(135deg, #060606 0%, #000000 33%, #aea488 66%, #561a17 100%)' },
  { id: 'coral', name: 'Coral', gradient: 'linear-gradient(135deg, #030303 0%, #000000 33%, #836260 66%, #a08f75 100%)' },
  { id: 'solar', name: 'Solar', gradient: 'linear-gradient(135deg, #0f2187 0%, #000000 33%, #787c61 66%, #d2c8ad 100%)' },
  { id: 'verdant', name: 'Verdant', gradient: 'linear-gradient(135deg, #701a1d 0%, #000000 33%, #ffffff 66%, #eeeeee 100%)' },
  { id: 'orchid', name: 'Orchid', gradient: 'linear-gradient(135deg, #7d7d7d 0%, #000000 33%, #f9f5ca 66%, #1c2421 100%)' },
  { id: 'storm', name: 'Storm', gradient: 'linear-gradient(135deg, #030303 0%, #000000 33%, #000000 66%, #d10805 100%)' },
  { id: 'sunset', name: 'Sunset', gradient: 'linear-gradient(135deg, #9277b5 0%, #000000 33%, #fb0536 66%, #dd0805 100%)' },
  { id: 'glacier', name: 'Glacier', gradient: 'linear-gradient(135deg, #5f1931 0%, #000000 33%, #0a0803 66%, #000000 100%)' },
  { id: 'twilight', name: 'Twilight', gradient: 'linear-gradient(135deg, #6a7881 0%, #184a3f 33%, #67766b 66%, #000300 100%)' },
  { id: 'pulse', name: 'Pulse', gradient: 'linear-gradient(135deg, #551a1b 0%, #8d0b09 33%, #45464c 66%, #000203 100%)' },
  { id: 'mirage', name: 'Mirage', gradient: 'linear-gradient(135deg, #9e9173 0%, #010001 33%, #404440 66%, #030002 100%)' },
  { id: 'alloy', name: 'Alloy', gradient: 'linear-gradient(135deg, #d4c7ad 0%, #010102 33%, #95746e 66%, #010101 100%)' },
  { id: 'inferno', name: 'Inferno', gradient: 'linear-gradient(135deg, #575857 0%, #250915 33%, #823d4d 66%, #080008 100%)' },
  { id: 'blossom', name: 'Blossom', gradient: 'linear-gradient(135deg, #18231f 0%, #496048 33%, #000000 66%, #010100 100%)' },
  { id: 'nautilus', name: 'Nautilus', gradient: 'linear-gradient(135deg, #d30804 0%, #bf7747 33%, #eaae35 66%, #020001 100%)' },
  { id: 'sahara', name: 'Sahara', gradient: 'linear-gradient(135deg, #dc0807 0%, #b2b2b2 33%, #b3a394 66%, #020403 100%)' },
  { id: 'obsidian', name: 'Obsidian', gradient: 'linear-gradient(135deg, #484f4f 0%, #909a97 33%, #fafbfa 66%, #054ff4 100%)' },
  { id: 'quartz', name: 'Quartz', gradient: 'linear-gradient(135deg, #fb8903 0%, #fadd55 33%, #4c4b4b 66%, #1b1c1c 100%)' },
  { id: 'nimbus', name: 'Nimbus', gradient: 'linear-gradient(135deg, #f5e60c 0%, #020003 33%, #15291b 66%, #32533e 100%)' },
  { id: 'magma', name: 'Magma', gradient: 'linear-gradient(135deg, #fae27b 0%, #811c1c 33%, #923a32 66%, #dca68c 100%)' },
  { id: 'saffron', name: 'Saffron', gradient: 'linear-gradient(135deg, #6f6867 0%, #293345 33%, #242f9a 66%, #434120 100%)' },
  { id: 'lagoon', name: 'Lagoon', gradient: 'linear-gradient(135deg, #db3601 0%, #c66d36 33%, #000000 66%, #030303 100%)' },
  { id: 'fuchsia', name: 'Fuchsia', gradient: 'linear-gradient(135deg, #d8c8ab 0%, #c8c2ad 33%, #5a627e 66%, #6670af 100%)' },
  { id: 'slate', name: 'Slate', gradient: 'linear-gradient(135deg, #f5a582 0%, #a23e1f 33%, #df6f30 66%, #f4b64a 100%)' },
  { id: 'zenith', name: 'Zenith', gradient: 'linear-gradient(135deg, #010101 0%, #be6e48 33%, #d5720a 66%, #2d2b28 100%)' },
  { id: 'cascade', name: 'Cascade', gradient: 'linear-gradient(135deg, #000203 0%, #bf4749 33%, #886361 66%, #53825a 100%)' },
  { id: 'bronze', name: 'Bronze', gradient: 'linear-gradient(135deg, #000000 0%, #000001 33%, #5d65aa 66%, #ba967a 100%)' },
  { id: 'ivory', name: 'Ivory', gradient: 'linear-gradient(135deg, #020203 0%, #964d5d 33%, #cc6208 66%, #d49d61 100%)' },
  { id: 'graphite', name: 'Graphite', gradient: 'linear-gradient(135deg, #020202 0%, #6884a1 33%, #478ba8 66%, #522335 100%)' },
  { id: 'limewire', name: 'Limewire', gradient: 'linear-gradient(135deg, #020005 0%, #b0a776 33%, #000000 66%, #664a2f 100%)' },
  { id: 'crimson', name: 'Crimson', gradient: 'linear-gradient(135deg, #020003 0%, #54544b 33%, #f4a8c2 66%, #fbe6bf 100%)' },
  { id: 'indigo', name: 'Indigo', gradient: 'linear-gradient(135deg, #000001 0%, #846761 33%, #ef628f 66%, #f4a8c6 100%)' },
  { id: 'vortex', name: 'Vortex', gradient: 'linear-gradient(135deg, #6b716d 0%, #142513 33%, #000000 66%, #a73714 100%)' },
  { id: 'amber', name: 'Amber', gradient: 'linear-gradient(135deg, #2a2b29 0%, #4a3f46 33%, #000000 66%, #b3a578 100%)' },
  { id: 'polar', name: 'Polar', gradient: 'linear-gradient(135deg, #5a8055 0%, #000101 33%, #010101 66%, #cdf858 100%)' },
  { id: 'tropic', name: 'Tropic', gradient: 'linear-gradient(135deg, #b6987b 0%, #040838 33%, #010101 66%, #7c7c7c 100%)' },
  { id: 'vulcan', name: 'Vulcan', gradient: 'linear-gradient(135deg, #eb7dd0 0%, #f245ca 33%, #010101 66%, #6191dd 100%)' },
  { id: 'nimbus-rose', name: 'NimbusRose', gradient: 'linear-gradient(135deg, #5a1e32 0%, #443e3a 33%, #000000 66%, #f89e17 100%)' },
  { id: 'chrome', name: 'Chrome', gradient: 'linear-gradient(135deg, #68492e 0%, #887a6b 33%, #010101 66%, #d6e3e2 100%)' },
  { id: 'opal', name: 'Opal', gradient: 'linear-gradient(135deg, #fae5bc 0%, #060606 33%, #010101 66%, #d3d3d3 100%)' },
  { id: 'roseate', name: 'Roseate', gradient: 'linear-gradient(135deg, #7dad21 0%, #d7e0a8 33%, #fbfce2 66%, #000000 100%)' },
  { id: 'shadow', name: 'Shadow', gradient: 'linear-gradient(135deg, #ad2d0a 0%, #e17803 33%, #83874f 66%, #ac740f 100%)' },
  { id: 'peony', name: 'Peony', gradient: 'linear-gradient(135deg, #b2a473 0%, #010101 33%, #303637 66%, #824bb5 100%)' },
  { id: 'pistachio', name: 'Pistachio', gradient: 'linear-gradient(135deg, #cffa53 0%, #af5b2c 33%, #9e5129 66%, #ab897a 100%)' },
  { id: 'cerulean', name: 'Cerulean', gradient: 'linear-gradient(135deg, #8765e3 0%, #3a335f 33%, #080807 66%, #040404 100%)' },
  { id: 'mocha', name: 'Mocha', gradient: 'linear-gradient(135deg, #3279fa 0%, #8fc6f4 33%, #000000 66%, #1b3e26 100%)' },
  { id: 'pebble', name: 'Pebble', gradient: 'linear-gradient(135deg, #fb9c02 0%, #caab7c 33%, #252726 66%, #505153 100%)' },
  { id: 'lumen', name: 'Lumen', gradient: 'linear-gradient(135deg, #d8e6e6 0%, #9b4657 33%, #ad351f 66%, #c88e5d 100%)' }
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
