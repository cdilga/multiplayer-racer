import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCandidate} from '../fit/likeness.mjs';
import {swatchUV as postieUV} from '../../../art/vehicles/postie-bike/atlas.js';
import {swatchUV as pigUV} from '../../../art/vehicles/pig-catcher/atlas.js';

function triangles(part,sw,uvFor){const uv=uvFor(sw),out=[];for(let i=0;i<part.positions.length;i+=9){const u=i/3*2;if(Math.abs(part.uvs[u]-uv[0])>1e-6||Math.abs(part.uvs[u+1]-uv[1])>1e-6)continue;out.push([0,3,6].map(k=>part.positions.slice(i+k,i+k+3).map((v,a)=>v+part.pivot[a])));}return out;}
function xAt(tri,y,z){const[a,b,c]=tri,dy=b[1]-a[1],dz=b[2]-a[2],ey=c[1]-a[1],ez=c[2]-a[2],det=dy*ez-dz*ey;if(Math.abs(det)<1e-10)return null;const u=((y-a[1])*ez-(z-a[2])*ey)/det,v=(dy*(z-a[2])-dz*(y-a[1]))/det;if(u< -1e-7||v< -1e-7||u+v>1.0000001)return null;return a[0]+u*(b[0]-a[0])+v*(c[0]-a[0]);}
function insetError(parts){const paint=triangles(parts.core,'paint',postieUV),cream=triangles(parts.core,'tankInset',postieUV);assert.ok(cream.length);let error=0;for(const tri of cream){const samples=[...tri,[0,1,2].map(a=>tri.reduce((s,p)=>s+p[a],0)/3),...tri.map((p,i)=>p.map((v,a)=>(v+tri[(i+1)%3][a])/2))];for(const p of samples){const xs=paint.map(t=>xAt(t,p[1],p[2])).filter(x=>x!==null&&Math.sign(x)===Math.sign(p[0]));assert.ok(xs.length,'cream point must have a red tank surface behind it');error=Math.max(error,Math.min(...xs.map(x=>Math.abs(x-p[0]))));}}return error;}
function panelCrest(parts){return Math.max(...triangles(parts.core,'paint',pigUV).flat().filter(p=>p[2]>-.60&&p[2]<-.32&&p[1]>.80&&p[1]<.97).map(p=>Math.abs(p[0])));}
function spotHeight(parts){const pts=triangles(parts.front,'head',pigUV).flat().filter(p=>Math.abs(p[0])>.05&&p[2]>.74);assert.ok(pts.length);return(Math.min(...pts.map(p=>p[1]))+Math.max(...pts.map(p=>p[1])))/2;}
const candidates={};for(const id of ['postie-bike','pig-catcher']){const root=`docs/evidence/P1-V-roster-visual/${id}/baseline/`;candidates[id]={current:await loadCandidate(id),old:await loadCandidate(id,{modelFile:root+'model.js',paramsFile:root+'params.json'})};}
for(let lod=0;lod<3;lod++){
 test(`Postie LOD${lod}: both cream insets remain within 4 mm of actual triangulated tank faces`,()=>{const{model,P}=candidates['postie-bike'].current;assert.ok(insetError(model.soups(P,lod).parts)<.004,`tank inset diverges at LOD${lod}`);});
 test(`Pig LOD${lod}: rear plastics retain a convex crest and round spots clear the beak`,()=>{const{model,P}=candidates['pig-catcher'].current,parts=model.soups(P,lod).parts;assert.ok(panelCrest(parts)>.26);assert.ok(spotHeight(parts)>1.32);});
 test(`Pig LOD${lod}: real old model fails both sculpted-panel and visible-light checks`,()=>{const{model,P}=candidates['pig-catcher'].old,parts=model.soups(P,lod).parts;assert.ok(panelCrest(parts)<.26);assert.ok(spotHeight(parts)<1.32);});
}
test('Postie: actual old ruled cream patches lift away from the red tank faces',()=>{const{model,P}=candidates['postie-bike'].old;assert.ok(insetError(model.soups(P,0).parts)>.004);});
test('Postie: rounded crankcase lower extent matches reference rather than the oversized solid housing',()=>{const ext=c=>Math.min(...triangles(c.model.soups(c.P,0).parts.core,'engine',postieUV).flat().map(p=>p[1]));assert.ok(ext(candidates['postie-bike'].current)>.32);assert.ok(ext(candidates['postie-bike'].old)<.31);});
for(const id of ['postie-bike','pig-catcher'])for(const lod of [1,2]){
 test(`${id} LOD${lod}: twelve outer tyre stations retain the round broad form`,()=>{
  const uv=id==='postie-bike'?postieUV:pigUV;
  const stationCount=(candidate,wheel)=>{const{model,P}=candidate,z=wheel==='wheel_F'?P.zF:P.zR,r=wheel==='wheel_F'?P.rF:P.rR;return new Set(triangles(model.soups(P,lod).parts[wheel],'tyre',uv).flat().filter(p=>Math.hypot(p[1]-r,p[2]-z)>r*.94).map(p=>Math.atan2(p[1]-r,p[2]-z).toFixed(6))).size;};
  for(const wheel of ['wheel_F','wheel_R']){assert.equal(stationCount(candidates[id].current,wheel),12);assert.equal(stationCount(candidates[id].old,wheel),8);}
 });
}
for(const lod of [1,2])test(`Postie LOD${lod}: helmet retains a dome instead of a box-like three-band shell`,()=>{
 const levels=c=>new Set(['helmet'].flatMap(sw=>triangles(c.model.soups(c.P,lod).parts.rider,sw,postieUV)).flat().map(p=>p[1].toFixed(6))).size;
 assert.ok(levels(candidates['postie-bike'].current)>=4);assert.ok(levels(candidates['postie-bike'].old)<4);
});
