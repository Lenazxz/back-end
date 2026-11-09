import { placementFor, buildConflict, supportsBuild } from './build-grid.js';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import {
  MAX_PLAYERS, safeCode, createCode, newRoom, addPlayer, pauseForMissingPlayers,
  beginPreRound, advanceRoom, snapshot, roomStatus, navigable, moveAllowed,
  roundFinished, hitAllowed, nearSite, buyForPlayer, reloadPlayer, lockAgent, useAgentAbility, buyKitCharge, earnUltimate, ensureRoomMap
} from './match-core.js';
import { weaponById } from './weapons.js';
import { terrainHeight, BALCONIES, MAP_IDS } from './map-layout.js';

const app=express();
const httpServer=createServer(app);
const origins=(process.env.CLIENT_ORIGIN||'*').split(',').map(s=>s.trim());
const io=new Server(httpServer,{cors:{origin:origins.includes('*')?'*':origins,methods:['GET','POST']}});
const rooms=new Map();
let mapCursor=0;
const chooseNewMap=()=>MAP_IDS[(mapCursor++)%MAP_IDS.length];
app.get('/',(_req,res)=>res.json({service:'Arena Forge v13 three-map rotation',version:13,status:'online',activeRooms:rooms.size}));
app.get('/health',(_req,res)=>res.json({ok:true,version:13,rooms:rooms.size,queuePlayers:[...rooms.values()].filter(r=>r.mode==='QUICK').reduce((a,r)=>a+r.players.size,0)}));

const emitState = room => io.to(room.code).emit('snapshot',snapshot(room));
const sendRoundReset = room => io.to(room.code).emit('resetBuilds');
const fail = (reply,error) => reply?.({ok:false,error});
const join = (socket,room,reply) => {
  if(!room)return fail(reply,'ROOM NOT FOUND');
  ensureRoomMap(room.mapId);
  if(room.players.size>=MAX_PLAYERS)return fail(reply,'ROOM FULL');
  if(!['WAITING','AGENT_SELECT','PRE_ROUND'].includes(room.phase))return fail(reply,'ROUND ALREADY STARTED');
  leave(socket);
  const oldSerial=room.roundSerial;
  const player=addPlayer(room,socket.id);
  if(!player)return fail(reply,'ROOM FULL');
  socket.join(room.code);socket.data.code=room.code;
  reply?.({ok:true,code:room.code,role:player.role,players:room.players.size,mode:room.mode,
    builds:room.builds,objective:roomStatus(room),agent:player.agent,mapId:room.mapId});
  if(room.roundSerial!==oldSerial)sendRoundReset(room);
  emitState(room);
};
function leave(socket){
  const code=socket.data.code;if(!code)return;
  const room=rooms.get(code);
  socket.leave(code);socket.data.code=null;
  if(!room)return;
  room.players.delete(socket.id);room.progress.delete(socket.id);
  if(room.spikeCarrier===socket.id)room.spikeCarrier=[...room.players.values()].find(p=>p.role==='ATTACKERS'&&p.health>0)?.id||null;
  if(room.players.size===0)rooms.delete(code);
  else{pauseForMissingPlayers(room);emitState(room)}
}
function findQuickRoom(){
  return [...rooms.values()]
    .filter(r=>r.mode==='QUICK'&&r.players.size<MAX_PLAYERS&&['WAITING','AGENT_SELECT','PRE_ROUND'].includes(r.phase))
    .sort((a,b)=>b.players.size-a.players.size||a.createdAt-b.createdAt)[0];
}

io.on('connection',socket=>{
  socket.use((_packet,next)=>{
    const room=rooms.get(socket.data.code);
    if(room)ensureRoomMap(room.mapId);
    next();
  });
  socket.on('createRoom',(payload,reply=()=>{})=>{
    const code=createCode(rooms);
    const chosen=MAP_IDS.includes(payload?.mapId)?payload.mapId:chooseNewMap();
    const room=newRoom(code,'PRIVATE',chosen);rooms.set(code,room);
    join(socket,room,reply);
  });
  socket.on('joinRoom',(payload,reply=()=>{})=>join(socket,rooms.get(safeCode(payload?.code)),reply));
  socket.on('joinQuickPlay',(_payload,reply=()=>{})=>{
    let room=findQuickRoom();
    if(!room){const code=createCode(rooms);room=newRoom(code,'QUICK',chooseNewMap());rooms.set(code,room)}
    join(socket,room,reply);
  });
  socket.on('selectAgent',(payload,reply=()=>{})=>{
    const room=rooms.get(socket.data.code),player=room?.players.get(socket.id);
    const result=lockAgent(room,player,payload?.id);
    reply(result);if(result.ok)emitState(room);
  });
  socket.on('buyAbility',(payload,reply=()=>{})=>{
    const room=rooms.get(socket.data.code),player=room?.players.get(socket.id);
    const result=buyKitCharge(room,player,payload?.slot);
    reply(result);if(result.ok)emitState(room);
  });
  socket.on('useAbility',(payload,reply=()=>{})=>{
    const room=rooms.get(socket.data.code),player=room?.players.get(socket.id);
    const slot=['signature','q','f','ultimate'].includes(payload?.slot)?payload.slot:'signature';
    const result=useAgentAbility(room,player,Date.now(),slot);
    reply(result);
    if(result.ok){
      if(Array.isArray(result.affected))for(const id of result.affected){
        const victim=room.players.get(id);if(!victim)continue;
        io.to(id).emit('hit',{damage:result.slot==='q'?0:result.slot==='f'?23:38,shooter:player.id,ability:result.ability});
        if(victim.health<=0){
          player.kills++;victim.deaths++;earnUltimate(player,1);
          if(room.spikeCarrier===id)room.spikeCarrier=[...room.players.values()].find(p=>p.role==='ATTACKERS'&&p.health>0&&p.id!==id)?.id||null;
          io.to(room.code).emit('elimination',{killer:player.id,victim:id,team:player.role,weapon:'ability'});
        }
      }
      if(result.affected?.length){
        const opposing=[...room.players.values()].filter(p=>p.role!==player.role);
        const aliveAttackers=[...room.players.values()].filter(p=>p.role==='ATTACKERS'&&p.health>0);
        if(opposing.every(p=>p.health<=0)&&(player.role==='ATTACKERS'||room.phase==='CARRIED'))roundFinished(room,player.role);
        else if(room.phase==='CARRIED'&&!aliveAttackers.length)roundFinished(room,'DEFENDERS');
      }
      io.to(room.code).emit('abilityEffect',{id:player.id,agent:player.agent,slot:result.slot||'signature',x:player.x,z:player.z});
      emitState(room);
    }
  });
  socket.on('leaveRoom',()=>leave(socket));
  socket.on('cancelQueue',()=>leave(socket));
  socket.on('restartRound',()=>{
    const room=rooms.get(socket.data.code);
    if(room?.mode!=='PRIVATE'||room.phase!=='ROUND_OVER'||room.players.size<2)return;
    room.timer=0;
    const actions=advanceRoom(room,.1);
    if(actions.includes('ROUND_RESET'))sendRoundReset(room);
    emitState(room);
  });
  socket.on('playerState',data=>{
    const room=rooms.get(socket.data.code),player=room?.players.get(socket.id);
    if(!player||!data)return;
    // During the short preparation phase, only facing/look changes are accepted.
    const playable=['CARRIED','PLANTED'].includes(room.phase);
    if(!playable){
      if(Number.isFinite(data.yaw))player.yaw=data.yaw;
      if(Number.isFinite(data.pitch))player.pitch=data.pitch;
      player.lastMove=Date.now();player.interact=false;return;
    }
    const now=Date.now();
    if(!moveAllowed(player,data,now))return;
    player.x=data.x;player.y=data.y;player.z=data.z;
    player.yaw=data.yaw;player.pitch=data.pitch;
    player.interact=!!data.interact;
    player.lastMove=now;
  });
  socket.on('build',data=>{
    const room=rooms.get(socket.data.code),player=room?.players.get(socket.id);
    if(!room||!player||!['CARRIED','PLANTED'].includes(room.phase)||player.health<=0)return;
    if(!data||room.builds.length>=500||!['wall','floor','ramp','roof'].includes(data.kind))return;
    const now=Date.now();if(now-player.lastBuild<140)return;
    const {cellX,cellZ,quarter,kind,level}=data;
    if(![cellX,cellZ,quarter,level].every(Number.isFinite) || !Number.isInteger(quarter) || quarter<0 || quarter>3)return;
    if(level<-25||level>5000||Math.hypot(cellX-player.x,cellZ-player.z)>9)return;
    if(!navigable(cellX,cellZ))return;
    const p=placementFor(kind,cellX,cellZ,level,quarter);
    if(!p || Math.abs((data.x??p.x)-p.x)>.02 || Math.abs((data.z??p.z)-p.z)>.02) return;
    if(room.builds.some(b=>buildConflict(p,b)))return;
    const ground=terrainHeight(cellX,cellZ);
    if(level>ground+.5 && !supportsBuild(p,room.builds,BALCONIES.map(b=>({type:'platform',x:b.x,z:b.z,sx:b.w,sz:b.d,top:b.top}))))return;
    player.lastBuild=now;
    const piece={id:`${room.code}-${++room.nextBuild}`,owner:socket.id, ...p};
    room.builds.push(piece);
    io.to(room.code).emit('buildPlaced',piece);
  });
  socket.on('buyWeapon',(payload,reply=()=>{})=>{
    const room=rooms.get(socket.data.code),player=room?.players.get(socket.id);
    if(!room||!player)return fail(reply,'NOT IN A ROOM');
    const result=buyForPlayer(room,player,payload?.id);
    reply(result);
    if(result.ok)emitState(room);
  });
  socket.on('reload',(_payload,reply=()=>{})=>{
    const room=rooms.get(socket.data.code),player=room?.players.get(socket.id);
    if(!room||!player||!['PRE_ROUND','CARRIED','PLANTED'].includes(room.phase)||player.health<=0)return fail(reply,'CANNOT RELOAD NOW');
    const now=Date.now();
    if(player.reloadUntil>now)return fail(reply,'ALREADY RELOADING');
    const result=reloadPlayer(player);
    if(result)player.reloadUntil=now+weaponById(player.weapon).reload*1000;
    reply({ok:result,ammo:player.ammo,reserve:player.reserve});
  });
  socket.on('shoot',data=>{
    const room=rooms.get(socket.data.code),player=room?.players.get(socket.id);
    if(!room||!player||!['CARRIED','PLANTED'].includes(room.phase)||player.health<=0)return;
    const weapon=weaponById(player.weapon);
    const now=Date.now();
    if(now-player.lastShot<weapon.rate*1000*0.87||now<player.reloadUntil||now<(player.flashUntil||0)||player.ammo<=0)return;
    const dir=data?.direction;
    if(!Array.isArray(dir)||dir.length!==3||!dir.every(Number.isFinite))return;
    if(Math.abs(Math.hypot(...dir)-1)>.07)return;
    const fwdX=-Math.sin(player.yaw),fwdZ=-Math.cos(player.yaw);
    if(dir[0]*fwdX+dir[2]*fwdZ<.15)return;
    player.lastShot=now;player.ammo-=1;
    for(const victim of room.players.values()){
      if(victim.id===player.id)continue;
      const distance=Math.hypot(victim.x-player.x,victim.z-player.z);
      if(distance>weapon.range||!hitAllowed(player,victim,dir,room.builds,{range:weapon.range,perp:weapon.id==='shotgun'?.95:.65}))continue;
      const falloff=weapon.id==='shotgun'?Math.max(.18,1-distance/weapon.range):1;
      const rawDamage=weapon.id==='shotgun'?Math.max(8,Math.round(weapon.damage*weapon.pellets*falloff)):weapon.damage;
      const reduction=victim.agent==='bastion'?.88:victim.agent==='aegis'?.92:1;
      const damage=Math.max(1,Math.round(rawDamage*reduction));
      const absorbed=Math.min(victim.armor||0,damage);victim.armor=(victim.armor||0)-absorbed;
      victim.health=Math.max(0,victim.health-(damage-absorbed));
      io.to(victim.id).emit('hit',{damage,shooter:socket.id,weapon:weapon.id});
      if(victim.health===0){
        if(room.spikeCarrier===victim.id)room.spikeCarrier=[...room.players.values()].find(p=>p.role==='ATTACKERS'&&p.health>0&&p.id!==victim.id)?.id||null;
        player.kills++;victim.deaths++;earnUltimate(player,1);player.credits=Math.min(9000,player.credits+200);
        io.to(room.code).emit('elimination',{killer:player.id,victim:victim.id,team:player.role,weapon:weapon.id});
        const enemies=[...room.players.values()].filter(p=>p.role!==player.role);
        const attackers=[...room.players.values()].filter(p=>p.role==='ATTACKERS');
        if(enemies.every(p=>p.health===0)&&(player.role==='ATTACKERS'||room.phase==='CARRIED'))roundFinished(room,player.role);
        else if(room.phase==='CARRIED'&&attackers.every(p=>p.health===0))roundFinished(room,'DEFENDERS');
      }
      break;
    }
    io.to(room.code).emit('shot',{id:socket.id,origin:[player.x,player.y+1.7,player.z],direction:dir,weapon:weapon.id});
  });
  socket.on('disconnect',()=>leave(socket));
});

setInterval(()=>{
  for(const room of rooms.values()) {
    ensureRoomMap(room.mapId);
    const before=room.roundSerial;
    const actions=advanceRoom(room,.1);
    if(room.roundSerial!==before||actions.includes('ROUND_RESET')||actions.includes('MATCH_RESET'))sendRoundReset(room);
  }
},100);
setInterval(()=>{
  for(const room of rooms.values()) {ensureRoomMap(room.mapId);emitState(room);}
},120);
setInterval(()=>{
  const now=Date.now();
  for(const room of rooms.values())if(!room.players.size||now-room.lastActiveAt>4*60*60*1000)rooms.delete(room.code);
},60*1000);
httpServer.listen(Number(process.env.PORT)||3001,'0.0.0.0',()=>console.log('Arena Forge v13 three-map rotation server listening'));
