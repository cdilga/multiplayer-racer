import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {soups} from '../../../art/vehicles/tradie-ute/model.js';
import {swatchUV} from '../../../art/vehicles/tradie-ute/atlas.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const P=JSON.parse(fs.readFileSync(path.join(root,'art/vehicles/tradie-ute/params.json')));
const under=swatchUV('under');
function undersides(parts) {
 const out=[];
 for(const [id,p] of Object.entries(parts)) {
  if(!['core','front'].includes(id))continue;
  for(let i=0;i<p.positions.length;i+=9) {
   const uv=p.uvs.slice(i/3*2,i/3*2+6);
   if(!uv.every((v,k)=>Math.abs(v-under[k%2])<1e-7))continue;
   out.push([0,3,6].map(j=>p.positions.slice(i+j,i+j+3).map((v,k)=>v+p.pivot[k])));
  }
 }
 return out;
}
function radialMembranes(parts) {
 return undersides(parts).filter(t=>{
  // Observed defect: an arch-height outer edge and low centre-floor point in
  // one surface, stretching across the whole half-width of the vehicle.
  const inner=t.some(v=>Math.abs(v[0])<.1&&v[1]<.56);
  const outer=t.some(v=>Math.abs(v[0])>.75&&v[1]>.75);
  return inner&&outer&&t.every(v=>v[2]>.9&&v[2]<2.01);
 });
}
function innerCapArea(p,sign) {
 let area=0;
 for(let i=0;i<p.positions.length;i+=9) {
  const t=[0,3,6].map(j=>p.positions.slice(i+j,i+j+3));
  if(!t.every(v=>Math.abs(v[0]+sign*P.wheelW/2)<1e-7))continue;
  const [a,b,c]=t;
  area+=Math.abs((b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]))/2;
 }
 return area;
}
for(const lod of [0,1,2]) test(`Tradie LOD${lod}: flipped and detached tyres have inner sidewalls`,()=>{
 const {parts}=soups(P,lod);
 for(const side of ['FL','FR','RL','RR'])assert.ok(innerCapArea(parts[`wheel_${side}`],side.endsWith('L')?1:-1)>.5,`${side} opaque inner disc`);
});
for(const lod of [0,1,2]) test(`Tradie LOD${lod}: centre floor is independent of arch lips`,()=>{
 const {parts}=soups(P,lod);
 assert.equal(radialMembranes(parts).length,0);
 const floor=undersides(parts).filter(t=>t.every(v=>Math.abs(v[0])<=.620001&&v[1]<.56)&&t.some(v=>Math.abs(v[0])>.61));
 assert.ok(floor.length>=2,'central undertray retained below the cab');
 assert.ok(floor.flat().some(v=>v[2]<-1.3),'floor continues to cab back');
 assert.ok(floor.flat().some(v=>v[2]>2.3),'floor continues to nose');
});
for(const lod of [0,1,2]) test(`Tradie LOD${lod}: photographed rear lamp order`,()=>{
 const {parts:{back:p}}=soups(P,lod);
 const lamps={};
 for(const sw of ['head','tail','indicator']) {
  const target=swatchUV(sw),xs=[];
  for(let i=0;i<p.positions.length;i+=9) {
   const uv=p.uvs.slice(i/3*2,i/3*2+6);
   if(uv.every((v,k)=>Math.abs(v-target[k%2])<1e-7))for(const j of [0,3,6])xs.push(Math.abs(p.positions[i+j]+p.pivot[0]));
  }
  assert.ok(xs.length>0,`${sw} rear lamp exists`);
  lamps[sw]=xs.reduce((a,b)=>a+b,0)/xs.length;
 }
 assert.ok(lamps.indicator>lamps.tail&&lamps.tail>lamps.head,'amber outside, red centre, white inside');
});
test('panel gate rejects saved previous radial floor',async()=>{
 const mod=await import(pathToFileURL(path.join(root,'docs/evidence/P1-V-roster-visual/tradie-ute/baseline-model.js')));
 for(const lod of [0,1,2])assert.ok(radialMembranes(mod.soups(P,lod).parts).length>0,`LOD${lod} previous membrane rejected`);
 for(const lod of [1,2])assert.equal(innerCapArea(mod.soups(P,lod).parts.wheel_FL,1),0,`LOD${lod} previous uncapped inner tyre detected`);
});
