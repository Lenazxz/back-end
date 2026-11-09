"""Generate original compact GLB characters; licensed to the user for use in this project.
Models contain named articulated nodes for inexpensive procedural animation in Three.js.
"""
from pathlib import Path
import numpy as np, trimesh
from trimesh.transformations import translation_matrix, rotation_matrix

ROOT=Path(__file__).resolve().parents[1]/'public'/'models'/'agents'; ROOT.mkdir(parents=True,exist_ok=True)

AGENTS = {
    'rift': dict(primary='#7a4542', secondary='#a35d42', accent='#f6a45d', armor='#373b43', skin='#c79775'),
    'aegis': dict(primary='#38666c', secondary='#66a7a6', accent='#9cf3d8', armor='#384c52', skin='#b88e70'),
    'lumen': dict(primary='#615274', secondary='#8f7fa5', accent='#ead18c', armor='#32343e', skin='#9f7c60'),
}

def rgba(color):
    s=color.lstrip('#');return np.array([int(s[i:i+2],16) for i in (0,2,4)]+[255],dtype=np.uint8)

def xform(x=0,y=0,z=0, angle=None, axis=(1,0,0)):
    mat=translation_matrix((x,y,z))
    if angle: mat=mat @ rotation_matrix(angle,axis)
    return mat

def make(agent,colors):
    scene=trimesh.Scene(); serial=[0]
    scene.graph.update(frame_to='RigRoot',frame_from='world', matrix=np.eye(4))
    for part,ox,oy,oz in [('LeftLegPivot',-.19,.87,0),('RightLegPivot',.19,.87,0),('LeftArmPivot',-.53,1.61,0),('RightArmPivot',.53,1.61,0),('HeadPivot',0,1.82,0)]:
        scene.graph.update(frame_to=part,frame_from='RigRoot',matrix=xform(ox,oy,oz))
    def add(mesh,color,x,y,z,name,parent='RigRoot'):
        mesh.visual.vertex_colors = np.tile(rgba(color),(len(mesh.vertices),1))
        serial[0]+=1
        scene.add_geometry(mesh, geom_name=f'{name}_geo_{serial[0]}',node_name=f'{name}_{serial[0]}', parent_node_name=parent,transform=xform(x,y,z))
    def box(color,x,y,z,w,h,d,name,parent='RigRoot'):
        mesh=trimesh.creation.box(extents=(w,h,d));add(mesh,color,x,y,z,name,parent)
    def ell(color,x,y,z,rx,ry,rz,name,parent='RigRoot'):
        mesh=trimesh.creation.icosphere(subdivisions=2,radius=1)
        mesh.apply_scale((rx,ry,rz));add(mesh,color,x,y,z,name,parent)
    p,s,a,d,skin=[colors[k] for k in ('primary','secondary','accent','armor','skin')]
    # torso with fitted jackets, articulated limbs and detailed helmet
    box(p,0,1.37,0,.68,.76,.38,'Jacket')
    box(s,0,1.49,-.225,.50,.44,.07,'VestArmor')
    box(d,0,1.02,0,.56,.20,.38,'WaistBelt')
    box(a,0,1.73,-.16,.20,.08,.16,'HarnessBadge')
    box(d,0,1.43,.25,.50,.62,.18,'Backpack')
    for sx in (-1,1):
        box(d,sx*.35,1.62,.0,.16,.21,.37,'ShoulderBack')
        box(d,sx*.22,1.02,-.19,.14,.12,.04,'BeltPouch')
        leg='LeftLegPivot' if sx<0 else 'RightLegPivot'
        box(p,0,-.23,0,.27,.48,.30,'TrouserThigh',leg)
        box(d,0,-.51,-.07,.29,.19,.30,'KneeArmor',leg)
        box(p,0,-.72,0,.25,.33,.26,'TrouserCalf',leg)
        box(d,0,-.79,-.10,.29,.21,.43,'Boot',leg)
        arm='LeftArmPivot' if sx<0 else 'RightArmPivot'
        box(s,0,-.13,0,.28,.30,.29,'UpperSleeve',arm)
        box(d,0,-.33,-.07,.25,.26,.26,'ForearmGuard',arm)
        ell(skin,0,-.56,-.06,.12,.12,.11,'Glove',arm)
        box(d,0,-.04,-.05,.33,.19,.35,'ShoulderPlate',arm)
    # head pivot, modeled visor geometry and face details
    ell(skin,0,.15,0,.22,.27,.23,'Face','HeadPivot')
    ell(d,0,.33,0,.29,.27,.28,'Helmet','HeadPivot')
    box(a,0,.29,-.265,.41,.15,.045,'Visor','HeadPivot')
    box(d,0,.10,-.25,.46,.08,.06,'FaceMask','HeadPivot')
    box(a,0,.49,-.05,.32,.042,.24,'HelmetStripe','HeadPivot')
    if agent=='rift':
        box(a,-.27,1.48,-.25,.11,.41,.07,'DashMark')
        box(d,.36,1.53,.30,.16,.47,.19,'RiftThruster')
        box(a,.36,1.60,.41,.11,.24,.04,'ThrusterGlow')
    if agent=='aegis':
        box(a,0,1.47,-.277,.23,.085,.035,'MedicCrossHorizontal')
        box(a,0,1.47,-.29,.08,.24,.035,'MedicCrossVertical')
        box(s,0,1.30,.37,.28,.42,.09,'MedDevice')
    if agent=='lumen':
        box(a,.21,2.38,.08,.06,.50,.07,'Antenna')
        ell(a,.21,2.65,.08,.07,.09,.07,'AntennaTip')
        box(s,0,1.25,-.3,.32,.06,.05,'SensorStrip')
    # rifle under right arm contributes to recognizable character silhouette
    box(d,.30,1.31,-.45,.14,.14,.69,'RifleBody')
    box(s,.30,1.34,-.89,.06,.06,.33,'RifleBarrel')
    path=ROOT/f'{agent}.glb'
    path.write_bytes(scene.export(file_type='glb'))
    test=trimesh.load(path,force='scene')
    print(path, path.stat().st_size,'bytes',len(test.geometry),'meshes',len(test.graph.nodes),'nodes')
for n,c in AGENTS.items():make(n,c)
