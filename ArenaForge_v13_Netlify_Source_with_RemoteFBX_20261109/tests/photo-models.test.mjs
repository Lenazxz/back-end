import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const files=['pink_midrise','warehouse_front','old_shopfront','corrugated_row','industrial_corner'];
for (const name of files) {
  test(`${name} is a self-contained textured GLB asset`, () => {
    const data = readFileSync(new URL(`../public/models/photocity/${name}.glb`, import.meta.url));
    assert.equal(data.toString('utf8',0,4),'glTF');
    assert.equal(data.readUInt32LE(4),2);
    assert.equal(data.readUInt32LE(8),data.byteLength);
    const jsonLength=data.readUInt32LE(12);
    const gltf=JSON.parse(data.toString('utf8',20,20+jsonLength));
    assert.ok(gltf.meshes.length>=3,'building has multiple dimensional meshes');
    assert.ok(gltf.images.length>=1,'building has an embedded photograph');
    assert.ok(gltf.materials.some((m)=>m.pbrMetallicRoughness?.baseColorTexture),'photo texture is bound to a mesh');
    assert.ok(gltf.images.some((img)=>img.bufferView!==undefined),'texture is bundled into GLB');
  });
}
