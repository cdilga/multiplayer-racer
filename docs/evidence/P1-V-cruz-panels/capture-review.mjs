import fs from 'node:fs';
import {open,close,saveDataURL} from '../../../tools/vehicles/fit/lib.mjs';
const root='docs/evidence/P1-V-cruz-panels';
for(const old of [true,false]){
 const dir=`${root}/${old?'before-fixed':'after-fixed'}`;fs.mkdirSync(dir,{recursive:true});
 const page=await open('cruz-missile',old?Object.fromEntries(['model','params','atlas'].map(k=>[k,`${root}/baseline/${k}.${k==='params'?'json':'js'}`])):{});
 try{await page.evaluate(()=>window.__fit.setLod(0));
 for(const [name,cam]of [['body',{az:55,elev:10,dist:9,fov:26,targetY:.78}],['underside',{az:125,elev:-25,dist:9,fov:26,targetY:.55}],['front',{az:12,elev:7,dist:8,fov:26,targetY:.78}],['side',{az:90,elev:0,dist:10,fov:26,targetY:.78}]])saveDataURL(`${dir}/${name}.png`,await page.evaluate(cam=>window.__fit.shaded('hero',1400,700,cam),cam));
 }finally{await close();}
}
