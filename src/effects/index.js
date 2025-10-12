const registry = new Map();

export function register(name, mod){
  if(!name || typeof mod !== 'object' || typeof mod.apply !== 'function'){
    return;
  }
  registry.set(name, {
    apply: mod.apply,
    defaults: mod.defaults || {},
    heavy: Boolean(mod.heavy)
  });
}

export function getEffect(name){
  return registry.get(name);
}

export function getEffectDefaults(name){
  const mod = registry.get(name);
  return mod ? mod.defaults : undefined;
}

export function isHeavy(name){
  const mod = registry.get(name);
  return Boolean(mod && mod.heavy);
}

export function listEffects(){
  return Array.from(registry.keys());
}

export const effects = registry;

export async function ensureEffect(name){
  if(!name) return undefined;
  if(registry.has(name)){
    return registry.get(name);
  }
  const normalized = name.replace(/[^a-z0-9_\-]/gi, '');
  try{
    await import(`./${normalized}.js`);
  }catch(err){
    console.warn(`Impossibile caricare l'effetto "${name}":`, err);
    return undefined;
  }
  return registry.get(name);
}

export function acquireBuffer(cache, key, length){
  const existing = cache.get(key);
  if(existing instanceof Uint8ClampedArray && existing.length === length){
    return existing;
  }
  const buf = new Uint8ClampedArray(length);
  cache.set(key, buf);
  return buf;
}

export function cloneImageData(img){
  const copy = new Uint8ClampedArray(img.data);
  return new ImageData(copy, img.width, img.height);
}
