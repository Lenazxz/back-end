"""Arena Forge v12: five original detailed, articulated 3D characters.
Vertex-coloured GLBs, locally bundled; no external download/runtime dependency.
The reference images informed the urban tactical clothing direction, not exact replicas.
"""
from pathlib import Path
import trimesh, numpy as np, math
from trimesh.transformations import translation_matrix, rotation_matrix
ROOT=Path(__file__).resolve().parents[1]/'public/models/agents'
ROOT.mkdir(parents=True,exist_ok=True)
COLORS={
 'rift':dict(jacket='#385b63',vest='#253944',cloth='#3f5051',metal='#192a31',accent='#ff965d',skin='#b98266',hair='#2c2826',boots='#202830',face='bare'),
 'aegis':dict(jacket='#557e79',vest='#a2b8a9',cloth='#466c65',metal='#30424d',accent='#66e3cc',skin='#a87a5d',hair='#282a31',boots='#24343c',face='visor'),
 'lumen':dict(jacket='#48485f',vest='#727c92',cloth='#5d6075',metal='#272c3d',accent='#dfc680',skin='#a97b60',hair='#39394a',boots='#2b3039',face='mask'),
 'ember':dict(jacket='#334e55',vest='#272e3e',cloth='#22685f',metal='#1b252f',accent='#ff9748',skin='#b87961',hair='#55322a',boots='#252a35',face='bare'),
 'bastion':dict(jacket='#64735e',vest='#566b65',cloth='#8b7760',metal='#38413b',accent='#b3d998',skin='#d5ad8d',hair='#b6a36c',boots='#4b453e',face='bare'),
}
def rgba(s):
 s=s.lstrip('#');return np.array([int(s[i:i+2],16) for i in (0,2,4)]+[255],dtype=np.uint8)
def T(x=0,y=0,z=0):return translation_matrix((x,y,z))
def R(a,axis):return rotation_matrix(a,axis)

def make(name,c):
 scene=trimesh.Scene(); count=[0]; rig_parts={n:[] for n in ['RigRoot','LeftLegPivot','RightLegPivot','LeftArmPivot','RightArmPivot','HeadPivot']}
 scene.graph.update(frame_to='RigRoot',frame_from='world',matrix=np.eye(4))
 for n,x,y,z in [('LeftLegPivot',-.18,.86,0),('RightLegPivot',.18,.86,0),('LeftArmPivot',-.49,1.58,0),('RightArmPivot',.49,1.58,0),('HeadPivot',0,1.78,0)]:
  scene.graph.update(frame_to=n,frame_from='RigRoot',matrix=T(x,y,z))
 def add(mesh,color,xyz,who,parent='RigRoot',rot=None):
  mesh.visual.vertex_colors=np.tile(rgba(color),(len(mesh.vertices),1))
  count[0]+=1
  x,y,z=xyz
  transform=T(x,y,z)
  if rot:transform=transform@R(rot[0],rot[1])
  mesh.apply_transform(transform)
  rig_parts[parent].append(mesh)
 def cub(color,x,y,z,sx,sy,sz,tag,parent='RigRoot',rot=None):add(trimesh.creation.box(extents=(sx,sy,sz)),color,(x,y,z),tag,parent,rot)
 def ell(color,x,y,z,sx,sy,sz,tag,parent='RigRoot',sub=2):
  m=trimesh.creation.icosphere(subdivisions=sub,radius=1)
  m.apply_scale((sx,sy,sz));add(m,color,(x,y,z),tag,parent)
 def cy(color,x,y,z,r0,r1,h,tag,parent='RigRoot'):
  m=trimesh.creation.cone(radius=r0,height=h,sections=12) if r1==0 else trimesh.creation.cylinder(radius=r0,height=h,sections=12)
  add(m,color,(x,y,z),tag,parent)
 j,v,cloth,metal,a,skin,hair,boot=[c[k] for k in ('jacket','vest','cloth','metal','accent','skin','hair','boots')]
 # Contoured torso + layered shoulder pads and fitted collar.
 ell(j,0,1.35,0,.32,.48,.235,'Torso')
 cub(v,0,1.45,-.22,.58,.60,.12,'ArmoredVest')
 cub(metal,0,1.19,-.291,.48,.12,.032,'VestLowerPlate')
 for y in [1.40,1.54,1.68]:cub(a,0,y,-.293,.5,.013,.018,'VestSeam')
 for x in [-.22,.22]:
  cub(metal,x,1.53,-.297,.048,.43,.038,'VestStrap')
  cub(a,x,1.20,-.305,.06,.068,.036,'VestClip')
 cub(metal,0,.98,0,.61,.17,.37,'UtilityBelt')
 for x in [-.25,-.08,.08,.25]:cub(v,x,.985,-.22,.13,.14,.08,'AmmoPouch')
 for x in [-.30,.30]:cub(a,x,.99,-.26,.048,.075,.028,'BeltBuckle')
 cub(v,0,1.39,.29,.56,.59,.23,'BackPack')
 cub(metal,0,1.46,.418,.37,.36,.07,'PackPanel')
 for x in [-.22,.22]:
  cub(metal,x,1.57,.424,.038,.44,.04,'PackStrap')
 # Arched neck and jacket collar.
 cy(skin,0,1.82,0,.15,.15,.2,'Neck')
 for x in [-.20,.20]:ell(v,x,1.75,-.14,.14,.075,.12,'RaisedCollar')
 # Legs contain separately articulated upper and lower details.
 for side in [-1,1]:
  pivot='LeftLegPivot' if side<0 else 'RightLegPivot'
  ell(cloth,0,-.22,0,.166,.35,.18,'PantUpper',pivot,sub=2)
  cub(cloth,0,-.47,-.02,.30,.32,.29,'PantKnee',pivot)
  cub(metal,0,-.50,-.184,.30,.21,.047,'KneePad',pivot)
  ell(cloth,0,-.69,.01,.136,.23,.155,'PantLower',pivot,sub=1)
  ell(boot,0,-.81,-.12,.175,.13,.26,'BootToe',pivot,sub=2)
  cub(metal,0,-.77,.01,.29,.20,.28,'CombatBoot',pivot)
  for yy in [-.13,-.28,-.40,-.58]:cub(j,0,yy,.18,.22,.022,.02,'TrouserFold',pivot)
  for yy in [-.76,-.69]:cub(a,0,yy,-.27,.21,.025,.02,'BootLace',pivot)
  # Padded arms, elbow joints, gloves and separated knuckles.
  ap='LeftArmPivot' if side<0 else 'RightArmPivot'
  ell(j,0,-.13,0,.185,.27,.19,'SleeveUpper',ap)
  cub(v,0,-.04,-.035,.36,.19,.39,'ShoulderPlate',ap)
  cub(metal,0,-.33,-.04,.29,.22,.31,'ForearmGauntlet',ap)
  cub(a,0,-.34,-.21,.21,.05,.027,'Armband',ap)
  ell(boot,0,-.56,-.08,.12,.12,.12,'GlovedHand',ap,sub=1)
  for k in range(3):cub(boot,(k-1)*.056,-.64,-.11,.052,.09,.075,'GloveFinger',ap)
  cub(a,0,-.055,-.235,.24,.04,.016,'ShoulderTrim',ap)
 # Head, visible expression, eyes and multiple hair sections.
 ell(skin,0,.125,0,.225,.275,.216,'Face','HeadPivot')
 ell(skin,0,.08,-.225,.055,.083,.038,'Nose','HeadPivot',sub=1)
 for x in [-.10,.10]:
  ell('#e9e2d5',x,.17,-.203,.065,.044,.024,'Sclera','HeadPivot',sub=1)
  ell(metal,x,.17,-.227,.022,.028,.015,'Pupil','HeadPivot',sub=1)
  cub(hair,x,.237,-.206,.135,.026,.026,'Brow','HeadPivot')
 ell('#8e5146',0,-.005,-.209,.09,.016,.008,'Lips','HeadPivot',sub=1)
 for side in [-1,1]:ell(skin,side*.238,.12,.0,.04,.086,.08,'Ear','HeadPivot',sub=1)
 # Distinct helmets, hair, headset and clothing per operative.
 if name=='ember':
  ell(hair,0,.38,.027,.235,.155,.22,'CurlyHair','HeadPivot')
  for k in range(8):
   theta=k*math.pi/4
   ell(hair,math.cos(theta)*.18,.35+math.sin(theta*2)*.03,math.sin(theta)*.17,.075,.079,.07,'HairLock','HeadPivot',sub=1)
  cub(a,0,.31,-.25,.45,.09,.25,'OrangeBand','HeadPivot')
  for side in [-1,1]:
   ell(metal,side*.28,.16,-.02,.065,.16,.135,'Headphone','HeadPivot',sub=1)
   cub(a,side*.28,.16,-.152,.065,.09,.035,'HeadphoneLED','HeadPivot')
  cub(a,-.2,1.49,-.3,.12,.38,.05,'Marking')
  cub(a,.38,1.28,.35,.17,.23,.07,'ExplosiveKit')
  cub(metal,.39,1.45,.40,.20,.37,.14,'GrenadePack')
  for side in [-1,1]:cub(a,side*.15,.96,-.28,.07,.10,.04,'UtilityTag')
 elif name=='bastion':
  ell(hair,0,.37,.02,.245,.155,.235,'ShortBlondHair','HeadPivot')
  for k in range(5):ell(hair,-.15+k*.075,.45,-.07,.075,.095,.11,'HairTuft','HeadPivot',sub=1)
  cub(v,0,1.52,-.30,.47,.40,.065,'SoldierVest')
  for x in [-.18,.18]:cub(a,x,1.49,-.34,.11,.13,.038,'ChestPatch')
  cub(a,-.53,-.09,-.19,.20,.09,.024,'ArmInsignia','LeftArmPivot')
  cub(metal,.55,1.19,.23,.12,.37,.21,'RadioUnit')
  cub(boot,.21,.91,-.20,.20,.15,.10,'Canteen')
 elif name=='aegis':
  ell(metal,0,.37,.045,.252,.18,.255,'MedicHelmet','HeadPivot')
  cub(a,0,.32,-.242,.35,.10,.04,'MedicVisor','HeadPivot')
  cub(a,0,1.47,-.295,.23,.060,.02,'MedCrossH')
  cub(a,0,1.47,-.309,.06,.25,.018,'MedCrossV')
  cub(v,-.35,1.28,.24,.18,.42,.19,'MedCanister')
 elif name=='rift':
  ell(hair,0,.37,.016,.25,.12,.24,'KineticHair','HeadPivot')
  ell(metal,0,.405,.06,.22,.11,.21,'RunnerCap','HeadPivot')
  cub(a,0,.40,-.245,.35,.07,.17,'VisorStripe','HeadPivot')
  for side in [-1,1]:cub(a,side*.36,1.44,.32,.10,.34,.10,'Thruster')
 elif name=='lumen':
  ell(metal,0,.37,.025,.255,.2,.25,'ReconHelmet','HeadPivot')
  cub(v,0,.19,-.247,.35,.16,.05,'Mask','HeadPivot')
  for x in [-.10,.10]:cub(a,x,.24,-.294,.07,.045,.025,'SensorLens','HeadPivot')
  cy(a,.24,.67,.02,.04,0,.23,'AntennaTip','HeadPivot')
  cub(a,-.3,1.50,.28,.11,.35,.065,'BackSensor')
 # Complex carried rifle geometry with stock, iron sight, magazine and barrel.
 cub(metal,.28,1.29,-.43,.15,.18,.67,'RifleReceiver')
 cub(v,.28,1.42,-.52,.14,.07,.41,'TopRail')
 cub(boot,.28,1.28,-.87,.08,.065,.38,'RifleBarrel')
 cub(metal,.28,1.21,-.20,.23,.11,.28,'Stock')
 cub(v,.28,1.06,-.41,.12,.25,.13,'Magazine')
 cub(a,.28,1.47,-.66,.038,.07,.05,'FrontSight')
 # Merge static pieces by articulated rig region: six draw calls per agent
 # rather than ~100, while preserving all the distinct vertex colours/details.
 for region,parts in rig_parts.items():
  if parts:
   merged=trimesh.util.concatenate(parts)
   scene.add_geometry(merged,geom_name=f'{region}_geometry',node_name=f'{region}_Model',parent_node_name=region,transform=np.eye(4))
 path=ROOT/f'{name}.glb'
 path.write_bytes(scene.export(file_type='glb'))
 parsed=trimesh.load(path,force='scene')
 print(name,path.stat().st_size,'bytes',len(parsed.geometry),'components')
for k,c in COLORS.items():make(k,c)
