/** Arena Forge's original v12 roster. Every operative has a passive, a free
 * signature, two buyable utilities, and an earned ultimate. Mirrored on server.
 * Keys: Q/F = purchased, C = signature, V = ultimate.
 */
const skill = (name, description, extras={}) => ({name,description,...extras});
export const AGENTS = Object.freeze({
  rift: {
    id:'rift',name:'RIFT',title:'KINETIC RUNNER',role:'DUELIST',color:'#ef9d69',model:'rift.glb',
    passive:skill('LIGHTFOOT','Move 8% faster whenever you are alive.'),
    signature:skill('VECTOR BURST','Dash up to 5 metres in your facing direction.',{key:'C',cooldown:18}),
    utility1:skill('KINETIC PLATING','Gain 25 temporary armor.',{key:'Q',price:250,max:2}),
    utility2:skill('SPRINT INJECTOR','Gain 25% movement speed for 7 seconds.',{key:'F',price:350,max:1}),
    ultimate:skill('OVERCLOCK','Move faster and gain 20 armor for 12 seconds.',{key:'V',cost:6}),
    description:'A fast entry specialist that fights by taking space and changing angles.'
  },
  aegis: {
    id:'aegis',name:'AEGIS',title:'COMBAT MEDIC',role:'SUPPORT',color:'#6adac8',model:'aegis.glb',
    passive:skill('TACTICAL PADDING','Take 8% less damage from weapons.'),
    signature:skill('REPAIR PULSE','Heal yourself for 35 health.',{key:'C',cooldown:24}),
    utility1:skill('FIELD PLATE','Gain 30 temporary armor.',{key:'Q',price:300,max:2}),
    utility2:skill('TEAM MEDKIT','Restore 20 health to nearby teammates.',{key:'F',price:350,max:1}),
    ultimate:skill('SECOND WIND','Heal all surviving teammates for 45 health.',{key:'V',cost:6}),
    description:'A durable support operative who keeps the whole team in the fight.'
  },
  lumen: {
    id:'lumen',name:'LUMEN',title:'SENSOR SCOUT',role:'RECON',color:'#e7c68b',model:'lumen.glb',
    passive:skill('SITUATIONAL READ','Detect enemy movement within 9 metres on your minimap.'),
    signature:skill('ECHO PULSE','Reveal enemies near you for seven seconds.',{key:'C',cooldown:28}),
    utility1:skill('SCOUT BEACON','Reveal enemies within 15 metres for four seconds.',{key:'Q',price:200,max:2}),
    utility2:skill('FOCUS LENS','Reveal enemies across a wider area for six seconds.',{key:'F',price:400,max:1}),
    ultimate:skill('OMNIVISION','Reveal enemy positions to your team for 14 seconds.',{key:'V',cost:7}),
    description:'A precision intelligence operative who sees danger before the push.'
  },
  ember: {
    id:'ember',name:'EMBER',title:'BREACH SPECIALIST',role:'DUELIST',color:'#ff8b52',model:'ember.glb',
    passive:skill('HOT START','Move 6% faster while alive.'),
    signature:skill('BURST STEP','Dash through a short clear lane.',{key:'C',cooldown:20}),
    utility1:skill('FLASH CHARGE','Temporarily disrupt nearby enemies in direct line of sight.',{key:'Q',price:250,max:2}),
    utility2:skill('HEAT WAVE','Damage enemies within five metres if visible.',{key:'F',price:350,max:1}),
    ultimate:skill('FIRESTORM','Deal damage to visible nearby enemies in an eight-metre radius.',{key:'V',cost:7}),
    description:'An aggressive close-range fighter with a bright orange technical kit.'
  },
  bastion: {
    id:'bastion',name:'BASTION',title:'ARMORED SENTINEL',role:'SENTINEL',color:'#99c888',model:'bastion.glb',
    passive:skill('HEAVY PLATE','Take 12% less damage from weapons.'),
    signature:skill('BULWARK','Gain 35 temporary armor.',{key:'C',cooldown:24}),
    utility1:skill('REINFORCE','Give yourself 25 temporary armor.',{key:'Q',price:300,max:2}),
    utility2:skill('HOLD THE LINE','Grant 20 temporary armor to nearby allies.',{key:'F',price:350,max:1}),
    ultimate:skill('IRON CITADEL','Grant nearby allies 45 temporary armor.',{key:'V',cost:7}),
    description:'A protective soldier who holds chokepoints and shields teammates.'
  }
});
export const AGENT_IDS=Object.freeze(Object.keys(AGENTS));
export const validAgent=id=>typeof id==='string'&&Object.hasOwn(AGENTS,id)?id:'rift';
// Keep the v11 signature names accessible to older UI modules and tests.
for(const a of Object.values(AGENTS)) {a.ability=a.signature.name;a.cooldown=a.signature.cooldown;a.key='C';a.details=`Cooldown ${a.cooldown}s`}
