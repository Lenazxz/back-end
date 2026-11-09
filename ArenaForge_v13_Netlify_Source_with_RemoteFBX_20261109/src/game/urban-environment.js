import * as THREE from 'three';
import { MAP_AREAS, MAP_HOLES, terrainHeight } from './map-layout.js';

/* Original modular Japanese/industrial street-scene detailing.
   No remote asset requests: works when exported to StackBlitz/Netlify offline.
   Reuses shared geometry/materials and instancing for low draw call count. */
function facadeTexture(color) {
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
  const ctx=canvas.getContext('2d');const base=new THREE.Color(color);
  ctx.fillStyle=color;ctx.fillRect(0,0,256,256);
  for(let y=0;y<256;y+=18){ctx.fillStyle='rgba(35,39,40,.16)';ctx.fillRect(0,y,256,2);}
  for(let x=0;x<256;x+=32){ctx.fillStyle='rgba(40,38,34,.07)';ctx.fillRect(x,0,2,256);}
  let seed=2134;const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)|0)>>>0)/4294967296;
  for(let i=0;i<1700;i++){
    const x=rnd()*256,y=rnd()*256;
    ctx.fillStyle=rnd()>.45?'rgba(30,25,19,.065)':'rgba(255,249,220,.09)';
    ctx.fillRect(x,y,1+rnd()*3,1+rnd()*4);
  }
  const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  tex.anisotropy=2;
  return new THREE.MeshStandardMaterial({map:tex,roughness:.92,metalness:.01});
}
const palette = ['#b9ada3','#d2b59c','#b9b9ae','#9aa2a3','#bf9390','#c0c0b5','#d8c0aa','#9a9e9a'];
const mat = (c, metalness=0.03) => new THREE.MeshStandardMaterial({color:c,roughness:0.86,metalness});
const shared = {
  frame: mat('#353d40',0.3),
  roof: mat('#555d60',0.26),
  roofLite: mat('#75736b',0.22),
  window: new THREE.MeshStandardMaterial({color:'#374e57',roughness:0.43,metalness:0.3,emissive:'#273743',emissiveIntensity:.12}),
  vine: mat('#4a674a'), vineLight:mat('#75916b'),
  signage:mat('#d0ab79'), pipe:mat('#747e79',0.45)
};
const seedRand = () => {let n=9919;return () => ((n=Math.imul(n,1664525)+1013904223|0)>>>0)/4294967296;};
export function addUrbanEnvironment(engine) {
  const scene=engine.scene;
  const random=seedRand();
  const boxGeometry=new THREE.BoxGeometry(1,1,1);
  const instanceGroups=new Map();
  const addInstance=(material,x,y,z,w,h,d,rotation=0)=>{
    if(!instanceGroups.has(material))instanceGroups.set(material,[]);
    instanceGroups.get(material).push({x,y,z,w,h,d,rotation});
  };
  const facadeMaterials=palette.map(facadeTexture);
  const buildingData=[];
  // Urban blocks flank the playable silhouette. The playable outline and collision
  // remain unchanged; these are architectural skyline/backdrop volumes.
  for(const side of [-1,1]) for(let k=0;k<11;k++) {
    const z=-65+k*12.2;
    const x=side*(46+random()*7);
    const width=9+random()*6,depth=9.4+random()*6;
    const levels=3+Math.floor(random()*5);
    const height=levels*3.65;
    buildingData.push({x,z,width,depth,height,levels,color:palette[(k+(side+1)*3)%palette.length],side});
  }
  for(let i=0;i<9;i++) {
    const side=i%2?1:-1;
    const x=-38+i*9.5;
    const z=side*(78+random()*6);
    const levels=4+(i%5);
    buildingData.push({x,z,width:9+random()*5,depth:10+random()*4,height:levels*3.65,levels,color:palette[(i+3)%palette.length],side:side===1?0:2});
  }
  // A concrete mid courtyard structure: existing footprint already has a
  // collision void; adding higher facade doesn't interfere with player routes.
  const hole=MAP_HOLES.find(h=>h.id==='courtyard-block');
  if(hole) buildingData.push({x:(hole.x1+hole.x2)/2,z:(hole.z1+hole.z2)/2,
    width:Math.max(2,hole.x2-hole.x1-1),depth:Math.max(2,hole.z2-hole.z1-1),
    height:18,levels:5,color:'#aa9589',side:0,center:true});

  for(let i=0;i<buildingData.length;i++) {
    const b=buildingData[i];
    const floor=b.center?terrainHeight(b.x,b.z):0;
    addInstance(facadeMaterials[i%facadeMaterials.length],b.x,floor+b.height/2,b.z,b.width,b.height,b.depth);
    addInstance(shared.roof,b.x,floor+b.height+.2,b.z,b.width+.95,.48,b.depth+.95);
    addInstance(shared.roofLite,b.x,floor+b.height+.5,b.z,b.width+.25,.17,b.depth+.25);
    // Layered exterior sheet metal awnings, window modules and lintels.
    for(let level=1;level<b.levels;level++){
      const windowY=floor+level*3.6-1.15;
      for(const side of [-1,1]){
        const frontZ=b.z+side*(b.depth/2+.035);
        for(let col=0;col<Math.floor((b.width-2)/2.1);col++){
          const xx=b.x-b.width/2+1.5+col*2.1;
          addInstance(shared.frame,xx,windowY,frontZ,.99,1.58,.12);
          addInstance(shared.window,xx,windowY,frontZ+side*.082,.75,1.30,.085);
          addInstance(shared.frame,xx,windowY,frontZ+side*.14,.07,1.42,.11);
          addInstance(shared.frame,xx,windowY-.04,frontZ+side*.14,.82,.065,.12);
        }
      }
      for(const side of [-1,1]){
        const frontX=b.x+side*(b.width/2+.04);
        for(let col=0;col<Math.floor((b.depth-2)/2.1);col++){
          const zz=b.z-b.depth/2+1.45+col*2.1;
          addInstance(shared.frame,frontX,windowY,zz,.12,1.58,.99);
          addInstance(shared.window,frontX+side*.09,windowY,zz,.08,1.30,.75);
        }
      }
      if(level===1 || level===b.levels-1){
        addInstance(shared.roof,b.x,windowY-1.12,b.z+b.depth/2+.78,b.width+.8,.17,1.65);
        addInstance(shared.frame,b.x,windowY-.97,b.z+b.depth/2+.78,b.width+.8,.09,.18);
      }
    }
    for(let j=0;j<3;j++){
      const x=b.x+(random()-.5)*(b.width-2);
      const y=floor+b.height+.75;
      addInstance(shared.pipe,x,y,b.z+.5,.22,1.2,.24);
    }
    if(i%4===0) {
      addInstance(shared.signage,b.x,floor+4.1,b.z+b.depth/2+.9,Math.min(b.width-2,6.5),.7,.2);
    }
  }
  // Building-edge climbing vines only: no scattered foliage in routes.
  // Instanced stems follow the visible outer walls from the roofline downward.
  const facadeVineData = buildingData.filter((_,i)=>i%3===0 || i===buildingData.length-1);
  for(const b of facadeVineData) {
    const rows=Math.min(13,Math.floor(b.height/1.25));
    const side=b.side===-1 ? -1 : 1;
    const x=b.x+(b.width*.5+.12)*side;
    const z=b.z+b.depth*.24;
    for(let i=0;i<rows;i++) {
      const y=Math.max(1,b.height-.9-i*1.1);
      const drift=Math.sin(i*.54)*.18;
      addInstance(shared.vine,x+side*.02,y,z+drift,.10,1.2,.11);
      addInstance(i%3===0?shared.vineLight:shared.vine,x+side*.09,y-.25,z+drift+.2,.22,.08,.45);
      addInstance(shared.vine,x+side*.09,y-.58,z+drift-.20,.21,.07,.42);
    }
  }
  // Rooftop pipe bridges, signals and signboards frame open lanes overhead.
  for(const [x,z,w] of [[0,24,13],[0,-42,12],[-23,10,8],[24,5,7],[-10,-17,8]]){
    const floor=terrainHeight(x,z);
    addInstance(shared.frame,x,floor+7.3,z,w,.21,.34);
    addInstance(shared.roofLite,x,floor+7.05,z,w,.12,1.2);
    for(const s of [-1,1]) addInstance(shared.pipe,x+s*w/2,floor+5.5,z,.19,3.6,.19);
  }
  // Dress the ACTUAL playable corridor walls, not only distant backdrop blocks.
  // Meshes remain non-colliding visual layers: original collision stays unchanged.
  const decorated = engine.solids.filter(s=>
    s.mesh.name==='granite perimeter'||s.mesh.name==='industrial corridor wall');
  let wallIndex=0;
  for(const item of decorated){
    const mesh=item.mesh;
    const w=mesh.geometry.parameters.width,d=mesh.geometry.parameters.depth;
    const runsOnX=w>d;
    const length=runsOnX?w:d;
    const total=Math.max(0,Math.floor((length-.8)/3.2));
    if(!total)continue;
    for(let i=0;i<total;i++){
      const k=i-(total-1)/2;
      for(const side of [-1,1]){
        const px=mesh.position.x+(runsOnX?k*3.2:side*(w/2+.12));
        const pz=mesh.position.z+(runsOnX?side*(d/2+.12):k*3.2);
        if((i+wallIndex)%4!==0){
          const ww=runsOnX?1.6:.10,dd=runsOnX?.10:1.6;
          addInstance(shared.frame,px,3.25,pz,ww,1.8,dd);
          addInstance(shared.window,px+(runsOnX?0:side*.06),3.25,pz+(runsOnX?side*.06:0),runsOnX?1.27:.075,1.48,runsOnX?.075:1.27);
        }else{
          addInstance(shared.roofLite,px,4.25,pz,runsOnX?2.3:.5,.16,runsOnX?.5:2.3);
          addInstance(shared.pipe,px,2.8,pz,runsOnX?1.3:.17,.11,runsOnX?.17:1.3);
        }
      }
    }
    wallIndex++;
  }
  const dummy=new THREE.Object3D();
  for(const [material,placements] of instanceGroups){
    const batch=new THREE.InstancedMesh(boxGeometry,material,placements.length);
    batch.castShadow=false;
    batch.receiveShadow=true;
    batch.frustumCulled=false;
    for(let i=0;i<placements.length;i++){
      const o=placements[i];
      dummy.position.set(o.x,o.y,o.z);dummy.rotation.set(0,o.rotation,0);dummy.scale.set(o.w,o.h,o.d);
      dummy.updateMatrix();batch.setMatrixAt(i,dummy.matrix);
    }
    batch.instanceMatrix.needsUpdate=true;
    scene.add(batch);
  }
}
