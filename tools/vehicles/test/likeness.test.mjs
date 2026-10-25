// P1-V-hawk-curves: reference-derived gates and defect injection. No browser required in normal CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { PNG } from 'pngjs';
import { cameraChecks, contourChecks, featureCheck, projectFeatures, sourceContourChecks } from '../fit/likeness.mjs';
import { soups } from '../../../art/vehicles/hawk-dash/model.js';

const dir='art/vehicles/hawk-dash',fixture=JSON.parse(fs.readFileSync(`${dir}/refs/likeness.json`)),sheets=JSON.parse(fs.readFileSync(`${dir}/refs/sheets.json`)),P=JSON.parse(fs.readFileSync(`${dir}/params.json`));
const failures=checks=>checks.filter(c=>!c.pass).map(c=>`${c.name}: ${c.error!=null?`error ${c.error}`:`IoU ${c.iou}`} / limit ${c.limit}`);
function reference(view) {
  const png=PNG.sync.read(fs.readFileSync(`${dir}/refs/masks/lod1_${view}.mask.png`)),mask=Uint8Array.from({length:png.width*png.height},(_,i)=>png.data[i*4]>127?1:0);
  return {w:png.width,h:png.height,reference:mask,model:mask.slice()};
}
function rewriteRow(d,t,newWidth) {
  const y=Math.round(t*(d.h-1)),half=newWidth*d.h/2;
  for(let x=0;x<d.w;x++)d.model[y*d.w+x]=Math.abs(x-(d.w-1)/2)<=half?1:0;
}

test('Hawk likeness oracle remains the canonical unmodified reference',()=> {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(fixture.reference)).digest('hex'),fixture.referenceSha256);
  for(const [file,hash]of Object.entries(fixture.maskSha256))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(`${dir}/refs/masks/${file}`)).digest('hex'),hash,file);
  for(const [view,specs]of Object.entries(fixture.contours))assert.deepEqual(failures(contourChecks(reference(view),specs)),[]);
  for(const spec of fixture.features) {
    const poly=spec.polygons.map(p=>p.map(([x,y])=>[(x-spec.size[0]/2)/spec.size[1],y/spec.size[1]]));
    assert.equal(featureCheck(spec,poly).iou,1);
  }
});

test('local shape gates reject a tucked base even if most of the silhouette is unchanged',()=> {
  for(const view of ['front','rear']) {
    const d=reference(view);rewriteRow(d,.85,1.20);
    const check=contourChecks(d,fixture.contours[view]).find(c=>c.name.includes('lower base'));
    assert.equal(check.pass,false,JSON.stringify(check));
  }
});

test('local shape gates reject widening that begins above the reference shoulder',()=> {
  const d=reference('front');rewriteRow(d,.4,1.29);
  const check=contourChecks(d,fixture.contours.front).find(c=>c.name.includes('shoulder'));
  assert.equal(check.pass,false,JSON.stringify(check));
});

test('local shape gates reject a square nose with the same width farther back',()=> {
  const d=reference('top');for(const t of [.90,.94,.98])rewriteRow(d,t,.39);
  assert.ok(contourChecks(d,fixture.contours.top).every(c=>!c.pass));
});

test('feature gates reject missing lamps, moved lamps and misplaced exhaust outlets',()=> {
  for(const spec of fixture.features) {
    assert.equal(featureCheck(spec,[]).pass,false,`${spec.name}: absent cue`);
    const moved=spec.polygons.map(p=>p.map(([x,y])=>[(x-spec.size[0]/2)/spec.size[1]+.15,y/spec.size[1]-.10]));
    assert.equal(featureCheck(spec,moved).pass,false,`${spec.name}: displaced cue`);
  }
});

test('camera gates reject an elevated, mismatched or unspecified comparison camera',()=> {
  assert.deepEqual(failures(cameraChecks(sheets,fixture.cameras)),[]);
  for(const mutate of [s=>s.tilt.front=.14,s=>s.heroRear.elev=14,s=>s.projection='orthographic-shaded/perspective-mask',s=>delete s.camD]) {
    const bad=structuredClone(sheets);mutate(bad);assert.ok(failures(cameraChecks(bad,fixture.cameras)).length>0);
  }
});

for(let lod=0;lod<3;lod++) {
  test(`Hawk LOD${lod}: current geometry retains reference stance, shoulders and rounded nose`,()=> {
    assert.deepEqual(failures(sourceContourChecks(soups(P,lod).parts,fixture,sheets,`${dir}/refs/masks`,lod)),[]);
  });
  test(`Hawk LOD${lod}: current geometry retains annotated lamps and exhaust placement`,()=> {
    const projected=projectFeatures(soups(P,lod).parts,fixture.features,sheets);
    assert.deepEqual(failures(fixture.features.map(f=>featureCheck(f,projected[f.name],lod))),[]);
  });
}
