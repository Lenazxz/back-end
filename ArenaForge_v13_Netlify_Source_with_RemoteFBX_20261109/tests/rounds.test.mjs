import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newRoom,addPlayer,advanceRoom,roundFinished,nearSite,spawnFor,roomStatus,
  nextRound,navigable,moveAllowed,snapshot,ROUNDS_TO_WIN,PRE_ROUND_SECONDS,AGENT_SELECT_SECONDS,buyForPlayer,reloadPlayer
} from '../server/match-core.js';
import { SITES } from '../server/map-layout.js';

function match(){const room=newRoom('TEST01','QUICK');addPlayer(room,'p1');addPlayer(room,'p2');advanceRoom(room,AGENT_SELECT_SECONDS+.1);return room}

test('queue waits for second player and runs agent select before a pre-round',()=>{
 const r=newRoom('Q1','QUICK');const a=addPlayer(r,'p1');
 assert.equal(r.phase,'WAITING');
 const b=addPlayer(r,'p2');
 assert.equal(a.role,'ATTACKERS');assert.equal(b.role,'DEFENDERS');
 assert.equal(r.phase,'AGENT_SELECT');assert.equal(r.roundSerial,0);
 advanceRoom(r,AGENT_SELECT_SECONDS+.1);assert.equal(r.phase,'PRE_ROUND');assert.equal(r.roundSerial,1);
 advanceRoom(r,PRE_ROUND_SECONDS+.1);assert.equal(r.phase,'CARRIED');
});

test('plant then defuse updates score and automatically resets next round',()=>{
 const r=match();advanceRoom(r,PRE_ROUND_SECONDS+.1);
 const p=[...r.players.values()].find(p=>p.role==='ATTACKERS');
 Object.assign(p,{x:SITES.A.x,z:SITES.A.z,interact:true});
 assert.equal(nearSite(p),'A');
 advanceRoom(r,2.7);assert.equal(r.phase,'PLANTED');assert.equal(r.spikeSite,'A');
 const d=[...r.players.values()].find(p=>p.role==='DEFENDERS');
 Object.assign(d,{x:SITES.A.x,z:SITES.A.z,interact:true});
 advanceRoom(r,4.1);assert.equal(r.phase,'ROUND_OVER');
 assert.equal(r.score.DEFENDERS,1);
 advanceRoom(r,5.1);assert.equal(r.phase,'PRE_ROUND');
 assert.equal(r.round,2);assert.equal(r.roundSerial,2);
 assert.equal(r.builds.length,0);
});

test('side swap at halftime retains team scores and reverses spawn orientation',()=>{
 const r=match();r.round=4;r.score={ATTACKERS:2,DEFENDERS:1};
 const before=r.players.get('p1').role;
 nextRound(r);
 assert.equal(r.round,5);assert.equal(r.players.get('p1').role,'DEFENDERS');
 assert.notEqual(r.players.get('p1').role,before);
 assert.deepEqual(r.score,{ATTACKERS:1,DEFENDERS:2});
 assert.ok(r.players.get('p1').z<0);
});

test('first to five ends match, then new match starts automatically',()=>{
 const r=match();advanceRoom(r,PRE_ROUND_SECONDS+.1);
 r.score.ATTACKERS=ROUNDS_TO_WIN-1;
 assert.equal(roundFinished(r,'ATTACKERS'),true);
 assert.equal(r.phase,'MATCH_OVER');
 assert.equal(r.score.ATTACKERS,ROUNDS_TO_WIN);
 assert.equal(roomStatus(r).roundResult,'ATTACKERS WIN THE MATCH');
 advanceRoom(r,13);
 assert.equal(r.phase,'AGENT_SELECT');assert.equal(r.round,1);
 assert.deepEqual(r.score,{ATTACKERS:0,DEFENDERS:0});
});

test('movement is restricted to the real map and plausible speeds',()=>{
 const p={...spawnFor('ATTACKERS'),lastMove:Date.now()};
 assert.equal(navigable(p.x,p.z),true);
 assert.equal(moveAllowed(p,{x:p.x+30,z:p.z,y:0,yaw:0,pitch:0}),false);
 assert.equal(moveAllowed(p,{x:p.x,z:p.z,y:0,yaw:0,pitch:0}),true);
 assert.equal(navigable(0,0),false,'courtyard centre should be blocked');
});


test('buy phase accepts valid purchases, enforces money and rejects late buying',()=>{
 const r=match(),p=r.players.get('p1');
 assert.equal(p.credits,1700);
 assert.equal(buyForPlayer(r,p,'rifle').ok,false,'rifle unaffordable at first buy');
 const purchase=buyForPlayer(r,p,'smg');
 assert.equal(purchase.ok,true);
 assert.equal(p.weapon,'smg');
 assert.equal(p.credits,200);
 assert.equal(p.ammo,32);
 assert.equal(buyForPlayer(r,p,'shotgun').ok,false);
 advanceRoom(r,PRE_ROUND_SECONDS+.01);
 assert.equal(buyForPlayer(r,p,'sidearm').ok,false,'buy only during preparation');
});

test('round economy pays winner and loser, and resets weapons',()=>{
 const r=match(),a=r.players.get('p1'),d=r.players.get('p2');
 assert.equal(buyForPlayer(r,a,'smg').ok,true);
 advanceRoom(r,PRE_ROUND_SECONDS+.01);
 roundFinished(r,'ATTACKERS');
 assert.equal(a.credits,3000);
 assert.equal(d.credits,3600);
 advanceRoom(r,5.1);
 assert.equal(a.weapon,'sidearm');
 assert.equal(a.ammo,12);
 assert.equal(a.credits,3000);
 assert.equal(roomStatus(r).canBuy,true);
});

test('individual weapon magazine reload uses reserves',()=>{
 const r=match(),a=r.players.get('p1');
 assert.equal(buyForPlayer(r,a,'smg').ok,true);
 a.ammo=11;a.reserve=13;
 assert.equal(reloadPlayer(a),true);
 assert.equal(a.ammo,24);assert.equal(a.reserve,0);
 assert.equal(reloadPlayer(a),false);
});
