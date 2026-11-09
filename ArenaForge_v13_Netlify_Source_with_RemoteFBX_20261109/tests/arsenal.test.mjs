import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WEAPONS, WEAPON_LIST, STARTING_CREDITS, canAfford } from '../server/weapons.js';
import { newRoom, addPlayer, advanceRoom, buyForPlayer, PRE_ROUND_SECONDS, AGENT_SELECT_SECONDS, roundFinished, hitAllowed } from '../server/match-core.js';
import { terrainHeight, playableAt, SPAWNS, SITES } from '../server/map-layout.js';

const match = () => {const r=newRoom('TEST','QUICK');addPlayer(r,'one');addPlayer(r,'two');advanceRoom(r,AGENT_SELECT_SECONDS+.1);return r};

test('server and client have exactly matching weapon specifications',()=>{
  const client=fs.readFileSync(new URL('../src/game/weapons.js',import.meta.url),'utf8');
  const server=fs.readFileSync(new URL('../server/weapons.js',import.meta.url),'utf8');
  assert.equal(client,server);
  assert.equal(WEAPON_LIST.length,5);
  for(const id of WEAPON_LIST){
    const w=WEAPONS[id];
    assert.ok(w.name&&w.magazine>0&&w.reserve>0&&w.rate>0&&w.damage>0&&w.pellets>=1);
  }
  assert.ok(canAfford(STARTING_CREDITS,'smg'));
  assert.equal(canAfford(STARTING_CREDITS,'rifle'),false);
});

test('shop has 22-second online buy phase with server-authorized purchases',()=>{
  const r=match(),p=r.players.get('one');
  assert.equal(r.phase,'PRE_ROUND');
  assert.equal(r.timer,PRE_ROUND_SECONDS);
  assert.equal(buyForPlayer(r,p,'shotgun').ok,false);
  assert.equal(buyForPlayer(r,p,'smg').ok,true);
  assert.equal(p.weapon,'smg');
  advanceRoom(r,PRE_ROUND_SECONDS+0.1);
  assert.equal(r.phase,'CARRIED');
  assert.equal(buyForPlayer(r,p,'rifle').ok,false);
});

test('weapons reset at round start and economy persists from previous round',()=>{
  const r=match(),p=r.players.get('one');
  assert.equal(buyForPlayer(r,p,'smg').ok,true);
  advanceRoom(r,PRE_ROUND_SECONDS+.1);roundFinished(r,'ATTACKERS');advanceRoom(r,5.1);
  assert.equal(p.weapon,'sidearm');
  assert.ok(p.credits>=1900);
  assert.equal(r.phase,'PRE_ROUND');
});

test('world has deep mid trench and original A/B routes',()=>{
  assert.ok(terrainHeight(-6,6) < -3.0);
  assert.ok(playableAt(SPAWNS.ATTACKERS.x,SPAWNS.ATTACKERS.z));
  assert.ok(playableAt(SITES.A.x,SITES.A.z));
  assert.ok(playableAt(SITES.B.x,SITES.B.z));
  assert.ok(7.5-(-14.6)>20,'high walkway above abyss has over 20m visible depth');
});
