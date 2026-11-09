import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const SIGNS = [
  {file:'b_market',x:-13.6,z:-4.0,y:6.7,scale:1.12,rotation:0},
  {file:'a_alley',x:19.0,z:-50.0,y:7.6,scale:1.1,rotation:0},
  {file:'mid_top',x:-12.5,z:-32.0,y:7.0,scale:1.1,rotation:0},
  {file:'boba',x:-26.1,z:-34.0,y:7.6,scale:1.0,rotation:0}
];
export function loadCitySigns(engine) {
  const loader = new GLTFLoader();
  for (const sign of SIGNS) {
    loader.load(`${import.meta.env.BASE_URL}models/signs/${sign.file}.glb`, result => {
      if(engine.isDisposed)return;
      const root=result.scene;
      root.name=`3D shop signage ${sign.file}`;
      root.position.set(sign.x,sign.y,sign.z);
      root.rotation.y=sign.rotation;
      root.scale.setScalar(sign.scale);
      root.traverse(obj=>{if(obj.isMesh){obj.receiveShadow=true;obj.castShadow=false;}});
      engine.scene.add(root);
    }, undefined, error=>console.warn('Sign model unavailable',error));
  }
}
