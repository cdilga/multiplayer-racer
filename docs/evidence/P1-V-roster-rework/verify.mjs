import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {glbStats} from '../../../tools/vehicles/review/build.mjs';
const root='docs/evidence/P1-V-roster-rework',revision='ad35536b';
const cars=['au-hawk','cruz-missile','lion-president','pig-catcher','postie-bike','tradie-ute'];
function previous(file){let b=execFileSync('git',['show',`${revision}:${file}`],{maxBuffer:30*1024*1024});
  if(b.subarray(0,30).toString().startsWith('version https://git-lfs')){const oid=b.toString().match(/oid sha256:([a-f0-9]+)/)[1],objects=execFileSync('git',['rev-parse','--git-path','lfs/objects'],{encoding:'utf8'}).trim();b=fs.readFileSync(path.join(objects,oid.slice(0,2),oid.slice(2,4),oid));}return b;
}
function glb(b){const len=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+len)),bin=b.subarray(28+len);return {j,positions(a){const v=j.bufferViews[j.accessors[a].bufferView],offset=(v.byteOffset??0)+(j.accessors[a].byteOffset??0);assert.equal(j.accessors[a].componentType,5126);return bin.subarray(offset,offset+j.accessors[a].count*12);}};}
const results=[];
for(const car of cars){const dir=`art/vehicles/${car}`,e=`${root}/${car}`;
  fs.mkdirSync(e,{recursive:true});
  fs.writeFileSync(`${e}/final-bake-check.txt`,execFileSync(process.execPath,['tools/vehicles/bake.mjs','--check',dir],{encoding:'utf8'}));
  const contract=execFileSync('target/debug/jj',['validate',`${dir}/${car}.asset.json`],{encoding:'utf8'});fs.writeFileSync(`${e}/final-contract.txt`,contract);
  const side=fs.readFileSync(`${dir}/${car}.asset.json`);assert.deepEqual(side,previous(`${dir}/${car}.asset.json`),`${car}: exact original sidecar`);
  const old=glb(previous(`${dir}/${car}.lod0.glb`)),now=glb(fs.readFileSync(`${dir}/${car}.lod0.glb`)),colliders=[];
  for(const node of old.j.nodes.filter(n=>n.name?.startsWith('collider_'))){const n=now.j.nodes.find(n=>n.name===node.name);assert.ok(n,node.name);const a=old.positions(old.j.meshes[node.mesh].primitives[0].attributes.POSITION),b=now.positions(now.j.meshes[n.mesh].primitives[0].attributes.POSITION);assert.deepEqual(b,a,`${car}/${node.name}: original collision points`);colliders.push({name:node.name,sha256:crypto.createHash('sha256').update(b).digest('hex')});}
  const asset=JSON.parse(side),lods=asset.lods.map((l,lod)=>({lod,...glbStats(`${dir}/${l.file}`),budget:l.maxTris}));for(const l of lods)assert.ok(l.tris<=l.budget,`${car} LOD${l.lod} budget`);
  execFileSync('target/debug/jj',['vehicle','sync',`assets/profiles/${car}.json`],{encoding:'utf8'});
  results.push({car,reproducible:true,contract:contract.trim(),sidecarByteIdentical:true,colliders,lods});
}
fs.writeFileSync(`${root}/exports.json`,JSON.stringify({baseline:revision,results},null,2)+'\n');console.log('PASS six reproducible bakes/native contracts, all18 budgets, byte-identical original sidecars and collider triangles.');
