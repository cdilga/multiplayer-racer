// Run from repository root. Baseline source stays isolated against unchanged references.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadCandidate, projectFeatures, featureCheck, sourceContourChecks, overlaySvg } from '../../../../tools/vehicles/fit/likeness.mjs';
const car=path.basename(path.dirname(new URL(import.meta.url).pathname));
const root=`art/vehicles/${car}`,out=`docs/evidence/P1-V-roster-rework/${car}`;
const fixture=JSON.parse(fs.readFileSync(`${root}/refs/likeness.json`)),sheets=JSON.parse(fs.readFileSync(`${root}/refs/sheets.json`));
const report={car,reference:fixture.reference,referenceSha256:fixture.referenceSha256,cameras:sheets,candidates:{}};
for(const candidate of ['before','after']){
  const source=candidate==='before'?`${out}/baseline-source`:root;
  const options={modelFile:`${source}/model.js`,paramsFile:`${source}/params.json`};
  const {model,P}=await loadCandidate(car,options);
  const row={source,modelSha256:crypto.createHash('sha256').update(fs.readFileSync(options.modelFile)).digest('hex'),paramsSha256:crypto.createHash('sha256').update(fs.readFileSync(options.paramsFile)).digest('hex'),lods:[]};
  for(let lod=0;lod<3;lod++){
    const parts=model.soups(P,lod).parts,projections=projectFeatures(parts,fixture.features,sheets);
    const checks=[...sourceContourChecks(parts,fixture,sheets,`${root}/refs/masks`,lod),...fixture.features.map(spec=>featureCheck(spec,projections[spec.name],lod))];
    row.lods.push({lod,pass:checks.every(c=>c.pass),checks});
    fs.writeFileSync(`${out}/${candidate}-shape-lod${lod}.svg`,overlaySvg(checks));
  }
  report.candidates[candidate]=row;
}
fs.writeFileSync(`${out}/shape-comparison.json`,JSON.stringify(report,null,2)+'\n');
for(const[candidate,row]of Object.entries(report.candidates))for(const{lod,checks}of row.lods)console.log(candidate,lod,checks.filter(c=>!c.pass).map(c=>`${c.name}: ${c.iou??c.error}`));
if(!report.candidates.after.lods.every(r=>r.pass))process.exitCode=1;
