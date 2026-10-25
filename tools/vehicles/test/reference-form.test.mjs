import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {loadCandidate} from '../fit/likeness.mjs';
import {measureForm,formChecks} from '../fit/reference-form.mjs';
import {run as uteShape} from '../../../art/vehicles/tradie-ute/refs/check-shape.mjs';
import {runChecks as pigShape} from '../../../art/vehicles/pig-catcher/refs/check-shape.mjs';
import {runChecks as postieShape} from '../../../art/vehicles/postie-bike/refs/check-shape.mjs';
const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/roster-form.json',import.meta.url)));
const f=fixtures['cruz-missile'],car='cruz-missile';
test('form oracle is pinned to the unchanged reference, independent of candidate parameters',()=>{
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(f.reference)).digest('hex'),f.referenceSha256);
});
const current=await loadCandidate(car),baseline=await loadCandidate(car,{modelFile:'docs/evidence/P1-V-roster-rework/cruz-missile/baseline-model.js',paramsFile:'docs/evidence/P1-V-roster-rework/cruz-missile/baseline-params.json'});
for(let lod=0;lod<3;lod++){
  test(`Cruz LOD${lod}: body proportions, nose sections, lamp slope and flank roll`,()=>{
    const checks=formChecks(measureForm(current.model.soups(current.P,lod).parts,f),f);
    assert.deepEqual(checks.filter(c=>!c.pass),[]);
  });
  test(`Cruz LOD${lod}: real rejected model fails named ramp, flat-centre, length and upright-flank checks`,()=>{
    const checks=formChecks(measureForm(baseline.model.soups(baseline.P,lod).parts,f),f);
    for(const name of ['lengthWheelbase','noseMidSetback','lampUpForward','upperFlankReturn'])assert.equal(checks.find(c=>c.name===name).pass,false,name);
  });
}
test('form measurements reject missing lamps and a shortened body instead of returning a clean score',()=>{
  const parts=current.model.soups(current.P,0).parts;
  const short=structuredClone(parts);for(const id of ['front','back'])for(let i=2;i<short[id].positions.length;i+=3){const z=short[id].positions[i]+short[id].pivot[2];short[id].positions[i]=z*.88-short[id].pivot[2];}
  assert.equal(formChecks(measureForm(short,f),f).find(c=>c.name==='lengthWheelbase').pass,false);
  const missing=structuredClone(parts);missing.front.uvs.fill(0);assert.throws(()=>measureForm(missing,f),/No surface|Missing front-facing lamps/);
});
test('Tradie Ute current shape checks are part of the normal vehicle gate',async()=>{
  const result=await uteShape();assert.equal(result.pass,true,JSON.stringify(result.lods));
});
test('Tradie Ute real rejected body fails all named local form checks',async()=>{
  const result=await uteShape({sourceDir:'docs/evidence/P1-V-roster-rework/tradie-ute/baseline'});
  assert.equal(result.pass,false);assert.equal(result.lods.flatMap(x=>x.checks).filter(c=>!c.pass).length,12);
});
for(const [car,check,count] of [['pig-catcher',pigShape,6],['postie-bike',postieShape,3]]) {
  test(`${car}: corrected named forms pass at every LOD`,async()=>{
    const result=await check();assert.equal(result.pass,true,JSON.stringify(result));
  });
  test(`${car}: actual rejected source fails named forms at every LOD`,async()=>{
    const root=`docs/evidence/P1-V-roster-rework/${car}/baseline/`;
    const result=await check({modelFile:root+'model.js',paramsFile:root+'params.json'});
    assert.equal(result.referenceIdentity,true);assert.equal(result.pass,false);
    assert.equal(result.lods.flatMap(l=>l.checks).filter(c=>!c.pass).length,count);
  });
}
