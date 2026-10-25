import fs from 'node:fs';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import path from 'node:path';
import {loadCandidate} from '../../../tools/vehicles/fit/likeness.mjs';
const BASELINE_REV='a19751dcdf662728f5974e7381dd320b276a1e06';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function oldBytes(p){let b=cp.execFileSync('git',['show',`${BASELINE_REV}:${p}`],{maxBuffer:30e6});if(b.toString('utf8',0,50).startsWith('version https://git-lfs')){const oid=b.toString().match(/oid sha256:(\w+)/)[1],root=cp.execFileSync('git',['rev-parse','--git-path','lfs/objects'],{encoding:'utf8'}).trim();b=fs.readFileSync(path.join(root,oid.slice(0,2),oid.slice(2,4),oid));}return b;}
function glbParts(b){const n=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+n).toString()),out={};for(const m of j.meshes){if(m.name.startsWith('collider_')||m.name.startsWith('interior_'))continue;out[m.name]=m.primitives.reduce((sum,p)=>sum+(p.indices===undefined?j.accessors[p.attributes.POSITION].count:j.accessors[p.indices].count)/3,0);}return out;}
for(const id of ['postie-bike','pig-catcher']){
 const dir=`docs/evidence/P1-V-roster-visual/${id}`,src=`art/vehicles/${id}`,old=await loadCandidate(id,{modelFile:`${dir}/baseline/model.js`,paramsFile:`${dir}/baseline/params.json`}),cur=await loadCandidate(id),V=JSON.parse(fs.readFileSync(`${src}/vehicle.json`));
 const receipt={id,baselineRevision:BASELINE_REV,sourceHashes:{},frozenContracts:{},lods:[],screenshots:'Playwright Chromium 151.0.7922.34, headless/software renderer; viewer is not the running host.'};
 for(const p of ['model.js','params.json','vehicle.json','colliders.json',`${id}.asset.json`,...V.lods.map((_,l)=>`${id}.lod${l}.glb`),'refs/lod-plus-1.png','refs/lowest-lod.png'])receipt.sourceHashes[p]=hash(fs.readFileSync(`${src}/${p}`));
 for(const p of ['vehicle.json','colliders.json',`${id}.asset.json`])receipt.frozenContracts[p]={unchanged:oldBytes(`${src}/${p}`).equals(fs.readFileSync(`${src}/${p}`)),sha256:receipt.sourceHashes[p]};
 for(let lod=0;lod<3;lod++){
  const file=`${src}/${id}.lod${lod}.glb`,before=glbParts(oldBytes(file)),after=glbParts(fs.readFileSync(file)),rawBefore=Object.fromEntries(Object.entries(old.model.soups(old.P,lod).parts).map(([k,p])=>[k,p.tris])),rawAfter=Object.fromEntries(Object.entries(cur.model.soups(cur.P,lod).parts).map(([k,p])=>[k,p.tris]));
  receipt.lods.push({lod,maxTris:V.lods[lod].maxTris,rawBefore,rawAfter,bakedBefore:before,bakedAfter:after,totalBefore:Object.values(before).reduce((a,b)=>a+b,0),totalAfter:Object.values(after).reduce((a,b)=>a+b,0),score:JSON.parse(fs.readFileSync(`${dir}/current-lod${lod}/score.json`)).score});
 }
 fs.writeFileSync(`${dir}/triangle-receipt.json`,JSON.stringify(receipt,null,2)+'\n');
 console.log(id,receipt.lods.map(l=>[l.totalBefore,l.totalAfter,l.maxTris]),receipt.frozenContracts);
}
