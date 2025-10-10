export type EffectFn = (
  img: ImageData,
  params: Record<string, any>,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null,
  cache: Map<string, any>
) => ImageData;

export interface EffectModule {
  apply: EffectFn;
  defaults: Record<string, any>;
  heavy?: boolean;
}

const registry = new Map<string, EffectModule>();

export function register(name: string, mod: EffectModule): void {
  if (!name || typeof mod !== 'object' || typeof mod.apply !== 'function') {
    return;
  }
  registry.set(name, {
    apply: mod.apply,
    defaults: mod.defaults || {},
    heavy: Boolean(mod.heavy)
  });
}

export function getEffect(name: string): EffectModule | undefined {
  return registry.get(name);
}

export function getEffectDefaults(name: string): Record<string, any> | undefined {
  const mod = registry.get(name);
  return mod ? mod.defaults : undefined;
}

export function isHeavy(name: string): boolean {
  const mod = registry.get(name);
  return Boolean(mod && mod.heavy);
}

export function listEffects(): string[] {
  return Array.from(registry.keys());
}

export const effects = registry;

export async function ensureEffect(name: string): Promise<EffectModule | undefined> {
  if (!name) return undefined;
  if (registry.has(name)) {
    return registry.get(name);
  }
  const normalized = name.replace(/[^a-z0-9_\-]/gi, '');
  try {
    await import(`./${normalized}.js`);
  } catch (err) {
    console.warn(`Impossibile caricare l'effetto "${name}":`, err);
    return undefined;
  }
  return registry.get(name);
}

export function acquireBuffer(cache: Map<string, any>, key: string, length: number): Uint8ClampedArray {
  const existing = cache.get(key);
  if (existing instanceof Uint8ClampedArray && existing.length === length) {
    return existing;
  }
  const buf = new Uint8ClampedArray(length);
  cache.set(key, buf);
  return buf;
}

export function cloneImageData(img: ImageData): ImageData {
  const copy = new Uint8ClampedArray(img.data);
  return new ImageData(copy, img.width, img.height);
}
