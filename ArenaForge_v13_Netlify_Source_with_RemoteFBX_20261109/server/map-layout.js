import { EXTRA_MAPS } from './map-variants.js';
/**
 * Arena Forge v12 — Ironveil Foundry, an extended original urban layout.
 * Layout source: user's 447px overview (A right / B left, spawn at both extremes).
 * Pixel-space outlines are translated to metres. This one file drives floor,
 * collision boundaries, AI navigation and the tactical minimap.
 */
export const TILE_SIZE = 2;
const SX = 0.235;
const SZ = 0.40;
const world = ([u, v]) => ({ x: (u - 225) * SX, z: (v - 225) * SZ });

function area(id, label, tint, pixels) {
  const polygon = pixels.map(world);
  const xs = polygon.map(p => p.x), zs = polygon.map(p => p.z);
  return Object.freeze({ id, label, tint, polygon,
    x1: Math.min(...xs), x2: Math.max(...xs), z1: Math.min(...zs), z2: Math.max(...zs) });
}

export let MAP_LIMITS = Object.freeze({ minX: -52, maxX: 52, minZ: -90, maxZ: 90 });
export let SITES = Object.freeze({
  A: world([337, 154]),
  B: world([94, 174])
});
export let SPAWNS = Object.freeze({
  ATTACKERS: { ...world([231, 398]), yaw: 0 },
  DEFENDERS: { ...world([216, 54]), yaw: Math.PI }
});

export let MAP_AREAS = Object.freeze([
  area('attacker-spawn', 'ATTACKER SPAWN', 'spawn', [
    [202,338],[239,337],[260,341],[261,425],[209,426],[202,374]
  ]),
  area('attacker-lobby', 'L LOBBY', 'lane', [
    [172,297],[236,297],[236,320],[251,320],[251,344],[192,344],[192,330],[172,330]
  ]),
  area('mid-bottom', 'MID BOTTOM', 'mid', [
    [147,242],[271,242],[271,262],[247,262],[247,281],[201,281],[201,311],[180,311],[180,282],[147,282]
  ]),
  area('b-main', 'B MAIN', 'lane', [
    [94,218],[142,218],[142,247],[156,247],[156,284],[107,284],[107,267],[85,267],[85,245],[94,245]
  ]),
  area('b-site', 'B SITE', 'siteB', [
    [67,139],[121,139],[121,219],[82,219],[82,211],[67,211]
  ]),
  area('b-boba', 'B BOBA', 'upper', [
    [100,132],[151,132],[151,156],[124,156],[124,193],[113,193],[113,146],[100,146]
  ]),
  area('b-market', 'B MARKET', 'lane', [
    [119,186],[163,186],[163,192],[204,192],[204,234],[150,234],[150,223],[119,223]
  ]),
  area('mid-tiles', 'MID TILES', 'lower', [
    [176,208],[218,208],[218,265],[178,265]
  ]),
  area('mid-courtyard', 'MID COURTYARD', 'mid', [
    [193,152],[312,152],[312,218],[271,218],[271,210],[194,210]
  ]),
  area('mid-top', 'MID TOP', 'upper', [
    [149,128],[206,128],[206,163],[156,163],[156,150],[149,150]
  ]),
  area('b-to-mid', 'B CONNECTOR', 'lane', [
    [122,138],[158,138],[158,157],[122,157]
  ]),
  area('a-link', 'A LINK', 'lane', [
    [272,133],[320,133],[320,172],[270,172],[270,156]
  ]),
  area('a-site', 'A SITE', 'siteA', [
    [310,120],[359,120],[359,191],[310,191]
  ]),
  area('a-alley', 'A ALLEY', 'upper', [
    [263,82],[362,82],[362,126],[315,126],[315,135],[267,135],[267,117]
  ]),
  area('a-elbow', 'A ELBOW', 'lower', [
    [351,134],[392,134],[392,201],[351,201]
  ]),
  area('a-main', 'A MAIN', 'lane', [
    [304,183],[355,183],[355,221],[330,221],[330,263],[282,263],[282,237],[304,237]
  ]),
  area('a-lobby', 'A LOBBY', 'lane', [
    [267,245],[330,245],[330,276],[308,276],[308,295],[257,295],[257,275]
  ]),
  area('defender-spawn', 'DEFENDER SPAWN', 'spawn', [
    [159,16],[278,16],[278,95],[301,95],[301,128],[268,128],[268,108],[242,108],[242,135],[181,135],[181,105],[159,105]
  ]),
  area('def-mid', 'MID TOP ACCESS', 'lane', [
    [179,105],[208,105],[208,139],[176,139]
  ]),
  area('def-b', 'DEFENDER B ROUTE', 'lane', [
    [158,97],[183,97],[183,139],[150,139],[150,148],[136,148],[136,134],[158,134]
  ]),
  area('def-a', 'DEFENDER A ROUTE', 'lane', [
    [260,88],[300,88],[300,114],[282,114],[282,133],[261,133]
  ]),
  // New in v12: lateral backstreets, a lower foundry service run and a
  // defender skybridge. These are real walkable sectors in the shared mesh.
  area('west-forge', 'WEST FORGE', 'lower', [
    [52,191],[88,191],[88,259],[110,259],[110,280],[52,280]
  ]),
  area('east-switchback', 'EAST SWITCHBACK', 'upper', [
    [356,179],[419,179],[419,245],[382,245],[382,216],[350,216]
  ]),
  area('foundry-undercroft', 'FOUNDRY UNDERCROFT', 'lower', [
    [191,277],[250,277],[250,321],[191,321]
  ]),
  area('defender-skybridge', 'DEFENDER SKYBRIDGE', 'upper', [
    [200,90],[270,90],[270,116],[205,116],[205,133],[200,133]
  ])
]);

// Central open-looking courtyard has an enclosed concrete ventilation building.
// This is a gameplay obstruction as well as scenery, giving Mid two approaches.
export let MAP_HOLES = Object.freeze([
  area('courtyard-block', 'MID VENT BLOCK', 'hole', [[227,164],[277,164],[277,197],[227,197]])
]);

export function pointInPolygon(x, z, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function playableAt(x, z) {
  return MAP_AREAS.some(a => x >= a.x1 && x <= a.x2 && z >= a.z1 && z <= a.z2 && pointInPolygon(x, z, a.polygon))
    && !MAP_HOLES.some(h => pointInPolygon(x, z, h.polygon));
}

export const tileKey = (ix, iz) => `${ix},${iz}`;
export const toTile = v => Math.round(v / TILE_SIZE);
export function createWalkableTiles() {
  const tiles = new Set();
  const ixMin=Math.floor(MAP_LIMITS.minX/TILE_SIZE), ixMax=Math.ceil(MAP_LIMITS.maxX/TILE_SIZE);
  const izMin=Math.floor(MAP_LIMITS.minZ/TILE_SIZE), izMax=Math.ceil(MAP_LIMITS.maxZ/TILE_SIZE);
  for (let iz = izMin; iz <= izMax; iz++) for (let ix = ixMin; ix <= ixMax; ix++) {
    const x = ix * TILE_SIZE, z = iz * TILE_SIZE;
    if (playableAt(x, z)) tiles.add(tileKey(ix, iz));
  }
  return tiles;
}

export let MAP_LABELS = Object.freeze([
  { text: 'A SITE', ...SITES.A }, { text: 'B SITE', ...SITES.B },
  { text: 'A ALLEY', ...world([306,100]) }, { text: 'A LINK', ...world([291,151]) },
  { text: 'A ELBOW', ...world([373,173]) }, { text: 'A MAIN', ...world([327,220]) },
  { text: 'A LOBBY', ...world([286,276]) }, { text: 'B BOBA', ...world([114,140]) },
  { text: 'B MARKET', ...world([167,215]) }, { text: 'B MAIN', ...world([115,258]) },
  { text: 'MID TOP', ...world([172,145]) }, { text: 'MID TILES', ...world([193,237]) },
  { text: 'MID COURTYARD', ...world([282,205]) }, { text: 'MID BOTTOM', ...world([183,271]) },
  { text: 'WEST FORGE', ...world([69,247]) }, { text: 'EAST SWITCHBACK', ...world([397,224]) },
  { text: 'UNDERCROFT', ...world([214,306]) }, { text: 'SKYBRIDGE', ...world([230,106]) }
]);

export let COVER = Object.freeze([
  { ...world([93,186]), w:2.3,d:1.8,h:1.8,kind:'generator' },
  { ...world([111,252]), w:2.0,d:2.0,h:1.4,kind:'crate' },
  { ...world([149,214]), w:1.5,d:1.8,h:1.2,kind:'console' },
  { ...world([336,179]), w:2.2,d:1.7,h:1.8,kind:'generator' },
  { ...world([324,237]), w:2.0,d:1.8,h:1.4,kind:'crate' },
  { ...world([285,266]), w:1.8,d:1.6,h:1.25,kind:'crate' },
  { ...world([211,257]), w:1.4,d:1.6,h:1.0,kind:'console' },
  { ...world([294,186]), w:1.7,d:1.8,h:1.0,kind:'console' },
  { ...world([185,316]), w:1.9,d:2.0,h:1.1,kind:'crate' },
  { ...world([244,334]), w:1.8,d:1.6,h:1.1,kind:'crate' },
  { ...world([169,82]), w:1.8,d:1.5,h:1.4,kind:'console' },
  { ...world([68,240]), w:2.5,d:1.9,h:1.5,kind:'generator' },
  { ...world([404,218]), w:2.0,d:2.2,h:1.6,kind:'crate' },
]);

// Raised site balcony pads and overhead routes. Height is metres above the
// courtyard ground. Low path is truly sunken: -1.5 m at the centre, with
// a graded transition at each end. Trench geometry and movement use same function.
export let BALCONIES = Object.freeze([
  { id:'A Alley overlook', ...world([330,102]), w:6.2,d:5.5,top:2.8, kind:'balcony' },
  { id:'A Elbow viewing ledge', ...world([376,153]), w:4.4,d:5.2,top:2.2, kind:'balcony' },
  { id:'B Boba overlook', ...world([112,161]), w:4.3,d:6.0,top:5.8, kind:'balcony' },
  { id:'Mid Top gantry', ...world([179,143]), w:6.0,d:4.6,top:2.3, kind:'bridge' },
  { id:'West Forge access mezzanine', ...world([75,242]), w:5.5,d:10.4,top:7.4,kind:'balcony' },
  { id:'East Switchback access catwalk', ...world([401,220]), w:5.2,d:10.5,top:8.8,kind:'bridge' },
  { id:'Skybridge access deck', ...world([235,110]), w:12.0,d:4.0,top:5.4,kind:'bridge' }
]);
export let ACCESS_RAMPS = Object.freeze([
  { id:'A Alley climb', ...world([329,112]), width:4.2,depth:6,height:2.8,rotation:0 },
  { id:'A Elbow climb', ...world([374,166]), width:3.6,depth:5.5,height:2.2,rotation:0 },
  { id:'B Boba climb', ...world([112,176]), width:3.6,depth:9,height:5.8,rotation:0 },
  { id:'Mid Top climb', ...world([178,155]), width:4.0,depth:5,height:2.3,rotation:0 },
  { id:'West Forge access', ...world([75,257]), width:4,depth:9,height:7.4,rotation:0 },
  { id:'East Switchback access', ...world([397,229]), width:4,depth:10,height:8.8,rotation:0 },
  { id:'Skybridge access', ...world([236,122]), width:4,depth:8,height:5.4,rotation:0 }
]);

// Smooth, navigable approaches: A is a sunken vault, B is a raised courtyard.
// The height difference is shared between the browser and Render.
export function siteElevation(x,z) {
  const easing=(distance,r0,r1)=>{
    const t=Math.max(0,Math.min(1,(r1-distance)/(r1-r0)));
    return t*t*(3-2*t);
  };
  const a=Math.hypot(x-SITES.A.x,z-SITES.A.z);
  const b=Math.hypot(x-SITES.B.x,z-SITES.B.z);
  const c=SITES.C?Math.hypot(x-SITES.C.x,z-SITES.C.z):Infinity;
  const elev=ACTIVE_MAP_ID==='foundry'?{A:-5,B:5.2}:EXTRA_MAPS[ACTIVE_MAP_ID]?.elevation||{A:-5,B:5.2};
  return (elev.A||0)*easing(a,4.8,21)+(elev.B||0)*easing(b,5,21)+(elev.C||0)*easing(c,5,21);
}
export function terrainHeight(x, z) {
  const elevation=siteElevation(x,z);
  // Taper to -3.3 in MID TILES, returning to 0 at both mouths. X restriction
  // keeps the sunken channel isolated from the adjacent high connector.
  if (ACTIVE_MAP_ID !== 'foundry' || x < -11.8 || x > -0.8 || z < -4 || z > 16) return elevation;
  const side = Math.max(0, Math.min(1, (x + 11.8) / 2, (-0.8 - x) / 2));
  const descent = Math.max(0, Math.min(1, (z + 4) / 5));
  const ascent = Math.max(0, Math.min(1, (16 - z) / 5));
  return elevation -4.6 * Math.min(descent, ascent) * side;
}

export function areaAt(x, z) {
  const areas = MAP_AREAS.filter(a => pointInPolygon(x, z, a.polygon));
  return areas.length ? areas[0].label : 'IRONVEIL YARD';
}

export function mapPoint(x, z) {
  return { x: 100 + x * 1.85, y: 106 + z * 1.26 };
}


// Three selectable layouts. The client has a single active 3D world; the server
// selects this per room, synchronously, before processing each room action.
const defaultMap={name:'FOUNDRY HEIGHTS',MAP_LIMITS,SITES,SPAWNS,MAP_AREAS,MAP_HOLES,MAP_LABELS,COVER,BALCONIES,ACCESS_RAMPS};
export const MAP_IDS=Object.freeze(['foundry','exchange','triad']);
export let ACTIVE_MAP_ID='foundry';
export let ACTIVE_MAP_NAME='FOUNDRY HEIGHTS';
export function selectActiveMap(requested='foundry') {
  const id=MAP_IDS.includes(requested)?requested:'foundry';
  const m=id==='foundry'?defaultMap:EXTRA_MAPS[id];
  ACTIVE_MAP_ID=id;
  ACTIVE_MAP_NAME=m.name;
  MAP_LIMITS=m.limits||m.MAP_LIMITS;
  SITES=m.sites||m.SITES;
  SPAWNS=m.spawns||m.SPAWNS;
  MAP_AREAS=m.areas||m.MAP_AREAS;
  MAP_HOLES=m.holes||m.MAP_HOLES;
  MAP_LABELS=m.labels||m.MAP_LABELS;
  COVER=m.cover||m.COVER;
  BALCONIES=m.balconies||m.BALCONIES;
  ACCESS_RAMPS=m.ramps||m.ACCESS_RAMPS;
  return id;
}
export function nextMapId(id='foundry'){
  return MAP_IDS[(MAP_IDS.indexOf(id)+1+MAP_IDS.length)%MAP_IDS.length];
}
