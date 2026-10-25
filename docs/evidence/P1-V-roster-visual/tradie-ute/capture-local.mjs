import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {open,close,saveDataURL} from '../../../../tools/vehicles/fit/lib.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
for(const old of [true,false]) {
 if(old&&process.argv.includes('--current-only'))continue;
 const label=old?'previous':'current';
 const page=await open('tradie-ute',old?{model:path.join(dir,'baseline-model.js'),params:path.join(dir,'baseline-params.json'),atlas:path.join(dir,'baseline-atlas.js')}:{});
 try {
  for(const lod of [0,1,2]) {
   if(process.argv.includes('--lod2-only')&&lod!==2)continue;
   await page.evaluate(l=>window.__fit.setLod(l),lod);
   for(const [view,cam] of Object.entries({rear:{az:140,elev:14,dist:11,fov:26},underside:{az:52,elev:-24,dist:11,fov:26},front:{az:52,elev:10,dist:11,fov:26}})) {
    saveDataURL(path.join(dir,`${label}-lod${lod}-${view}.png`),await page.evaluate(cam=>window.__fit.shaded('hero',1200,700,cam),cam));
   }
  }
 } finally {await close();}
}
