import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCandidate} from '../fit/likeness.mjs';
import {surface,triangles} from '../fit/reference-form.mjs';
import {swatchUV} from '../../../art/vehicles/cruz-missile/atlas.js';
const current=await loadCandidate('cruz-missile');
const previous=await loadCandidate('cruz-missile',{modelFile:'docs/evidence/P1-V-cruz-panels/baseline/model.js',paramsFile:'docs/evidence/P1-V-cruz-panels/baseline/params.json'});
// The shaded reference has a fuller middle door and a tucked-in sill. A straight
// diagonal from sill to shoulder passes the outline test but fails this section.
function waist(parts){return surface(parts.door_FL,[4,.60,.3],[-1,0,0]).x-surface(parts.door_FL,[4,.42,.3],[-1,0,0]).x;}
function fans(parts){return ['front','core','back'].flatMap(id=>triangles(parts[id],swatchUV('under'))).filter(t=>t.some(v=>Math.abs(v.x)<.1&&v.y<.35)&&t.some(v=>Math.abs(v.x)>.70&&v.y>.65));}
function bracket(parts){const p=parts.front,skin=surface(p,[.52,.60,8],[0,0,-1],swatchUV('paint')).z;
 const verts=triangles(p,swatchUV('trim')).flat().filter(v=>Math.abs(v.x-.52)<.028&&Math.abs(v.y-.6)<.028&&v.z>2.1);
 return verts.some(v=>v.z<skin-.015)&&verts.some(v=>v.z>skin+.015);}
for(let lod=0;lod<3;lod++){
 test(`Cruz LOD${lod}: fuller door waist and independent floor`,()=>{
  const {parts}=current.model.soups(current.P,lod);
  assert.ok(waist(parts)>.01,'middle of door projects beyond tucked sill');
  assert.equal(fans(parts).length,0,'no diagonal floor-to-arch membranes');
  const floor=['front','core','back'].flatMap(id=>triangles(parts[id],swatchUV('under'))).filter(t=>t.every(v=>v.y<.31));
  assert.ok(floor.length>0,'low undertray remains');
 });
 test(`Cruz LOD${lod}: actual previous flat waist and radial floor are rejected`,()=>{
  const {parts}=previous.model.soups(previous.P,lod);assert.ok(waist(parts)<0);assert.ok(fans(parts).length>0);
 });
 if(lod<2)test(`Cruz LOD${lod}: bar mounting bracket crosses actual bumper surface`,()=>assert.ok(bracket(current.model.soups(current.P,lod).parts)));
 test(`Cruz LOD${lod}: detached wheels retain both opaque sidewalls`,()=>{
  const p=current.model.soups(current.P,lod).parts.wheel_FL;
  for(const sign of [-1,1])assert.ok(triangles(p).some(t=>{const n=t[1].clone().sub(t[0]).cross(t[2].clone().sub(t[0]));return sign*n.x>1e-6&&Math.abs(n.y)+Math.abs(n.z)<1e-7;}));
 });
}
test('previous coarse bar has no bracket reaching its curved fascia',()=>assert.equal(bracket(previous.model.soups(previous.P,1).parts),false));
