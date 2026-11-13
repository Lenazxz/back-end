/** Arena Forge v16: first-person 3D gun models; client-side cosmetics only.
 * Files are served from Netlify at /models/weapons/. No damage or hit logic changes.
 *
 * StackBlitz preview: if VITE_WEAPON_ASSET_BASE isn't set, derive the asset root
 * automatically from the existing VITE_MIXAMO_ASSET_BASE environment variable.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

console.info('[Arena Forge] weapon loader v16.1: GRIT pistol, calibrated sights and muzzle positions active');

const GUN_FILES = Object.freeze({
  sidearm: 'grit-sidearm.glb',
  smg: 'classic-smg.glb',
  shotgun: 'pump-shotgun.glb',
  rifle: 'standard-rifle.glb',
  marksman: 'semi-auto-dmr.glb',
  woodRifle: 'wood-stock-rifle.glb',
});

// Camera-space scale and sight-line calibration for the six supplied meshes.
// All supplied meshes point their barrels toward -Z. 'sightHeight' aligns the
// upper receiver/front sight near the crosshair when the camera enters ADS.
// The shorter pistol uses its own fit instead of inheriting rifle dimensions.
const GUN_FIT = Object.freeze({
  sidearm:   { length: 0.51, sightHeight: 0.187, depth: -0.045 },
  smg:      { length: 0.77, sightHeight: 0.182, depth: -0.030 },
  shotgun:  { length: 1.02, sightHeight: 0.186, depth: -0.055 },
  rifle:    { length: 0.98, sightHeight: 0.184, depth: -0.040 },
  marksman: { length: 1.06, sightHeight: 0.188, depth: -0.060 },
  woodRifle:{ length: 0.99, sightHeight: 0.184, depth: -0.040 },
});
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
    this.finishPlayed = false;
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
      // All supplied models have their barrel along -Z. Fit each weapon to a
      // calibrated length and place the *top* of the gun near the ADS sight line.
      const fit = GUN_FIT[kind];
      const length = Math.max(0.001, box.max.z - box.min.z);
      const factor = fit.length / length;
      model.scale.setScalar(factor);
      model.position.x = -(box.min.x + box.max.x) * 0.5 * factor;
      model.position.y = fit.sightHeight - box.max.y * factor;
      model.position.z = -(box.min.z + box.max.z) * 0.5 * factor + fit.depth;
      // Pass the correct barrel-end location back to the engine for muzzle VFX.
      // This is relative to weaponGroup, the common parent of root and muzzle.
      const muzzleAt = new THREE.Vector3(
        model.position.x + (box.min.x + box.max.x) * 0.5 * factor,
        model.position.y + (box.min.y + box.max.y) * 0.5 * factor,
        model.position.z + box.min.z * factor - 0.025,
      );
      this.root.add(model);
      this.object = model;
      this.mixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations || []) this.clips.set(clip.name, clip);
      this.onVisible?.(true, id, model, muzzleAt);
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
    // The shotgun cycles its pump. The GRIT sidearm cycles its actual slide.
    // Rifles and SMGs intentionally do not rack their charging handles on each
    // automatic shot; those are not real firing animations on the supplied GLBs.
    if (!this.object || this.sequence?.type === 'reload') return;
    const pistol = this.kind === 'sidearm';
    if (!pistol && this.kind !== 'shotgun') return;
    const opening = pistol ? 'slide-open' : (this.clips.has('charge-open') ? 'charge-open' : 'open');
    const closing = pistol ? 'slide-close' : (this.clips.has('charge-close') ? 'charge-close' : 'close');
    if (!this.clips.has(opening) || !this.clips.has(closing)) return;
    const length = pistol ? 0.12 : 0.24;
    this.sequence = { type: 'fire', opening, closing, length };
    this.sequenceTime = 0;
    this.closePlayed = false;
    this.finishPlayed = false;
    this.startClip(opening, length * 0.47);
  }

  reload(seconds) {
    if (!this.object) return;
    const opening = this.clips.has('magazine-open') ? 'magazine-open' : this.clips.has('open') ? 'open' : null;
    const closing = this.clips.has('magazine-close') ? 'magazine-close' : this.clips.has('close') ? 'close' : null;
    if (!opening || !closing) return;
    // The pistol has an extra hammer cock action after the magazine returns.
    const finish = this.kind === 'sidearm' && this.clips.has('cock') ? 'cock' : null;
    this.sequence = { type: 'reload', opening, closing, finish, length: seconds };
    this.sequenceTime = 0;
    this.closePlayed = false;
    this.finishPlayed = false;
    this.startClip(opening, seconds * 0.42);
  }

  update(delta) {
    if (!this.mixer || !this.sequence) return;
    const s = this.sequence;
    this.sequenceTime += delta;
    if (!this.closePlayed && this.sequenceTime >= s.length * 0.47) {
      this.closePlayed = true;
      this.startClip(s.closing, s.length * (s.finish ? 0.41 : 0.53));
    }
    if (s.finish && !this.finishPlayed && this.sequenceTime >= s.length * 0.88) {
      this.finishPlayed = true;
      this.startClip(s.finish, s.length * 0.12);
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
