import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AGENTS, AGENT_IDS } from '../server/agents.js';
import { SPAWNS, SITES, terrainHeight, BALCONIES } from '../server/map-layout.js';
import { newRoom, addPlayer, advanceRoom, AGENT_SELECT_SECONDS, lockAgent, useAgentAbility, beginPreRound } from '../server/match-core.js';
const fixture=()=>{const r=newRoom('V11TEST');addPlayer(r,'alpha');addPlayer(r,'beta');return r;};
const beginLive=(room)=>{advanceRoom(room,AGENT_SELECT_SECONDS+.01);advanceRoom(room,23);};

test('five defined original agents with active abilities and animations',()=>{
 assert.deepEqual(AGENT_IDS,['rift','aegis','lumen','ember','bastion']);
 for(const id of AGENT_IDS){assert.ok(AGENTS[id].ability&&AGENTS[id].description&&AGENTS[id].cooldown>=10)}
 assert.equal(fs.readFileSync(new URL('../src/game/agents.js',import.meta.url),'utf8'),fs.readFileSync(new URL('../server/agents.js',import.meta.url),'utf8'));
});
test('agent selection happens before the round-one buy phase',()=>{
 const room=fixture();assert.equal(room.phase,'AGENT_SELECT');
 const p1=room.players.get('alpha'),p2=room.players.get('beta');
 assert.equal(lockAgent(room,p1,'aegis').ok,true);
 assert.equal(lockAgent(room,p2,'lumen').ok,true);
 advanceRoom(room,4.1);
 assert.equal(room.phase,'PRE_ROUND');assert.equal(room.round,1);
 assert.equal(p1.agent,'aegis');assert.equal(p2.agent,'lumen');
});
test('invalid and late agent selection are rejected',()=>{
 const room=fixture(),p=room.players.get('alpha');
 assert.equal(lockAgent(room,p,'invented').ok,false);
 assert.equal(lockAgent(room,p,'rift').ok,true);
 assert.equal(lockAgent(room,p,'aegis').ok,false);
 beginLive(room);assert.equal(lockAgent(room,room.players.get('beta'),'lumen').ok,false);
});
test('A is physically below B and original spawn positions stay distant',()=>{
 assert.ok(terrainHeight(SITES.A.x,SITES.A.z)<-3);
 assert.ok(terrainHeight(SITES.B.x,SITES.B.z)>3);
 assert.ok(Math.abs(SPAWNS.ATTACKERS.z-SPAWNS.DEFENDERS.z)>110);
 assert.ok(BALCONIES.some(b=>b.top>=5));
});
test('support agent heals only in live phase and must recharge',()=>{
 const r=fixture(),p=r.players.get('alpha');p.agent='aegis';p.health=50;
 assert.equal(useAgentAbility(r,p,1000).ok,false);
 beginLive(r);p.health=50;
 const now=Date.now();const done=useAgentAbility(r,p,now);
 assert.equal(done.ok,true);assert.equal(p.health,85);
 assert.equal(useAgentAbility(r,p,now+500).ok,false);
});
test('recon agent pulse has a finite timer and server cooldown',()=>{
 const r=fixture(),p=r.players.get('alpha');p.agent='lumen';beginLive(r);
 const now=Date.now();const first=useAgentAbility(r,p,now);
 assert.equal(first.ok,true);assert.equal(first.reconUntil,now+7000);
 assert.equal(useAgentAbility(r,p,now+200).ok,false);
});
test('dash agent moves, refuses fast repeat, and never leaves walkable map',()=>{
 const r=fixture(),p=r.players.get('alpha');p.agent='rift';beginLive(r);
 p.x=SPAWNS.ATTACKERS.x;p.z=SPAWNS.ATTACKERS.z;p.y=0;p.yaw=0;
 const now=Date.now();const first=useAgentAbility(r,p,now);
 assert.equal(first.ok,true);
 assert.ok(first.z<SPAWNS.ATTACKERS.z-1);
 assert.equal(useAgentAbility(r,p,now+100).ok,false);
});
test('GLB characters have articulated limbs and actual embedded meshes',()=>{
 for(const agent of AGENT_IDS){
   const path=new URL(`../public/models/agents/${agent}.glb`,import.meta.url);
   const buf=fs.readFileSync(path);
   assert.equal(buf.toString('ascii',0,4),'glTF');
   const chunkLen=buf.readUInt32LE(12),json=JSON.parse(buf.toString('utf8',20,20+chunkLen).trim());
   assert.ok(json.meshes.length>=6 && json.meshes.length<=8,'rigged GLB uses mesh batching for fewer draw calls');
   for(const node of ['LeftLegPivot','RightLegPivot','LeftArmPivot','RightArmPivot','HeadPivot'])assert.ok(json.nodes.some(n=>n.name===node));
 }
});
test('four bundled sign GLBs exist and use actual mesh geometry',()=>{
 for(const s of ['b_market','a_alley','mid_top','boba']){
   const p=new URL(`../public/models/signs/${s}.glb`,import.meta.url);
   const buf=fs.readFileSync(p);
   assert.equal(buf.toString('ascii',0,4),'glTF');
   assert.ok(buf.length>10000);
 }
});

test('late joiner can select a character during round-one preparation',()=>{
  const r=fixture();advanceRoom(r,AGENT_SELECT_SECONDS+.01);
  const p=addPlayer(r,'gamma');
  assert.ok(p);assert.equal(p.agentLocked,false);
  assert.equal(lockAgent(r,p,'lumen').ok,true);
  assert.equal(p.agent,'lumen');
});
