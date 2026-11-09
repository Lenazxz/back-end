import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AGENTS, AGENT_IDS } from '../server/agents.js';
import { newRoom, addPlayer, beginPreRound, buyKitCharge, useAgentAbility, earnUltimate } from '../server/match-core.js';
import { beginKitRound } from '../server/kit-rules.js';
import { MAP_AREAS, BALCONIES, ACCESS_RAMPS, terrainHeight, SITES } from '../src/game/map-layout.js';
import { placementFor, supportsBuild } from '../src/game/build-grid.js';

const setup=(id='rift')=>{
  const r=newRoom('V12ROOM');addPlayer(r,'a');addPlayer(r,'b');
  const p=r.players.get('a');p.agent=id;p.credits=9000;
  beginPreRound(r);
  return {r,p,other:r.players.get('b')};
};

test('five detailed original agents expose a coherent five-part kit',()=>{
  assert.equal(AGENT_IDS.length,5);
  for(const a of Object.values(AGENTS)){
    for(const key of ['passive','signature','utility1','utility2','ultimate'])assert.ok(a[key].name&&a[key].description);
    assert.ok(a.utility1.price>0&&a.utility2.price>0);
    assert.ok(a.utility1.max>=1&&a.utility2.max>=1);
    assert.ok(a.ultimate.cost>=5);
    const asset=fs.readFileSync(new URL(`../public/models/agents/${a.model}`,import.meta.url));
    assert.ok(asset.length>50000,`${a.id} includes detailed geometry`);
    assert.equal(asset.subarray(0,4).toString('utf8'),'glTF');
  }
});

test('paid abilities cost credits and cannot be overbought',()=>{
  const {r,p}=setup('rift');
  const cost=AGENTS.rift.utility1.price;
  assert.equal(buyKitCharge(r,p,'q').ok,true);
  assert.equal(buyKitCharge(r,p,'q').ok,true);
  assert.equal(buyKitCharge(r,p,'q').ok,false);
  assert.equal(p.charges.q,2);
  assert.equal(p.credits,9000-2*cost);
  assert.equal(buyKitCharge(r,p,'f').ok,true);
  r.phase='CARRIED';
  assert.equal(buyKitCharge(r,p,'f').ok,false);
  const result=useAgentAbility(r,p,Date.now(),'q');
  assert.equal(result.ok,true);
  assert.equal(p.charges.q,1);
  assert.ok(p.armor>=25);
  useAgentAbility(r,p,Date.now()+1,'q');
  assert.equal(p.charges.q,0);
  assert.equal(useAgentAbility(r,p,Date.now()+2,'q').ok,false);
});

test('ultimates are earned, not bought, and preserve charge until used',()=>{
  const {r,p}=setup('bastion');
  r.phase='CARRIED';
  assert.equal(useAgentAbility(r,p,Date.now(),'ultimate').ok,false);
  const goal=AGENTS.bastion.ultimate.cost;
  earnUltimate(p,goal);
  assert.equal(p.ultimatePoints,goal);
  const result=useAgentAbility(r,p,Date.now(),'ultimate');
  assert.equal(result.ok,true);assert.equal(p.ultimatePoints,0);
  earnUltimate(p,2);beginKitRound(p);
  assert.equal(p.ultimatePoints,2,'ultimate progress persists across rounds');
  assert.equal(p.charges.q,0,'purchased charges reset');
});

test('healer can restore nearby teammate and recon reveals enemies',()=>{
  const {r,p,other}=setup('aegis');
  other.role=p.role;other.x=p.x+2;other.z=p.z;other.health=43;
  buyKitCharge(r,p,'f');r.phase='CARRIED';
  assert.equal(useAgentAbility(r,p,Date.now(),'f').ok,true);
  assert.equal(other.health,63);
  p.agent='lumen';p.charges={q:1,f:0};
  const result=useAgentAbility(r,p,Date.now()+1000,'q');
  assert.equal(result.ok,true);assert.ok(p.reconUntil>Date.now());
});

test('new Foundry map has additional route sectors and deep site height contrast',()=>{
  for(const sector of ['west-forge','east-switchback','foundry-undercroft','defender-skybridge']){
    assert.ok(MAP_AREAS.some(a=>a.id===sector),`missing ${sector}`);
  }
  assert.ok(terrainHeight(SITES.A.x,SITES.A.z)<-4.9);
  assert.ok(terrainHeight(SITES.B.x,SITES.B.z)>5);
  assert.ok(BALCONIES.some(b=>b.top>8));
  assert.ok(ACCESS_RAMPS.length>=7);
});

test('building supports elevations far beyond the original 16/30 metre clamp',()=>{
  const lower=placementFor('ramp',0,0,64,0);
  const upper=placementFor('floor',0,-2,66,0);
  assert.ok(lower&&upper);
  assert.ok(supportsBuild(upper,[lower]));
  assert.equal(upper.level,66);
});
