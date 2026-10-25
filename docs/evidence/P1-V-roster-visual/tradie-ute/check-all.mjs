import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const dir=path.dirname(fileURLToPath(import.meta.url));
const jobs=[
 ['shape-check.json','node',['art/vehicles/tradie-ute/refs/check-shape.mjs']],
 ['measured-check.json','node',['art/vehicles/tradie-ute/refs/check-measured.mjs']],
 ['frozen-physics.json','node',[path.join(dir,'check-frozen.mjs')]],
 ['contract-check.txt','target/debug/jj',['validate','art/vehicles/tradie-ute/tradie-ute.asset.json']],
 ['bake-check.txt','node',['tools/vehicles/bake.mjs','--check','art/vehicles/tradie-ute']],
 ['panels-test.txt','node',['--test','tools/vehicles/test/tradie-panels.test.mjs']],
];
for(const [file,cmd,args] of jobs) {
 fs.writeFileSync(path.join(dir,file),execFileSync(cmd,args,{encoding:'utf8'}));
 console.log(`PASS ${file}`);
}
