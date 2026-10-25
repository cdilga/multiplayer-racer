import fs from 'node:fs';
import {open,close,saveDataURL} from '../../../tools/vehicles/fit/lib.mjs';
for(const id of ['postie-bike','pig-catcher']){
 const dir=`docs/evidence/P1-V-roster-visual/${id}/switch-size`;fs.mkdirSync(dir,{recursive:true});
 for(const before of [true,false]){
  const model=before?`docs/evidence/P1-V-roster-visual/${id}/baseline/model.js`:undefined;
  const page=await open(id,{model});
  try{for(const lod of [1,2]){
   await page.evaluate(l=>window.__fit.setLod(l),lod);
   for(const view of ['side','front','rear'])saveDataURL(`${dir}/${before?'before':'after'}-${lod}-${view}.png`,await page.evaluate(v=>window.__fit.shaded(v,240,120),view));
  }}finally{await close();}
 }
}
