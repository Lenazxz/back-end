/** Arena Forge original firearms. Server and client share identical stat definitions. */
export const STARTING_CREDITS = 1700;
export const CREDIT_CAP = 9000;
export const WEAPONS = Object.freeze({
  sidearm: Object.freeze({id:'sidearm',name:'GRIT SIDEARM',category:'SIDEARM',price:0,damage:26,magazine:12,reserve:48,rate:0.23,reload:1.2,range:46,spread:0.006,pellets:1,automatic:false,description:'Free precision backup'}),
  smg: Object.freeze({id:'smg',name:'CINDER SMG',category:'SMG',price:1500,damage:20,magazine:32,reserve:128,rate:0.083,reload:1.65,range:33,spread:0.023,pellets:1,automatic:true,description:'Fast close-range spray'}),
  shotgun: Object.freeze({id:'shotgun',name:'BREACH-6',category:'SHOTGUN',price:1800,damage:13,magazine:6,reserve:30,rate:0.82,reload:1.9,range:21,spread:0.09,pellets:6,automatic:false,description:'Six pellets; strong up close'}),
  rifle: Object.freeze({id:'rifle',name:'VANTA RIFLE',category:'RIFLE',price:2700,damage:34,magazine:30,reserve:90,rate:0.105,reload:1.65,range:61,spread:0.012,pellets:1,automatic:true,description:'Versatile assault rifle'}),
  marksman: Object.freeze({id:'marksman',name:'NIGHTFALL DMR',category:'MARKSMAN',price:3200,damage:58,magazine:10,reserve:40,rate:0.47,reload:2.15,range:90,spread:0.004,pellets:1,automatic:false,description:'Heavy, accurate single shots'})
});
export const WEAPON_LIST = Object.freeze(['sidearm','smg','shotgun','rifle','marksman']);
export function weaponById(id){return WEAPONS[id]||WEAPONS.sidearm;}
export function canAfford(credits,id){const w=WEAPONS[id];return !!w&&Number.isFinite(credits)&&credits>=w.price;}
export function clampCredits(value){return Math.max(0,Math.min(CREDIT_CAP,Math.trunc(value||0)));}
