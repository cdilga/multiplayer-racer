import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadCandidate } from '../fit/likeness.mjs';

// Actual rejected source is kept as evidence. These checks measure surfaces, not
// source tokens or tuned parameters; the earlier high-IoU model must still fail.
const world = (part,i) => part.positions.slice(i,i+3).map((v,k)=>v+part.pivot[k]);
function floorFan(parts,uv) {
  let worst=0;
  for(const [id,p] of Object.entries(parts))if(!id.startsWith('interior'))for(let i=0;i<p.positions.length;i+=9){
    if(![0,1,2].every(k=>Math.abs(p.uvs[i/3*2+k*2]-uv[0])<1e-7&&Math.abs(p.uvs[i/3*2+k*2+1]-uv[1])<1e-7))continue;
    const t=[0,1,2].map(k=>world(p,i+k*3));
    if(!t.some(v=>Math.abs(v[0])<1e-6&&Math.abs(v[2])<1.9&&v[1]<.3))continue;
    for(const a of t)for(const b of t)if(Math.abs(a[2]-b[2])<1e-6)worst=Math.max(worst,Math.abs(a[1]-b[1]));
  }return worst;
}
function sideX(parts,y,z) {
  let x=-Infinity;
  for(const [id,p] of Object.entries(parts))if(id==='door_FL'||id==='door_RL')for(let i=0;i<p.positions.length;i+=9){
    const [a,b,c]=[0,1,2].map(k=>world(p,i+k*3)),det=(b[2]-a[2])*(c[1]-a[1])-(b[1]-a[1])*(c[2]-a[2]);if(Math.abs(det)<1e-8)continue;
    const u=((z-a[2])*(c[1]-a[1])-(y-a[1])*(c[2]-a[2]))/det,v=((b[2]-a[2])*(y-a[1])-(b[1]-a[1])*(z-a[2]))/det;
    if(u>=-1e-7&&v>=-1e-7&&u+v<=1+1e-7)x=Math.max(x,a[0]+u*(b[0]-a[0])+v*(c[0]-a[0]));
  }assert.ok(Number.isFinite(x),'missing measured door surface');return x;
}
function openWheelEdges(p) {
  const edges=new Map();for(let i=0;i<p.positions.length;i+=9){const t=[0,1,2].map(k=>world(p,i+k*3).map(x=>x.toFixed(7)).join(','));for(let k=0;k<3;k++){const e=[t[k],t[(k+1)%3]].sort().join('|');edges.set(e,(edges.get(e)??0)+1);}}return [...edges.values()].filter(n=>n!==2).length;
}
for(const car of ['au-hawk','lion-president']){
  const current=await loadCandidate(car),old=await loadCandidate(car,{modelFile:`docs/evidence/P1-V-roster-visual/${car}/baseline/model.js`,paramsFile:`docs/evidence/P1-V-roster-visual/${car}/baseline/params.json`});
  const atlas=await import(`../../../art/vehicles/${car}/atlas.js`),under=atlas.swatchUV('under');
  for(let lod=0;lod<3;lod++){
    const parts=current.model.soups(current.P,lod).parts;
    test(`${car} LOD${lod}: undertray has no transverse arch fan`,()=>assert.ok(floorFan(parts,under)<1e-6));
    test(`${car} LOD${lod}: optimised wheel is closed on both faces`,()=>{for(const id of ['wheel_FL','wheel_FR','wheel_RL','wheel_RR']){assert.equal(openWheelEdges(parts[id]),0);assert.ok(parts[id].tris<=44);}});
    test(`${car} LOD${lod}: frozen hinges and physical contract`,()=>{for(const [id,p]of Object.entries(parts))assert.deepEqual(p.pivot,current.P.physicsPivots[id]);assert.deepEqual(JSON.parse(fs.readFileSync(`art/vehicles/${car}/vehicle.json`)),JSON.parse(fs.readFileSync(`docs/evidence/P1-V-roster-visual/${car}/baseline/vehicle.json`)));});
  }
  const rejected=old.model.soups(old.P,0).parts;
  test(`${car}: actual previous model rejects raised underside and open expensive wheels`,()=>{assert.ok(floorFan(rejected,under)>.3);assert.ok(openWheelEdges(rejected.wheel_FL)>0);assert.ok(rejected.wheel_FL.tris>44);});
  if(car==='au-hawk'){
    const proud=p=>sideX(p,.565,.3)-(sideX(p,.525,.3)+sideX(p,.605,.3))/2;
    test('AU reference rub strip stands proud of the lower door',()=>{assert.ok(proud(current.model.soups(current.P,0).parts)>.012);assert.ok(proud(rejected)<.012);});
  }else {
    function sillAt(parts,z){let lo=Infinity;const p=parts.core;for(let i=0;i<p.positions.length;i+=9){const t=[0,1,2].map(k=>world(p,i+k*3));if(t.some(v=>v[0]<.86||v[1]>.35))continue;for(let k=0;k<3;k++){const a=t[k],b=t[(k+1)%3];if(z<Math.min(a[2],b[2])-1e-7||z>Math.max(a[2],b[2])+1e-7)continue;if(Math.abs(b[2]-a[2])<1e-7)lo=Math.min(lo,a[1],b[1]);else lo=Math.min(lo,a[1]+(b[1]-a[1])*(z-a[2])/(b[2]-a[2]));}}return lo;}
    for(let lod=1;lod<3;lod++)test(`Lion LOD${lod}: visible lower sill stays straight between arches`,()=>{const p=current.model.soups(current.P,lod).parts,ys=[-.6,0,.6].map(z=>sillAt(p,z));assert.ok(ys.every(Number.isFinite));assert.ok(Math.max(...ys)-Math.min(...ys)<.005);assert.equal(Number.isFinite(sillAt(old.model.soups(old.P,lod).parts,0)),false);});
    for(let lod=0;lod<3;lod++)test(`Lion LOD${lod}: lower door crease returns inward`,()=>{const p=current.model.soups(current.P,lod).parts;assert.ok(sideX(p,.85,.2)-sideX(p,.36,.2)>.035);assert.ok(sideX(rejected,.85,.2)-sideX(rejected,.36,.2)<.035);});
  }
}
