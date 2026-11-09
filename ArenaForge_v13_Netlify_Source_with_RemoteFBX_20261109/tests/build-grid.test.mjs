import test from 'node:test';
import assert from 'node:assert/strict';
import { placementFor, buildConflict, supportsBuild, forwardEdge, quarterFromYaw } from '../src/game/build-grid.js';
import { newRoom, addPlayer, beginPreRound, snapshot, advanceRoom } from '../server/match-core.js';

test('all four wall edges are unique per tile and same shared edge across neighbours', () => {
  const north = placementFor('wall',0,0,0,0);
  const west = placementFor('wall',0,0,0,1);
  const south = placementFor('wall',0,0,0,2);
  const east = placementFor('wall',0,0,0,3);
  assert.equal(new Set([north.key,west.key,south.key,east.key]).size,4);
  assert.equal(north.key,placementFor('wall',0,-2,0,2).key);
  assert.equal(east.key,placementFor('wall',2,0,0,1).key);
  assert.equal(north.z,-1);
  assert.equal(east.x,1);
});

test('a floor and a ramp cannot overlap in same cell but separate cells can connect', () => {
  const floor=placementFor('floor',0,0,0,0);
  const ramp=placementFor('ramp',0,0,0,0);
  const neighbour=placementFor('floor',2,0,0,0);
  assert.ok(buildConflict(floor,ramp));
  assert.ok(!buildConflict(floor,neighbour));
  assert.ok(!buildConflict(floor,placementFor('wall',0,0,0,0)));
});

test('floor can attach to top of built ramp and tile height is enforced', () => {
  const ramp=placementFor('ramp',0,0,0,0);
  const floor=placementFor('floor',0,-2,2,0);
  assert.equal(supportsBuild(floor,[ramp]),true);
  assert.equal(supportsBuild(placementFor('floor',12,12,8,0),[ramp]),false);
  assert.equal(quarterFromYaw(Math.PI/2),1);
  assert.equal(forwardEdge(1),'W');
});

test('server owns spike carrier and only carrier can plant', () => {
  const room=newRoom('TESTV10');
  const p1=addPlayer(room,'attacker');
  addPlayer(room,'defender');
  advanceRoom(room,27);
  assert.equal(room.spikeCarrier,p1.id);
  assert.equal(snapshot(room).spikeCarrier,p1.id);
  room.phase='CARRIED';room.timer=100;
  p1.x=0;p1.z=0;
  const defender=[...room.players.values()].find(p=>p.role==='DEFENDERS');
  defender.x=0;defender.z=0;defender.interact=true;
  for(let i=0;i<30;i++)advanceRoom(room,.1);
  assert.equal(room.phase,'CARRIED');
});
