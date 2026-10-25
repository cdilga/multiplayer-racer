// Curved open-face helmet regression. An exterior silhouette does not detect the
// previous rectangular skin wafer floating in front of the shell.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { loadCandidate } from '../../../../tools/vehicles/fit/likeness.mjs';
import { swatchUV } from '../atlas.js';
const reference='art/vehicles/postie-bike/refs/lod-plus-1.png';
const hash='06505b41248d9ef1427cd2e8a02f5869dea8c9cc2f582732ae213e222794a6e8';
function frontAt(part,x,y){const uv=swatchUV('skin'),ray=new THREE.Ray(new THREE.Vector3(x,y,3),new THREE.Vector3(0,0,-1)),hit=new THREE.Vector3();let z=-Infinity;
 for(let i=0;i<part.positions.length;i+=9){if(Math.abs(part.uvs[i/3*2]-uv[0])>1e-6||Math.abs(part.uvs[i/3*2+1]-uv[1])>1e-6)continue;
  const tri=[0,3,6].map(k=>new THREE.Vector3(...part.positions.slice(i+k,i+k+3).map((v,a)=>v+part.pivot[a])));
  if(ray.intersectTriangle(...tri,false,hit))z=Math.max(z,hit.z);
 }return Number.isFinite(z)?z:null;
}
export async function runChecks(options={}){
 const {model,P}=await loadCandidate('postie-bike',options),lods=[];
 const referenceIdentity=crypto.createHash('sha256').update(fs.readFileSync(reference)).digest('hex')===hash;
 for(let lod=0;lod<3;lod++){
  const part=model.soups(P,lod).parts.rider,[x,y]=P.rider.head,r=P.rider.headR,fy=y-r*.13;
  // The reference's curved face/visor opening returns into its cheek edges. Sample
  // the central face and both cheeks: the old flat wafer has zero return; its far
  // tier omits the face. The face's existing reference envelope fixes its location.
  const fraction=lod===2?.65:.45,center=frontAt(part,x,fy),edges=[-1,1].map(s=>frontAt(part,x+s*r*fraction,fy));
  const cheekReturn=center!==null&&edges.every(v=>v!==null)?center-Math.max(...edges):null;
  const checks=[{name:'helmet face curves back into both cheek edges',value:cheekReturn,min:.015,pass:cheekReturn!==null&&cheekReturn>=.015}];
  lods.push({lod,checks,pass:checks.every(c=>c.pass)});
 }
 return{reference,referenceHash:hash,referenceIdentity,lods,pass:referenceIdentity&&lods.every(l=>l.pass)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const baseline=process.argv.includes('--baseline'),root='docs/evidence/P1-V-roster-rework/postie-bike/baseline/';console.log(JSON.stringify(await runChecks(baseline?{modelFile:root+'model.js',paramsFile:root+'params.json'}:{}),null,2));}
