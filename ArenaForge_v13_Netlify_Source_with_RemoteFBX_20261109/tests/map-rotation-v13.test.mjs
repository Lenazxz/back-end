import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_IDS, selectActiveMap, nextMapId, createWalkableTiles, SITES, SPAWNS } from '../server/map-layout.js';
import { ensureRoomMap, navigable, nearSite, newRoom, addPlayer, beginPreRound, newMatch, roomStatus } from '../server/match-core.js';

const BFS = (tiles,source,target) => {
  const k = p => `${Math.round(p.x/2)},${Math.round(p.z/2)}`;
  const q=[k(source)],seen=new Set(q);
  for(let i=0;i<q.length;i++) {
    if(q[i]===k(target))return true;
    const [x,z]=q[i].split(',').map(Number);
    for(const [dx,dz] of [[0,1],[0,-1],[1,0],[-1,0]]){
      const key=`${x+dx},${z+dz}`;
      if(tiles.has(key)&&!seen.has(key)){seen.add(key);q.push(key);}
    }
  }
  return false;
};

test('all three playable maps have paths from both spawns to each bomb site',()=>{
  for(const id of MAP_IDS){
    ensureRoomMap(id);
    const tiles=createWalkableTiles();
    for(const site of Object.values(SITES)){
      for(const home of Object.values(SPAWNS))assert.equal(BFS(tiles,home,site),true,`${id} lacks route from ${JSON.stringify(home)} to ${JSON.stringify(site)}`);
      assert.equal(nearSite(site)!=null,true);
    }
  }
});

test('Triad Atrium contains a third plantable site',()=>{
  ensureRoomMap('triad');
  assert.equal(Object.keys(SITES).join(''), 'ABC');
  assert.equal(nearSite(SITES.C),'C');
  assert.equal(navigable(SITES.C.x,SITES.C.z),true);
});

test('room map persists through normal rounds and rotates for a rematch',()=>{
  ensureRoomMap('exchange');
  const room=newRoom('MAP123','QUICK','exchange');
  addPlayer(room,'one');addPlayer(room,'two');
  beginPreRound(room);
  assert.equal(room.mapId,'exchange');
  const first=roomStatus(room);
  assert.equal(first.mapId,'exchange');
  assert.equal(first.mapName,'CANAL EXCHANGE');
  newMatch(room);
  assert.equal(room.mapId,'triad');
  assert.equal(roomStatus(room).mapName,'TRIAD ATRIUM');
  assert.equal(nextMapId('triad'),'foundry');
});

test('client and server use equivalent map variant definitions',async()=>{
  const fs=await import('node:fs');
  const url=new URL('../src/game/map-variants.js',import.meta.url);
  const server=new URL('../server/map-variants.js',import.meta.url);
  assert.equal(fs.readFileSync(url,'utf8'),fs.readFileSync(server,'utf8'));
});
