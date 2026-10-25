import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { loadCandidate, sourceContourChecks, projectFeatures, featureCheck } from '../../../../tools/vehicles/fit/likeness.mjs';
const car = path.basename(path.dirname(new URL(import.meta.url).pathname));
const evidence = `docs/evidence/P1-V-roster-reference/${car}`, dir = `art/vehicles/${car}`;
const fixture = JSON.parse(fs.readFileSync(`${dir}/refs/likeness.json`));
const sheets = JSON.parse(fs.readFileSync(`${dir}/refs/sheets.json`));
const receipt=[];
for (const baseline of [false,true]) {
  const {model,P}=await loadCandidate(car,baseline?{modelFile:`${evidence}/baseline-model.js`,paramsFile:`${evidence}/baseline-params.json`}:{});
  for(let lod=0;lod<3;lod++) {
    const parts=model.soups(P,lod).parts, projected=projectFeatures(parts,fixture.features,sheets);
    const checks=[...sourceContourChecks(parts,fixture,sheets,`${dir}/refs/masks`,lod),...fixture.features.map(f=>featureCheck(f,projected[f.name],lod))];
    if(!baseline) assert.equal(checks.every(c=>c.pass),true,JSON.stringify(checks.filter(c=>!c.pass)));
    else assert.equal(checks.some(c=>!c.pass),true,`baseline LOD${lod} must expose previous mistake`);
    receipt.push({baseline,lod,pass:checks.every(c=>c.pass),checks});
    if(!baseline) for(const f of fixture.features) {
      assert.equal(featureCheck(f,[],lod).pass,false,`${f.name}: missing cue`);
      const moved=projected[f.name].map(poly=>poly.map(([x,y])=>[x+.25,y-.15]));
      assert.equal(featureCheck(f,moved,lod).pass,false,`${f.name}: displaced cue`);
    }
  }
}
fs.writeFileSync(`${evidence}/source-checks.json`,JSON.stringify(receipt,null,2)+'\n');
console.log(`${car}: current LOD0/1/2 pass; previous source fails each; missing/displaced features rejected`);
