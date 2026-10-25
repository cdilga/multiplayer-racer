// Reproduce this visual-only refinement's narrow source, collider and likeness gates.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bake } from '../../../../tools/vehicles/bake.mjs';
import { loadCandidate, sourceContourChecks, projectFeatures, featureCheck } from '../../../../tools/vehicles/fit/likeness.mjs';
const out=path.dirname(fileURLToPath(import.meta.url)),car=path.basename(out),dir=`art/vehicles/${car}`;
const {model,P}=await loadCandidate(car),fixture=JSON.parse(fs.readFileSync(`${dir}/refs/likeness.json`)),sheets=JSON.parse(fs.readFileSync(`${dir}/refs/sheets.json`));
const baselinePivots=JSON.parse(fs.readFileSync(`${out}/baseline-source/pivots.json`));
assert.deepEqual(model.pivots(P),baselinePivots,'visual work must preserve every original pivot');
const beforeV=JSON.parse(fs.readFileSync(`${out}/baseline-source/vehicle.json`)),V=JSON.parse(fs.readFileSync(`${dir}/vehicle.json`));
assert.deepEqual(V.parts,beforeV.parts);assert.deepEqual(V.anchors,beforeV.anchors);assert.deepEqual(V.lods,beforeV.lods);
function glb(bytes){const len=bytes.readUInt32LE(12),j=JSON.parse(bytes.subarray(20,20+len)),bin=bytes.subarray(28+len);return {j,bin};}
function colliders(bytes){const{j,bin}=glb(bytes),out={};for(const n of j.nodes)if(n.name?.startsWith('collider_')){const a=j.accessors[j.meshes[n.mesh].primitives[0].attributes.POSITION],v=j.bufferViews[a.bufferView],o=(v.byteOffset??0)+(a.byteOffset??0);out[n.name]=Array.from(new Float32Array(bin.buffer.slice(bin.byteOffset+o,bin.byteOffset+o+a.count*12))).reduce((a,x,i)=>{if(i%3===0)a.push([]);a.at(-1).push(x);return a;},[]).map(p=>p.join(',')).sort();}return out;}
const baseline=colliders(fs.readFileSync(`${out}/baseline-source/${car}.lod0.glb`));
assert.deepEqual(colliders(fs.readFileSync(`${dir}/${car}.lod0.glb`)),baseline,'every original exported collider triangle is identical');
const baked=await bake(path.resolve(dir));
for(const[file,bytes]of baked.files)assert.ok(Buffer.from(bytes).equals(fs.readFileSync(`${dir}/${file}`)),`${file}: reproducible committed output`);
const results=[];
for(let lod=0;lod<3;lod++){
 const {parts}=model.soups(P,lod),checks=sourceContourChecks(parts,fixture,sheets,`${dir}/refs/masks`,lod),features=projectFeatures(parts,fixture.features,sheets);
 checks.push(...fixture.features.map(f=>featureCheck(f,features[f.name],lod)));
 assert.deepEqual(checks.filter(c=>!c.pass),[],`LOD${lod}: current reference-derived gates`);
 const spec=fixture.features[0],broken=structuredClone(parts),uvs=spec.uvs;
 for(let i=0;i<broken[spec.part].uvs.length;i+=2)if(uvs.some(uv=>Math.abs(broken[spec.part].uvs[i]-uv[0])<1e-6&&Math.abs(broken[spec.part].uvs[i+1]-uv[1])<1e-6))broken[spec.part].uvs.splice(i,2,-1,-1);
 const injected=featureCheck(spec,projectFeatures(broken,[spec],sheets)[spec.name],lod);
 assert.equal(injected.pass,false,'meaningful defect: missing front lamps must fail, not fail import');
 const report=baked.report.lods[lod];assert.ok(report.tris<=V.lods[lod].maxTris,`LOD${lod} budget`);
 results.push({lod,checks,missingFrontLamps:injected,tris:report.tris,breakdown:report.breakdown});
}
fs.writeFileSync(`${out}/checks.json`,JSON.stringify({car,physics:'original collider triangles, pivots, anchors, masses, hinges and budgets unchanged',reproducible:true,results},null,2)+'\n');
console.log(`${car}: original physics exact; reproducible output; every LOD reference gate PASS; missing-lamp defects rejected`);
