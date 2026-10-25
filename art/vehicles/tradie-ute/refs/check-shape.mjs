#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const R=JSON.parse(fs.readFileSync(path.join(root,'refs/shape-reference.json')));
const inBand=(v,b)=>Number.isFinite(v)&&v>=b[0]&&v<=b[1];
const tris=p=>Array.from({length:p.positions.length/9},(_,i)=>[0,3,6].map(j=>p.positions.slice(i*9+j,i*9+j+3).map((v,k)=>v+p.pivot[k])));
function sectionX(ts,y,z) {
  const out=[];
  for(const t of ts) {
    const [a,b,c]=t,dy=b[1]-a[1],dz=b[2]-a[2],ey=c[1]-a[1],ez=c[2]-a[2],det=dy*ez-dz*ey;
    if(Math.abs(det)<1e-10)continue;
    const u=((y-a[1])*ez-(z-a[2])*ey)/det,v=(dy*(z-a[2])-dz*(y-a[1]))/det;
    if(u>=-1e-7&&v>=-1e-7&&u+v<=1+1e-7)out.push(a[0]+u*(b[0]-a[0])+v*(c[0]-a[0]));
  }
  return out.length?Math.max(...out):null;
}
function hoodZ(p,x) {
  const out=[];
  for(let i=0;i<p.positions.length;i+=9) {
    const uv=[0,2,4].map(j=>p.uvs.slice(i/3*2+j,i/3*2+j+2));
    if(!uv.every(([u,v])=>u>=0&&u<=.350001&&v<=.500001))continue;
    const t=[0,3,6].map(j=>p.positions.slice(i+j,i+j+3).map((v,k)=>v+p.pivot[k]));
    for(let j=0;j<3;j++) {
      const a=t[j],b=t[(j+1)%3];
      if(Math.abs(a[0]-x)<1e-8&&a[1]>.95)out.push(a[2]);
      if((a[0]-x)*(b[0]-x)<0) {
        const f=(x-a[0])/(b[0]-a[0]);
        if(a[1]+f*(b[1]-a[1])>.95)out.push(a[2]+f*(b[2]-a[2]));
      }
    }
  }
  return out.length?Math.max(...out):null;
}
export async function run({sourceDir=root}={}) {
  const {soups}=await import(pathToFileURL(path.join(sourceDir,'model.js')));
  const P=JSON.parse(fs.readFileSync(path.join(sourceDir,'params.json'))),lods=[];
  for(const lod of [0,1,2]) {
    const {parts}=soups(P,lod),ts=tris(parts.door_RL),widths=R.body.heights.map(y=>sectionX(ts,y,R.body.sectionZ));
    const nose=R.nose.xSamples.map(x=>hoodZ(parts.front,x));
    const lowerTuck=widths[1]-widths[0],shoulderTuck=widths[1]-widths[3],cornerSetback=nose[0]-nose[2],midpointSetback=nose[0]-nose[1];
    const checks=[
      {name:'lower flank returns toward sill',actual:lowerTuck,band:R.body.lowerTuckBand,pass:inBand(lowerTuck,R.body.lowerTuckBand)},
      {name:'shoulder returns below glass',actual:shoulderTuck,band:R.body.shoulderTuckBand,pass:inBand(shoulderTuck,R.body.shoulderTuckBand)},
      {name:'nose corner sweeps behind centre',actual:cornerSetback,band:R.nose.cornerSetbackBand,pass:inBand(cornerSetback,R.nose.cornerSetbackBand)},
      {name:'nose intermediate section curves',actual:midpointSetback,band:R.nose.midpointSetbackBand,pass:inBand(midpointSetback,R.nose.midpointSetbackBand)}
    ];
    lods.push({lod,widthHalfMetres:widths,noseZMetres:nose,checks,pass:checks.every(c=>c.pass)});
  }
  const sourceSha256=Object.fromEntries(['model.js','params.json','atlas.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(sourceDir,f))).digest('hex')]));
  return {reference:'refs/shape-reference.json',referenceSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'refs/shape-reference.json'))).digest('hex'),sourceSha256,sourceDir,lods,pass:lods.every(l=>l.pass)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const i=process.argv.indexOf('--source'),result=await run({sourceDir:i>=0?path.resolve(process.argv[i+1]):root});
 console.log(JSON.stringify(result,null,2));if(!result.pass)process.exitCode=1;
}
