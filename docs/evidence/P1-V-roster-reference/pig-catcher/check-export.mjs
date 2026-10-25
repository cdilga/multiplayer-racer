import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const car=path.basename(path.dirname(new URL(import.meta.url).pathname)),dir=`art/vehicles/${car}`,evidence=`docs/evidence/P1-V-roster-reference/${car}`;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function oldFile(file) {
  const revision=fs.readFileSync(`${evidence}/baseline-revision.txt`,'utf8').trim();
  const b=execFileSync('git',['show',`${revision}:${file}`],{maxBuffer:20*1024*1024});
  if(b.subarray(0,30).toString().startsWith('version https://git-lfs')) {
    const oid=b.toString().match(/oid sha256:([a-f0-9]+)/)[1];
    return fs.readFileSync(path.join(execFileSync('git',['rev-parse','--git-path','lfs/objects'],{encoding:'utf8'}).trim(),oid.slice(0,2),oid.slice(2,4),oid));
  }
  return b;
}
function glb(b) {
  const length=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+length).toString()),bin=b.subarray(28+length);
  const values=n=> { const a=j.accessors[n],v=j.bufferViews[a.bufferView],o=(v.byteOffset??0)+(a.byteOffset??0);assert.equal(a.componentType,5126);return Array.from({length:a.count*3},(_,i)=>bin.readFloatLE(o+i*4)); };
  return {j,values};
}
const old=glb(oldFile(`${dir}/${car}.lod0.glb`)),current=glb(fs.readFileSync(`${dir}/${car}.lod0.glb`)),colliders={};
for(const n of old.j.nodes.filter(n=>n.name?.startsWith('collider_'))) {
  const now=current.j.nodes.find(x=>x.name===n.name);
  const a=old.values(old.j.meshes[n.mesh].primitives[0].attributes.POSITION),b=current.values(current.j.meshes[now.mesh].primitives[0].attributes.POSITION);
  assert.deepEqual(b,a,`${n.name}: exact float32 collider triangles`);
  colliders[n.name]={unchanged:true,sha256:hash(Buffer.from(Float32Array.from(b).buffer))};
}
const side=JSON.parse(fs.readFileSync(`${dir}/${car}.asset.json`)),previous=JSON.parse(fs.readFileSync(`${evidence}/baseline.asset.json`));
assert.deepEqual(side,previous,'sidecar physics, hinges, masses and anchors unchanged');
const lods=[];
for(let lod=0;lod<3;lod++) {
  const {j,values}=glb(fs.readFileSync(`${dir}/${car}.lod${lod}.glb`));let triangles=0;const parts={};
  assert.equal(j.materials.length,1);
  for(const n of j.nodes.filter(n=>n.mesh!=null&&!n.name.startsWith('collider_'))) {
    const p=values(j.meshes[n.mesh].primitives[0].attributes.POSITION);assert.ok(p.every(Number.isFinite));
    for(let i=0;i<p.length;i+=9) { const a=[p[i+3]-p[i],p[i+4]-p[i+1],p[i+5]-p[i+2]],b=[p[i+6]-p[i],p[i+7]-p[i+1],p[i+8]-p[i+2]];assert.ok(Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])>1e-12,`${n.name} LOD${lod}: nonzero triangle`); }
    parts[n.name]=p.length/9;
    // Budgets apply to the visible intact vehicle; optional interior instances are counted separately.
    if(!n.name.startsWith('interior_'))triangles+=p.length/9;
  }
  assert.ok(triangles<=side.lods[lod].maxTris,`${triangles} <= ${side.lods[lod].maxTris}`);
  lods.push({lod,triangles,maxTris:side.lods[lod].maxTris,parts});
}
fs.writeFileSync(`${evidence}/export-checks.json`,JSON.stringify({car,pass:true,baseline:'HEAD before roster refinement',sidecarUnchanged:true,colliders,lods},null,2)+'\n');
console.log(`${car}: exported budgets, finite/nonzero triangles, one material, exact collider and sidecar preservation PASS`);
