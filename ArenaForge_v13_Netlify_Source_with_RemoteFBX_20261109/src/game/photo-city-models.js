import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Self-contained GLBs use photo textures from the user's own map references.
// Scenic models do not register collision; physical layout, AI routes and
// multiplayer remain governed by map-layout.js.
const PLACEMENTS = Object.freeze([
  ['pink_midrise', 6, -18, 0, 1.06],
  ['pink_midrise', -47, -53, Math.PI / 2, 1.1],
  ['warehouse_front', -40, 15, Math.PI / 2, 1.06],
  ['warehouse_front', 41, -18, -Math.PI / 2, 1.04],
  ['corrugated_row', 40, 15, -Math.PI / 2, 1.02],
  ['corrugated_row', -41, -9, Math.PI / 2, 1.02],
  ['industrial_corner', -42, -34, Math.PI / 2, 1.06],
  ['industrial_corner', 43, 42, -Math.PI / 2, 1.02],
  ['old_shopfront', 39, -43, -Math.PI / 2, 1.15],
  ['old_shopfront', -41, 45, Math.PI / 2, 1.12]
]);

export function loadPhotoCityModels(engine, mapId='foundry') {
  const placements=mapId==='exchange'
    ? [['pink_midrise',-50,-41,Math.PI/2,1.0],['warehouse_front',53,19,-Math.PI/2,1.0],['corrugated_row',-51,20,Math.PI/2,1.0],['old_shopfront',50,37,-Math.PI/2,1.0]]
    : mapId==='triad'
    ? [['pink_midrise',-52,-25,Math.PI/2,1.0],['warehouse_front',53,18,-Math.PI/2,1.0],['corrugated_row',-51,34,Math.PI/2,1.0],['old_shopfront',52,-36,-Math.PI/2,1.0]]
    : PLACEMENTS;
  const loader = new GLTFLoader();
  const root = new THREE.Group();
  root.name = 'Photographic urban building assets';
  engine.scene.add(root);
  const prefix = `${import.meta.env.BASE_URL}models/photocity/`;
  for (const name of [...new Set(placements.map((p) => p[0]))]) {
    loader.load(`${prefix}${name}.glb`, (gltf) => {
      if (engine.isDisposed) return;
      for (const [, x, z, angle, scale] of placements.filter((p) => p[0] === name)) {
        const model = gltf.scene.clone(true);
        model.name = `${name} photo-textured GLB`;
        model.position.set(x, -0.2, z);
        model.scale.setScalar(scale);
        model.rotation.y = angle;
        model.traverse((part) => {
          if (!part.isMesh) return;
          part.castShadow = false;
          part.receiveShadow = true;
          part.frustumCulled = true;
        });
        root.add(model);
      }
    }, undefined, (err) => {
      if (!engine.isDisposed) console.warn(`Could not load ${name}.glb`, err);
    });
  }
  return root;
}
