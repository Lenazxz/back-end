/** Shared, deterministic 2-metre build grid. No Three.js or DOM dependency. */
export const BUILD_TILE = 2;
export const BUILD_KINDS = Object.freeze(['wall','floor','ramp','roof']);
export const BUILD_EDGES = Object.freeze(['N','E','S','W']);
export const normalizeQuarter = quarter => ((Math.round(quarter) % 4) + 4) % 4;
export const quarterFromYaw = yaw => normalizeQuarter(Math.round(yaw / (Math.PI/2)));
// Forward direction in game coordinates: 0=N, 1=W, 2=S, 3=E.
export const forwardEdge = quarter => ['N','W','S','E'][normalizeQuarter(quarter)];
export function gridCoordinate(value) { return Math.round(value/BUILD_TILE)*BUILD_TILE; }
export function placementFor(kind, x, z, level, quarter) {
  if(!BUILD_KINDS.includes(kind) || ![x,z,level,quarter].every(Number.isFinite)) return null;
  if(Math.abs(x/BUILD_TILE-Math.round(x/BUILD_TILE))>1e-5 || Math.abs(z/BUILD_TILE-Math.round(z/BUILD_TILE))>1e-5) return null;
  const rotation = normalizeQuarter(quarter) * Math.PI/2;
  const edge = kind === 'wall' ? forwardEdge(quarter) : null;
  const tileX = Math.round(x/BUILD_TILE), tileZ = Math.round(z/BUILD_TILE);
  let px=x,pz=z;
  if(edge==='N') pz-=1;
  if(edge==='S') pz+=1;
  if(edge==='W') px-=1;
  if(edge==='E') px+=1;
  // Shared edge is canonical (same wall whether placed from either neighbouring tile).
  const key = kind==='wall'
    ? `W:${edge==='E'||edge==='W'?'V':'H'}:${Math.round(px)}:${Math.round(pz)}:${Math.round(level*100)}`
    : `C:${tileX}:${tileZ}:${Math.round(level*100)}`;
  const y = kind==='wall'?level+1.05 : kind==='floor'||kind==='roof'?level-.08:level;
  const wallRotation = edge==='E'||edge==='W' ? Math.PI/2 : 0;
  return {kind, cellX:x, cellZ:z, x:px, y, z:pz, level, rotation:kind==='wall'?wallRotation:rotation, edge, key};
}
export function buildConflict(a,b) {
  if(a.key===b.key) return true;
  if(a.kind==='wall'||b.kind==='wall') return false;
  // Both floor and ramp occupy a cell on one elevation plane; roof is a floor-like tile.
  return Math.abs(a.cellX-b.cellX)<.01 && Math.abs(a.cellZ-b.cellZ)<.01 && Math.abs(a.level-b.level)<.13;
}
export function supportsBuild(candidate,builds=[],surfaces=[]) {
  if(builds.some(b=>{
    const bx=b.cellX??b.x,bz=b.cellZ??b.z;
    const sameLevel=Math.abs((b.level??0)-candidate.level)<.25;
    const climb=(b.kind==='ramp'||b.kind==='wall')&&Math.abs((b.level??0)+2-candidate.level)<.25;
    return Math.abs(bx-candidate.cellX)<=2.05 && Math.abs(bz-candidate.cellZ)<=2.05 && (sameLevel||climb);
  })) return true;
  return surfaces.some(s => s.type==='platform'&&Math.abs(s.top-candidate.level)<.32&&
    Math.abs(s.x-candidate.cellX)<=s.sx/2+1.05&&Math.abs(s.z-candidate.cellZ)<=s.sz/2+1.05);
}
