// Local reference gates for the errors rejected in the roster rework. They inspect
// current triangles. Baseline overrides use the original module's import directory.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadCandidate } from '../../../../tools/vehicles/fit/likeness.mjs';
import { swatchUV } from '../atlas.js';
const reference='art/vehicles/pig-catcher/refs/lod-plus-1.png';
const hash='994a995591c2eaf637a352936b7d149397f52601ca75d4f73371b0e65ed85e7c';

function selected(part,sw,{central=false}={}) {
 const uv=swatchUV(sw),out=[];
 for(let i=0;i<part.positions.length;i+=9){if(Math.abs(part.uvs[i/3*2]-uv[0])>1e-6||Math.abs(part.uvs[i/3*2+1]-uv[1])>1e-6)continue;
  const tri=[0,3,6].map(k=>part.positions.slice(i+k,i+k+3).map((v,a)=>v+part.pivot[a]));
  if(central&&tri.some(p=>Math.abs(p[0])>.18))continue;out.push(tri);
 }return out;
}
function section(triangles,y){const zs=[];for(const tri of triangles)for(let i=0;i<3;i++){const a=tri[i],b=tri[(i+1)%3];if(Math.abs(a[1]-y)<1e-8)zs.push(a[2]);if((a[1]-y)*(b[1]-y)<0){const t=(y-a[1])/(b[1]-a[1]);zs.push(a[2]+(b[2]-a[2])*t);}}return zs.length?{lo:Math.min(...zs),hi:Math.max(...zs)}:null;}

export async function runChecks(options={}){
 const {model,P}=await loadCandidate('pig-catcher',options),lods=[];
 const referenceIdentity=crypto.createHash('sha256').update(fs.readFileSync(reference)).digest('hex')===hash;
 for(let lod=0;lod<3;lod++){
  const parts=model.soups(P,lod).parts,engine=selected(parts.core,'engine'),ys=engine.flat().map(p=>p[1]),lo=Math.min(...ys),hi=Math.max(...ys);
  const widths=Array.from({length:79},(_,i)=>section(engine,lo+(hi-lo)*(i+1)/80)).filter(Boolean).map(s=>s.hi-s.lo),maximum=Math.max(...widths);
  const bottom=[.07,.10,.13].map(t=>section(engine,lo+(hi-lo)*t));
  const bottomWidthRatio=bottom.every(Boolean)?bottom.reduce((n,s)=>n+(s.hi-s.lo)/maximum,0)/bottom.length:null;
  const torso=selected(parts.rider,'shirt',{central:true}),lower=section(torso,1.22),upper=section(torso,1.50);
  const torsoForwardSlope=lower&&upper?Math.abs((upper.lo+upper.hi-lower.lo-lower.hi)/2)/.28:null;
  // The unchanged side reference has a rounded lower casting, not full-width bottom
  // corners, and a nearly upright shirt centreline (about 10–12 degrees). The generous
  // envelopes retain faceting/pose uncertainty; they reject the old cuboid/plank.
  const checks=[{name:'rounded lower crankcase narrows before its bottom',value:bottomWidthRatio,max:.82,pass:bottomWidthRatio!==null&&bottomWidthRatio<=.82},
   {name:'standing rider shirt remains nearly upright',value:torsoForwardSlope,max:.25,pass:torsoForwardSlope!==null&&torsoForwardSlope<=.25}];
  lods.push({lod,checks,pass:checks.every(c=>c.pass)});
 }
 return{reference,referenceHash:hash,referenceIdentity,lods,pass:referenceIdentity&&lods.every(l=>l.pass)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const baseline=process.argv.includes('--baseline'),root='docs/evidence/P1-V-roster-rework/pig-catcher/baseline/';console.log(JSON.stringify(await runChecks(baseline?{modelFile:root+'model.js',paramsFile:root+'params.json'}:{}),null,2));}
