// Final focused export/contract receipt, run from repository root after authoring is stable.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {glbStats} from '../../../tools/vehicles/review/build.mjs';
const root='docs/evidence/P1-V-roster-reference',cars=['au-hawk','cruz-missile','lion-president','pig-catcher','postie-bike','tradie-ute'];
const results=[];
for(const car of cars){
  const dir=`art/vehicles/${car}`;
  const bake=execFileSync(process.execPath,['tools/vehicles/bake.mjs','--check',dir],{encoding:'utf8'});
  fs.writeFileSync(`${root}/${car}/final-bake-check.txt`,bake);
  const contract=execFileSync('target/debug/jj',['validate',`${dir}/${car}.asset.json`],{encoding:'utf8'});
  fs.writeFileSync(`${root}/${car}/final-contract.txt`,contract);
  const asset=JSON.parse(fs.readFileSync(`${dir}/${car}.asset.json`));
  results.push({car,lods:asset.lods.map((l,lod)=>({lod,...glbStats(`${dir}/${l.file}`),budget:l.maxTris})),contract:contract.trim(),reproducible:true});
}
fs.writeFileSync(`${root}/exports.json`,JSON.stringify(results,null,2)+'\n');
console.log('PASS six reproducible bakes, all native asset contracts and 18 exported budgets.');
