// Run from repository root. Both candidates use the same corrected reference masks/cameras.
import {execFileSync} from 'node:child_process';
const root='docs/evidence/P1-V-roster-reference/postie-bike';
for(let lod=0;lod<3;lod++) {
  const sheet=lod===2?'lowest':'lod1';
  for(const kind of ['before','after']) {
    const out=`${root}/${kind}-lod${lod}`;
    execFileSync(process.execPath,['tools/vehicles/fit/capture.mjs','postie-bike','--lod',String(lod),'--sheet',sheet,'--out',out,
      ...(kind==='before'?['--model',`${root}/baseline-source/model.js`,'--params',`${root}/baseline-source/params.json`,'--atlas',`${root}/baseline-source/atlas.js`]:[])],{stdio:'inherit'});
    if(kind==='after')execFileSync(process.execPath,['tools/vehicles/fit/likeness.mjs','postie-bike','--capture',out],{stdio:'inherit'});
  }
}
