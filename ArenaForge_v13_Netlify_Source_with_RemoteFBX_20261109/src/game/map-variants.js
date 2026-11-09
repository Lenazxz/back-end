/** Additional original playable plans adapted from the player's two uploaded layout drawings. */
const area = (id,label,tint,x1,z1,x2,z2) => {
  const polygon=[{x:x1,z:z1},{x:x2,z:z1},{x:x2,z:z2},{x:x1,z:z2}];
  return { id,label,tint,polygon,x1,x2,z1,z2 };
};
const cover = (x,z,kind='crate',w=2,d=2,h=1.4) => ({x,z,kind,w,d,h});
const deck = (id,x,z,top,w=5,d=5) => ({id,x,z,top,w,d,kind:'balcony'});
const ramp = (id,x,z,height,rotation=0,width=4,depth=7) => ({id,x,z,height,rotation,width,depth});
const loc = (text,x,z) => ({text,x,z});
const limits = {minX:-54,maxX:54,minZ:-84,maxZ:84};
const pair = (x,z) => ({x,z});

const exchangeAreas=[
  area('exchange-attacker-spawn','ATTACKER SPAWN','spawn',-10,62,10,80),
  area('exchange-south-mid','MID SHOPS','spawn',-7,32,7,65),
  area('exchange-b-ramp','B RAMP','lane',-42,4,-30,55),
  area('exchange-b-lobby','B CLUB','lane',-35,46,-4,58),
  area('exchange-b-main','B MAIN','lane',-49,-20,-30,10),
  area('exchange-b-site','B SITE','siteB',-51,-34,-29,-13),
  area('exchange-b-screen','B SCREEN','lane',-45,-45,-31,-30),
  area('exchange-b-def-route','B HALL','lane',-42,-59,-31,-39),
  area('exchange-b-def-link','DEFENDER B WATER','lane',-35,-59,-4,-49),
  area('exchange-a-lobby','A RESTAURANT','lane',4,44,36,55),
  area('exchange-a-main','A MAIN','lane',30,2,43,52),
  area('exchange-a-lift','A LIFT','lane',30,-18,49,12),
  area('exchange-a-site','A SITE','siteA',29,-34,51,-13),
  area('exchange-a-secret','A SECRET','lane',34,-47,49,-28),
  area('exchange-a-def-route','A DUGOUT','lane',31,-59,44,-42),
  area('exchange-a-def-link','DEFENDER A RECORDS','lane',4,-59,36,-49),
  area('exchange-mid-bottom','MID TOP','mid',-9,4,9,35),
  area('exchange-mid-plaza','MID PLAZA','mid',-10,-20,10,9),
  area('exchange-mid-west','B LINK','lane',-32,-9,-7,4),
  area('exchange-mid-east','A LINK','lane',7,-10,33,3),
  area('exchange-mid-north','MID CONNECTOR','mid',-8,-52,8,-17),
  area('exchange-def-spawn','DEFENDER SPAWN','spawn',-10,-81,10,-55)
];
const exchangeSites={A:pair(40,-24),B:pair(-40,-23)};
const exchange={
  id:'exchange', name:'CANAL EXCHANGE', description:'Two-site industrial exchange with cross-links, long flank lanes and underground access.',
  limits, sites:exchangeSites,
  spawns:{ATTACKERS:{x:0,z:72,yaw:0},DEFENDERS:{x:0,z:-72,yaw:Math.PI}},
  areas:exchangeAreas,
  holes:[area('exchange-mid-block','MID PLAZA ARCHIVE','hole',-3,-5,3,5)],
  labels:[loc('A SITE',40,-24),loc('B SITE',-40,-23),loc('B HALL',-38,-45),loc('B RAMP',-37,21),loc('B LINK',-20,-3),loc('MID CONNECTOR',0,-31),loc('MID PLAZA',0,14),loc('A LINK',22,-4),loc('A RESTAURANT',20,50),loc('A MAIN',36,24),loc('A SECRET',40,-43),loc('ATTACKER SPAWN',0,72),loc('DEFENDER SPAWN',0,-72)],
  cover:[cover(-46,-30,'generator',2.5,2.5,2),cover(46,-30,'generator',2.4,2.3,1.8),cover(0,13,'crate'),cover(-39,22,'crate'),cover(38,22,'console'),cover(-18,-4,'crate'),cover(20,-5,'console'),cover(0,-37,'crate')],
  balconies:[deck('B HALL UPPER',-38,-43,5.4,5,8),deck('A SECRET OVERLOOK',40,-43,6,5,7),deck('MID ARCHIVE BRIDGE',0,-13,4.2,11,4)],
  ramps:[ramp('B HALL STAIRS',-38,-36,5.4,0,4,9),ramp('A SECRET STAIRS',40,-36,6,0,4,9),ramp('MID BRIDGE RAMP',0,-7,4.2,0,4,8)],
  elevation:{A:-3.4,B:4.2},
  zoneNames:['EXCHANGE','WATERWORKS','B HALL','A SECRET']
};

const triadAreas=[
 area('triad-attacker-spawn','ATTACKER SPAWN','spawn',-12,-82,12,-61),
 area('triad-attacker-mid','C LOBBY','spawn',-8,-65,9,-26),
 area('triad-a-long','A LONG','lane',-46,-48,-5,-36),
 area('triad-a-garden','A GARDEN','lane',-49,-47,-36,-2),
 area('triad-a-site','A SITE','siteA',-51,-14,-31,15),
 area('triad-a-short','A SHORT','lane',-34,-5,-7,7),
 area('triad-b-courtyard','MID COURTYARD','mid',-11,-27,11,-1),
 area('triad-b-site','B SITE','siteB',-13,-8,13,15),
 area('triad-c-lobby','C CUBBY','lane',4,-48,46,-36),
 area('triad-c-long','C LONG','lane',36,-43,50,9),
 area('triad-c-site','C SITE','siteC',31,-13,52,16),
 area('triad-c-short','C SHORT','lane',8,-5,35,7),
 area('triad-mid-doors','MID DOORS','mid',-10,11,10,37),
 area('triad-a-link','A LINK','lane',-44,7,-30,42),
 area('triad-b-back','B BACK','lane',-11,28,11,49),
 area('triad-c-link','C LINK','lane',31,9,46,43),
 area('triad-def-connector','DEFENDER CONNECTION','lane',-45,36,46,47),
 area('triad-def-spawn','DEFENDER SPAWN','spawn',-12,42,12,81),
 area('triad-mid-window','MID WINDOW','upper',-15,-38,18,-28)
];
const triadSites={A:pair(-40,2),B:pair(0,3),C:pair(41,2)};
const triad={
 id:'triad',name:'TRIAD ATRIUM',description:'Three bomb sites with top and bottom spawns, mid windows, courtyard and cross-site rotations.',
 limits,sites:triadSites,spawns:{ATTACKERS:{x:0,z:-73,yaw:Math.PI},DEFENDERS:{x:0,z:70,yaw:0}},
 areas:triadAreas,holes:[area('triad-mid-column','COURTYARD COLUMN','hole',-3,-23,3,-13)],
 labels:[loc('A SITE',-40,2),loc('B SITE',0,3),loc('C SITE',41,2),loc('A LONG',-27,-40),loc('A SHORT',-20,0),loc('B COURTYARD',0,-17),loc('MID WINDOW',0,-32),loc('C SHORT',23,0),loc('C LONG',43,-27),loc('B BACK',0,36),loc('C LINK',39,28),loc('A LINK',-38,28),loc('ATTACKER SPAWN',0,-73),loc('DEFENDER SPAWN',0,70)],
 cover:[cover(-47,10,'generator',2.8,2.4,1.6),cover(-7,11,'generator',2.4,2.4,1.7),cover(47,11,'generator',3,2,1.8),cover(0,-7,'crate'),cover(-20,-41,'crate'),cover(24,-41,'crate'),cover(-18,41,'console'),cover(22,41,'console')],
 balconies:[deck('A TOWER',-43,9,5,5,7),deck('MID WINDOW OVERPASS',0,-30,5.8,8,5),deck('C WINDOW WALK',42,8,6.8,4.6,8)],
 ramps:[ramp('A TOWER STEPS',-43,17,5,0,4,10),ramp('MID WINDOW STEPS',0,-23,5.8,Math.PI,4,10),ramp('C WINDOW STEPS',42,16,6.8,0,4,10)],
 elevation:{A:-1.8,B:2.6,C:3.1},zoneNames:['TRIAD','ATRIUM','C SITE','B BACK']
};

export const EXTRA_MAPS={exchange,triad};
