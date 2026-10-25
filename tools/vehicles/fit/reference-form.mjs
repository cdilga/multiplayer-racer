// Named source measurements for the owner's rejected Cruz: scale-independent length,
// rounded front corner onset, lamp plane and flank slope. Expectations live in reference pixels.
import fs from 'node:fs';
import * as THREE from 'three';
import {loadCandidate} from './likeness.mjs';

export function triangles(part,uv=null){
  const out=[];for(let i=0;i<part.positions.length;i+=9){
    if(uv && ![0,1,2].every(k=>Math.abs(part.uvs[(i/3+k)*2]-uv[0])<1e-7&&Math.abs(part.uvs[(i/3+k)*2+1]-uv[1])<1e-7))continue;
    out.push([0,1,2].map(k=>new THREE.Vector3(...part.positions.slice(i+k*3,i+k*3+3)).add(new THREE.Vector3(...part.pivot))));
  }return out;
}
export function surface(part,origin,direction,uv=null){
  const ray=new THREE.Ray(new THREE.Vector3(...origin),new THREE.Vector3(...direction)),p=new THREE.Vector3();let best=null,d=Infinity;
  for(const t of triangles(part,uv)){if(!ray.intersectTriangle(...t,false,p))continue;const next=p.distanceTo(ray.origin);if(next<d){d=next;best=p.clone();}}
  if(!best)throw new Error(`No surface at ${origin} along ${direction}`);return best;
}
export function measureForm(parts,f){
  const nose=surface(parts.front,[0,.6,8],[0,0,-1],f.bodyUV),tail=surface(parts.back,[0,.6,-8],[0,0,1],f.bodyUV);
  const wheelbase=Math.abs(parts.wheel_FL.pivot[2]-parts.wheel_RL.pivot[2]);
  const fore=f.noseXs.map(x=>surface(parts.front,[x,.6,8],[0,0,-1],x<.6?f.bodyUV:null).z);
  let lampArea=0,upArea=0;
  for(const t of triangles(parts.front,f.lampUV)){
    const n=t[1].clone().sub(t[0]).cross(t[2].clone().sub(t[0]));
    // Side wraps are a different surface: measure the planes visible head-on.
    if(Math.abs(n.z)<Math.abs(n.x))continue;
    lampArea+=Math.abs(n.z);upArea+=Math.abs(n.y);
  }
  if(lampArea<1e-8)throw new Error('Missing front-facing lamps');
  const flank=[.78,1.05].map(y=>surface(parts.door_FL,[4,y,.3],[-1,0,0]).x);
  return {lengthWheelbase:(nose.z-tail.z)/wheelbase,noseMidSetback:fore[0]-fore[1],noseCornerSetback:fore[0]-fore[2],lampUpForward:upArea/lampArea,upperFlankReturn:flank[0]-flank[1]};
}
export function formChecks(measured,fixture){return Object.entries(fixture.limits).map(([name,[min,max]])=>({name,value:measured[name],min,max,pass:Number.isFinite(measured[name])&&measured[name]>=min&&measured[name]<=max}));}
export async function checkForm(car,options={}){
  const f=JSON.parse(fs.readFileSync(`tools/vehicles/test/fixtures/roster-form.json`))[car];if(!f)throw new Error(`No form fixture for ${car}`);
  const {model,P}=await loadCandidate(car,options);return [0,1,2].map(lod=>({lod,checks:formChecks(measureForm(model.soups(P,lod).parts,f),f)}));
}
if(process.argv[1]?.endsWith('/reference-form.mjs')){
  const args=process.argv.slice(2),opt=k=>args.includes(k)?args[args.indexOf(k)+1]:undefined;
  const result=await checkForm(args[0],{modelFile:opt('--model'),paramsFile:opt('--params')});console.log(JSON.stringify(result,null,2));if(result.some(x=>x.checks.some(c=>!c.pass)))process.exitCode=1;
}
