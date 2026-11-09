import { AGENTS, validAgent } from './agents.js';

const cap=(n,min,max)=>Math.max(min,Math.min(max,n));
export function prepareKit(player) {
  if(!player.charges)player.charges={q:0,f:0};
  if(!Number.isFinite(player.ultimatePoints))player.ultimatePoints=0;
  if(!Number.isFinite(player.armor))player.armor=0;
  if(!Number.isFinite(player.hasteUntil))player.hasteUntil=0;
  if(!Number.isFinite(player.flashUntil))player.flashUntil=0;
  return player;
}
export function beginKitRound(player) {
  prepareKit(player);
  player.charges={q:0,f:0}; // Utility purchased per round; ultimate charges carry across rounds.
  player.armor=0;player.hasteUntil=0;player.flashUntil=0;
}
export function buyKitCharge(room,player,slot) {
  if(!room || room.phase!=='PRE_ROUND') return {ok:false,error:'BUY PHASE ENDED'};
  if(!player || player.health<=0) return {ok:false,error:'PLAYER NOT ACTIVE'};
  if(!['q','f'].includes(slot)) return {ok:false,error:'INVALID ABILITY SLOT'};
  prepareKit(player);
  const ability=AGENTS[validAgent(player.agent)][slot==='q'?'utility1':'utility2'];
  if(player.charges[slot]>=ability.max)return {ok:false,error:'CHARGES FULL'};
  if(player.credits<ability.price)return {ok:false,error:'INSUFFICIENT CREDITS'};
  player.credits=cap(player.credits-ability.price,0,9000);
  player.charges[slot]++;
  return {ok:true,slot,charges:{...player.charges},credits:player.credits,ability:ability.name};
}
export function earnUltimate(player,points=1) {
  prepareKit(player);
  const goal=AGENTS[validAgent(player.agent)].ultimate.cost;
  player.ultimatePoints=cap(player.ultimatePoints+points,0,goal);
  return player.ultimatePoints;
}
export function usePaidOrUltimate(room,player,slot,now=Date.now(),isVisible=()=>true) {
  if(!room || !player || !['CARRIED','PLANTED'].includes(room.phase) || player.health<=0)return {ok:false,error:'NOT IN ACTIVE ROUND'};
  prepareKit(player);
  const agent=AGENTS[validAgent(player.agent)];
  if(!['q','f','ultimate'].includes(slot))return {ok:false,error:'INVALID ABILITY'};
  const description=slot==='q'?agent.utility1:slot==='f'?agent.utility2:agent.ultimate;
  if(slot==='ultimate'){
    if(player.ultimatePoints<description.cost)return {ok:false,error:`NEED ${description.cost} ULT POINTS`};
  } else if(player.charges[slot]<1)return {ok:false,error:'BUY ABILITY CHARGE DURING PREP'};
  const allies=[...room.players.values()].filter(p=>p.health>0&&p.role===player.role);
  const enemies=[...room.players.values()].filter(p=>p.health>0&&p.role!==player.role);
  const within=(p,r)=>Math.hypot(p.x-player.x,p.z-player.z)<=r;
  const heal=(p,n)=>{p.health=Math.min(100,p.health+n)};
  const giveArmor=(p,n)=>{p.armor=Math.min(85,(p.armor||0)+n)};
  const reveal=(duration,radius=1000)=>{
    const until=now+duration;
    for(const ally of allies)if(within(ally,radius))ally.reconUntil=Math.max(ally.reconUntil||0,until);
  };
  let targets=[];
  if(agent.id==='rift'){
    if(slot==='q')giveArmor(player,25);
    if(slot==='f')player.hasteUntil=now+7000;
    if(slot==='ultimate'){giveArmor(player,20);player.hasteUntil=now+12000;}
  }else if(agent.id==='aegis'){
    if(slot==='q')giveArmor(player,30);
    if(slot==='f')for(const ally of allies)if(within(ally,9))heal(ally,20);
    if(slot==='ultimate')for(const ally of allies)heal(ally,45);
  }else if(agent.id==='lumen'){
    if(slot==='q')reveal(4000,15);
    if(slot==='f')reveal(6000,25);
    if(slot==='ultimate')reveal(14000);
  }else if(agent.id==='ember'){
    if(slot==='q'){
      targets=enemies.filter(e=>within(e,7)&&isVisible(player,e));
      for(const e of targets)e.flashUntil=now+1600;
    }
    if(slot==='f'||slot==='ultimate'){
      const radius=slot==='ultimate'?8:5;
      const damage=slot==='ultimate'?38:23;
      targets=enemies.filter(e=>within(e,radius)&&isVisible(player,e));
      for(const e of targets) {
        // Damage can eliminate, but victory resolution must remain in match rules.
        e.health=Math.max(0,e.health-damage);
      }
    }
  }else if(agent.id==='bastion'){
    if(slot==='q')giveArmor(player,25);
    if(slot==='f')for(const ally of allies)if(within(ally,8))giveArmor(ally,20);
    if(slot==='ultimate')for(const ally of allies)if(within(ally,15))giveArmor(ally,45);
  }
  if(slot==='ultimate')player.ultimatePoints=0;else player.charges[slot]--;
  return {ok:true,slot,ability:description.name,agent:agent.id,charges:{...player.charges},
    ultimatePoints:player.ultimatePoints,armor:player.armor,health:player.health,hasteUntil:player.hasteUntil,
    reconUntil:player.reconUntil,affected:targets.map(t=>t.id)};
}
