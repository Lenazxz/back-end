import * as THREE from 'three';
import { placementFor, gridCoordinate, quarterFromYaw, buildConflict, supportsBuild } from './build-grid.js';
import { addUrbanEnvironment } from './urban-environment.js';
import { loadPhotoCityModels } from './photo-city-models.js';
import { loadCitySigns } from './city-signs.js';
import { AGENTS, validAgent } from './agents.js';
import { attachAgentModel, animateAgent, playAgentAction } from './agent-models.js';
import { TILE_SIZE, MAP_AREAS, MAP_LABELS, SITES, SPAWNS, COVER, BALCONIES, ACCESS_RAMPS, terrainHeight, playableAt, createWalkableTiles, tileKey, toTile, areaAt, selectActiveMap, ACTIVE_MAP_NAME, ACTIVE_MAP_ID } from './map-layout.js';
import { findNavPath, segmentIsClear } from './bot-navigation.js';
import { WEAPONS, weaponById, STARTING_CREDITS, clampCredits, canAfford } from './weapons.js';

const GRID = 2;
const PLAYER_HEIGHT = 1.72;
const PLAYER_RADIUS = 0.38;
const BUILD_COSTS = { wall: 10, floor: 10, ramp: 15, roof: 10 };
const BUILD_LABELS = { wall: 'WALL', floor: 'FLOOR', ramp: 'RAMP', roof: 'ROOF' };

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const snap = (value, size = GRID) => Math.round(value / size) * size;

export class ArenaEngine {
  constructor(container, onHud, role = 'attack', network = null, gameMode = 'attackDrill', agentId = 'rift', mapId = 'foundry') {
    this.container = container;
    this.onHud = onHud;
    this.role = role === 'defend' ? 'DEFENDERS' : 'ATTACKERS';
    this.network = network;
    this.agentId = validAgent(agentId);
    this.abilityReadyAt=0;
    this.reconUntil=0;
    this.abilityFeedback='';
    this.charges={q:0,f:0};this.ultimatePoints=0;this.armor=0;this.hasteUntil=0;this.flashUntil=0;
    this.gameMode = gameMode;
    this.onlinePhase = network ? 'WAITING' : null;
    this.onlineRoundSerial = -1;
    this.onlineSpikeSite = null;
    this.spikeCarrierId=null;
    this.isSpikeCarrier=false;
    this.remotePlayers = new Map();
    this.netSendAt = 0;
    this.netBuildIds = new Set();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#a8bfc3');
    this.scene.fog = new THREE.Fog('#a8bfc3', 80, 190);
    this.camera = new THREE.PerspectiveCamera(76, 1, 0.1, 10000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.27;
    this.container.appendChild(this.renderer.domElement);

    const saved = this.readSettings();
    this.camera.fov = saved.fov;
    this.camera.updateProjectionMatrix();
    this.sensitivity = saved.sensitivity;
    this.botDifficulty = saved.botDifficulty;
    this.camera.rotation.order = 'YXZ';
    this.playerTarget = { position: this.camera.position, userData: { isPlayer: true, team: this.role } };

    this.clock = new THREE.Clock();
    this.keys = Object.create(null);
    this.velocityY = 0;
    this.grounded = true;
    this.yaw = 0;
    this.pitch = 0;
    this.health = 100;
    this.weaponId = 'sidearm';
    this.ammo = WEAPONS.sidearm.magazine;
    this.reserve = WEAPONS.sidearm.reserve;
    this.credits = STARTING_CREDITS;
    this.localBuyTimer = gameMode === 'bots' ? 18 : 0;
    this.materials = 300;
    this.weaponCooldown = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.buildMode = false;
    this.buildPiece = 'wall';
    this.buildLevelOffset = 0;
    this.botTime = 0;
    this.damageFlash = 0;
    this.previewValid = false;
    this.targets = [];
    this.targetParts = [];
    this.solidMeshes = [];
    this.solids = [];
    this.surfaces = [];
    this.buildings = [];
    this.effects = [];
    this.lastHudAt = 0;
    this.message = 'CLICK TO CAPTURE MOUSE';
    this.messageTimer = 2.4;
    this.isDisposed = false;
    this.raycaster = new THREE.Raycaster();
    this.center = new THREE.Vector2(0, 0);
    this.score = { ATTACKERS: 0, DEFENDERS: 0 };
    this.roundResetTimer = 0;
    this.playerRespawnTimer = 0;
    this.abilityReadyAt = 0;
    this.reconUntil = 0;
    this.kills = 0;
    this.deaths = 0;
    this.killId = 0;
    this.killFeed = [];
    this.navEpoch = 0;

    this.mapId=selectActiveMap(mapId);
    this.makeLighting();
    this.makeArena();
    this.objectiveSite = 'A';
    this.bindNetwork();
    this.setupObjectiveForMode();
    if (!this.network) {this.makeTargets();this.localSpikeCarrier=this.role==='ATTACKERS'?'YOU':this.targets.find(b=>b.userData.team==='ATTACKERS')?.userData.botName||null;}
    this.makeWeaponModel();
    this.makeBuildPreview();
    this.bindEvents();
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.animate();
    this.pushHud(true);
  }

  readSettings() {
    try {
      const settings = JSON.parse(localStorage.getItem('arenaForgeSettingsV1') || '{}');
      return {
        sensitivity: clamp(Number(settings.sensitivity) || 0.0022, 0.001, 0.004),
        fov: clamp(Number(settings.fov) || 76, 65, 100),
        botDifficulty: ['rookie', 'standard', 'veteran'].includes(settings.botDifficulty) ? settings.botDifficulty : 'standard'
      };
    } catch {
      return { sensitivity: 0.0022, fov: 76, botDifficulty: 'standard' };
    }
  }

  makeLighting() {
    const hemi = new THREE.HemisphereLight('#daebed', '#696b6d', 2.0);
    this.scene.add(hemi);
    const moon = new THREE.DirectionalLight('#ffe6cf', 2.4);
    moon.position.set(-18, 28, 14);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.left = -46;
    moon.shadow.camera.right = 46;
    moon.shadow.camera.top = 46;
    moon.shadow.camera.bottom = -46;
    moon.shadow.bias = -0.00028;
    this.scene.add(moon);
    const fill = new THREE.DirectionalLight('#a5bac4', 1.0);
    fill.position.set(20, 12, -18);
    this.scene.add(fill);
    const accent = new THREE.PointLight('#dfb18c', 0.45, 44, 2);
    accent.position.set(0, 7, 6);
    this.scene.add(accent);
  }

  material(color, roughness = 0.82, metalness = 0.04) {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness });
  }

  addBox(name, x, y, z, sx, sy, sz, color, options = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), this.material(color, options.roughness ?? 0.82, options.metalness ?? 0.04));
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    // Architectural geometry is physical by default. Tiny paving/trim is deliberately
    // excluded from movement collision, but still stops bullets if substantial.
    if (options.solid !== false && sy >= 0.07 && (sx >= 0.08 || sz >= 0.08)) this.addCollider(mesh, { type: 'box' });
    return mesh;
  }

  addCollider(mesh, extra = {}) {
    const box = new THREE.Box3().setFromObject(mesh);
    this.solidMeshes.push(mesh);
    this.solids.push({ mesh, box, ...extra });
  }

  addPlatformBox(name, x, z, width, depth, top, color = '#87938a') {
    const thickness = 0.22;
    const mesh = this.addBox(name, x, top - thickness / 2, z, width, thickness, depth, color, { solid: true });
    this.surfaces.push({ type: 'platform', x, z, top, sx: width, sz: depth, mesh });
    return mesh;
  }

  makeArchAlongX(name, x, z, width = 4.8, height = 4.1, color = '#a99c82') {
    const postWidth = 0.55;
    this.addBox(`${name} left post`, x - width / 2, height / 2, z, postWidth, height, 0.8, color, { solid: true });
    this.addBox(`${name} right post`, x + width / 2, height / 2, z, postWidth, height, 0.8, color, { solid: true });
    this.addBox(`${name} lintel`, x, height - 0.22, z, width + postWidth, 0.44, 0.95, '#687b76', { solid: true });
  }

  makeArchAlongZ(name, x, z, width = 4.8, height = 4.1, color = '#a99c82') {
    const postWidth = 0.55;
    this.addBox(`${name} near post`, x, height / 2, z - width / 2, 0.8, height, postWidth, color, { solid: true });
    this.addBox(`${name} far post`, x, height / 2, z + width / 2, 0.8, height, postWidth, color, { solid: true });
    this.addBox(`${name} lintel`, x, height - 0.22, z, 0.95, 0.44, width + postWidth, '#687b76', { solid: true });
  }

  makeArena() {
    this.mapName = ACTIVE_MAP_NAME;
    this.siteCenters = SITES;
    this.walkableTiles = createWalkableTiles();
    this.navStatic = new Set(this.walkableTiles);
    this.spawnPoints = {
      attackers: [{ x: SPAWNS.ATTACKERS.x, y: PLAYER_HEIGHT, z: SPAWNS.ATTACKERS.z }],
      defenders: [{ x: SPAWNS.DEFENDERS.x, y: PLAYER_HEIGHT, z: SPAWNS.DEFENDERS.z }]
    };

    // The playable footprint is the supplied custom floor-plan silhouette.
    // Only walkable floor pixels are meshed; the outside is deliberately void.
    const abyss = new THREE.Mesh(new THREE.PlaneGeometry(155, 185), this.material('#0b0e13', 0.98));
    abyss.rotation.x = -Math.PI / 2;
    abyss.position.y = -14.6;
    abyss.receiveShadow = true;
    this.scene.add(abyss);

    // Build one batched, vertex-coloured continuous floor with true height
    // changes in Mid Tiles. The same terrainHeight() powers movement physics.
    const verts = [], colors = [], indices = [];
    const tileColor = (ix, iz) => {
      const x = ix * TILE_SIZE, z = iz * TILE_SIZE;
      const zone = MAP_AREAS.find(a => x >= a.x1 && x <= a.x2 && z >= a.z1 && z <= a.z2
        && a.polygon && this.pointInArea(x, z, a));
      const shade = zone?.tint === 'siteA' ? '#b29d96' : zone?.tint === 'siteB' ? '#8da5aa'
        : zone?.tint === 'lower' ? '#848f90' : zone?.tint === 'upper' ? '#b9aaa0'
        : zone?.tint === 'spawn' ? '#aaa59d' : '#aba49b';
      const c = new THREE.Color(shade);
      c.multiplyScalar(0.90 + Math.abs((ix * 17 + iz * 29) % 7) * 0.013);
      return c;
    };
    for (const key of this.walkableTiles) {
      const [ix, iz] = key.split(',').map(Number);
      const x = ix * TILE_SIZE, z = iz * TILE_SIZE;
      const left=x-1, right=x+1, top=z-1, bottom=z+1;
      const corners = [[left,top],[right,top],[left,bottom],[right,bottom]];
      const start = verts.length / 3;
      const base = tileColor(ix, iz);
      for (const [cx,cz] of corners) {
        verts.push(cx, terrainHeight(cx,cz)+0.012, cz);
        colors.push(base.r,base.g,base.b);
      }
      indices.push(start,start+2,start+1,start+1,start+2,start+3);
    }
    const floorGeometry = new THREE.BufferGeometry();
    floorGeometry.setAttribute('position', new THREE.Float32BufferAttribute(verts,3));
    floorGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors,3));
    floorGeometry.setIndex(indices);
    floorGeometry.computeVertexNormals();
    const floor = new THREE.Mesh(floorGeometry, new THREE.MeshStandardMaterial({ vertexColors:true, roughness:0.96, metalness:0.025, side:THREE.DoubleSide }));
    floor.receiveShadow = true;
    this.scene.add(floor);
    // Solid to bullets, but player/bot floor support is from terrainHeight().
    this.solidMeshes.push(floor);

    // Map boundary walls: real collision and line-of-sight blockers. Every
    // 2m edge is derived from the floor footprint, then merged into long runs.
    const xEdges = new Map(), zEdges = new Map();
    const append = (group, edge, cell) => {if(!group.has(edge))group.set(edge,[]);group.get(edge).push(cell)};
    for (const key of this.walkableTiles) {
      const [ix, iz] = key.split(',').map(Number);
      for (const side of [-1,1]) {
        if (!this.walkableTiles.has(tileKey(ix+side,iz))) append(xEdges, ix*TILE_SIZE+side, iz);
        if (!this.walkableTiles.has(tileKey(ix,iz+side))) append(zEdges, iz*TILE_SIZE+side, ix);
      }
    }
    const makeWallRuns = (edges,axis) => {
      for (const [edge,values] of edges) {
        values.sort((a,b)=>a-b);
        let first=values[0],prev=values[0];
        const emit=()=>{
          const midpoint=(first+prev)*TILE_SIZE/2;
          const length=(prev-first+1)*TILE_SIZE;
          const gray = axis==='x'?'#b5a59b':'#a8a59e';
          if(axis==='x') this.addBox('granite perimeter',edge,0,midpoint,0.38,12.0,length+0.23,gray);
          else this.addBox('industrial corridor wall',midpoint,0,edge,length+0.23,12.0,0.38,gray);
        };
        for(let k=1;k<values.length;k++) {
          if(values[k]===prev+1)prev=values[k];
          else {emit();first=values[k];prev=values[k]}
        }
        emit();
      }
    };
    makeWallRuns(xEdges,'x');makeWallRuns(zEdges,'z');

    for (const [site,point] of Object.entries(SITES)) {
      this.makeSite(site,point.x,point.z,site==='A'?'#cc655c':site==='B'?'#6499b1':'#d7b06e');
      this.makeSiteLabel(site,point.x,3,point.z);
    }

    for(const item of COVER) {
      const mat = item.kind==='generator'?'#8d7569':item.kind==='console'?'#747d7e':'#998b7b';
      const baseY=terrainHeight(item.x,item.z);
      this.addBox(`${item.kind} housing`, item.x,baseY+item.h/2,item.z,item.w,item.h,item.d,mat);
      this.addBox(`${item.kind} worn cap`,item.x,baseY+item.h+0.08,item.z,item.w+0.12,0.14,item.d+0.12,'#5b6565');
      if(item.kind==='generator') this.addBox('power conduit panel',item.x+item.w*.22,baseY+item.h*.67,item.z+item.d*.52,0.7,.33,.09,'#af7968');
    }

    // Genuine two-level routes. Upper gantries have fully physical surfaces;
    // long incline planks enter them from their southern mouths.
    for(const deck of BALCONIES) {
      this.addPlatformBox(deck.id,deck.x,deck.z,deck.w,deck.d,deck.top,'#849094');
      this.addBox(`${deck.id} underside girder`,deck.x,deck.top-.36,deck.z,deck.w,.26,deck.d,'#282c33');
      // Rails along the outer flanks; keep open front and back for the incline.
      for(const side of [-1,1]) {
        const rx=deck.x+side*(deck.w/2-.12);
        this.addBox(`${deck.id} safety rail`,rx,deck.top+.51,deck.z,.12,1.02,deck.d-.35,'#6a7179');
      }
    }
    for(const ramp of ACCESS_RAMPS) {
      this.makeRampMesh(ramp.x,0,ramp.z,ramp.rotation,'#7f8b8b',false,
        {width:ramp.width,depth:ramp.depth,height:ramp.height});
    }

    // Dark industrial atmosphere: guard towers, recessed lamps, pipes,
    // welded containers, floor warning stripes and broken-overhead frames.
    const glow = new THREE.MeshBasicMaterial({color:'#d29f86'});
    for(const zone of MAP_AREAS) {
      if(zone.tint!=='spawn')continue;
      const x=(zone.x1+zone.x2)/2,z=(zone.z1+zone.z2)/2;
      this.addBox(`${zone.label} awning`,x,7.4,z,Math.min(13,zone.x2-zone.x1-1),.24,2.2,'#292f38');
      this.addBox(`${zone.label} beam`,x,6.8,z,Math.min(12,zone.x2-zone.x1-1),.2,.22,'#616873');
    }
    for(const [x,z] of [[-29,-25],[28,-35],[0,-10],[0,21],[-25,13],[27,12],[-11,-36],[11,-48],[-4,48]]) {
      if(!playableAt(x,z))continue;
      const rootY=terrainHeight(x,z);
      this.addBox('wall fixture support',x,rootY+3.6,z,.36,1.2,.35,'#73737b');
      const lamp=new THREE.Mesh(new THREE.BoxGeometry(.22,.14,.21),glow);
      lamp.position.set(x,rootY+3.1,z);
      this.scene.add(lamp);
    }
    // Walkable balcony extension: Mid Top and Alley become true elevated routes.
    for(const link of [
      {name:'Mid Top east catwalk',x:-7.2,z:-33.0,w:4.8,d:2.6,top:2.3},
      {name:'A Alley south catwalk',x:24.7,z:-45.8,w:4.0,d:5.0,top:2.8},
      {name:'B Boba guard walk',x:-26.55,z:-28.8,w:3.2,d:5.0,top:5.8}
    ]){
      this.addPlatformBox(link.name,link.x,link.z,link.w,link.d,link.top,'#848e92');
      this.addBox(`${link.name} outer rail`,link.x+link.w/2-.1,link.top+.5,link.z,.13,1,link.d,'#626c70');
      this.addBox(`${link.name} brace`,link.x,link.top-.22,link.z,link.w,.16,.19,'#48545d');
    }
    for(const deck of BALCONIES) {
      for(const off of [-deck.w*.25,deck.w*.25]) {
        this.addBox('riveted steel girder',deck.x+off,deck.top-.38,deck.z,.24,.3,deck.d,'#2c3139');
      }
    }
    if(this.mapId==='foundry') {
      this.makeOvergrownArchitecture();
      this.makeHighAccessWalkways();
      addUrbanEnvironment(this);
      loadPhotoCityModels(this);
      loadCitySigns(this);
    } else {
      this.makeVariantUrbanDetails();
      loadPhotoCityModels(this, this.mapId);
    }
    for(const label of MAP_LABELS) {
      if(Object.keys(SITES).some(site=>label.text===`${site} SITE`)||label.text==='MID COURTYARD')continue;
      this.makeAreaSign(label.text,label.x,label.z);
    }
  }

  makeVariantUrbanDetails(){
    // Architectural wall caps and roofed passages are placed on the new layouts
    // only; their footprints never change navigation or the multiplayer map.
    const scenic = this.mapId==='exchange'
      ? [{x:-40,z:25,w:10,d:10},{x:39,z:23,w:10,d:11},{x:0,z:-35,w:12,d:8}]
      : [{x:-39,z:-29,w:10,d:9},{x:41,z:-26,w:10,d:9},{x:0,z:33,w:11,d:7}];
    for(const [i,room] of scenic.entries()){
      const roofY=6.5+i*.4;
      this.addBox('covered market roof',room.x,roofY,room.z,room.w,.24,room.d,'#776f66',{solid:false});
      this.addBox('metal roof fascia',room.x,roofY+.18,room.z,room.w+.18,.17,room.d+.16,'#4e5257',{solid:false});
      for(const dx of [-room.w/2+.35,room.w/2-.35]){
        for(const dz of [-room.d/2+.35,room.d/2-.35]){
          this.addBox('covered passage column',room.x+dx,roofY/2,room.z+dz,.23,roofY,.23,'#5a5652');
        }
      }
      for(let vine=0;vine<5;vine++){
        const x=room.x+room.w/2-.25;
        const z=room.z-room.d/2+(vine+1)*room.d/6;
        const height=1.4+((vine*7+i*3)%5)*.32;
        this.addBox('wall-side green climbing vine',x,roofY-height/2,z,.08,height,.14,'#536b4a',{solid:false});
      }
    }
  }

  /** Covered rooms and climbable, connected high walks. Geometry is original. */
  makeOvergrownArchitecture() {
    const rooms = [
      {name:'B MARKET GREENHOUSE',x:-14.3,z:-2.7,w:7.1,d:9.2,y:6.7},
      {name:'A LINK MAINTENANCE',x:15.0,z:-28.5,w:8.2,d:8.0,y:7.2},
      {name:'MID TOP CONSERVATORY',x:-11.2,z:-33.6,w:8.2,d:9.0,y:7.7},
      {name:'A MAIN VAULT',x:24.0,z:-1.2,w:7.2,d:7.2,y:7.2}
    ];
    let seed = 73;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (const room of rooms) {
      // Full roofs stop bullets and jumping through; pillars occupy the corners.
      this.addBox(`${room.name} concrete roof`,room.x,room.y,room.z,room.w,.42,room.d,'#7b7771');
      this.addBox(`${room.name} cross beam`,room.x,room.y-.34,room.z,room.w,.25,.36,'#4c5155');
      for(const dx of [-room.w/2+.28,room.w/2-.28]){
        for(const dz of [-room.d/2+.28,room.d/2-.28]){
          this.addBox(`${room.name} pillar`,room.x+dx,room.y/2,room.z+dz,.45,room.y,.45,'#494c4d');
        }
      }
      for(let i=0;i<9;i++){
        const side=i%2===0?1:-1;
        const vx=room.x+side*(room.w/2-.3);
        const vz=room.z-room.d/2+.7+(i/9)*(room.d-1.4);
        const length=.7+rand()*3.2;
        const vine=new THREE.Mesh(new THREE.CylinderGeometry(.024,.062,length,5),this.material(i%3===0?'#5f715e':'#364b3d',.98));
        vine.position.set(vx,room.y-.38-length/2,vz);
        vine.rotation.z=(rand()-.5)*.27;
        this.scene.add(vine);
        for(let j=0;j<2;j++){
          const leaf=new THREE.Mesh(new THREE.SphereGeometry(.18+rand()*.13,6,5),this.material('#475c48',.97));
          leaf.scale.set(1.3,.28,.72);
          leaf.position.set(vx+.12*(j*2-1),room.y-.52-length*(.28+j*.36),vz);
          this.scene.add(leaf);
        }
      }
      const warm = new THREE.PointLight('#acb9a0',.8,12,2);
      warm.position.set(room.x,room.y-.7,room.z);
      this.scene.add(warm);
    }
    for(const [x,z] of [[-19,-16],[-30,-31],[22,-38],[10,-5],[-13,20]]){
      if(!playableAt(x,z))continue;
      const y=terrainHeight(x,z);
      const pipe=this.addBox('weathered drainpipe',x,y+2.7,z,.19,5.4,.24,'#4d534d');
      pipe.material.metalness=.6;
    }
  }

  makeHighAccessWalkways() {
    // Two lookout walks sit ~8m high above the courtyards. The adjacent visible
    // void is -14.6m deep, a vertical visual drop exceeding 20 metres.
    // Short mezzanine ramps keep the upper areas reachable from older balconies.
    for (const {name,x,z,top,w,d,rampZ,base,depth} of [
      {name:'A ALLEY HIGH WALK',x:24.5,z:-55.25,top:7.5,w:4.2,d:3.1,rampZ:-51.0,base:2.8,depth:5.6},
      {name:'B BOBA HIGH WALK',x:-25.1,z:-35.1,top:7.2,w:3.6,d:3.1,rampZ:-30.8,base:2.4,depth:5.5}
    ]) {
      this.addPlatformBox(name,x,z,w,d,top,'#575f62');
      this.addBox(`${name} underframes`,x,top-.27,z,w,.24,d,'#30363a');
      // A rising plank follows the player's usual northward approach.
      this.makeRampMesh(x,base,rampZ,0,'#616a6a',false,{width:Math.min(w,3.3),depth,height:top-base});
      for(const side of [-1,1]){
        this.addBox(`${name} edge guard`,x+side*(w/2-.10),top+.47,z,.15,.95,d,'#737a78');
      }
      const danger = this.addBox(`${name} warning trim`,x,top+.045,z-d/2+.13,w-.25,.08,.22,'#d1a467',{solid:false});
      danger.material.emissive=new THREE.Color('#33210e');
    }
    // Shallow underpasses provide a lower secondary fighting plane.
    for(const [name,x,z,w,d] of [
      ['MID SUMP',-6.8,7.3,5.0,6.2],
      ['B MAINTENANCE',-19.2,12.0,4.3,5.1]
    ]){
      if(!playableAt(x,z))continue;
      this.addBox(`${name} side balustrade`,x-w/2+.19,1.2,z,.26,2.4,d,'#3d444b');
      this.addBox(`${name} overhead pipe run`,x,4.9,z,w,.25,.38,'#606667');
    }
  }

  pointInArea(x,z,area) {
    let inside=false;
    const polygon=area.polygon;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
      const a=polygon[i],b=polygon[j];
      if((a.z>z)!==(b.z>z) && x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x) inside=!inside;
    }
    return inside;
  }

  makeAreaSign(label, x, z) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#171c24'; ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = '#c2b5a1'; ctx.font = 'bold 43px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, 256, 52);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false}));
    sprite.position.set(x, 4.9, z);
    sprite.scale.set(4.1, 0.77, 1);
    this.scene.add(sprite);
  }

  updateBots(delta) {
    if (this.network) return;
    this.botTime += delta;
    if(this.gameMode==='bots'&&this.localBuyTimer>0)return;

    if (this.playerRespawnTimer > 0) {
      this.playerRespawnTimer -= delta;
      if (this.playerRespawnTimer <= 0 && this.gameMode === 'bots') {
        const home = SPAWNS[this.role];
        this.camera.position.set(home.x, PLAYER_HEIGHT, home.z);
        this.health = 100;
        this.equipWeapon('sidearm');
        this.velocityY = 0;
        this.yaw = home.yaw;
        this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
        this.setMessage('RESPAWNED · REJOIN THE FIGHT', 2);
        this.playerRespawnTimer = 0;
      }
    }

    if (this.roundResult) return;

    for (const bot of this.targets) {
      const b = bot.userData;
      if (!b.alive) {
        if (this.gameMode === 'bots') {
          b.respawn -= delta;
          if (b.respawn <= 0) this.respawnBot(bot);
        }
        continue;
      }

      b.thinkTimer -= delta;
      b.fireCooldown -= delta;
      b.coverCooldown -= delta;
      if (b.reload > 0) {
        b.reload -= delta;
        if (b.reload <= 0) b.ammo = 24;
      }
      // Sensible perception budget: only re-evaluate targets around 5 times per second.
      if (b.thinkTimer <= 0) {
        b.thinkTimer = 0.17 + (b.index % 3) * 0.04;
        const nextEnemy = this.findBotEnemy(bot);
        if (nextEnemy !== b.enemy) b.reaction = (0.22 + Math.random() * 0.34) * (this.botDifficulty === 'rookie' ? 1.5 : this.botDifficulty === 'veteran' ? 0.7 : 1);
        b.enemy = nextEnemy;
        if (nextEnemy) b.lastSight = this.botTime;
      }
      b.reaction = Math.max(0, b.reaction - delta);
      const hpRatio = clamp(b.health / 100, 0, 1);
      b.healthFill.scale.x = hpRatio;
      b.healthFill.position.x = -(1 - hpRatio) * 0.38;
      b.healthBar.rotation.y = this.yaw - bot.rotation.y;

      const target = b.enemy && (b.enemy.userData?.isPlayer ? this.health > 0 : b.enemy.userData.alive) ? b.enemy : null;
      const targetPosition = target ? this.combatPosition(target) : null;
      const visible = targetPosition && this.hasLineOfSight(
        new THREE.Vector3(bot.position.x, bot.position.y + 1.48, bot.position.z), targetPosition
      );
      const distanceToEnemy = visible ? Math.hypot(targetPosition.x - bot.position.x, targetPosition.z - bot.position.z) : Infinity;

      let moved = false;
      if (b.usingSpike) {
        // Planting / defusing needs several uninterrupted seconds.
        moved = false;
      } else if (visible && distanceToEnemy < 15 && b.reaction <= 0) {
        // Fights are dynamic: strafe, sometimes close the gap, and duck away at point-blank range.
        const tx = targetPosition.x - bot.position.x;
        const tz = targetPosition.z - bot.position.z;
        const d = Math.max(0.01, Math.hypot(tx, tz));
        if (b.strafeTimer <= 0) {
          b.strafeTimer = 1.0 + Math.random() * 1.7;
          b.strafeDir *= -1;
        }
        b.strafeTimer -= delta;
        const approach = b.health < 32 ? -0.65 : distanceToEnemy > 10 ? 0.64 : distanceToEnemy < 4 ? -0.5 : 0.03;
        const mx = (tx / d) * approach + (-tz / d) * b.strafeDir * 0.72;
        const mz = (tz / d) * approach + (tx / d) * b.strafeDir * 0.72;
        moved = this.stepBot(bot, mx, mz, delta, 2.9);
        if (!moved) b.strafeDir *= -1;
      } else {
        moved = this.navigateBot(bot, delta);
      }

      if (visible && b.reaction <= 0) {
        const dx = targetPosition.x - bot.position.x;
        const dz = targetPosition.z - bot.position.z;
        bot.rotation.y = Math.atan2(-dx, -dz);
      } else if (moved && b.facing) {
        bot.rotation.y = Math.atan2(-b.facing.x, -b.facing.z);
      }
      const gait = moved ? Math.sin(this.botTime * 10 + b.phase) * 0.40 : Math.sin(this.botTime * 1.7 + b.phase) * 0.035;
      b.animParts.leftLeg.rotation.x = gait;
      b.animParts.rightLeg.rotation.x = -gait;
      b.animParts.leftArm.rotation.x = -gait * 0.4;
      b.animParts.rightArm.rotation.x = gait * 0.4;

      if (this.gameMode === 'bots' && visible && distanceToEnemy < 18 && b.health < 65 && b.coverCooldown <= 0 && !b.usingSpike) {
        this.botDeployCover(bot, targetPosition);
        b.coverCooldown = 14 + Math.random() * 7;
      }
      if (!b.usingSpike && Date.now() >= (b.flashUntil||0) && visible && distanceToEnemy <= 28 && b.reaction <= 0 && b.fireCooldown <= 0 && b.reload <= 0) {
        const from = new THREE.Vector3(bot.position.x, bot.position.y + 1.5, bot.position.z);
        const rangePenalty = Math.min(0.35, distanceToEnemy * 0.011);
        const skill = this.botDifficulty === 'rookie' ? -0.16 : this.botDifficulty === 'veteran' ? 0.08 : 0;
        const chance = clamp(0.77 + skill - rangePenalty - (moved ? 0.08 : 0), 0.23, 0.90);
        const hit = Math.random() < chance;
        const spread = hit ? 0.13 : 1.6;
        const aim = targetPosition.clone().add(new THREE.Vector3(
          (Math.random() * 2 - 1) * spread,
          (Math.random() * 2 - 1) * spread,
          (Math.random() * 2 - 1) * spread
        ));
        this.spawnTracer(from, aim);
        playAgentAction(bot,'fire');
        b.ammo -= 1;
        b.fireCooldown = 0.35 + Math.random() * 0.30;
        if (hit) this.applyBotDamage(target, 13 + Math.round(Math.random() * 8), bot);
        if (b.ammo <= 0) b.reload = 1.65 + Math.random() * 0.5;
      }
    }
  }

  combatPosition(entity) {
    if (entity.userData?.isPlayer) return this.camera.position.clone().add(new THREE.Vector3(0, -0.2, 0));
    return entity.position.clone().add(new THREE.Vector3(0, 1.4, 0));
  }

  botDeployCover(bot, targetPosition) {
    const b = bot.userData;
    if (b.botMaterials < BUILD_COSTS.wall) return;
    const dx = targetPosition.x - bot.position.x;
    const dz = targetPosition.z - bot.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 3.5) return;
    const x = snap(bot.position.x + (dx / d) * 1.7);
    const z = snap(bot.position.z + (dz / d) * 1.7);
    const rotation = Math.round(Math.atan2(-dx, -dz) / (Math.PI / 2)) * (Math.PI / 2);
    const position = {x, y:1.05, z, level:0, rotation};
    if (!this.walkableTiles.has(tileKey(toTile(x), toTile(z))) || !this.validateBuild(position, 'wall')) return;
    if (Math.hypot(this.camera.position.x - x, this.camera.position.z - z) < 1.1) return;
    const wall = this.createBuildMesh('wall', false);
    wall.position.set(x, 1.05, z);
    wall.rotation.y = rotation;
    wall.userData.kind = 'wall';
    wall.userData.buildRoot = wall;
    wall.userData.health = 120;
    wall.userData.level = 0;
    this.scene.add(wall);
    this.buildings.push(wall);
    this.addCollider(wall, {type:'box', build:true});
    b.botMaterials -= BUILD_COSTS.wall;
    b.pathTimer = 0;
    this.setMessage(`${b.botName} DEPLOYED COVER`, 1.1);
  }

  hasLineOfSight(from, to) {
    const vector = to.clone().sub(from);
    const length = vector.length();
    if (length < 0.01) return true;
    const ray = new THREE.Raycaster(from, vector.multiplyScalar(1 / length), 0, length);
    const hit = ray.intersectObjects(this.solidMeshes, false)[0];
    return !hit || hit.distance >= length - 0.35;
  }

  findBotEnemy(bot) {
    const b = bot.userData;
    const muzzle = new THREE.Vector3(bot.position.x, bot.position.y + 1.5, bot.position.z);
    let closest = null;
    let best = Infinity;
    const enemies = this.targets.filter(other => other !== bot && other.userData.alive && other.userData.team !== b.team);
    if (this.health > 0 && this.role !== b.team && this.playerRespawnTimer <= 0) {
      enemies.push(this.playerTarget);
    }
    for (const enemy of enemies) {
      const end = this.combatPosition(enemy);
      const distance = muzzle.distanceTo(end);
      if (distance >= best || distance > 29) continue;
      if (!this.hasLineOfSight(muzzle, end)) continue;
      best = distance;
      closest = enemy;
    }
    return closest;
  }

  // Tactical destination selection changes when the spike goes down.
  chooseBotGoal(bot) {
    const b = bot.userData;
    const site = this.objectiveState === 'PLANTED' ? this.objectiveSite : b.site;
    const destination = this.siteCenters[site];
    if (this.objectiveState === 'PLANTED') {
      if (b.team === 'DEFENDERS') return { x: destination.x, z: destination.z };
      // Attackers hold off-angles around the planted site.
      return { x: destination.x + (b.index % 2 ? 3 : -3), z: destination.z + (b.index % 3 ? 2 : -2) };
    }
    if (b.team === 'ATTACKERS') {
      if (b.lane === 'MID' && this.roundTimer > 72 && b.phaseIndex < 1) return { x: 0, z: -3 };
      return { x: destination.x + (b.index % 2 ? 1.8 : -1.8), z: destination.z + (b.index % 3 ? 2 : -2) };
    }
    // Defenders split A/B and mid. If one site is lost, all rotate there.
    if (b.lane === 'MID' && this.objectiveState === 'CARRIED') return { x: 0, z: -8 - (b.index % 2) * 5 };
    return { x: destination.x + (b.index % 2 ? 3 : -3), z: destination.z - 4.5 };
  }

  navigateBot(bot, delta) {
    const b = bot.userData;
    if (this.roundResult) return false;
    const goal = this.chooseBotGoal(bot);
    const goalChanged = !b.lastGoal || Math.hypot(b.lastGoal.x - goal.x, b.lastGoal.z - goal.z) > 3;
    b.pathTimer -= delta;
    const blocked = (x, z) => this.isBlocked(x, z, bot.position.y);
    if (!b.path.length || b.pathTimer <= 0 || goalChanged || b.stuckFor > 0.7) {
      b.path = findNavPath(this.walkableTiles, bot.position, goal, blocked);
      b.pathIndex = 0;
      b.pathTimer = 1.0 + (b.index % 4) * 0.12;
      b.lastGoal = goal;
      b.stuckFor = 0;
    }
    if (b.path.length === 0) return false;
    let node = b.path[b.pathIndex];
    while (node && Math.hypot(bot.position.x - node.x, bot.position.z - node.z) < 0.6 && b.pathIndex < b.path.length - 1) {
      b.pathIndex += 1;
      node = b.path[b.pathIndex];
    }
    if (!node) return false;
    const dx = node.x - bot.position.x;
    const dz = node.z - bot.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.55) {
      if (b.lane === 'MID') b.phaseIndex = 1;
      return false;
    }
    const moved = this.stepBot(bot, dx / distance, dz / distance, delta, b.team === 'ATTACKERS' ? 3.7 : 3.35);
    if (!moved) b.stuckFor += delta;
    else b.stuckFor = 0;
    return moved;
  }

  stepBot(bot, dx, dz, delta, speed = 3.4) {
    const length = Math.hypot(dx, dz);
    if (length < 0.01) return false;
    const distance = Math.min(speed * delta, 0.22);
    const moveX = (dx / length) * distance;
    const moveZ = (dz / length) * distance;
    const ox = bot.position.x, oz = bot.position.z;
    const nextX = ox + moveX, nextZ = oz + moveZ;
    if (this.isNavigable(nextX, nextZ, bot.position.y)) {
      bot.position.x = nextX;
      bot.position.z = nextZ;
    } else if (this.isNavigable(nextX, oz, bot.position.y)) {
      bot.position.x = nextX;
    } else if (this.isNavigable(ox, nextZ, bot.position.y)) {
      bot.position.z = nextZ;
    }
    const moved = Math.hypot(bot.position.x - ox, bot.position.z - oz) > 0.001;
    if (moved) {
      bot.userData.facing = { x: bot.position.x - ox, z: bot.position.z - oz };
      bot.position.y = this.getSurfaceHeight(bot.position.x, bot.position.z, bot.position.y);
    }
    return moved;
  }

  isNavigable(x, z, footY = 0) {
    return this.walkableTiles.has(tileKey(toTile(x), toTile(z))) && !this.isBlocked(x, z, footY);
  }

  recordElimination(killerName, victimName, killerTeam) {
    if (!this.killFeed) this.killFeed = [];
    this.killFeed.unshift({ id: ++this.killId, killer: killerName, victim: victimName, team: killerTeam, created: performance.now() });
    this.killFeed.length = Math.min(this.killFeed.length, 5);
    this.setMessage(`${killerName} ELIMINATED ${victimName}`, 1.4);
  }

  applyBotDamage(target, damage, attacker) {
    const attackerTeam = attacker.userData?.team || this.role;
    const attackerName = attacker.userData?.botName || 'YOU';
    if (target.userData?.isPlayer) {
      if (this.health <= 0 || this.roundResult) return;
      const passive=this.agentId==='bastion'?.88:this.agentId==='aegis'?.92:1;
      const actual=Math.max(0,Math.round(damage*passive));
      const absorbed=Math.min(this.armor,actual);this.armor-=absorbed;
      this.health=Math.max(0,this.health-(actual-absorbed));
      this.damageFlash = 0.32;
      if (this.health === 0) {
        this.deaths += 1;
        this.recordElimination(attackerName, 'YOU', attackerTeam);
        if (this.gameMode === 'bots') {
          this.playerRespawnTimer = 3.2;
          this.setMessage('ELIMINATED · RESPAWNING IN 3 SEC', 3.2);
        } else {
          this.finishRound(this.role === 'ATTACKERS' ? 'DEFENDERS WIN' : 'ATTACKERS WIN', 'OPERATIVE ELIMINATED');
        }
      }
      return;
    }
    if (!target.userData?.alive) return;
    const b = target.userData;
    const effective=damage-Math.min(damage,b.armor||0);
    b.armor=Math.max(0,(b.armor||0)-damage);
    b.health = Math.max(0, b.health - effective);
    if (b.health === 0) {
      b.alive = false;
      target.visible = false;
      b.respawn = this.gameMode === 'bots' ? 4.6 + Math.random() * 1.5 : Infinity;
      this.recordElimination(attackerName, b.botName, attackerTeam);
      if (attackerName === 'YOU') {
        this.kills += 1;
        this.ultimatePoints=Math.min(AGENTS[this.agentId].ultimate.cost,this.ultimatePoints+1);
        this.materials = Math.min(600, this.materials + 35);
      }
    }
  }

  respawnBot(bot) {
    const b = bot.userData;
    const home = SPAWNS[b.team];
    const offsetX = ((b.index % 5) - 2) * 2;
    b.health = 100;
    b.alive = true;
    b.respawn = 0;
    b.path = [];
    b.pathIndex = 0;
    b.pathTimer = 0;
    b.lastGoal = null;
    b.phaseIndex = 0;
    b.stuckFor = 0;
    b.enemy = null;
    b.reaction = 0.5;
    b.ammo = 24;
    b.botMaterials = 60;
    b.coverCooldown = 8 + Math.random() * 5;
    b.reload = 0;
    b.fireCooldown = 0.5 + Math.random();
    b.plantProgress = 0;
    b.defuseProgress = 0;
    b.usingSpike = false;
    bot.position.set(home.x + offsetX, 0, home.z + (b.team === 'ATTACKERS' ? -2 : 2));
    bot.visible = true;
  }

  makeSite(letter, x, z, accent) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(5.8, 5.8, 0.12, 42), this.material('#2c3136'));
    pad.position.set(x, terrainHeight(x,z)+0.06, z);
    pad.receiveShadow = true;
    this.scene.add(pad);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.1, 8, 64), this.material(accent, 0.52, 0.16));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, terrainHeight(x,z)+0.14, z);
    this.scene.add(ring);
    const marker = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 1.6), this.material(accent));
    marker.position.set(x, terrainHeight(x,z)+0.18, z);
    this.scene.add(marker);
    const post = this.addBox(`${letter} beacon`, x, terrainHeight(x,z)+2.05, z - 4.8, 0.24, 3.8, 0.24, accent);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10), new THREE.MeshBasicMaterial({ color: accent }));
    lamp.position.set(x, terrainHeight(x,z)+3.95, z - 4.8);
    this.scene.add(lamp);
  }

  makeSiteLabel(letter, x, y, z) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(11,14,18,0.82)'; ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#c9b198'; ctx.lineWidth = 8; ctx.strokeRect(6, 6, 244, 116);
    ctx.fillStyle = '#ebe2d2'; ctx.font = 'bold 82px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(letter, 128, 66);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
    sprite.position.set(x, terrainHeight(x,z)+y+2.5, z + 3.8);
    sprite.scale.set(2.3, 1.15, 1);
    this.scene.add(sprite);
  }

  makePlanter(x, y, z) {
    this.addBox('planter', x, 0.45, z, 2.3, 0.9, 2.3, '#534c47', { solid: true });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 1.4, 8), this.material('#42382e'));
    trunk.position.set(x, 1.45, z); trunk.castShadow = true; this.scene.add(trunk); this.addCollider(trunk, { type: 'box' });
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), this.material('#59615d'));
    crown.position.set(x, 2.3, z); crown.scale.set(1.05, 1.15, 1.05); crown.castShadow = true; this.scene.add(crown); this.addCollider(crown, { type: 'box' });
  }

  makeRampGeometry(width = 2, depth = 2, height = 2) {
    const geometry = new THREE.BoxGeometry(width, 0.13, Math.hypot(depth, height));
    geometry.rotateX(Math.atan2(height, depth));
    geometry.translate(0, height / 2, 0);
    return geometry;
  }

  makeRampMesh(x, y, z, rotation, color, isBuild = false, profile = {}) {
    const width=profile.width ?? 2, depth=profile.depth ?? 2, height=profile.height ?? 2;
    const mesh = new THREE.Mesh(this.makeRampGeometry(width,depth,height), this.material(color, 0.86));
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotation;
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh);
    mesh.userData.kind = 'ramp';
    this.addCollider(mesh, { type: 'ramp', ramp: true });
    if (isBuild) this.buildings.push(mesh);
    this.surfaces.push({ type: 'ramp', x, z, y, rotation, width, depth, height, mesh });
    return mesh;
  }

  makeTargets() {
    this.targets = [];
    this.targetParts = [];
    const bots = [];
    const addTeam = (team, count) => {
      for (let i = 0; i < count; i++) {
        const home = SPAWNS[team];
        const site = Object.keys(SITES)[i % Object.keys(SITES).length];
        const lane = i === 2 ? 'MID' : site;
        bots.push({
          x: home.x + (i - (count - 1) / 2) * 2.2,
          z: home.z + (team === 'ATTACKERS' ? -Math.cos(home.yaw)*1.5 : -Math.cos(home.yaw)*1.5),
          team, lane, site
        });
      }
    };
    if (this.gameMode === 'bots') {
      // Player + 4 allies versus 5 enemies = 5v5, even when the player switches sides.
      addTeam('ATTACKERS', this.role === 'ATTACKERS' ? 4 : 5);
      addTeam('DEFENDERS', this.role === 'DEFENDERS' ? 4 : 5);
    } else if (this.gameMode === 'defendDrill') {
      addTeam('DEFENDERS', 2);
      addTeam('ATTACKERS', 4);
    } else {
      addTeam('ATTACKERS', 2);
      addTeam('DEFENDERS', 4);
    }
    bots.forEach((bot, index) => this.spawnTarget(bot.x, 0, bot.z, index, bot.team, bot.lane, bot.site));
  }

  spawnTarget(x, y, z, index, team = 'DEFENDERS', lane = 'MID', site = 'A') {
    const root = new THREE.Group();
    root.position.set(x, y, z);
    root.userData = {
      health: 100,
      alive: true,
      index,
      team,
      lane,
      site,
      botName: `${team === 'ATTACKERS' ? 'RIFT' : 'WARD'}-${String(index + 1).padStart(2, '0')}`,
      phase: index * 1.2,
      fireCooldown: 0.4 + index * 0.09,
      reload: 0,
      ammo: 24,
      botMaterials: 60,
      coverCooldown: 8 + Math.random() * 5,
      respawn: 0,
      thinkTimer: index * 0.03,
      reaction: 0.45,
      strafeDir: index % 2 ? 1 : -1,
      strafeTimer: 1,
      pathIndex: 0,
      path: [],
      pathTimer: 0,
      lastGoal: null,
      phaseIndex: 0,
      stuckFor: 0,
      plantProgress: 0,
      defuseProgress: 0,
      enemy: null,
      usingSpike: false
    };
    const suit = this.material(team === 'ATTACKERS' ? '#915648' : '#4e7c96', 0.65, 0.18);
    const dark = this.material('#1d242b', 0.67, 0.22);
    const armour = this.material(team === 'ATTACKERS' ? '#cb8f6b' : '#88b8ca', 0.49, 0.35);
    const skin = this.material('#c69b7f');
    const part = (geo, mat, px, py, pz, parent = root) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(px, py, pz);
      mesh.castShadow = true;
      mesh.userData.targetRoot = root;
      parent.add(mesh);
      this.targetParts.push(mesh);
      return mesh;
    };
    part(new THREE.BoxGeometry(0.72, 0.82, 0.40), suit, 0, 1.24, 0);
    part(new THREE.BoxGeometry(0.56, 0.25, 0.48), armour, 0, 1.42, -0.05);
    part(new THREE.BoxGeometry(0.56, 0.22, 0.42), dark, 0, 0.84, 0);
    part(new THREE.CylinderGeometry(0.14, 0.14, 0.18, 8), skin, 0, 1.76, 0);
    const helmet = part(new THREE.SphereGeometry(0.3, 12, 10), dark, 0, 2.0, 0);
    helmet.scale.set(1.05, 1.12, 0.95);
    part(new THREE.BoxGeometry(0.43, 0.12, 0.10), armour, 0, 2.02, -0.27);
    part(new THREE.BoxGeometry(0.33, 0.09, 0.13), this.material('#111821', 0.28, 0.6), 0, 2.04, -0.338);
    const leftLeg = new THREE.Group(), rightLeg = new THREE.Group();
    leftLeg.position.set(-0.19, 0.8, 0); rightLeg.position.set(0.19, 0.8, 0);
    root.add(leftLeg, rightLeg);
    for (const leg of [leftLeg, rightLeg]) {
      part(new THREE.BoxGeometry(0.25, 0.55, 0.30), suit, 0, -0.27, 0, leg);
      part(new THREE.BoxGeometry(0.28, 0.22, 0.38), dark, 0, -0.65, -0.08, leg);
    }
    const leftArm = new THREE.Group(), rightArm = new THREE.Group();
    leftArm.position.set(-0.48, 1.55, 0); rightArm.position.set(0.48, 1.55, 0);
    root.add(leftArm, rightArm);
    for (const arm of [leftArm, rightArm]) {
      part(new THREE.BoxGeometry(0.25, 0.5, 0.29), suit, 0, -0.25, -0.06, arm);
      part(new THREE.BoxGeometry(0.28, 0.17, 0.29), dark, 0, -0.55, -0.06, arm);
      part(new THREE.BoxGeometry(0.31, 0.19, 0.32), armour, 0, -0.07, 0, arm);
    }
    part(new THREE.BoxGeometry(0.12, 0.14, 0.70), dark, 0.23, 1.25, -0.48);
    part(new THREE.BoxGeometry(0.09, 0.09, 0.24), armour, 0.23, 1.27, -0.93);
    root.userData.animParts = { leftLeg, rightLeg, leftArm, rightArm };
    const statusBar = new THREE.Group();
    const backdrop = new THREE.Mesh(new THREE.BoxGeometry(0.80, 0.12, 0.025), new THREE.MeshBasicMaterial({color:'#0c1218',depthTest:true}));
    const fill = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.075, 0.03), new THREE.MeshBasicMaterial({color:team==='ATTACKERS'?'#e49b82':'#8fcbdf',depthTest:true}));
    fill.position.z = 0.028;
    statusBar.add(backdrop, fill);
    statusBar.position.y = 2.43;
    statusBar.userData.agentIndicator = true;
    root.add(statusBar);
    root.userData.healthBar = statusBar;
    root.userData.healthFill = fill;
    this.scene.add(root);
    root.userData.agent=['rift','aegis','lumen','ember','bastion'][index%5];
    attachAgentModel(root,root.userData.agent,{
      targetRoot:root,
      isDisposed:()=>this.isDisposed,
      onMesh:(mesh)=>this.targetParts.push(mesh)
    }).then(model=>{
      if(model)this.targetParts=this.targetParts.filter(part=>part.userData?.targetRoot!==root || model.getObjectById?.(part.id));
    });
    this.targets.push(root);
  }

  makeWeaponModel() {
    this.weaponGroup=new THREE.Group();
    this.weaponCore=new THREE.Mesh(new THREE.BoxGeometry(.18,.16,.65),this.material('#303941',.32,.60));
    this.weaponCore.position.set(0,0,0);
    this.weaponBarrel=new THREE.Mesh(new THREE.CylinderGeometry(.035,.04,.58,10),this.material('#737a80',.3,.75));
    this.weaponBarrel.rotation.x=Math.PI/2;this.weaponBarrel.position.set(0,.015,-.53);
    const grip=new THREE.Mesh(new THREE.BoxGeometry(.13,.25,.16),this.material('#6b5c52'));
    grip.position.set(0,-.19,.13);grip.rotation.x=-.16;
    const sight=new THREE.Mesh(new THREE.BoxGeometry(.08,.08,.15),this.material('#bfa27a'));
    sight.position.set(0,.13,-.17);
    this.muzzle=new THREE.Mesh(new THREE.SphereGeometry(.10,10,8),new THREE.MeshBasicMaterial({color:'#ffcc8a',transparent:true,opacity:0}));
    this.muzzle.position.set(0,.015,-.82);
    this.weaponGroup.add(this.weaponCore,this.weaponBarrel,grip,sight,this.muzzle);
    this.weaponGroup.position.set(.38,-.32,-.66);
    this.camera.add(this.weaponGroup);
    this.scene.add(this.camera);
    this.updateWeaponModel();
  }

  updateWeaponModel() {
    if(!this.weaponCore)return;
    const id=this.weaponId;
    const scale=id==='shotgun'?1.2:id==='smg'?.78:id==='sidearm'?.52:id==='marksman'?1.38:1;
    this.weaponCore.scale.set(id==='shotgun'?1.35:1,1,scale);
    this.weaponBarrel.scale.set(id==='shotgun'?1.25:1,1,scale);
    this.muzzle.position.z=-.53-.29*scale;
    const color=id==='shotgun'?'#775e50':id==='marksman'?'#707984':id==='smg'?'#485d67':'#303941';
    this.weaponCore.material.color.set(color);
  }

  equipWeapon(id,ammo,reserve) {
    const w=weaponById(id);
    this.weaponId=w.id;
    this.ammo=Number.isFinite(ammo)?ammo:w.magazine;
    this.reserve=Number.isFinite(reserve)?reserve:w.reserve;
    this.reloading=false;
    this.weaponCooldown=0;
    this.updateWeaponModel();
    this.pushHud(true);
  }

  buyWeapon(id) {
    const weapon=WEAPONS[id];
    if(!weapon)return;
    const available=this.network?this.onlinePhase==='PRE_ROUND':this.gameMode!=='bots'||this.localBuyTimer>0;
    if(!available){this.setMessage('SHOP CLOSED · WAIT FOR NEXT ROUND',2);this.pushHud(true);return}
    if(this.network){
      this.network.emit('buyWeapon',{id},response=>{
        if(response?.ok){
          this.credits=response.credits;
          this.equipWeapon(response.weapon,response.ammo,response.reserve);
          this.setMessage(`${weapon.name} EQUIPPED`,2);
        }else this.setMessage(response?.error||'PURCHASE FAILED',2);
        this.pushHud(true);
      });
    }else{
      if(this.weaponId===id){this.setMessage('ALREADY EQUIPPED');return}
      if(!canAfford(this.credits,id)){this.setMessage('NOT ENOUGH CREDITS',2);return}
      this.credits=clampCredits(this.credits-weapon.price);
      this.equipWeapon(id);
      this.setMessage(`${weapon.name} EQUIPPED`,2);
    }
  }

  makeBuildPreview() {
    this.preview = this.createBuildMesh('wall', true);
    this.scene.add(this.preview);
  }

  createBuildMesh(kind, preview = false) {
    let geometry;
    let color = preview ? '#79e2a8' : '#c1b7a0';
    const material = new THREE.MeshStandardMaterial({ color, transparent: preview, opacity: preview ? 0.43 : 1, roughness: 0.72, metalness: 0.05, depthWrite: !preview });
    if (kind === 'wall') geometry = new THREE.BoxGeometry(2, 2.15, 0.18);
    else if (kind === 'floor' || kind === 'roof') geometry = new THREE.BoxGeometry(2, 0.16, 2);
    else geometry = this.makeRampGeometry();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = !preview;
    mesh.receiveShadow = true;
    mesh.userData.kind = kind;
    return mesh;
  }

  setMessage(message, duration = 1.5) {
    this.message = message;
    this.messageTimer = duration;
  }

  buyAbility(slot) {
    if(!['q','f'].includes(slot))return;
    const ability=AGENTS[this.agentId][slot==='q'?'utility1':'utility2'];
    const affordable=this.credits>=ability.price;
    if(this.network) {
      this.network.emit('buyAbility',{slot},response=>{
        if(!response?.ok){this.setMessage(response?.error||'PURCHASE FAILED',2);return;}
        this.charges={...response.charges};this.credits=response.credits;
        this.setMessage(`${ability.name} · CHARGE PURCHASED`,2);this.pushHud(true);
      });
    }else{
      if(this.gameMode==='bots'&&this.localBuyTimer<=0){this.setMessage('BUY PHASE CLOSED');return;}
      if(this.charges[slot]>=ability.max){this.setMessage('CHARGES FULL');return;}
      if(!affordable){this.setMessage('NOT ENOUGH CREDITS');return;}
      this.charges[slot]++;this.credits=clampCredits(this.credits-ability.price);
      this.setMessage(`${ability.name} PURCHASED`,2);this.pushHud(true);
    }
  }

  applyLocalKit(slot,now) {
    const agent=AGENTS[this.agentId];
    const allies=this.targets.filter(bot=>bot.userData.alive&&bot.userData.team===this.role);
    const enemies=this.targets.filter(bot=>bot.userData.alive&&bot.userData.team!==this.role);
    const nearby=(bot,r)=>Math.hypot(bot.position.x-this.camera.position.x,bot.position.z-this.camera.position.z)<=r;
    const healTeam=(amount,radius)=>{
      this.health=Math.min(100,this.health+amount);
      allies.forEach(bot=>{if(nearby(bot,radius))bot.userData.health=Math.min(100,bot.userData.health+amount)});
    };
    if(this.agentId==='rift'){
      if(slot==='q')this.armor=Math.min(85,this.armor+25);
      if(slot==='f')this.hasteUntil=now+7000;
      if(slot==='ultimate'){this.armor=Math.min(85,this.armor+20);this.hasteUntil=now+12000;}
    }else if(this.agentId==='aegis'){
      if(slot==='q')this.armor=Math.min(85,this.armor+30);
      if(slot==='f')healTeam(20,9);
      if(slot==='ultimate')healTeam(45,9999);
    }else if(this.agentId==='lumen'){
      this.reconUntil=now+(slot==='ultimate'?14000:slot==='q'?4000:6000);
    }else if(this.agentId==='ember'){
      if(slot==='q')enemies.forEach(bot=>{if(nearby(bot,7))bot.userData.flashUntil=now+1600});
      if(slot==='f'||slot==='ultimate')enemies.forEach(bot=>{
        const range=slot==='f'?5:8;
        if(!nearby(bot,range))return;
        const start=this.camera.position.clone();
        const target=bot.position.clone().add(new THREE.Vector3(0,1.2,0));
        if(this.hasLineOfSight(start,target))this.applyBotDamage(bot,slot==='f'?23:38,{userData:{team:this.role,botName:'YOU'}});
      });
    }else if(this.agentId==='bastion'){
      if(slot==='q')this.armor=Math.min(85,this.armor+25);
      if(slot==='f'||slot==='ultimate'){
        const amount=slot==='f'?20:45;
        this.armor=Math.min(85,this.armor+amount);
        allies.forEach(bot=>{if(nearby(bot,slot==='f'?8:15))bot.userData.armor=Math.min(85,(bot.userData.armor||0)+amount)});
      }
    }
    if(slot==='ultimate')this.ultimatePoints=0;else this.charges[slot]--;
    this.spawnAbilityEffect(this.agentId,this.camera.position.x,this.camera.position.z);
    this.setMessage(`${(slot==='q'?agent.utility1:slot==='f'?agent.utility2:agent.ultimate).name} ACTIVATED`,2);
    this.pushHud(true);
  }

  useAbility(slot='signature') {
    if(!['signature','q','f','ultimate'].includes(slot))return;
    if(this.health<=0||this.roundResult) return;
    if(this.network && !['CARRIED','PLANTED'].includes(this.onlinePhase))return;
    if(!this.network && this.gameMode==='bots' && this.localBuyTimer>0)return;
    const now=Date.now();
    if(slot!=='signature'){
      if(slot==='ultimate'&&this.ultimatePoints<AGENTS[this.agentId].ultimate.cost){this.setMessage('ULTIMATE NOT CHARGED');return;}
      if(slot!=='ultimate'&&!this.charges[slot]){this.setMessage('BUY THIS ABILITY IN BUY PHASE');return;}
      if(this.network){
        this.network.emit('useAbility',{slot},result=>{
          if(!result?.ok){this.setMessage(result?.error||'ABILITY REJECTED');return;}
          if(result.charges)this.charges={...result.charges};
          if(Number.isFinite(result.ultimatePoints))this.ultimatePoints=result.ultimatePoints;
          if(Number.isFinite(result.armor))this.armor=result.armor;
          if(Number.isFinite(result.health))this.health=result.health;
          if(Number.isFinite(result.hasteUntil))this.hasteUntil=result.hasteUntil;
          if(Number.isFinite(result.reconUntil))this.reconUntil=result.reconUntil;
          this.spawnAbilityEffect(this.agentId,this.camera.position.x,this.camera.position.z);
          this.setMessage(`${result.ability} ACTIVATED`,2);this.pushHud(true);
        });
      }else this.applyLocalKit(slot,now);
      return;
    }
    if(now < this.abilityReadyAt){this.setMessage(`ABILITY RECHARGING · ${Math.ceil((this.abilityReadyAt-now)/1000)}S`);return;}
    if(this.network){
      this.network.emit('useAbility',{slot:'signature'},result=>{
        if(!result?.ok){this.setMessage(result?.error||'ABILITY REJECTED');return;}
        this.agentId=validAgent(result.agent);
        this.abilityReadyAt=result.abilityReadyAt;
        if(['rift','ember'].includes(this.agentId) && Number.isFinite(result.x)){
          this.camera.position.set(result.x,result.y+PLAYER_HEIGHT,result.z);
          this.velocityY=0;
        }
        if(Number.isFinite(result.health))this.health=result.health;
        if(Number.isFinite(result.armor))this.armor=result.armor;
        if(Number.isFinite(result.reconUntil))this.reconUntil=result.reconUntil;
        this.spawnAbilityEffect(this.agentId,this.camera.position.x,this.camera.position.z);
        this.setMessage(`${result.ability} ACTIVATED`,2);
        this.pushHud(true);
      });
      return;
    }
    if(this.agentId==='rift'||this.agentId==='ember'){
      const fx=-Math.sin(this.yaw),fz=-Math.cos(this.yaw);
      const start=this.camera.position.clone();
      for(let d=.35;d<=5;d+=.35){
        const nx=start.x+fx*d,nz=start.z+fz*d;
        if(!playableAt(nx,nz)||this.isBlocked(nx,nz))break;
        this.camera.position.set(nx,terrainHeight(nx,nz)+PLAYER_HEIGHT,nz);
      }
      if(Math.hypot(this.camera.position.x-start.x,this.camera.position.z-start.z)<1){this.setMessage('DASH BLOCKED');return;}
      this.velocityY=0;
    } else if(this.agentId==='aegis'){
      if(this.health>=100){this.setMessage('ALREADY FULL HEALTH');return;}
      this.health=Math.min(100,this.health+35);
    } else if(this.agentId==='lumen'){
      this.reconUntil=now+7000;
    } else if(this.agentId==='bastion'){
      this.armor=Math.min(85,this.armor+35);
    }
    this.abilityReadyAt=now+AGENTS[this.agentId].cooldown*1000;
    this.spawnAbilityEffect(this.agentId,this.camera.position.x,this.camera.position.z);
    this.setMessage(`${AGENTS[this.agentId].ability} ACTIVATED`,2);
    this.pushHud(true);
  }

  bindEvents() {
    this.handleKeyDown = (event) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      this.keys[event.code] = true;
      if (event.repeat) return;
      if (event.code === 'KeyB') {
        this.buildMode = !this.buildMode;
        if(!this.buildMode && this.preview) this.preview.visible = false;
        this.setMessage(this.buildMode ? 'BUILD MODE' : 'COMBAT MODE');
        this.pushHud(true);
      }
      if (event.code === 'Digit1') this.selectBuild('wall');
      if (event.code === 'Digit2') this.selectBuild('floor');
      if (event.code === 'Digit3') this.selectBuild('ramp');
      if (event.code === 'Digit4') this.selectBuild('roof');
      if (event.code === 'KeyQ' && this.buildMode) this.setMessage('BUILD FOLLOWS YOUR FACING');
      if (event.code === 'KeyX' && this.buildMode) { this.buildLevelOffset = this.buildLevelOffset + 2; this.setMessage(`BUILD LAYER +${this.buildLevelOffset}m`); }
      if (event.code === 'KeyZ' && this.buildMode) { this.buildLevelOffset = Math.max(-24, this.buildLevelOffset - 2); this.setMessage(`BUILD LAYER ${this.buildLevelOffset >= 0 ? '+' : ''}${this.buildLevelOffset}m`); }
      if (event.code === 'KeyR' && !this.buildMode) this.reload();
      if (event.code === 'KeyC' && !this.buildMode) this.useAbility('signature');
      if (event.code === 'KeyQ' && !this.buildMode) this.useAbility('q');
      if (event.code === 'KeyF' && !this.buildMode) this.useAbility('f');
      if (event.code === 'KeyV' && !this.buildMode) this.useAbility('ultimate');
      if (event.code === 'KeyN' && this.network) this.network.emit('restartRound');
      if (event.code === 'Space' && this.grounded && this.health > 0 && !this.roundResult) { this.velocityY = 7.2; this.grounded = false; }
    };
    this.handleKeyUp = (event) => { this.keys[event.code] = false; };
    this.handleMouseMove = (event) => {
      if (document.pointerLockElement !== this.renderer.domElement) return;
      this.yaw -= event.movementX * this.sensitivity;
      this.pitch -= event.movementY * this.sensitivity;
      this.pitch = clamp(this.pitch, -1.42, 1.42);
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    };
    this.handleMouseDown = (event) => {
      if (event.button !== 0) return;
      if (document.pointerLockElement !== this.renderer.domElement) {
        this.renderer.domElement.requestPointerLock?.();
        this.setMessage('MOUSE CAPTURED — GOOD LUCK');
        return;
      }
      if (this.buildMode) this.placeBuild();
      else { this.mouseHeld = true; this.fire(); }
    };
    this.handleMouseUp = (event) => { if (event.button === 0) this.mouseHeld = false; };
    this.handleContext = (event) => {
      event.preventDefault();
      if (this.buildMode) this.setMessage('PLACEMENT CANCELLED');
    };
    this.handlePointerLock = () => {
      if (document.pointerLockElement !== this.renderer.domElement) { this.mouseHeld = false; this.setMessage('CLICK TO CAPTURE MOUSE', 2.4); }
    };
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
    this.renderer.domElement.addEventListener('mousedown', this.handleMouseDown);
    this.renderer.domElement.addEventListener('contextmenu', this.handleContext);
    document.addEventListener('pointerlockchange', this.handlePointerLock);
  }

  selectBuild(kind) {
    if (!this.buildMode) this.buildMode = true;
    this.buildPiece = kind;
    const oldPreview = this.preview;
    this.scene.remove(oldPreview); // old ghost MUST leave the scene before disposal
    oldPreview.geometry.dispose();
    oldPreview.material.dispose();
    this.preview = this.createBuildMesh(kind, true);
    this.scene.add(this.preview);
    this.setMessage(`${BUILD_LABELS[kind]} SELECTED`);
    this.pushHud(true);
  }

  resize() {
    if (!this.container || !this.renderer) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  isBlocked(x, z, footY = this.camera.position.y - PLAYER_HEIGHT) {
    const playerBottom = footY + 0.08;
    const playerTop = footY + PLAYER_HEIGHT;
    for (const item of this.solids) {
      if (item.type === 'ramp') {
        const r = this.surfaces.find(s => s.mesh === item.mesh);
        if (!r) continue;
        const local = new THREE.Vector3(x-r.x,0,z-r.z).applyAxisAngle(new THREE.Vector3(0,1,0),-r.rotation);
        const halfWidth = r.width/2 + PLAYER_RADIUS;
        if (Math.abs(local.x)>halfWidth || Math.abs(local.z)>r.depth/2+PLAYER_RADIUS) continue;
        const zOn = clamp(local.z,-r.depth/2,r.depth/2);
        const rampTop = r.y + ((r.depth/2-zOn)/r.depth)*r.height;
        // Allow the character to step onto a slope from low OR high end; block
        // penetration from below and sideways if the board is above their feet.
        if (rampTop > footY + 0.48 && playerBottom < rampTop - 0.22 && playerTop > rampTop - 0.19) return true;
        continue;
      }
      const b = item.box;
      if (playerTop <= b.min.y + 0.02 || playerBottom >= b.max.y - 0.02) continue;
      const nearestX = clamp(x, b.min.x, b.max.x);
      const nearestZ = clamp(z, b.min.z, b.max.z);
      const dx = x - nearestX;
      const dz = z - nearestZ;
      if (dx * dx + dz * dz < PLAYER_RADIUS * PLAYER_RADIUS) return true;
    }
    return false;
  }

  getSurfaceHeight(x, z, currentFoot) {
    let highest = playableAt(x,z) ? terrainHeight(x,z) : -14.6;
    for (const surface of this.surfaces) {
      if (surface.type === 'platform') {
        if (Math.abs(x - surface.x) <= surface.sx / 2 && Math.abs(z - surface.z) <= surface.sz / 2) {
          if (surface.top <= currentFoot + 0.28 && surface.top > highest) highest = surface.top;
        }
      } else if (surface.type === 'ramp') {
        const local = new THREE.Vector3(x - surface.x, 0, z - surface.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), -surface.rotation);
        if (Math.abs(local.x) <= surface.width / 2 && local.z >= -surface.depth / 2 && local.z <= surface.depth / 2) {
          const rampY = surface.y + ((surface.depth / 2 - local.z) / surface.depth) * surface.height;
          if (rampY <= currentFoot + 0.48 && rampY > highest) highest = rampY;
        }
      }
    }
    return highest;
  }

  updateMovement(delta) {
    if (this.health <= 0 || (!this.network && this.roundResult)) return;
    if (this.network && !['CARRIED','PLANTED'].includes(this.onlinePhase)) return;
    if (!this.network && this.gameMode==='bots' && this.localBuyTimer>0)return;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const move = new THREE.Vector3();
    if (this.keys.KeyW) move.add(forward);
    if (this.keys.KeyS) move.sub(forward);
    if (this.keys.KeyD) move.add(right);
    if (this.keys.KeyA) move.sub(right);
    if (move.lengthSq() > 0) move.normalize();
    const naturalSpeed=this.keys.ShiftLeft||this.keys.ShiftRight?10.3:7.2;
    const passiveSpeed=this.agentId==='rift'?1.08:this.agentId==='ember'?1.06:1;
    const speed=naturalSpeed*passiveSpeed*(Date.now()<this.hasteUntil?1.25:1);
    const dx = move.x * speed * delta;
    const dz = move.z * speed * delta;
    const nextX = clamp(this.camera.position.x + dx, -44.8, 44.8);
    if (!this.isBlocked(nextX, this.camera.position.z)) this.camera.position.x = nextX;
    const nextZ = clamp(this.camera.position.z + dz, -84.4, 84.4);
    if (!this.isBlocked(this.camera.position.x, nextZ)) this.camera.position.z = nextZ;

    const currentFoot = this.camera.position.y - PLAYER_HEIGHT;
    this.velocityY -= 20.5 * delta;
    let nextFoot = currentFoot + this.velocityY * delta;
    const floor = this.getSurfaceHeight(this.camera.position.x, this.camera.position.z, currentFoot);
    if (nextFoot <= floor) {
      nextFoot = floor;
      this.velocityY = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
    this.camera.position.y = nextFoot + PLAYER_HEIGHT;
    if (this.camera.position.y < -16.0) {
      const home = SPAWNS[this.role];
      this.camera.position.set(home.x, PLAYER_HEIGHT, home.z);
      this.velocityY = 0;
      this.setMessage('DEEP DROP · RETURNED TO SPAWN', 2);
    }
  }

  getBuildRotation() {
    // Fortnite-style automatic orientation: pieces snap to the nearest 90-degree
    // direction the player is facing. No manual rotate key is required.
    return Math.round(this.yaw / (Math.PI / 2)) * (Math.PI / 2);
  }

  getBuildPlacement() {
    const forward = new THREE.Vector3(-Math.sin(this.yaw),0,-Math.cos(this.yaw));
    const cellX=gridCoordinate(this.camera.position.x+forward.x*3.65);
    const cellZ=gridCoordinate(this.camera.position.z+forward.z*3.65);
    const foot=this.camera.position.y-PLAYER_HEIGHT;
    const ground=terrainHeight(cellX,cellZ);
    const levels=[ground];
    for(const surf of this.surfaces) {
      if(surf.type==='platform' && Math.abs(cellX-surf.x)<=surf.sx/2+1 && Math.abs(cellZ-surf.z)<=surf.sz/2+1)levels.push(surf.top);
      if(surf.type==='ramp') {
        const high = new THREE.Vector3(0,0,-surf.depth/2).applyAxisAngle(new THREE.Vector3(0,1,0),surf.rotation);
        if(Math.hypot(cellX-surf.x-high.x,cellZ-surf.z-high.z)<2.5) levels.push(surf.y+surf.height);
      }
    }
    const base=levels.reduce((best,h)=>Math.abs(h-foot)<Math.abs(best-foot)?h:best,levels[0]);
    let level=base+this.buildLevelOffset;
    if(levels.length===1 && foot>ground+.8) level=ground+Math.round((foot-ground)/GRID)*GRID+this.buildLevelOffset;
    level=Math.round(level*100)/100;
    return placementFor(this.buildPiece,cellX,cellZ,level,quarterFromYaw(this.yaw));
  }

  validateBuild(position,kind=this.buildPiece) {
    if(!position || !Number.isFinite(position.level) || position.level>5000 || position.level<-25 || !playableAt(position.cellX,position.cellZ)) return false;
    const ground=terrainHeight(position.cellX,position.cellZ);
    if(this.buildings.some(b=>buildConflict(position,{
      kind:b.userData.kind,cellX:b.userData.cellX??b.position.x,
      cellZ:b.userData.cellZ??b.position.z,level:b.userData.level,key:b.userData.buildKey||b.userData.key
    })))return false;
    if(position.level>ground+.45 && !supportsBuild(position,this.buildings.map(b=>({
      kind:b.userData.kind,cellX:b.userData.cellX??b.position.x,
      cellZ:b.userData.cellZ??b.position.z,level:b.userData.level
    })),this.surfaces))return false;
    // Map architecture is physical. Subtract a small edge tolerance so built
    // floors may touch a wall or ramp landing without collision rejection.
    const quarter=Math.abs(Math.sin(position.rotation))>.5;
    let sx=2,sz=kind==='wall'?.16:2;
    if(quarter)[sx,sz]=[sz,sx];
    const minY=kind==='wall'?position.level+.15:kind==='ramp'?position.level+.15:position.level-.035;
    const maxY=kind==='wall'?position.level+2:kind==='ramp'?position.level+1.83:position.level+.035;
    const candidate=new THREE.Box3(
      new THREE.Vector3(position.x-sx/2+.08,minY,position.z-sz/2+.08),
      new THREE.Vector3(position.x+sx/2-.08,maxY,position.z+sz/2-.08));
    for(const solid of this.solids){
      if(solid.mesh.userData.buildRoot)continue;
      if(candidate.intersectsBox(solid.box))return false;
    }
    return true;
  }

  updateBuildPreview() {
    if (!this.preview) return;
    if (!this.buildMode) { this.preview.visible = false; return; }
    const p = this.getBuildPlacement();
    this.preview.visible = true;
    this.preview.position.set(p.x, p.y, p.z);
    this.preview.rotation.set(0, p.rotation, 0);
    this.previewValid = this.validateBuild(p) && this.materials >= BUILD_COSTS[this.buildPiece];
    this.preview.material.color.set(this.previewValid ? '#79e2a8' : '#e66d65');
  }

  placeBuild() {
    if (this.health <= 0 || (!this.network && this.roundResult)) return;
    if (this.network && !['CARRIED','PLANTED'].includes(this.onlinePhase)) return;
    if (!this.buildMode) return;
    const p = this.getBuildPlacement();
    if (!this.validateBuild(p)) { this.setMessage('CANNOT BUILD HERE'); return; }
    const cost = BUILD_COSTS[this.buildPiece];
    if (this.materials < cost) { this.setMessage('NOT ENOUGH MATERIALS'); return; }
    this.materials -= cost;
    const kind = this.buildPiece;
    const mesh = this.createBuildMesh(kind, false);
    mesh.position.set(p.x, p.y, p.z);
    mesh.rotation.y = p.rotation;
    mesh.userData.kind = kind;
    mesh.userData.buildRoot = mesh;
    mesh.userData.health = 120;
    mesh.userData.level = p.level;
    mesh.userData.cellX = p.cellX;mesh.userData.cellZ = p.cellZ;mesh.userData.buildKey=p.key;
    this.scene.add(mesh);
    this.buildings.push(mesh);
    if (kind === 'wall') {
      this.addCollider(mesh, { type: 'box', build: true });
    } else if (kind === 'floor' || kind === 'roof') {
      this.addCollider(mesh, { type: 'box', build: true });
      this.surfaces.push({ type: 'platform', x: p.x, z: p.z, top: p.level, sx: 2, sz: 2, mesh });
    } else {
      this.addCollider(mesh, {type:'ramp', ramp:true}); // Solid plank, including its underside; walkable top.
      this.surfaces.push({ type: 'ramp', x: p.x, z: p.z, y: p.y, rotation: p.rotation, width: 2, depth: 2, height: 2, mesh });
    }
    if (this.network) this.network.emit('build', {kind, x:p.x, y:p.y, z:p.z, rotation:p.rotation, level:p.level,cellX:p.cellX,cellZ:p.cellZ,quarter:quarterFromYaw(this.yaw)});
    this.setMessage(`${BUILD_LABELS[kind]} PLACED · −${cost} MATERIAL`);
    this.pushHud(true);
  }

  createSpikeVisual(site) {
    if (this.spikeVisual) {
      this.scene.remove(this.spikeVisual);
      this.spikeVisual.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    }
    const point = this.siteCenters[site];
    const group = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.48, 0.16, 8), this.material('#263b3d', 0.42, 0.55));
    base.position.y = 0.12;
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), new THREE.MeshStandardMaterial({ color: '#e6a46f', emissive: '#a94e24', emissiveIntensity: 1.25, roughness: 0.28, metalness: 0.3 }));
    core.position.y = 0.72;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 8, 28), new THREE.MeshBasicMaterial({ color: '#f3c18d' }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.24;
    group.add(base, core, ring);
    group.position.set(point.x, terrainHeight(point.x,point.z)+0.04, point.z);
    group.userData.core = core;
    this.scene.add(group);
    this.spikeVisual = group;
  }

  removeSpikeVisual() {
    if (!this.spikeVisual) return;
    this.scene.remove(this.spikeVisual);
    this.spikeVisual.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    this.spikeVisual = null;
  }

  nearestSite() {
    let nearest = null;
    let nearestDistance = Infinity;
    for (const [name, point] of Object.entries(this.siteCenters)) {
      const distance = Math.hypot(this.camera.position.x - point.x, this.camera.position.z - point.z);
      if (distance < nearestDistance) { nearest = name; nearestDistance = distance; }
    }
    return nearestDistance <= 4.8 ? nearest : null;
  }

  finishRound(result, message) {
    if (this.roundResult) return;
    this.roundResult = result;
    this.objectiveState = 'ROUND_OVER';
    this.keys.KeyE = false;
    const winner = result.includes('ATTACKERS') ? 'ATTACKERS' : result.includes('DEFENDERS') ? 'DEFENDERS' : null;
    if (winner) {
      this.score[winner] += 1;
      this.credits=clampCredits(this.credits+(winner===this.role?2800:1900));
    this.ultimatePoints=Math.min(AGENTS[this.agentId].ultimate.cost,this.ultimatePoints+1);
    }
    if (!this.network) this.roundResetTimer = 4.2;
    this.setMessage(message, 6);
    this.pushHud(true);
  }

  setupObjectiveForMode() {
    this.roundResult = '';
    this.plantProgress = 0;
    this.defuseProgress = 0;
    this.bombTimer = 35;
    this.roundTimer = 100;
    this.removeSpikeVisual();
    if(this.gameMode==='bots')this.localBuyTimer=18;
    if (this.gameMode === 'defendDrill') {
      this.objectiveState = 'PLANTED';
      this.objectiveSite = 'A';
      this.createSpikeVisual('A');
      if (this.role === 'DEFENDERS') {
        const spawn = this.spawnPoints.defenders[0];
        this.camera.position.set(spawn.x, spawn.y, spawn.z);
        this.yaw = SPAWNS.DEFENDERS.yaw;
      }
    } else {
      this.objectiveState = 'CARRIED';
      this.objectiveSite = 'A';
      if (this.role === 'ATTACKERS') {
        const spawn = this.spawnPoints.attackers[0];
        this.camera.position.set(spawn.x, spawn.y, spawn.z);
        this.yaw = SPAWNS.ATTACKERS.yaw;
      } else {
        const spawn = this.spawnPoints.defenders[0];
        this.camera.position.set(spawn.x, spawn.y, spawn.z);
        this.yaw = SPAWNS.DEFENDERS.yaw;
      }
    }
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  resetRoundLocal() {
    this.roundResetTimer = 0;
    this.abilityReadyAt=0;
    this.reconUntil=0;
    this.charges={q:0,f:0};this.armor=0;this.hasteUntil=0;this.flashUntil=0;
    this.health = 100;
    this.equipWeapon('sidearm');
    this.materials = 300;
    this.playerRespawnTimer = 0;
    this.velocityY = 0;
    this.buildMode = false;
    if(this.preview) this.preview.visible = false;
    this.mouseHeld = false;
    this.keys.KeyE = false;
    for (const b of this.buildings) this.scene.remove(b);
    this.solidMeshes = this.solidMeshes.filter((m) => !m.userData.buildRoot);
    this.solids = this.solids.filter((s) => !s.mesh.userData.buildRoot);
    this.surfaces = this.surfaces.filter((s) => !s.mesh.userData.buildRoot);
    this.buildings = [];
    this.setupObjectiveForMode();
    for (const bot of this.targets) this.respawnBot(bot);
    this.localSpikeCarrier=this.role==='ATTACKERS'?'YOU':this.targets.find(b=>b.userData.team==='ATTACKERS')?.userData.botName||null;
    this.setMessage('NEW ROUND · MOVE OUT', 2.0);
  }

  updateObjective(delta) {
    if (this.network) return;
    if (this.roundResetTimer > 0) {
      this.roundResetTimer -= delta;
      if (this.roundResetTimer <= 0) this.resetRoundLocal();
      return;
    }
    if (this.roundResult) return;
    if(this.gameMode==='bots'&&this.localBuyTimer>0){this.localBuyTimer=Math.max(0,this.localBuyTimer-delta);return;}

    const site = this.nearestSite();
    const attackers = this.targets.filter(bot => bot.userData.alive && bot.userData.team === 'ATTACKERS');
    const defenders = this.targets.filter(bot => bot.userData.alive && bot.userData.team === 'DEFENDERS');
    const playerAlive = this.health > 0;
    if(this.localSpikeCarrier==='YOU'&&!playerAlive)this.localSpikeCarrier=attackers[0]?.userData.botName||null;
    if(this.localSpikeCarrier!==null&&this.localSpikeCarrier!=='YOU'&&!attackers.some(b=>b.userData.botName===this.localSpikeCarrier))this.localSpikeCarrier=attackers[0]?.userData.botName||null;
    const attackCount = attackers.length + (playerAlive && this.role === 'ATTACKERS' ? 1 : 0);
    const defendCount = defenders.length + (playerAlive && this.role === 'DEFENDERS' ? 1 : 0);
    if (this.gameMode !== 'bots') {
      if (defendCount === 0) { this.finishRound('ATTACKERS WIN', 'DEFENDER TEAM ELIMINATED'); return; }
      if (attackCount === 0 && this.objectiveState === 'CARRIED') { this.finishRound('DEFENDERS WIN', 'ATTACKERS ELIMINATED'); return; }
    }

    for (const bot of this.targets) bot.userData.usingSpike = false;
    if (this.objectiveState === 'CARRIED') {
      this.roundTimer = Math.max(0, this.roundTimer - delta);
      if (this.roundTimer <= 0) {
        this.finishRound('DEFENDERS WIN', 'ROUND OVER · DEFENDERS HOLD');
        return;
      }
      if (site && this.role === 'ATTACKERS' && this.localSpikeCarrier==='YOU' && playerAlive && this.keys.KeyE) {
        this.plantProgress = Math.min(2.6, this.plantProgress + delta);
        if (this.plantProgress >= 2.6) {
          this.objectiveState = 'PLANTED';
          this.objectiveSite = site;
          this.bombTimer = 35;
          this.plantProgress = 0;
          this.createSpikeVisual(site);
          this.setMessage(`SPIKE PLANTED · ${site} SITE`, 3);
          return;
        }
      } else this.plantProgress = 0;
      for (const bot of attackers) {
        const b = bot.userData;
        if(b.botName!==this.localSpikeCarrier)continue;
        const botSite = Object.entries(SITES).find(([,site])=>
          Math.hypot(bot.position.x-site.x,bot.position.z-site.z)<3.3)?.[0]||null;
        const contested = b.enemy && Math.hypot(b.enemy.position.x - bot.position.x, b.enemy.position.z - bot.position.z) < 11;
        if (botSite && !contested && !this.keys.KeyE) {
          b.usingSpike = true;
          b.plantProgress = Math.min(2.6, (b.plantProgress || 0) + delta);
          if (b.plantProgress >= 2.6) {
            this.objectiveState = 'PLANTED';
            this.objectiveSite = botSite;
            this.bombTimer = 35;
            this.createSpikeVisual(botSite);
            this.setMessage(`${b.botName} PLANTED THE SPIKE · SITE ${botSite}`, 3);
            this.killFeed.unshift({ id: ++this.killId, killer: b.botName, victim: `PLANTED ${botSite}`, team: b.team, created: performance.now() });
            return;
          }
        } else b.plantProgress = 0;
      }
    } else if (this.objectiveState === 'PLANTED') {
      this.bombTimer = Math.max(0, this.bombTimer - delta);
      if (this.role === 'DEFENDERS' && site === this.objectiveSite && playerAlive && this.keys.KeyE) {
        this.defuseProgress = Math.min(4, this.defuseProgress + delta);
        if (this.defuseProgress >= 4) {
          this.removeSpikeVisual();
          this.finishRound('DEFENDERS WIN', 'SPIKE DEFUSED · DEFENDERS WIN');
          return;
        }
      } else this.defuseProgress = 0;
      for (const bot of defenders) {
        const b = bot.userData;
        const objective = SITES[this.objectiveSite];
        const d = Math.hypot(bot.position.x - objective.x, bot.position.z - objective.z);
        const contested = b.enemy && Math.hypot(b.enemy.position.x - bot.position.x, b.enemy.position.z - bot.position.z) < 11;
        if (d < 3.4 && !contested && !(this.role === 'DEFENDERS' && this.keys.KeyE)) {
          b.usingSpike = true;
          b.defuseProgress = Math.min(4, (b.defuseProgress || 0) + delta);
          if (b.defuseProgress >= 4) {
            this.removeSpikeVisual();
            this.finishRound('DEFENDERS WIN', `${b.botName} DEFUSED THE SPIKE`);
            return;
          }
        } else b.defuseProgress = 0;
      }
      if (this.bombTimer <= 0) {
        this.finishRound('ATTACKERS WIN', 'SPIKE DETONATED · ATTACKERS WIN');
        return;
      }
    }
    if (this.spikeVisual?.userData.core) {
      const pulse = 1 + Math.sin(performance.now() * 0.008) * 0.08;
      this.spikeVisual.userData.core.scale.setScalar(pulse);
    }
  }

  objectiveHud() {
    let objective = this.gameMode === 'bots' ? `BOT MATCH · ATK ${this.score.ATTACKERS} — ${this.score.DEFENDERS} DEF` : 'SPIKE: CARRIED';
    let actionHint = this.gameMode === 'bots' ? 'LIVE SANDBOX MATCH · BOTS RESPAWN' : 'FIND SITE A OR B · HOLD E TO PLANT';
    let timer = this.roundTimer;
    let progress = 0;
    if (this.objectiveState === 'PLANTED') {
      objective = `SPIKE PLANTED · SITE ${this.objectiveSite} · ATK ${this.score.ATTACKERS} — ${this.score.DEFENDERS} DEF`;
      timer = this.bombTimer;
      if (this.role === 'DEFENDERS') {
        actionHint = this.nearestSite() === this.objectiveSite ? 'HOLD E TO DEFUSE' : `REACH SITE ${this.objectiveSite} · HOLD E TO DEFUSE`;
        progress = this.defuseProgress / 4;
      } else {
        actionHint = 'DEFEND THE PLANTED SPIKE';
      }
    } else if (this.objectiveState === 'CARRIED') {
      const site = this.nearestSite();
      actionHint = site && this.role === 'ATTACKERS' ? `HOLD E TO PLANT AT SITE ${site}` : this.role === 'ATTACKERS' ? 'FIND SITE A OR B · HOLD E TO PLANT' : 'HOLD THE SITES · ELIMINATE ATTACKERS';
      progress = this.plantProgress / 2.6;
    } else if (this.objectiveState === 'ROUND_OVER') {
      objective = `${this.roundResult} · ATK ${this.score.ATTACKERS} — ${this.score.DEFENDERS} DEF`;
      actionHint = this.roundResetTimer > 0 ? 'RESETTING ROUND...' : 'ROUND COMPLETE';
      timer = this.roundResetTimer;
    }
    if(this.gameMode==='bots'&&this.localBuyTimer>0){
      objective=`BUY PHASE · ROUND ${this.score.ATTACKERS+this.score.DEFENDERS+1}`;
      actionHint='PRESS M OR CLICK SHOP · WEAPONS RESET EACH ROUND';
      timer=this.localBuyTimer;
    }
    const seconds = Math.max(0, Math.ceil(timer));
    return {
      role: this.role,
      objective,
      actionHint,
      clock: `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`,
      objectiveProgress: progress,
      roundResult: this.roundResult,
      canBuy:this.gameMode!=='bots'||this.localBuyTimer>0,
      phase:this.gameMode==='bots'&&this.localBuyTimer>0?'PRE_ROUND':this.objectiveState
    };
  }

  fire() {
    if(this.health<=0||(!this.network&&this.roundResult))return;
    if(this.network&&!['CARRIED','PLANTED'].includes(this.onlinePhase))return;
    if(!this.network&&this.gameMode==='bots'&&this.localBuyTimer>0)return;
    if(this.weaponCooldown>0||this.reloading)return;
    if(this.ammo<=0){this.reload();return}
    const w=weaponById(this.weaponId);
    this.ammo--;
    this.weaponCooldown=w.rate;
    this.weaponGroup.position.z=-.56;
    this.muzzle.material.opacity=.9;
    this.muzzle.scale.setScalar(1.2+Math.random()*.5);
    const origin=this.camera.position.clone();
    const forward=this.camera.getWorldDirection(new THREE.Vector3()).normalize();
    const right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();
    const up=new THREE.Vector3().crossVectors(right,forward).normalize();
    const start=origin.clone().add(forward.clone().multiplyScalar(.65));
    const active=this.targetParts.filter(part=>part.userData.targetRoot?.userData?.alive&&part.userData.targetRoot.userData.team!==this.role);
    const objects=[...this.solidMeshes,...active];
    const damageByTarget=new Map();
    let bestEnd=null;
    for(let n=0;n<w.pellets;n++){
      const driftX=(Math.random()-.5)*2*w.spread;
      const driftY=(Math.random()-.5)*2*w.spread;
      const aim=forward.clone().addScaledVector(right,driftX).addScaledVector(up,driftY).normalize();
      this.raycaster.set(origin,aim);
      this.raycaster.far=w.range;
      const hits=this.raycaster.intersectObjects(objects,false);
      let end=origin.clone().addScaledVector(aim,w.range);
      if(hits.length){
        const hit=hits[0];end=hit.point.clone();
        const root=hit.object.userData.targetRoot;
        if(root?.userData.alive){
          const falloff=w.id==='shotgun'?Math.max(.18,1-hit.distance/w.range):1;
          damageByTarget.set(root,(damageByTarget.get(root)||0)+w.damage*falloff);
          this.spawnHitSpark(end);
        }else{
          const buildRoot=hit.object.userData.buildRoot;
          if(buildRoot){
            buildRoot.userData.health-=w.damage;
            if(buildRoot.userData.health<=0){
              this.scene.remove(buildRoot);
              this.buildings=this.buildings.filter(b=>b!==buildRoot);
              this.solidMeshes=this.solidMeshes.filter(b=>b!==buildRoot);
              this.solids=this.solids.filter(b=>b.mesh!==buildRoot);
              this.surfaces=this.surfaces.filter(b=>b.mesh!==buildRoot);
            }
          }
        }
      }
      if(n===0)bestEnd=end;
      if(n<4)this.spawnTracer(start,end);
    }
    for(const [target,damage] of damageByTarget)this.applyBotDamage(target,Math.round(damage),{userData:{team:this.role,botName:'YOU'}});
    if(this.network)this.network.emit('shoot',{direction:forward.toArray()});
    this.pushHud(true);
  }

  spawnAbilityEffect(agent,x,z) {
    if(this.isDisposed)return;
    const color=AGENTS[validAgent(agent)].color;
    const pulse=new THREE.Mesh(
      new THREE.RingGeometry(.42,.58,36),
      new THREE.MeshBasicMaterial({color,transparent:true,opacity:.86,side:THREE.DoubleSide,depthWrite:false})
    );
    pulse.rotation.x=-Math.PI/2;
    pulse.position.set(x,terrainHeight(x,z)+.15,z);
    this.scene.add(pulse);
    this.effects.push({object:pulse,life:.62,maxLife:.62,expand:true});
  }

  spawnTracer(start, end) {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#f5d39c', transparent: true, opacity: 0.85 }));
    this.scene.add(line);
    this.effects.push({ object: line, life: 0.075, maxLife: 0.075 });
  }

  spawnHitSpark(position) {
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color: '#ffe0a3' }));
    spark.position.copy(position);
    this.scene.add(spark);
    this.effects.push({ object: spark, life: 0.18, maxLife: 0.18 });
  }

  reload() {
    const w=weaponById(this.weaponId);
    if(this.reloading||this.ammo===w.magazine||this.reserve<=0)return;
    this.reloading=true;this.reloadTimer=w.reload;
    this.setMessage('RELOADING');
    if(this.network){
      this.network.emit('reload',{},result=>{
        if(result?.ok){this.ammo=result.ammo;this.reserve=result.reserve;}
        this.pushHud(true);
      });
    }
  }

  updateReload(delta) {
    if(!this.reloading)return;
    this.reloadTimer-=delta;
    if(this.reloadTimer>0)return;
    const w=weaponById(this.weaponId);
    const load=Math.min(w.magazine-this.ammo,this.reserve);
    this.ammo+=load;this.reserve-=load;
    this.reloading=false;
    this.setMessage(`${w.name} READY`);
    this.pushHud(true);
  }

  updateEffects(delta) {
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i];
      effect.life -= delta;
      if(effect.expand)effect.object.scale.setScalar(1+(1-Math.max(0,effect.life)/effect.maxLife)*4);
      if (effect.object.material?.opacity !== undefined) effect.object.material.opacity = Math.max(0, effect.life / effect.maxLife);
      if (effect.life <= 0) {
        this.scene.remove(effect.object);
        effect.object.geometry?.dispose();
        effect.object.material?.dispose();
        this.effects.splice(i, 1);
      }
    }
    if (this.weaponCooldown > 0) this.weaponCooldown = Math.max(0, this.weaponCooldown - delta);
    if (this.muzzle.material.opacity > 0) this.muzzle.material.opacity = Math.max(0, this.muzzle.material.opacity - delta * 12);
    this.weaponGroup.position.z += (-0.66 - this.weaponGroup.position.z) * Math.min(1, delta * 18);
    this.updateReload(delta);
  }

  pushHud(force = false) {
    const now = performance.now();
    if (!force && now - this.lastHudAt < 160) return;
    this.lastHudAt = now;
    const allies = this.network ? [...this.remotePlayers.values()].filter(a => a.visible && a.userData.team === this.role) : this.targets.filter(bot => bot.userData.alive && bot.userData.team === this.role);
    const hostiles = this.network ? [...this.remotePlayers.values()].filter(a => a.visible && a.userData.team !== this.role) : this.targets.filter(bot => bot.userData.alive && bot.userData.team !== this.role);
    this.killFeed = this.killFeed.filter(entry => now - entry.created < 8500);
    const reconCenters=this.network?this.reconCenters||[]:(Date.now()<this.reconUntil?[{x:this.camera.position.x,z:this.camera.position.z}]:[]);
    const revealed=(x,z)=>reconCenters.some(p=>Math.hypot(p.x-x,p.z-z)<=25)||
      (this.agentId==='lumen'&&Math.hypot(this.camera.position.x-x,this.camera.position.z-z)<9);
    const mapPlayers = this.network ? [...this.remotePlayers.values()].filter(a => a.visible).map(a => ({
      team: a.userData.team || 'DEFENDERS', x: a.position.x, z: a.position.z, id:a.userData.netId, name: 'OPERATIVE'
    })).filter(a => a.team === this.role || revealed(a.x,a.z)) : this.targets.filter(bot => bot.userData.alive).map(bot => ({
      team: bot.userData.team, x: bot.position.x, z: bot.position.z, id:bot.userData.botName, name: bot.userData.botName
    })).filter(a=>a.team===this.role || revealed(a.x,a.z));
    this.onHud?.({
      health: Math.round(this.health),
      kitCharges:{...this.charges},ultimatePoints:this.ultimatePoints,armor:this.armor,
      flashRemaining:Math.max(0,(this.flashUntil-Date.now())/1000),
      ammo: this.ammo,
      reserve: this.reserve,
      materials: this.materials,
      weapon: weaponById(this.weaponId).name,
      weaponId:this.weaponId,
      credits:this.credits,
      canBuy:this.network?this.onlinePhase==='PRE_ROUND':this.gameMode!=='bots'||this.localBuyTimer>0,
      mode: this.buildMode ? 'BUILD' : 'COMBAT',
      buildPiece: BUILD_LABELS[this.buildPiece],
      buildLayer: this.buildLevelOffset,
      targets: hostiles.length,
      allies: allies.length + (this.health > 0 ? 1 : 0),
      enemies: hostiles.length,
      kills: this.kills,
      deaths: this.deaths,
      score: { ...this.score },
      role: this.role,
      agentId:this.agentId,
      abilityCooldown:Math.max(0,(this.abilityReadyAt-Date.now())/1000),
      agentLocked:!!this.agentLocked,
      location: areaAt(this.camera.position.x, this.camera.position.z),
      mapPlayer: { x: this.camera.position.x, z: this.camera.position.z, yaw: this.yaw },
      mapPlayers,
      feed: this.killFeed,
      respawn: Math.max(0, this.playerRespawnTimer),
      damageFlash: this.damageFlash,
      spikeSite: this.network ? this.onlineSpikeSite : this.objectiveState === 'PLANTED' ? this.objectiveSite : null,
      isSpikeCarrier: this.network ? this.isSpikeCarrier : this.localSpikeCarrier==='YOU'&&this.objectiveState==='CARRIED',
      spikeCarrierId: this.network ? this.spikeCarrierId : this.localSpikeCarrier,
      carrierLabel: this.network ? (this.spikeCarrierId ? (this.isSpikeCarrier?'YOU':`${this.role==='ATTACKERS'?'ALLY':'ATTACKER'} ${this.spikeCarrierId.slice(0,4)}`) : 'NONE') : this.localSpikeCarrier||'NONE',
      ...(this.network ? (this.onlineObjective || {
        role: this.role, objective: 'CONNECTING TO ROOM', actionHint: 'WAITING FOR PLAYERS',
        clock: '--:--', objectiveProgress: 0, roundResult: ''
      }) : this.objectiveHud()),
      message: this.messageTimer > 0 ? this.message : ''
    });
  }

  animate = () => {
    if (this.isDisposed) return;
    this.frameId = requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.04);
    this.updateMovement(delta);
    if (!this.network) this.updateBots(delta);
    this.updateNetwork(delta);
    if (!this.network) this.updateObjective(delta);
    this.updateBuildPreview();
    if (this.mouseHeld && !this.buildMode && weaponById(this.weaponId).automatic && document.pointerLockElement === this.renderer.domElement) this.fire();
    this.updateEffects(delta);
    for(const bot of this.targets)if(bot.userData.alive)animateAgent(bot,delta);
    for(const avatar of this.remotePlayers.values())if(avatar.visible)animateAgent(avatar,delta,avatar.userData.networkVelocity || 0);
    this.damageFlash = Math.max(0, this.damageFlash - delta);
    if (this.messageTimer > 0) this.messageTimer -= delta;
    this.pushHud();
    this.renderer.render(this.scene, this.camera);
  };

  makeRemoteAvatar(id, role, agent='rift') {
    const group = new THREE.Group();
    const suit = this.material(role === 'DEFENDERS' ? '#4c9b9c' : '#bb7158',0.6,0.17);
    const metal = this.material('#233b46',0.55,0.22);
    const piece = (geo,mat,x,y,z) => {const mesh=new THREE.Mesh(geo,mat);mesh.position.set(x,y,z);mesh.castShadow=true;group.add(mesh);return mesh;};
    piece(new THREE.BoxGeometry(0.72,0.85,0.42),suit,0,1.2,0);
    piece(new THREE.BoxGeometry(0.56,0.25,0.48),metal,0,1.42,-0.06);
    piece(new THREE.SphereGeometry(0.31,12,10),metal,0,1.94,0);
    for(const x of [-0.23,0.23]) { piece(new THREE.BoxGeometry(0.25,0.8,0.3),suit,x,0.46,0);piece(new THREE.BoxGeometry(0.25,0.3,0.32),metal,x,0.16,-0.06); }
    for(const x of [-0.5,0.5]) piece(new THREE.BoxGeometry(0.25,0.74,0.32),suit,x,1.16,0);
    piece(new THREE.BoxGeometry(0.14,0.14,0.72),metal,0.3,1.14,-0.50);
    group.userData.netId=id;
    group.userData.team=role;
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.45,.048,7,24),
      new THREE.MeshBasicMaterial({color:role==='ATTACKERS'?'#e98862':'#5ccde2',depthTest:true}));
    ring.position.y=2.37;ring.rotation.x=Math.PI/2;ring.userData.agentIndicator=true;group.add(ring);
    const marker=new THREE.Mesh(new THREE.OctahedronGeometry(.25),new THREE.MeshBasicMaterial({color:'#ffe581'}));
    marker.position.y=3.0;marker.visible=false;marker.userData.agentIndicator=true;group.add(marker);
    group.userData.carrierTag=marker;
    this.scene.add(group);
    attachAgentModel(group,agent,{isDisposed:()=>this.isDisposed});
    return group;
  }

  bindNetwork() {
    if (!this.network) return;
    for (const piece of (this.network.initialBuilds || [])) this.onBuildPlacedPending = [...(this.onBuildPlacedPending || []), piece];
    this.onSnapshot = (state) => {
      this.onlineObjective = state.objective;
      this.onlinePhase = state.phase;
      this.spikeCarrierId=state.spikeCarrier||null;
      this.reconCenters=state.players.filter(p=>p.role===this.role&&p.reconUntil>Date.now()).map(p=>({x:p.x,z:p.z}));
      this.isSpikeCarrier=this.role==='ATTACKERS'&&this.spikeCarrierId===this.network.id;
      const self = state.players.find(p => p.id === this.network.id);
      if (self) {
        const formerRole = this.role;
        this.role = self.role;
        this.isSpikeCarrier=!!this.spikeCarrierId&&this.spikeCarrierId===this.network.id;
        this.health = self.health;
        this.kills = self.kills ?? this.kills;
        this.deaths = self.deaths ?? this.deaths;
        if(Number.isFinite(self.credits))this.credits=self.credits;
        if(self.weapon&&self.weapon!==this.weaponId)this.equipWeapon(self.weapon,self.ammo,self.reserve);
        // Ammo is server-owned; sync whenever it changes.
        if(Number.isFinite(self.ammo)&&!this.reloading)this.ammo=self.ammo;
        if(Number.isFinite(self.reserve)&&!this.reloading)this.reserve=self.reserve;
        this.playerTarget.userData.team = this.role;
        if(self.agent)this.agentId=validAgent(self.agent);
        if(Number.isFinite(self.abilityReadyAt))this.abilityReadyAt=self.abilityReadyAt;
        if(Number.isFinite(self.reconUntil))this.reconUntil=self.reconUntil;
        if(self.charges)this.charges={...self.charges};
        if(Number.isFinite(self.ultimatePoints))this.ultimatePoints=self.ultimatePoints;
        if(Number.isFinite(self.armor))this.armor=self.armor;
        if(Number.isFinite(self.hasteUntil))this.hasteUntil=self.hasteUntil;
        if(Number.isFinite(self.flashUntil))this.flashUntil=self.flashUntil;
        this.agentLocked=!!self.agentLocked;
        if (Number.isInteger(state.roundSerial) && state.roundSerial !== this.onlineRoundSerial) {
          this.onlineRoundSerial = state.roundSerial;
          this.camera.position.set(self.x, self.y + PLAYER_HEIGHT, self.z);
          this.yaw = self.yaw;
          this.pitch = 0;
          this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
          this.equipWeapon(self.weapon||'sidearm',self.ammo,self.reserve);this.materials=300;this.velocityY=0;
          this.reloading=false;this.weaponCooldown=0;this.buildMode=false;this.mouseHeld=false;
          if(this.preview) this.preview.visible=false;
          this.setMessage(state.phase === 'PRE_ROUND' ? `ROUND ${state.objective?.round ?? 1} · PREPARE` : 'ROUND LIVE',2);
        }
        if(formerRole !== this.role) this.setMessage(`SIDES SWITCHED · ${this.role}`,3);
      }
      if (state.spikeSite !== this.onlineSpikeSite) {
        this.onlineSpikeSite = state.spikeSite;
        if (this.onlineSpikeSite) this.createSpikeVisual(this.onlineSpikeSite);
        else this.removeSpikeVisual();
      }
      const live = new Set();
      for (const peer of state.players) {
        if (peer.id === this.network.id) continue;
        live.add(peer.id);
        let avatar = this.remotePlayers.get(peer.id);
        if (avatar && avatar.userData.team !== peer.role) {
          this.scene.remove(avatar);
          this.remotePlayers.delete(peer.id);
          avatar = null;
        }
        if (!avatar) { avatar=this.makeRemoteAvatar(peer.id,peer.role,peer.agent||'rift');this.remotePlayers.set(peer.id,avatar); }
        if(peer.agent && avatar.userData.agent!==peer.agent)attachAgentModel(avatar,peer.agent,{isDisposed:()=>this.isDisposed});
        avatar.visible = peer.health > 0;
        const now=performance.now();
        const elapsed=Math.max(.05,(now-(avatar.userData.lastNetworkAt||now-120))/1000);
        avatar.userData.networkVelocity=Math.min(12,Math.hypot(peer.x-avatar.position.x,peer.z-avatar.position.z)/elapsed);
        avatar.userData.lastNetworkAt=now;
        avatar.position.set(peer.x,peer.y,peer.z);
        avatar.rotation.y = peer.yaw;
        if(avatar.userData.carrierTag)avatar.userData.carrierTag.visible=peer.id===this.spikeCarrierId;
      }
      for(const [id,avatar] of this.remotePlayers) if(!live.has(id)){
        this.scene.remove(avatar);this.remotePlayers.delete(id);
      }
    };
    this.onBuildPlaced = (data) => {
      if(this.netBuildIds.has(data.id)) return;
      this.netBuildIds.add(data.id);
      if(data.owner===this.network.id) return;
      const mesh=this.createBuildMesh(data.kind);
      mesh.position.set(data.x,data.y,data.z);mesh.rotation.y=data.rotation;
      mesh.userData={kind:data.kind,level:data.level,cellX:data.cellX??data.x,cellZ:data.cellZ??data.z,buildKey:data.key,buildRoot:mesh,health:120};
      this.scene.add(mesh);this.buildings.push(mesh);
      this.addCollider(mesh,{type:data.kind==='ramp'?'ramp':'box'});
      if(data.kind==='ramp')this.surfaces.push({type:'ramp',x:data.x,z:data.z,y:data.y,rotation:data.rotation,width:2,depth:2,height:2,mesh});
      if(data.kind==='floor'||data.kind==='roof')this.surfaces.push({type:'platform',x:data.x,z:data.z,top:data.level,sx:2,sz:2,mesh});
    };
    this.onRemoteShot = (data) => {
      if(data.id===this.network.id) return;
      this.spawnTracer(new THREE.Vector3(...data.origin),new THREE.Vector3(...data.origin).add(new THREE.Vector3(...data.direction).multiplyScalar(24)));
      playAgentAction(this.remotePlayers.get(data.id),'fire');
    };
    this.onResetBuilds = () => {
      this.velocityY=0;this.equipWeapon('sidearm');this.materials=300;
      this.mouseHeld=false;this.buildMode=false;
      if(this.preview) this.preview.visible=false;
      this.removeSpikeVisual();
      this.onlineSpikeSite=null;
      for(const b of this.buildings) this.scene.remove(b);
      this.solidMeshes=this.solidMeshes.filter(m=>!m.userData.buildRoot);
      this.solids=this.solids.filter(s=>!s.mesh.userData.buildRoot);
      this.surfaces=this.surfaces.filter(s=>!s.mesh.userData.buildRoot);
      this.buildings=[];this.netBuildIds.clear();
    };
    this.onHit = ({damage,shooter}) => {
      this.damageFlash=0.35;
      this.setMessage(`HIT BY ${shooter.slice(0,4)} · -${damage} HP`);
    };
    this.onAbilityEffect = data => {
      if(data.id===this.network.id)return;
      this.spawnAbilityEffect(data.agent,data.x,data.z);
    };
    this.onElimination = (event) => {
      const killer = event.killer === this.network.id ? 'YOU' : `PLAYER ${String(event.killer).slice(0,4)}`;
      const victim = event.victim === this.network.id ? 'YOU' : `PLAYER ${String(event.victim).slice(0,4)}`;
      this.recordElimination(killer, victim, event.team);
    };
    for(const piece of this.onBuildPlacedPending || []) this.onBuildPlaced(piece);
    this.onBuildPlacedPending=[];
    this.network.on('snapshot',this.onSnapshot);
    this.network.on('buildPlaced',this.onBuildPlaced);
    this.network.on('shot',this.onRemoteShot);
    this.network.on('hit',this.onHit);
    this.network.on('resetBuilds',this.onResetBuilds);
    this.network.on('elimination',this.onElimination);
    this.network.on('abilityEffect',this.onAbilityEffect);
  }

  updateNetwork() {
    if(!this.network || !this.network.connected) return;
    const now=performance.now();
    if(now-this.netSendAt<50)return;
    this.netSendAt=now;
    const foot=this.camera.position.y-PLAYER_HEIGHT;
    this.network.emit('playerState',{x:this.camera.position.x,y:foot,z:this.camera.position.z,yaw:this.yaw,pitch:this.pitch,interact:!!this.keys.KeyE});
  }

  dispose() {
    this.isDisposed = true;
    cancelAnimationFrame(this.frameId);
    this.resizeObserver?.disconnect();
    if (this.network) { this.network.off('snapshot',this.onSnapshot); this.network.off('buildPlaced',this.onBuildPlaced); this.network.off('shot',this.onRemoteShot); this.network.off('hit',this.onHit); this.network.off('resetBuilds',this.onResetBuilds); this.network.off('elimination',this.onElimination);this.network.off('abilityEffect',this.onAbilityEffect); }
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);
    this.renderer.domElement.removeEventListener('mousedown', this.handleMouseDown);
    this.renderer.domElement.removeEventListener('contextmenu', this.handleContext);
    document.removeEventListener('pointerlockchange', this.handlePointerLock);
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock?.();
    this.scene.traverse((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach((m) => m.dispose());
      else object.material?.dispose?.();
    });
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) this.container.removeChild(this.renderer.domElement);
  }
}
