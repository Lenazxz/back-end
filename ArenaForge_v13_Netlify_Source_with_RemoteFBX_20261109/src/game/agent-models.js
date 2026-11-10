console.info('[Arena Forge] Character loader v13.3 active: SWAT local; Ember crimson; Bastion emerald.');
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { validAgent } from './agents.js';

/**
 * Arena Forge v13.3 — local SWAT and vivid independently recoloured operatives.
 *
 * Real source characters:
 *  Rift = Ch15  |  Aegis = SWAT (converted from supplied legacy FBX 6100)
 *  Lumen = Ch35 |  Ember = heavily recoloured Ch15
 *  Bastion = heavily recoloured Ch35
 *
 * SWAT uses a locally bundled, optimised <1 MB GLB. Its Mixamo animation
 * clips still load from the existing remote Netlify FBX folder.
 * Ember and Bastion recolour the original uniform *texture pixels* rather
 * than multiplying already-dark images by a small tint.
 */
const fbxLoader = new FBXLoader();
const gltfLoader = new GLTFLoader();
const modelSource = Object.freeze({
  rift: 'ch15',
  aegis: 'swat',
  lumen: 'ch35',
  ember: 'ch15',
  bastion: 'ch35',
});

// The originals keep their textures; the duplicated bases get intentionally
// high-contrast, completely different uniforms, not a 22% pastel tint.
const LOOKS = Object.freeze({
  rift:    { suit: null },
  aegis:   { suit: '#276f9b', accent: '#e0faff', dark: '#213c55', gear: 'medic' },
  lumen:   { suit: null },
  ember:   { suit: '#ff2639', accent: '#ffd12f', dark: '#75091b', gear: 'striker' },
  bastion: { suit: '#0bb063', accent: '#c9ff36', dark: '#143929', gear: 'armored' },
});

const baseURL = (
  import.meta.env.VITE_MIXAMO_ASSET_BASE ||
  `${import.meta.env.BASE_URL}models/mixamo/`
).replace(/\/+$/, '') + '/';
const pathFor = (name, ext = 'fbx') => `${baseURL}${name}.${ext}`;
// This asset deliberately bypasses VITE_MIXAMO_ASSET_BASE: it's small enough
// to live in StackBlitz's public directory, independent of Netlify.
const swatLocalPath = `${import.meta.env.BASE_URL}models/mixamo/swat-local-v133.glb`;
const tintedTextureCache = new WeakMap();
const MODELS = new Map();
const CLIPS = new Map();
const ACTIONS = ['idle', 'walk', 'run', 'jump', 'fire', 'reload'];

function meshCount(scene) {
  let count = 0;
  scene.traverse(obj => { if (obj.isSkinnedMesh || obj.isMesh) count++; });
  return count;
}

async function loadSource(source) {
  if (MODELS.has(source)) return MODELS.get(source);
  const promise = (async () => {
    if (source === 'swat') {
      // FBX 6100 cannot reliably be opened by Three.js FBXLoader. Use the
      // GLB converted from the user's ACTUAL SWAT mesh and textures instead.
      const gltf = await gltfLoader.loadAsync(swatLocalPath);
      if (!meshCount(gltf.scene)) throw new Error('Local SWAT GLB has no visible meshes');
      return gltf.scene;
    }
    const fbx = await fbxLoader.loadAsync(pathFor(source));
    if (!meshCount(fbx)) throw new Error(`${source}.fbx has no visible meshes`);
    return fbx;
  })().catch(error => {
    MODELS.delete(source);
    throw error;
  });
  MODELS.set(source, promise);
  return promise;
}

async function clipsFor(source) {
  if (CLIPS.has(source)) return CLIPS.get(source);
  const task = Promise.all(ACTIONS.map(async name => {
    try {
      const fbx = await fbxLoader.loadAsync(pathFor(`${source}-${name}`));
      const original = fbx.animations?.[0];
      if (original) {
        const clip = original.clone();
        clip.name = name;
        return [name, clip];
      }
    } catch (error) {
      console.warn(`[Arena Forge] Missing ${source} ${name} animation`, error);
    }
    return [name, null];
  })).then(entries => Object.fromEntries(entries));
  CLIPS.set(source, task);
  return task;
}

/**
 * True uniform recolouring. The old v13 approach used material.color.lerp,
 * which multiplies an already almost-black diffuse map and produces an
 * imperceptible colour change. This recolours the diffuse texture itself,
 * retaining cloth stitching, creases and normal maps. No extra hosted assets.
 */
function recolourUniformMaterial(material, id) {
  if (!material) return material;
  const m = material.clone();
  const look = LOOKS[id];
  const colour = new THREE.Color(look.suit);
  const map = m.map;
  // Exclude the SWAT face/skin and anything explicitly labelled human skin.
  if (/head|face|skin|eye|hair/i.test(m.name || '')) return m;
  if (map?.image && typeof document !== 'undefined') {
    try {
      let variants = tintedTextureCache.get(map);
      if (!variants) { variants = new Map(); tintedTextureCache.set(map, variants); }
      let recoloured = variants.get(id);
      if (!recoloured) {
        const img = map.image;
        const width = Math.max(1, Math.min(1024, img.naturalWidth || img.videoWidth || img.width || 512));
        const height = Math.max(1, Math.min(1024, img.naturalHeight || img.videoHeight || img.height || 512));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas 2D unavailable');
        context.drawImage(img, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height);
        const rgb = [colour.r * 255, colour.g * 255, colour.b * 255];
        for (let i = 0; i < pixels.data.length; i += 4) {
          const r = pixels.data[i], g = pixels.data[i+1], b = pixels.data[i+2];
          const original = (0.2126*r+0.7152*g+0.0722*b) / 255;
          // Lift very dark fabric: otherwise bright red/green remains black.
          const lighting = 0.43 + 0.73 * Math.sqrt(original);
          const textureDetail = (r + g + b) / 3 - original * 255;
          for (let k=0; k<3; k++) {
            const shaded = rgb[k] * lighting + textureDetail * 0.17;
            pixels.data[i+k] = Math.max(0, Math.min(255, shaded * 0.96 + [r,g,b][k] * 0.04));
          }
        }
        context.putImageData(pixels, 0, 0);
        recoloured = map.clone();
        // Texture.clone() shares its Source with the original. Replacing the
        // Source avoids recolouring Rift/Lumen by accident.
        recoloured.source = new THREE.Source(canvas);
        recoloured.colorSpace = map.colorSpace;
        recoloured.needsUpdate = true;
        variants.set(id, recoloured);
      }
      m.map = recoloured;
      m.color.set('#ffffff');
      m.needsUpdate = true;
      return m;
    } catch (error) {
      console.warn(`[Arena Forge] ${id} textile recolour using fallback uniform`, error);
    }
  }
  // Always-visible fallback if the map is not loaded yet or Canvas is blocked:
  // remove the dark diffuse map instead of multiplying it by a colour.
  m.map = null;
  m.color.copy(colour);
  // Preserve existing geometry, normal-map and roughness detail when possible.
  if (m.emissive) m.emissive.copy(colour).multiplyScalar(0.08);
  m.needsUpdate = true;
  return m;
}

function basicMaterial(color, metalness = 0.15, emissive = '#000000') {
  return new THREE.MeshStandardMaterial({
    color, metalness, roughness: 0.64,
    emissive, emissiveIntensity: emissive === '#000000' ? 0 : 0.17,
  });
}

/** Small fitted armour pieces distinguish silhouettes without replacing the
 * textured character model with a box figure. Created in 2-metre avatar space.
 */
function addGear(sceneRoot, skinnedScene, id) {
  const look = LOOKS[id];
  if (!look?.gear) return;
  const suitMat = basicMaterial(look.dark);
  const accentMat = basicMaterial(look.accent, 0.35, look.accent);
  const group = new THREE.Group();
  group.name = `AF_${id}_operative_kit`;

  const panel = (size, xyz, mat, rz = 0) => {
    const obj = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
    obj.position.set(...xyz);
    obj.rotation.z = rz;
    obj.castShadow = true;
    obj.receiveShadow = true;
    obj.userData.operativeCosmetic = true;
    obj.raycast = () => {}; // cosmetics must not interfere with hit registration
    group.add(obj);
    return obj;
  };

  if (look.gear === 'striker') {
    // Bright yellow/orange chest harness and compact angular shoulder guards.
    panel([0.28, 0.40, 0.08], [-0.11, 1.33, -0.26], suitMat, -0.24);
    panel([0.12, 0.47, 0.10], [-0.12, 1.32, -0.31], accentMat, -0.34);
    panel([0.27, 0.10, 0.10], [0.08, 1.20, -0.31], accentMat);
    panel([0.16, 0.11, 0.20], [-0.30, 1.54, 0], accentMat, 0.20);
    panel([0.16, 0.11, 0.20], [0.30, 1.54, 0], accentMat, -0.20);
  } else if (look.gear === 'armored') {
    // Broad green ballistic shoulders, contrasting breastplate and back unit.
    panel([0.53, 0.44, 0.13], [0, 1.33, -0.26], suitMat);
    panel([0.43, 0.13, 0.145], [0, 1.45, -0.32], accentMat);
    panel([0.10, 0.20, 0.15], [-0.13, 1.26, -0.33], accentMat);
    panel([0.10, 0.20, 0.15], [0.13, 1.26, -0.33], accentMat);
    panel([0.26, 0.17, 0.28], [-0.35, 1.49, 0], suitMat);
    panel([0.26, 0.17, 0.28], [0.35, 1.49, 0], suitMat);
    panel([0.25, 0.42, 0.16], [0, 1.26, -0.25], suitMat);
  } else if (look.gear === 'medic') {
    // Pale-blue medical breast panel distinguishes SWAT from assault suits.
    panel([0.27, 0.34, 0.085], [0, 1.32, -0.26], suitMat);
    panel([0.085, 0.23, 0.09], [0, 1.34, -0.315], accentMat);
    panel([0.23, 0.085, 0.09], [0, 1.34, -0.315], accentMat);
    panel([0.16, 0.08, 0.20], [-0.28, 1.51, 0], accentMat);
    panel([0.16, 0.08, 0.20], [0.28, 1.51, 0], accentMat);
  }

  sceneRoot.add(group);
  sceneRoot.updateMatrixWorld(true);
  // Follow spine rotation if a Mixamo spine bone can be located. The gear is
  // placed in metre space before reparenting, so its world pose stays intact.
  let torso;
  skinnedScene.traverse(obj => {
    if (obj.isBone && /(?:^|:)Spine2$|mixamorigSpine2$/i.test(obj.name)) torso = obj;
  });
  if (torso) {
    try { torso.attach(group); } catch { /* root-attached gear still works */ }
  }
}

function instantiate(baseModel, id, preview) {
  const model = cloneSkeleton(baseModel);
  const root = new THREE.Group();
  const bbox = new THREE.Box3().setFromObject(model);
  const height = bbox.getSize(new THREE.Vector3()).y;
  if (!(height > 0.02 && Number.isFinite(height))) throw new Error(`Invalid mesh dimensions for ${id}`);
  model.scale.multiplyScalar(2.02 / height);
  model.updateMatrixWorld(true);
  model.position.y -= new THREE.Box3().setFromObject(model).min.y;
  model.rotation.y = Math.PI;
  root.add(model);

  const look = LOOKS[id];
  model.traverse(obj => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return;
    obj.castShadow = !preview;
    obj.receiveShadow = true;
    const update = mat => {
      if (!mat) return mat;
      const base = mat.clone();
      // Face skin is intentionally unaffected: SWAT has a dedicated head mat.
      if (id === 'aegis' && /head|face|eye|skin/i.test(base.name)) return base;
      // Keep the other three originals, recolour *all* uniform parts for both
      // duplicate skins, including the whole body atlas rather than a 22% tint.
      return (id === 'ember' || id === 'bastion') ? recolourUniformMaterial(base, id) : base;
    };
    obj.material = Array.isArray(obj.material) ? obj.material.map(update) : update(obj.material);
  });
  addGear(root, model, id);
  return { root, model };
}

/** Retained for compatibility with the existing v13 game UI. */
export async function getAgentGLB(agentId) {
  const id = validAgent(agentId);
  let source = modelSource[id];
  try {
    return { scene: await loadSource(source), source, id };
  } catch (error) {
    if (source !== 'swat') throw error;
    console.error('[Arena Forge] Local SWAT GLB failed. Check /public/models/mixamo/swat-local-v133.glb, then check Vite Network tab.', error);
    // Visible SWAT load failure is reported explicitly; do not silently
    // substitute Ch35 and pretend it is a third original character.
    throw error;
  }
}

export function attachAgentModel(avatar, agentId, options = {}) {
  const id = validAgent(agentId);
  const serial = (avatar.userData.modelSerial || 0) + 1;
  avatar.userData.modelSerial = serial;
  avatar.userData.agent = id;

  return getAgentGLB(id).then(async ({ scene, source }) => {
    if (options.isDisposed?.() || avatar.userData.modelSerial !== serial) return null;
    const { root, model } = instantiate(scene, id, !!options.preview);
    const clips = await clipsFor(source);
    if (options.isDisposed?.() || avatar.userData.modelSerial !== serial) return null;

    if (avatar.userData.agentModel) avatar.remove(avatar.userData.agentModel);
    for (const child of avatar.children) {
      if (child === root || child.userData?.agentIndicator) continue;
      child.visible = false;
    }
    avatar.add(root);
    avatar.userData.agentModel = root;
    avatar.userData.agentSource = source;

    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const [name, clip] of Object.entries(clips)) {
      if (!clip) continue;
      actions[name] = mixer.clipAction(clip);
      if (['jump', 'fire', 'reload'].includes(name)) {
        actions[name].setLoop(THREE.LoopOnce, 1);
        actions[name].clampWhenFinished = true;
      }
    }
    avatar.userData.mixer = mixer;
    avatar.userData.actions = actions;
    avatar.userData.animState = null;
    avatar.userData.motionLast = avatar.position.clone();
    avatar.userData.motionSpeed = 0;
    avatar.userData.animClock = 0;

    model.traverse(obj => {
      if ((!obj.isMesh && !obj.isSkinnedMesh) || obj.userData?.operativeCosmetic) return;
      if (options.targetRoot) obj.userData.targetRoot = options.targetRoot;
      options.onMesh?.(obj);
    });
    return root;
  }).catch(error => {
    console.error(`[Arena Forge] ${id} model unavailable. Check local SWAT asset and Network requests.`, error);
    return null;
  });
}

export function animateAgent(avatar, dt, forcedSpeed) {
  const data = avatar?.userData;
  if (!data?.agentModel) return;
  const delta = Math.min(0.05, Math.max(0, dt));
  if (!data.motionLast) data.motionLast = avatar.position.clone();
  const displacement = Math.hypot(avatar.position.x - data.motionLast.x, avatar.position.z - data.motionLast.z);
  data.motionLast.copy(avatar.position);
  const speed = forcedSpeed === undefined ? Math.min(12, displacement / Math.max(delta, 0.01)) : forcedSpeed;
  data.motionSpeed = THREE.MathUtils.lerp(data.motionSpeed || 0, speed, Math.min(1, delta * 10));
  const state = data.motionSpeed > 5.3 ? 'run' : data.motionSpeed > 0.9 ? 'walk' : 'idle';
  const actions = data.actions || {};
  if (state !== data.animState && actions[state]) {
    actions[state].reset().fadeIn(0.18).play();
    if (data.animState && actions[data.animState]) actions[data.animState].fadeOut(0.18);
    data.animState = state;
  }
  data.mixer?.update(delta);
  if (!data.mixer || !actions[state]) {
    data.animClock = (data.animClock || 0) + delta * (2.5 + data.motionSpeed);
    data.agentModel.position.y = Math.sin(data.animClock) * Math.min(1, data.motionSpeed / 5) * 0.02;
  }
}

export function playAgentAction(avatar, name) {
  const action = avatar?.userData?.actions?.[name];
  if (!action) return false;
  action.reset().fadeIn(0.08).play();
  return true;
}
