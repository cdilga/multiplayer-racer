// P1-V-hawk-curves: reference-derived gates and defect injection. No browser required in normal CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { PNG } from 'pngjs';
import { cameraChecks, contourChecks, featureCheck, projectFeatures, sourceContourChecks, loadCandidate, inside } from '../fit/likeness.mjs';
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

// Every annotated roster vehicle exercises current source, not a screenshot left by its author.
const annotated=fs.readdirSync('art/vehicles').filter(id=>id!=='hawk-dash'&&fs.existsSync(`art/vehicles/${id}/refs/likeness.json`));
for(const id of annotated) {
  const root=`art/vehicles/${id}`,f=JSON.parse(fs.readFileSync(`${root}/refs/likeness.json`)),s=JSON.parse(fs.readFileSync(`${root}/refs/sheets.json`));
  test(`${id}: reference identity and camera stay fixed`,()=> {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(f.reference)).digest('hex'),f.referenceSha256);
    assert.ok(Object.keys(f.maskSha256).length>0,'reference masks must be pinned');
    for(const [file,hash]of Object.entries(f.maskSha256))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(`${root}/refs/masks/${file}`)).digest('hex'),hash,file);
    assert.deepEqual(failures(cameraChecks(s,f.cameras)),[]);
    const bad=structuredClone(s);bad.projection='mismatched';
    assert.ok(cameraChecks(bad,f.cameras).some(c=>!c.pass),'mismatched mask/shaded cameras must fail');
  });
  test(`${id}: local gates reject a changed contour and missing features`,()=> {
    for(const [view,specs]of Object.entries(f.contours)) {
      const png=PNG.sync.read(fs.readFileSync(`${root}/refs/masks/lod1_${view}.mask.png`)),mask=Uint8Array.from({length:png.width*png.height},(_,i)=>png.data[i*4]>127?1:0);
      const d={w:png.width,h:png.height,reference:mask,model:mask.slice()};
      const spec=specs[0];rewriteRow(d,spec.rows.at(-1),.025);
      const collapsed=contourChecks(d,specs).some(c=>!c.pass);
      // A naturally narrow tip may already be this narrow; the opposite full-width defect must expose it.
      rewriteRow(d,spec.rows.at(-1),d.w/d.h);
      assert.ok(collapsed||contourChecks(d,specs).some(c=>!c.pass),`${view}: collapsed/full-width section defects must fail`);
    }
    for(const spec of f.features)assert.equal(featureCheck(spec,[]).pass,false,`${spec.name}: missing feature`);
  });
  for(let lod=0;lod<3;lod++)test(`${id} LOD${lod}: current geometry preserves annotated reference cues`,async()=> {
    const {model,P}=await loadCandidate(id),parts=model.soups(P,lod).parts;
    const contours=sourceContourChecks(parts,f,s,`${root}/refs/masks`,lod);
    const projected=projectFeatures(parts,f.features,s);
    assert.deepEqual(failures([...contours,...f.features.map(spec=>featureCheck(spec,projected[spec.name],lod))]),[]);
  });
}

test('source override loader resolves a bike kit against the original vehicle directory',async()=> {
  // This path used to break baseline reproduction for bikes because ../_kit was relative to a data URL.
  const {model,P}=await loadCandidate('postie-bike',{modelFile:'art/vehicles/postie-bike/model.js'});
  const parts=model.soups(P,2).parts;
  assert.ok(parts.rider.positions.length>0&&parts.wheel_F.positions.length>0);
});

for(let lod=0;lod<3;lod++)test(`Postie LOD${lod}: CB50 frame and spoked wheels retain reference negative spaces`,async()=> {
  const {model,P}=await loadCandidate('postie-bike'),parts=model.soups(P,lod).parts;
  const covered=(part,z,y)=> {
    for(let i=0;i<part.positions.length;i+=9) {
      const triangle=[0,3,6].map(k=>[part.positions[i+k+2]+part.pivot[2],part.positions[i+k+1]+part.pivot[1]]);
      if(inside([z,y],triangle))return true;
    }
    return false;
  };
  for(const name of ['wheel_F','wheel_R']) {
    const part=parts[name],r=part.pivot[1];
    assert.equal(covered(part,part.pivot[2]+r*.20,r+r*.40),false,`${name}: daylight between spokes, unlike a filled scooter wheel`);
  }
  // Reference side crop: daylight below the rear frame triangle, behind the exposed engine.
  assert.equal(covered(parts.core,-.55,.55),false,'scooter body/floor must not fill the classic motorcycle frame gap');
});

test('Tradie Ute: current LODs retain independent owner measurements and reject geometric defects',async()=> {
  const {runChecks}=await import('../../../art/vehicles/tradie-ute/refs/check-measured.mjs');
  const report=await runChecks({defects:true});
  assert.equal(report.lods.length,3);
  assert.equal(report.pass,true,JSON.stringify(report.lods));
  for(const lod of report.lods)assert.equal(lod.pass,true,`LOD${lod.lod}`);
});
