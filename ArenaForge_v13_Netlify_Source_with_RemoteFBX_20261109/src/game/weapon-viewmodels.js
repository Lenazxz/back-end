/** Arena Forge v16: first-person 3D gun models; client-side cosmetics only.
 * Files are served from Netlify at /models/weapons/. No damage or hit logic changes.
 *
 * StackBlitz preview: if VITE_WEAPON_ASSET_BASE isn't set, derive the asset root
 * automatically from the existing VITE_MIXAMO_ASSET_BASE environment variable.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const GUN_FILES = Object.freeze({
  smg: 'classic-smg.glb',
  shotgun: 'pump-shotgun.glb',
  rifle: 'standard-rifle.glb',
  marksman: 'semi-auto-dmr.glb',
  woodRifle: 'wood-stock-rifle.glb',
});

const GUN_LENGTHS = Object.freeze({ smg: 0.78, shotgun: 1.06, rifle: 0.98, marksman: 1.08, woodRifle: 1.01 });
const assetCache = new Map();
const loader = new GLTFLoader();

export function weaponAssetBase() {
  const env = import.meta.env || {};
  const explicit = String(env.VITE_WEAPON_ASSET_BASE || '').trim();
  if (explicit) return explicit.endsWith('/') ? explicit : `${explicit}/`;
  const mixamo = String(env.VITE_MIXAMO_ASSET_BASE || '').trim();
  if (mixamo) {
    // Reuse the same deployed site that already hosts the character models.
    const redirected = mixamo.replace(/\/models\/mixamo\/?(?:\?.*)?$/, '/models/weapons/');
    if (redirected !== mixamo) return redirected;
  }
  return '/models/weapons/';
}

export function weaponModelFor(id, rifleStyle = 'standard') {
  return id === 'rifle' && rifleStyle === 'wood' ? 'woodRifle' : id;
}

function getAsset(kind) {
  const file = GUN_FILES[kind];
  if (!file) return Promise.resolve(null);
  const url = weaponAssetBase() + file;
  if (!assetCache.has(url)) {
    const promise = new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
    assetCache.set(url, promise);
    // Remove failures from the cache so a later weapon switch can retry.
    promise.catch(() => { if (assetCache.get(url) === promise) assetCache.delete(url); });
  }
  return assetCache.get(url);
}

function cloneIndependent(template) {
  // Engine.dispose() disposes scene materials and geometries. Clone both so
  // a subsequent game can reuse the cached template without broken GPU assets.
  const object = template.clone(true);
  object.traverse(child => {
    if (!child.isMesh) return;
    child.geometry = child.geometry.clone();
    if (Array.isArray(child.material)) child.material = child.material.map(m => m.clone());
    else if (child.material) child.material = child.material.clone();
    child.castShadow = false;
    child.receiveShadow = false;
    child.frustumCulled = false; // Weapon never disappears near camera edges.
  });
  return object;
}

function disposeIndependent(object) {
  if (!object) return;
  object.traverse(child => {
    if (!child.isMesh) return;
    child.geometry?.dispose();
    if (Array.isArray(child.material)) child.material.forEach(m => m?.dispose());
    else child.material?.dispose();
  });
}

export class WeaponViewModel {
  constructor(holder, onVisible) {
    this.holder = holder;
    this.onVisible = onVisible;
    this.root = new THREE.Group();
    this.root.name = 'ArenaForge3DWeapon';
    this.holder.add(this.root);
    this.serial = 0;
    this.destroyed = false;
    this.object = null;
    this.kind = null;
    this.mixer = null;
    this.clips = new Map();
    this.sequence = null;
    this.sequenceTime = 0;
    this.closePlayed = false;
  }

  clear() {
    this.mixer?.stopAllAction();
    this.mixer?.uncacheRoot(this.object);
    this.mixer = null;
    this.clips.clear();
    this.sequence = null;
    if (this.object) {
      this.root.remove(this.object);
      disposeIndependent(this.object);
      this.object = null;
    }
  }

  async equip(id, rifleStyle = 'standard') {
    const seq = ++this.serial;
    this.clear();
    const kind = weaponModelFor(id, rifleStyle);
    this.kind = kind;
    if (!GUN_FILES[kind]) { this.onVisible?.(false, id); return; }
    this.onVisible?.(false, id); // Keep the lightweight fallback until loaded.
    try {
      const gltf = await getAsset(kind);
      if (this.destroyed || seq !== this.serial) return;
      const model = cloneIndependent(gltf.scene);
      const box = new THREE.Box3().setFromObject(model);
      if (box.isEmpty() || !Number.isFinite(box.max.z - box.min.z)) {
        disposeIndependent(model);
        throw new Error('Weapon model has no valid geometry');
      }
      // All supplied models have their barrel along -Z. Fit the overall length
      // to the camera's first-person coordinate system while keeping the sight
      // line near the center when ADS is active.
      const length = Math.max(0.001, box.max.z - box.min.z);
      const factor = GUN_LENGTHS[kind] / length;
      model.scale.setScalar(factor);
      model.position.x = -(box.min.x + box.max.x) * 0.5 * factor;
      model.position.y = 0.085 - (box.min.y + box.max.y) * 0.5 * factor;
      model.position.z = -(box.min.z + box.max.z) * 0.5 * factor;
      this.root.add(model);
      this.object = model;
      this.mixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations || []) this.clips.set(clip.name, clip);
      this.onVisible?.(true, id, model);
    } catch (error) {
      if (this.destroyed || seq !== this.serial) return;
      console.warn(`[Arena Forge] 3D weapon ${kind} could not load; using fallback.`, error);
      this.onVisible?.(false, id);
    }
  }

  startClip(name, seconds) {
    const clip = this.clips.get(name);
    if (!clip || !this.mixer) return false;
    this.mixer.stopAllAction();
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.timeScale = clip.duration / Math.max(0.06, seconds);
    action.play();
    return true;
  }

  fire() {
    // Charging a rifle on every automatic bullet would be visually wrong;
    // only the pump shotgun cycles a moving part after individual shots.
    if (this.kind !== 'shotgun' || !this.object || this.sequence?.type === 'reload') return;
    const opening = this.clips.has('charge-open') ? 'charge-open' : this.clips.has('open') ? 'open' : null;
    const closing = this.clips.has('charge-close') ? 'charge-close' : this.clips.has('close') ? 'close' : null;
    if (!opening || !closing) return;
    this.sequence = { type: 'fire', opening, closing, length: 0.24 };
    this.sequenceTime = 0;
    this.closePlayed = false;
    this.startClip(opening, 0.12);
  }

  reload(seconds) {
    if (!this.object) return;
    const opening = this.clips.has('magazine-open') ? 'magazine-open' : this.clips.has('open') ? 'open' : null;
    const closing = this.clips.has('magazine-close') ? 'magazine-close' : this.clips.has('close') ? 'close' : null;
    if (!opening || !closing) return;
    this.sequence = { type: 'reload', opening, closing, length: seconds };
    this.sequenceTime = 0;
    this.closePlayed = false;
    this.startClip(opening, seconds * 0.42);
  }

  update(delta) {
    if (!this.mixer || !this.sequence) return;
    const s = this.sequence;
    this.sequenceTime += delta;
    if (!this.closePlayed && this.sequenceTime >= s.length * 0.47) {
      this.closePlayed = true;
      this.startClip(s.closing, s.length * 0.53);
    }
    this.mixer.update(delta);
    if (this.sequenceTime >= s.length) this.sequence = null;
  }

  dispose() {
    this.destroyed = true;
    this.serial++;
    this.clear();
    this.holder.remove(this.root);
  }
}
