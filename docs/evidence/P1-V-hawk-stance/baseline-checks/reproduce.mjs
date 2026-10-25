// Reproduce real previous-candidate rejection and current-candidate acceptance without editing the shared tree.
// Run from repository root after fit captures exist: node docs/evidence/P1-V-hawk-stance/baseline-checks/reproduce.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkCapture } from '../../../../tools/vehicles/fit/likeness.mjs';

const out=path.dirname(fileURLToPath(import.meta.url)),evidence=path.dirname(out),previousCommit='e1d8a900';
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'hawk-likeness-baseline-'));
const compact=result=>({...result,checks:result.checks.map(({reference,model,...check})=>({
  ...check,...(check.kind==='feature-iou'?{}:{reference,model}),
}))});
const summary={previousCommit,method:'Same frozen horizontal camera; source-based feature projection plus browser pixel contours. Original reference pixels and masks unchanged.',lods:[]};
try {
  for(const name of ['model.js','params.json'])fs.writeFileSync(path.join(scratch,name),execFileSync('git',['show',`${previousCommit}:art/vehicles/hawk-dash/${name}`]));
  for(let lod=0;lod<3;lod++) {
    const previous=await checkCapture({car:'hawk-dash',capture:path.join(evidence,`before-lod${lod}`),modelFile:path.join(scratch,'model.js'),paramsFile:path.join(scratch,'params.json')});
    const current=await checkCapture({car:'hawk-dash',capture:path.join(evidence,`reference-lod${lod}`)});
    assert.equal(previous.pass,false,`LOD${lod}: known previous defects must be rejected`);
    assert.equal(current.pass,true,`LOD${lod}: current candidate must meet the same reference constraints`);
    const rejected=previous.checks.filter(c=>!c.pass).map(c=>c.name);
    assert.ok(rejected.includes('rounded nose tapers towards its centre'));
    assert.ok(rejected.includes('front shoulder widens at the reference height'));
    assert.ok(rejected.includes('swept front lamp envelopes'));
    for(const [name,result]of [['previous',previous],['current',current]])fs.writeFileSync(path.join(out,`${name}-lod${lod}.json`),JSON.stringify(compact(result),null,2)+'\n');
    summary.lods.push({lod,previousPass:previous.pass,previousFailures:rejected,currentPass:current.pass,checks:current.checks.length});
  }
  fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
  console.log('All three current LODs pass; all three published previous LODs reject the known shoulder, nose and lamp defects.');
} finally {
  fs.rmSync(scratch,{recursive:true,force:true});
}
