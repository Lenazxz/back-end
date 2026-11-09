import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { validAgent } from './agents.js';

// Real, textured, skinned Mixamo FBX models supplied by the player.
// Two 4K-texture packs have been downsampled to 1K, WITHOUT stripping skinning.
const loader=new FBXLoader();
const sourceForAgent={rift:'ch15',aegis:'swat',lumen:'ch35',ember:'ch15',bastion:'ch35'};
const variantTint={rift:'#e9a26e',aegis:'#7294a5',lumen:'#65b4a8',ember:'#dc7951',bastion:'#bca878'};
const resourceCache=new Map();
const animationCache=new Map();
const unavailableSources=new Set();
const ACTIONS=['idle','walk','run','jump','fire','reload'];
// Optional external asset host for StackBlitz previews that cannot upload large FBX files.
// For normal Netlify builds, models are copied from public/models/mixamo.
const mixamoBase = (import.meta.env.VITE_MIXAMO_ASSET_BASE || `${import.meta.env.BASE_URL}models/mixamo/`).replace(/\/+$/, '') + '/';
const base=(name)=>`${mixamoBase}${name}.fbx`;

async function loadSource(source){
  if(resourceCache.has(source))return resourceCache.get(source);
  const task=(async()=>{
    if(source==='swat'){
      // SWAT was exported as FBX 6100. FBXLoader rejects pre-6400 files; try
      // this binary-compatibility parse, and use a full modern model if needed.
      const response=await fetch(base('swat'));
      if(!response.ok)throw new Error(`SWAT download ${response.status}`);
      const data=await response.arrayBuffer();
      const view=new DataView(data);
      if(view.getUint32(23,true)<6400)view.setUint32(23,6400,true);
      return loader.parse(data,mixamoBase);
    }
    return loader.loadAsync(base(source));
  })().catch(error=>{
    resourceCache.delete(source);
    throw error;
  });
  resourceCache.set(source,task);
  return task;
}

async function clipsFor(source){
  if(animationCache.has(source))return animationCache.get(source);
  const task=Promise.all(ACTIONS.map(async id=>{
    try {
      const data=await loader.loadAsync(base(`${source}-${id}`));
      const clip=data.animations[0];
      if(clip){clip.name=id;return [id,clip];}
    }catch(err){console.warn('FBX animation not available',source,id,err);}
    return [id,null];
  })).then(pairs=>Object.fromEntries(pairs));
  animationCache.set(source,task);
  return task;
}

function createMeshInstance(resource,id,preview){
  const mesh=cloneSkeleton(resource);
  const out=new THREE.Group();
  const height=new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).y;
  const scale=height>0.001 ? 2.02/height : .01;
  mesh.scale.multiplyScalar(scale);
  mesh.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(mesh);
  mesh.position.y-=bounds.min.y;
  // Mixamo's character forward is commonly +Z. Arena Forge uses -Z for forward.
  mesh.rotation.y=Math.PI;
  out.add(mesh);
  const tint=new THREE.Color(variantTint[id]||'#ddd');
  mesh.traverse(obj=>{
    if(!obj.isMesh && !obj.isSkinnedMesh)return;
    obj.castShadow=!preview;
    obj.receiveShadow=true;
    const mats=Array.isArray(obj.material)?obj.material:[obj.material];
    const updated=mats.map(material=>{
      if(!material)return material;
      const m=material.clone();
      const n=(m.name||'').toLowerCase();
      const human=/skin|face|head|eye|hair|hand/.test(n);
      if(id==='ember'||id==='bastion') {
        if(!human && m.color)m.color.lerp(tint,.22);
      }
      return m;
    });
    obj.material=Array.isArray(obj.material)?updated:updated[0];
  });
  return {out,mesh};
}

/** Legacy name kept for components that already load agent resources. */
export async function getAgentGLB(agentId){
  const id=validAgent(agentId);
  const requested=sourceForAgent[id];
  let source=unavailableSources.has(requested)?'ch35':requested,scene;
  try{scene=await loadSource(source);}catch(error){
    if(source==='swat'){
      unavailableSources.add('swat');
      console.warn('Legacy SWAT FBX not compatible; using modern textured fallback',error);
      source='ch35';scene=await loadSource(source);
    }else throw error;
  }
  return {scene,source,id};
}

export function attachAgentModel(avatar,agentId,options={}){
  const id=validAgent(agentId);
  const serial=(avatar.userData.modelSerial||0)+1;
  avatar.userData.modelSerial=serial;
  avatar.userData.agent=id;
  return getAgentGLB(id).then(async resource=>{
    if(options.isDisposed?.()||avatar.userData.modelSerial!==serial)return null;
    const {out,mesh}=createMeshInstance(resource.scene,id,!!options.preview);
    // Switch visuals ONLY after a valid skinned model is available.
    const tracks=await clipsFor(resource.source);
    if(options.isDisposed?.()||avatar.userData.modelSerial!==serial)return null;
    if(avatar.userData.agentModel)avatar.remove(avatar.userData.agentModel);
    for(const child of avatar.children){
      if(child===out||child.userData?.agentIndicator)continue;
      child.visible=false;
    }
    avatar.add(out);
    avatar.userData.agentModel=out;
    const mixer=new THREE.AnimationMixer(mesh);
    const actions={};
    for(const [name,clip] of Object.entries(tracks)){
      if(!clip)continue;
      actions[name]=mixer.clipAction(clip);
      if(name==='jump'||name==='fire'||name==='reload'){
        actions[name].setLoop(THREE.LoopOnce,1);
        actions[name].clampWhenFinished=true;
      }
    }
    avatar.userData.mixer=mixer;
    avatar.userData.actions=actions;
    avatar.userData.animState=null;
    avatar.userData.motionLast=avatar.position.clone();
    avatar.userData.motionSpeed=0;
    avatar.userData.animClock=0;
    mesh.traverse(obj=>{
      if(obj.isMesh||obj.isSkinnedMesh){
        if(options.targetRoot)obj.userData.targetRoot=options.targetRoot;
        if(options.onMesh)options.onMesh(obj);
      }
    });
    return out;
  }).catch(err=>{console.warn('Character model failed, retaining fallback',id,err);return null;});
}

export function animateAgent(root,dt,forcedSpeed){
  const ud=root?.userData;
  if(!ud?.agentModel)return;
  const delta=Math.min(.05,Math.max(0,dt));
  if(!ud.motionLast)ud.motionLast=root.position.clone();
  const traveled=Math.hypot(root.position.x-ud.motionLast.x,root.position.z-ud.motionLast.z);
  ud.motionLast.copy(root.position);
  const speed=forcedSpeed===undefined?Math.min(12,traveled/Math.max(delta,.01)):forcedSpeed;
  ud.motionSpeed=THREE.MathUtils.lerp(ud.motionSpeed||0,speed,Math.min(1,delta*10));
  const state=ud.motionSpeed>5.3?'run':ud.motionSpeed>.9?'walk':'idle';
  const actions=ud.actions||{};
  if(state!==ud.animState && actions[state]){
    const next=actions[state];next.reset().fadeIn(.18).play();
    if(ud.animState&&actions[ud.animState])actions[ud.animState].fadeOut(.18);
    ud.animState=state;
  }
  ud.mixer?.update(delta);
  // Fallback for models whose imported animation tracks do not bind.
  if(!ud.mixer||!actions[state]){
    ud.animClock=(ud.animClock||0)+delta*(2.5+ud.motionSpeed);
    ud.agentModel.position.y=Math.sin(ud.animClock)*Math.min(1,ud.motionSpeed/5)*.02;
  }
}

export function playAgentAction(root,name){
  const ud=root?.userData;
  const action=ud?.actions?.[name];
  if(!action)return false;
  action.reset().fadeIn(.08).play();
  return true;
}
