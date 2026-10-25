// Reproduce fixed-world-camera comparisons; no per-model framing or anisotropic resizing.
import fs from 'node:fs';
import {open,close,saveDataURL} from '../../../../tools/vehicles/fit/lib.mjs';
const car=process.argv[2],root=`docs/evidence/P1-V-roster-visual/${car}`;
for(const old of (process.argv.includes('--after-only')?[false]:[true,false])){
 const dir=`${root}/${old?'before-fixed':'after-fixed'}`;fs.mkdirSync(dir,{recursive:true});
 const page=await open(car,old?Object.fromEntries(['model','params','atlas'].map(k=>[k,`${root}/baseline/${k}.${k==='params'?'json':'js'}`])):{});
 try{await page.evaluate(()=>window.__fit.setLod(0));
 for(const [name,cam]of [['body',{az:55,elev:10,dist:9,fov:26,targetY:.78}],['underside',{az:125,elev:-25,dist:9,fov:26,targetY:.55}],['front',{az:12,elev:7,dist:8,fov:26,targetY:.78}]])saveDataURL(`${dir}/${name}.png`,await page.evaluate(cam=>window.__fit.shaded('hero',1400,700,cam),cam));
 }finally{await close();}
}
