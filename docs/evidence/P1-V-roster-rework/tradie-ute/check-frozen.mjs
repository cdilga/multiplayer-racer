import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const dir='art/vehicles/tradie-ute',ev='docs/evidence/P1-V-roster-rework/tradie-ute';
function colliders(file){const b=fs.readFileSync(file),len=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+len)),bin=b.subarray(28+len);return Object.fromEntries(j.nodes.filter(n=>n.name.startsWith('collider_')).map(n=>{const a=j.accessors[j.meshes[n.mesh].primitives[0].attributes.POSITION],v=j.bufferViews[a.bufferView],o=(v.byteOffset??0)+(a.byteOffset??0);return [n.name,crypto.createHash('sha256').update(bin.subarray(o,o+a.count*12)).digest('hex')]}));}
const before=colliders(`${ev}/baseline/tradie-ute.lod0.glb`),lods=[];
for(const lod of [0]){const after=colliders(`${dir}/tradie-ute.lod${lod}.glb`);assert.deepEqual(after,before);lods.push({lod,colliderPositionsIdentical:true,colliders:after});}
const old=JSON.parse(fs.readFileSync(`${ev}/baseline/tradie-ute.asset.json`)),now=JSON.parse(fs.readFileSync(`${dir}/tradie-ute.asset.json`));assert.deepEqual(now,old);
console.log(JSON.stringify({sidecarByteIdentical:fs.readFileSync(`${ev}/baseline/tradie-ute.asset.json`).equals(fs.readFileSync(`${dir}/tradie-ute.asset.json`)),sidecarIdenticalIncludingPivotsHingesMassesAnchorsAndBudgets:true,lods,pass:true},null,2));
