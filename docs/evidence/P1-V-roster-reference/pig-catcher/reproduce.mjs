import fs from 'node:fs';
import * as THREE from 'three';
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
    const holes=fixture.negativeSpaces.map(spec=>{ const part=parts[spec.part],geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(part.positions,3));const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));mesh.updateMatrixWorld();let open=0;const radius=(spec.part==='wheel_F'?P.rF:P.rR)*spec.sampleRadiusFraction;for(const degrees of spec.anglesDeg){const angle=degrees*Math.PI/180,ray=new THREE.Raycaster(new THREE.Vector3(-2,Math.cos(angle)*radius,Math.sin(angle)*radius),new THREE.Vector3(1,0,0));if(!ray.intersectObject(mesh).length)open++;}const fraction=open/spec.anglesDeg.length;assert.equal(fraction>=spec.minOpenFraction,!baseline,`${spec.name} LOD${lod}: ${fraction}`);return {name:spec.name,openFraction:fraction,minOpenFraction:spec.minOpenFraction,pass:fraction>=spec.minOpenFraction};});
    const checks=[...holes,...sourceContourChecks(parts,fixture,sheets,`${dir}/refs/masks`,lod),...fixture.features.map(f=>featureCheck(f,projected[f.name],lod))];
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
