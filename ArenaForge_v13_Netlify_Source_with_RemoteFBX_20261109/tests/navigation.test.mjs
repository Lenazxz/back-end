import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAP_AREAS, MAP_HOLES, MAP_LABELS, COVER, BALCONIES, ACCESS_RAMPS,
  SITES, SPAWNS, createWalkableTiles, tileKey, toTile, mapPoint, pointInPolygon, terrainHeight
} from '../src/game/map-layout.js';
import { findNavPath, nearestNavTile, segmentIsClear } from '../src/game/bot-navigation.js';

const tiles = createWalkableTiles();
const blocked = (x,z) => COVER.some(p => Math.abs(x-p.x)<p.w/2+.37 && Math.abs(z-p.z)<p.d/2+.37);
const passable = (x,z) => tiles.has(tileKey(toTile(x),toTile(z))) && !blocked(x,z);
function checkPath(from, to, name) {
  const path = findNavPath(tiles, from, to, blocked);
  assert.ok(path.length >= 2, `missing path ${name}`);
  const last = path.at(-1);
  assert.ok(Math.hypot(last.x-to.x,last.z-to.z)<4, `wrong destination ${name}`);
  for(let i=1;i<path.length;i++) assert.ok(segmentIsClear(tiles,path[i-1],path[i],blocked), `route clips obstacle ${name}`);
  return path;
}

test('custom layout is one connected playable footprint',()=>{
  const start=tileKey(toTile(SPAWNS.ATTACKERS.x),toTile(SPAWNS.ATTACKERS.z));
  assert.ok(tiles.has(start));
  const queue=[start], seen=new Set(queue);
  for(let i=0;i<queue.length;i++){
    const [x,z]=queue[i].split(',').map(Number);
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const k=tileKey(x+dx,z+dz);
      if(tiles.has(k)&&!seen.has(k)){seen.add(k);queue.push(k)}
    }
  }
  assert.equal(seen.size,tiles.size);
});

test('both teams reach both sites while avoiding cover',()=>{
  for(const [team,from] of Object.entries(SPAWNS)) for(const [site,to] of Object.entries(SITES)) checkPath(from,to,`${team}->${site}`);
});

test('sites, Mid, lower route and spawns have navigable rotations',()=>{
  const pts=[SITES.A,SITES.B,{x:-6,z:5},{x:-9,z:-31},{x:0,z:28},SPAWNS.ATTACKERS,SPAWNS.DEFENDERS];
  for(let i=0;i<pts.length;i++)for(let j=i+1;j<pts.length;j++)checkPath(pts[i],pts[j],`${i}->${j}`);
});

test('every named area has playable cells, even when its centre is intentionally obstructed',()=>{
  for(const area of MAP_AREAS){
    const candidates=[...tiles].filter(key=>{
      const [ix,iz]=key.split(',').map(Number);
      return pointInPolygon(ix*2,iz*2,area.polygon) && !blocked(ix*2,iz*2);
    });
    assert.ok(candidates.length,`${area.label} should have a walkable interior`);
  }
  for(const hole of MAP_HOLES){
    const c={x:(hole.x1+hole.x2)/2,z:(hole.z1+hole.z2)/2};
    assert.equal(tiles.has(tileKey(toTile(c.x),toTile(c.z))),false,'courtyard vent building must be impassable');
  }
});

test('concept A and B orientation, long approaches and minimap bounds',()=>{
  assert.ok(SITES.A.x>0 && SITES.B.x<0);
  assert.ok(SPAWNS.ATTACKERS.z-SITES.A.z>70,'attackers spawn should be distant from A');
  assert.ok(SITES.A.z-SPAWNS.DEFENDERS.z>20,'defender approach has meaningful length');
  assert.ok(MAP_LABELS.some(l=>l.text==='MID TILES'));
  for(const p of [...Object.values(SITES),...Object.values(SPAWNS)]){
    const m=mapPoint(p.x,p.z);
    assert.ok(m.x>8&&m.x<192&&m.y>10&&m.y<202);
  }
});

test('real lower trench and ramp-accessible balconies',()=>{
  assert.ok(terrainHeight(-6,6)<-1.2,'MID TILES must have a sunken passage');
  assert.equal(terrainHeight(-6,20),0);
  assert.ok(BALCONIES.length>=4);
  for(const ramp of ACCESS_RAMPS){
    assert.ok(passable(ramp.x,ramp.z),`${ramp.id} centre walkable`);
    assert.ok(passable(ramp.x,ramp.z+ramp.depth/2),`${ramp.id} base walkable`);
    assert.ok(passable(ramp.x,ramp.z-ramp.depth/2),`${ramp.id} top walkable`);
    const deck=BALCONIES.find(p=>p.id.includes(ramp.id.split(' climb')[0]));
    assert.ok(deck || ramp.id==='Mid Top climb',`balcony has linked incline ${ramp.id}`);
  }
});
