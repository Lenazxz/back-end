from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import numpy as np, trimesh
from trimesh.transformations import translation_matrix
out=Path(__file__).resolve().parents[1]/'public/models/signs';out.mkdir(parents=True,exist_ok=True)
try:font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 36)
except:font=ImageFont.load_default()

def rgba(s):return [int(s[i:i+2],16) for i in (1,3,5)]+[255]

def sign(title,base,accent):
  sc=trimesh.Scene();counter=[0]
  def bx(x,y,z,w,h,d,c):
    m=trimesh.creation.box(extents=(w,h,d));m.visual.vertex_colors=np.tile(rgba(c),(len(m.vertices),1));counter[0]+=1
    mat=translation_matrix((x,y,z));sc.add_geometry(m,transform=mat,node_name=f'piece{counter[0]}')
  plateWidth=5.4
  bx(0,0,0,plateWidth,1.20,.17,'#313738')
  bx(0,.52,.12,plateWidth,.13,.26,base)
  bx(0,-.52,.12,plateWidth,.13,.26,base)
  for x in (-2.55,2.55):bx(x,0,.11,.15,1.13,.25,base)
  img=Image.new('L',(400,80));draw=ImageDraw.Draw(img)
  titleText=title.upper()
  b=draw.textbbox((0,0),titleText,font=font)
  draw.text(((400-(b[2]-b[0]))/2,12),titleText,fill=255,font=font)
  img=img.resize((160,32))
  px=np.array(img)>120
  # Horizontal bar merging gives raised lettering with much fewer primitives.
  for yy in range(2,30):
    xx=0
    while xx<160:
      if not px[yy,xx]:xx+=1;continue
      start=xx
      while xx<160 and px[yy,xx]:xx+=1
      width=(xx-start)*.028
      cx=((start+xx)/2-80)*.028
      cy=(16-yy)*.028
      bx(cx,cy,.18,width,.03,.07,accent)
  path=out/f'{title.lower().replace(" ","_")}.glb';path.write_bytes(sc.export(file_type='glb'))
  print(path,path.stat().st_size)
for title,base,accent in [('B MARKET','#bc8c5f','#e8deb6'),('A ALLEY','#b9686b','#ffe4bd'),('MID TOP','#789d93','#e6f3dc'),('BOBA','#6c8090','#f6dfb2')]:sign(title,base,accent)
