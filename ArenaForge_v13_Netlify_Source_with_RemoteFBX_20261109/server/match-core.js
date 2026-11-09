/** Pure match rules for Quick Play and private rooms (no Socket.IO dependency). */
import { createWalkableTiles, tileKey, toTile, SPAWNS, SITES, COVER, MAP_LIMITS, selectActiveMap, nextMapId, ACTIVE_MAP_ID, ACTIVE_MAP_NAME, MAP_IDS } from './map-layout.js';
import { WEAPONS, weaponById, canAfford, clampCredits, STARTING_CREDITS } from './weapons.js';
import { AGENTS, validAgent } from './agents.js';
import { prepareKit, beginKitRound, buyKitCharge, usePaidOrUltimate, earnUltimate } from './kit-rules.js';
export { buyKitCharge, earnUltimate } from './kit-rules.js';
import { terrainHeight } from './map-layout.js';

export const MAX_PLAYERS = 10;
export const ROUNDS_TO_WIN = 5;
export const AGENT_SELECT_SECONDS = 26;
export const PRE_ROUND_SECONDS = 22;
export const ROUND_SECONDS = 115;
export const SPIKE_SECONDS = 40;
export const END_SECONDS = 5;
export const MATCH_END_SECONDS = 12;
let tiles = createWalkableTiles();
let navMap='foundry';
/** The room handlers are synchronous. Switch the shared immutable map data
 * before each room event/tick; never keep a room-specific map in a Promise. */
export function ensureRoomMap(mapId='foundry') {
  const id=MAP_IDS.includes(mapId)?mapId:'foundry';
  if(id!==navMap) {
    selectActiveMap(id);
    tiles=createWalkableTiles();
    navMap=id;
  }
  return navMap;
}
const valid = (n,min,max) => typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
export const safeCode = code => String(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
export function createCode(existing) {
  let code;
  do { code=Math.random().toString(36).slice(2,8).toUpperCase(); } while(existing.has(code));
  return code;
}
export function newRoom(code,mode='PRIVATE',mapId='foundry') {
  return {code,mode,mapId,players:new Map(),builds:[],nextBuild:0,spikeCarrier:null,phase:'WAITING',timer:0,bombTimer:SPIKE_SECONDS,
    spikeSite:null,progress:new Map(),winner:'',score:{ATTACKERS:0,DEFENDERS:0},round:1,roundSerial:0,
    createdAt:Date.now(),lastActiveAt:Date.now(),matchWinner:'',sidesSwapped:false,selectElapsed:0};
}
export function teamCount(room,team) {return [...room.players.values()].filter(p=>p.role===team).length;}
export function getRole(room) {return teamCount(room,'ATTACKERS')<=teamCount(room,'DEFENDERS')?'ATTACKERS':'DEFENDERS';}
export function spawnFor(role,index=0) {
  const h=SPAWNS[role];
  const shift=(index%5-2)*1.7;
  return {x:h.x+shift,z:h.z,y:0,yaw:h.yaw};
}
export function newPlayer(id,role,index=0) {
  return {id,role,...spawnFor(role,index),pitch:0,health:100,interact:false,
    lastMove:Date.now(),lastShot:0,lastBuild:0,reloadUntil:0,kills:0,deaths:0,
    weapon:'sidearm',ammo:WEAPONS.sidearm.magazine,reserve:WEAPONS.sidearm.reserve,credits:STARTING_CREDITS,
    agent:'rift',agentLocked:false,abilityReadyAt:0,reconUntil:0,armor:0,charges:{q:0,f:0},ultimatePoints:0,hasteUntil:0,flashUntil:0};
}
export function addPlayer(room,id) {
  if (room.players.size>=MAX_PLAYERS) return null;
  const role=getRole(room),player=newPlayer(id,role,teamCount(room,role));
  room.players.set(id,player);
  room.lastActiveAt=Date.now();
  if (room.players.size>=2 && room.phase==='WAITING') beginAgentSelect(room);
  return player;
}
export function beginAgentSelect(room) {
  room.phase='AGENT_SELECT';room.timer=AGENT_SELECT_SECONDS;room.selectElapsed=0;
  room.spikeCarrier=null;room.spikeSite=null;room.progress.clear();
  for(const p of room.players.values()) {p.abilityReadyAt=0;p.reconUntil=0;}
}
export function lockAgent(room, player, agentId) {
  if(!room||!player||!['WAITING','AGENT_SELECT','PRE_ROUND'].includes(room.phase))return {ok:false,error:'SELECTION CLOSED'};
  if(player.agentLocked)return {ok:false,error:'AGENT ALREADY LOCKED'};
  if(!Object.hasOwn(AGENTS,agentId))return {ok:false,error:'UNKNOWN AGENT'};
  player.agent=validAgent(agentId);player.agentLocked=true;prepareKit(player);
  return {ok:true,agent:player.agent};
}
export function useAgentAbility(room,player,now=Date.now(),slot='signature') {
  if(slot!=='signature')return usePaidOrUltimate(room,player,slot,now,(a,b)=>segmentClear2D(a,b));
  prepareKit(player);
  if(!room||!player||!['CARRIED','PLANTED'].includes(room.phase)||player.health<=0)return {ok:false,error:'NOT IN ACTIVE ROUND'};
  if(now < player.abilityReadyAt)return {ok:false,error:'ABILITY RECHARGING',remainingMs:player.abilityReadyAt-now};
  const agent=AGENTS[validAgent(player.agent)];
  const result={ok:true,ability:agent.ability,agent:agent.id};
  if(agent.id==='rift'||agent.id==='ember') {
    const dx=-Math.sin(player.yaw),dz=-Math.cos(player.yaw);
    let last={x:player.x,z:player.z};
    for(let step=.35;step<=5.0;step+=.35){
      const next={x:player.x+dx*step,z:player.z+dz*step};
      if(!navigable(next.x,next.z)||!segmentClear2D(last,next) || room.builds.some(b=>b.kind==='wall' && segmentHitsRect(last,next,b.x-1.05,b.x+1.05,b.z-1.05,b.z+1.05)))break;
      last=next;
    }
    if(Math.hypot(last.x-player.x,last.z-player.z)<1)return {ok:false,error:'DASH BLOCKED'};
    player.x=last.x;player.z=last.z;player.y=terrainHeight(last.x,last.z);player.lastMove=now;
    result.x=player.x;result.y=player.y;result.z=player.z;
  } else if(agent.id==='aegis') {
    if(player.health>=100)return {ok:false,error:'ALREADY FULL HEALTH'};
    player.health=Math.min(100,player.health+35);result.health=player.health;
  } else if(agent.id==='lumen') {
    player.reconUntil=now+7000;result.reconUntil=player.reconUntil;
  } else if(agent.id==='bastion') {
    player.armor=Math.min(85,(player.armor||0)+35);result.armor=player.armor;
  }
  player.abilityReadyAt=now+agent.cooldown*1000;
  result.abilityReadyAt=player.abilityReadyAt;
  return result;
}
export function beginPreRound(room) {
  room.phase='PRE_ROUND';room.timer=PRE_ROUND_SECONDS;room.winner='';room.matchWinner='';
  room.spikeSite=null;room.progress.clear();room.builds=[];
  room.nextBuild=0;room.bombTimer=SPIKE_SECONDS;
  room.roundSerial++;
  const teamIndices={ATTACKERS:0,DEFENDERS:0};
  for(const player of room.players.values()) {
    Object.assign(player,spawnFor(player.role,teamIndices[player.role]++));
    player.health=100;player.interact=false;player.lastMove=Date.now();player.lastShot=0;player.reloadUntil=0;
    player.weapon='sidearm';player.ammo=WEAPONS.sidearm.magazine;player.reserve=WEAPONS.sidearm.reserve;
    player.abilityReadyAt=0;player.reconUntil=0;beginKitRound(player);
  }
  room.spikeCarrier=[...room.players.values()].find(p=>p.role==='ATTACKERS')?.id || null;
}
export function roundFinished(room,winner) {
  if(!['CARRIED','PLANTED'].includes(room.phase))return false;
  room.phase='ROUND_OVER';room.winner=`${winner} WIN`;room.timer=END_SECONDS;room.progress.clear();
  room.score[winner]++;
  for(const player of room.players.values()) {
    earnUltimate(player,1);
    player.credits=clampCredits(player.credits+(player.role===winner?2800:1900));
  }
  if(room.score[winner]>=ROUNDS_TO_WIN) {
    room.phase='MATCH_OVER';room.matchWinner=winner;room.timer=MATCH_END_SECONDS;
    room.winner=`${winner} WIN THE MATCH`;
  }
  return true;
}
export function pauseForMissingPlayers(room) {
  if(room.players.size>=2) return false;
  if(room.phase==='WAITING') return false;
  room.phase='WAITING';room.timer=0;room.winner='';room.progress.clear();room.spikeSite=null;room.spikeCarrier=null;
  return true;
}
export function nextRound(room) {
  room.round++;
  // After four rounds, the teams switch sides and retain their win totals.
  if(room.round===5 && !room.sidesSwapped) {
    room.sidesSwapped=true;
    const score=room.score;
    room.score={ATTACKERS:score.DEFENDERS,DEFENDERS:score.ATTACKERS};
    for(const player of room.players.values()) player.role=player.role==='ATTACKERS'?'DEFENDERS':'ATTACKERS';
  }
  beginPreRound(room);
}
export function newMatch(room) {
  room.mapId=nextMapId(room.mapId);
  ensureRoomMap(room.mapId);
  room.score={ATTACKERS:0,DEFENDERS:0};room.round=1;room.sidesSwapped=false;
  room.phase='WAITING';room.matchWinner='';
  // Return switched teams to the sides they originally started on.
  for(const player of room.players.values()) if(player.role) player.role=player.role==='ATTACKERS'?'DEFENDERS':'ATTACKERS';
  // Instead recompute balance from player order for fresh match, avoiding stale role.
  let i=0;
  for(const player of room.players.values()) {
    player.role=(i++%2===0)?'ATTACKERS':'DEFENDERS';
    player.agentLocked=false;player.credits=STARTING_CREDITS;player.weapon='sidearm';player.ultimatePoints=0;beginKitRound(player);
  }
  if(room.players.size>=2) beginAgentSelect(room);
}
const near = (p,site) => Math.hypot(p.x-SITES[site].x,p.z-SITES[site].z);
export function nearSite(player) {
  return Object.keys(SITES).find(site=>near(player,site)<4.8)||null;
}
export function navigable(x,z) {
  return valid(x,MAP_LIMITS.minX,MAP_LIMITS.maxX)&&valid(z,MAP_LIMITS.minZ,MAP_LIMITS.maxZ)
    && tiles.has(tileKey(toTile(x),toTile(z)))
    && !COVER.some(c=>Math.abs(x-c.x)<c.w/2+0.33&&Math.abs(z-c.z)<c.d/2+0.33);
}
export function segmentClear2D(a,b) {
  const length=Math.hypot(b.x-a.x,b.z-a.z);
  for(let i=0,n=Math.max(1,Math.ceil(length/.38));i<=n;i++) {
    const k=i/n,x=a.x+(b.x-a.x)*k,z=a.z+(b.z-a.z)*k;
    if(!tiles.has(tileKey(toTile(x),toTile(z))))return false;
  }
  return true;
}
export function moveAllowed(player,data,now=Date.now()) {
  if(!data || ![data.x,data.y,data.z,data.yaw,data.pitch].every(Number.isFinite))return false;
  if(!valid(data.y,-12,5000)||!navigable(data.x,data.z))return false;
  const dt=Math.max(.016,Math.min(.25,(now-player.lastMove)/1000));
  const d=Math.hypot(data.x-player.x,data.z-player.z);
  const boost=(player.hasteUntil||0)>now?1.28:1;
  if(d>Math.max(.88,13*boost*dt+.45))return false;
  if(Math.abs(data.y-player.y)>Math.max(1.5,14*dt))return false;
  return segmentClear2D(player,data);
}
export function hitAllowed(shooter,victim,dir,builds=[],opts={}) {
  if(shooter.role===victim.role||victim.health<=0||shooter.health<=0)return false;
  const dx=victim.x-shooter.x,dy=victim.y+1.3-(shooter.y+1.65),dz=victim.z-shooter.z;
  const forward=dx*dir[0]+dy*dir[1]+dz*dir[2];
  if(forward<.1||forward>(opts.range??58))return false;
  const perp=Math.sqrt(Math.max(0,dx*dx+dy*dy+dz*dz-forward*forward));
  if(perp>(opts.perp??.65))return false;
  if(!segmentClear2D(shooter,victim))return false;
  // Crates block shots while walls are already rejected by segmentClear2D.
  for(const box of COVER) {
    if(segmentHitsRect(shooter,victim,box.x-box.w/2,box.x+box.w/2,box.z-box.d/2,box.z+box.d/2)) {
      if(shooter.y+1.65<box.h+0.2||victim.y+1.3<box.h+0.2)return false;
    }
  }
  for(const b of builds) {
    if(b.kind==='wall'&&segmentHitsRect(shooter,victim,b.x-1.05,b.x+1.05,b.z-1.05,b.z+1.05))return false;
  }
  return true;
}
function segmentHitsRect(a,b,x1,x2,z1,z2) {
  const steps=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.3);
  for(let k=1;k<steps;k++) {
    const t=k/steps,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
    if(x>=x1&&x<=x2&&z>=z1&&z<=z2)return true;
  }
  return false;
}
export function advanceRoom(room,dt) {
  if(room.players.size<2) {pauseForMissingPlayers(room);return []}
  const actions=[];
  if(room.phase==='AGENT_SELECT') {
    room.timer-=dt;room.selectElapsed+=dt;
    if(room.timer<=0 || (room.selectElapsed>=4 && [...room.players.values()].every(p=>p.agentLocked))) {
      for(const p of room.players.values())p.agentLocked=true;
      beginPreRound(room);actions.push('AGENTS_LOCKED');actions.push('ROUND_RESET');
    }
  } else if(room.phase==='PRE_ROUND') {
    room.timer-=dt;
    if(room.timer<=0){room.phase='CARRIED';room.timer=ROUND_SECONDS;actions.push('ROUND_LIVE')}
  } else if(room.phase==='CARRIED') {
    room.timer-=dt;
    if(room.timer<=0){roundFinished(room,'DEFENDERS');return actions}
    for(const p of room.players.values()) {
      if(p.id!==room.spikeCarrier||p.role!=='ATTACKERS'||!p.interact||p.health<=0||!nearSite(p)) {room.progress.delete(p.id);continue}
      const progress=(room.progress.get(p.id)||0)+dt;
      room.progress.set(p.id,progress);
      if(progress>=2.6) {
        earnUltimate(p,1);
        room.phase='PLANTED';room.spikeCarrier=null;room.spikeSite=nearSite(p);room.bombTimer=SPIKE_SECONDS;room.progress.clear();actions.push('PLANTED');break;
      }
    }
  } else if(room.phase==='PLANTED') {
    room.bombTimer-=dt;
    if(room.bombTimer<=0){roundFinished(room,'ATTACKERS');return actions}
    for(const p of room.players.values()) {
      if(p.role!=='DEFENDERS'||!p.interact||p.health<=0||nearSite(p)!==room.spikeSite) {room.progress.delete(p.id);continue}
      const progress=(room.progress.get(p.id)||0)+dt;
      room.progress.set(p.id,progress);
      if(progress>=4){earnUltimate(p,1);roundFinished(room,'DEFENDERS');actions.push('DEFUSED');break}
    }
  } else if(room.phase==='ROUND_OVER') {
    room.timer-=dt;
    if(room.timer<=0){nextRound(room);actions.push('ROUND_RESET')}
  } else if(room.phase==='MATCH_OVER') {
    room.timer-=dt;
    if(room.timer<=0){newMatch(room);actions.push('MATCH_RESET')}
  }
  return actions;
}
export function roomStatus(room) {
  let objective='WAITING FOR MATCH',hint='NEED AT LEAST TWO PLAYERS',seconds=0;
  if(room.phase==='AGENT_SELECT'){objective='SELECT YOUR AGENT';hint='CHOOSE AN AGENT AND LOCK IN';seconds=room.timer}
  if(room.phase==='PRE_ROUND'){objective=`ROUND ${room.round} · BUY PHASE`;hint='PRESS M TO BUY WEAPONS AND ABILITY CHARGES';seconds=room.timer}
  if(room.phase==='CARRIED'){objective=`ROUND ${room.round} · SPIKE CARRIED`;hint=`ATTACKERS: HOLD E AT ${Object.keys(SITES).join('/')} · DEFENDERS: HOLD SITES`;seconds=room.timer}
  if(room.phase==='PLANTED'){objective=`SPIKE PLANTED · ${room.spikeSite}`;hint='DEFENDERS: HOLD E TO DEFUSE';seconds=room.bombTimer}
  if(room.phase==='ROUND_OVER'){objective=room.winner;hint='NEXT ROUND STARTING';seconds=room.timer}
  if(room.phase==='MATCH_OVER'){objective=room.winner;hint='REMATCH COUNTDOWN';seconds=room.timer}
  const s=Math.max(0,Math.ceil(seconds));
  return {objective,actionHint:hint,clock:`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`,
    mapId:room.mapId, mapName:ACTIVE_MAP_NAME, sites:Object.keys(SITES), objectiveProgress:0,roundResult:['ROUND_OVER','MATCH_OVER'].includes(room.phase)?room.winner:'',
    score:{...room.score},round:room.round,phase:room.phase,gameType:room.mode,roundSerial:room.roundSerial,
    canBuy:room.phase==='PRE_ROUND',agentSelect:room.phase==='AGENT_SELECT'};
}
export function snapshot(room) {
  return {players:[...room.players.values()].map(p=>({id:p.id,role:p.role,x:p.x,y:p.y,z:p.z,yaw:p.yaw,health:p.health,kills:p.kills,deaths:p.deaths,weapon:p.weapon,ammo:p.ammo,reserve:p.reserve,credits:p.credits,agent:p.agent,agentLocked:p.agentLocked,abilityReadyAt:p.abilityReadyAt,reconUntil:p.reconUntil,charges:p.charges,ultimatePoints:p.ultimatePoints,armor:p.armor,hasteUntil:p.hasteUntil,flashUntil:p.flashUntil})),
    objective:roomStatus(room),phase:room.phase,spikeSite:room.spikeSite,spikeCarrier:room.spikeCarrier,roundSerial:room.roundSerial,mapId:room.mapId};
}

/** Purchase is only legal during PRE_ROUND. Returns a structured outcome for Socket.IO. */
export function buyForPlayer(room,player,id) {
  const weapon=WEAPONS[id];
  if(room.phase!=='PRE_ROUND')return {ok:false,error:'BUY PHASE IS OVER'};
  if(!player||player.health<=0)return {ok:false,error:'PLAYER NOT ACTIVE'};
  if(!weapon)return {ok:false,error:'UNKNOWN WEAPON'};
  if(!canAfford(player.credits,id))return {ok:false,error:'NOT ENOUGH CREDITS'};
  if(player.weapon===id)return {ok:false,error:'ALREADY EQUIPPED'};
  player.credits=clampCredits(player.credits-weapon.price);
  player.weapon=id;player.ammo=weapon.magazine;player.reserve=weapon.reserve;
  return {ok:true,weapon:id,ammo:player.ammo,reserve:player.reserve,credits:player.credits};
}

export function reloadPlayer(player) {
  const w=weaponById(player.weapon);
  if(player.ammo>=w.magazine||player.reserve<=0)return false;
  const n=Math.min(w.magazine-player.ammo,player.reserve);
  player.ammo+=n;player.reserve-=n;
  return true;
}
