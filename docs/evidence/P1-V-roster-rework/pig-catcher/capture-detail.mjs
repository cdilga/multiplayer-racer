// Same baked-asset viewer and paint-key shader; only the capture resolution and paint change.
// node docs/evidence/P1-V-roster-rework/pig-catcher/capture-detail.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
const root=process.cwd(),types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.glb':'model/gltf-binary'};
const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://x').pathname);if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}res.setHeader('content-type',types[path.extname(file)]??'application/octet-stream');res.end(fs.readFileSync(file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch();
try{
for(const [id,paint]of [['pig-catcher','#f4c418'],['postie-bike','#d8262b']]){
 const page=await browser.newPage();
 await page.route('**/tools/vehicles/view/view.js',route=>{const original=fs.readFileSync('tools/vehicles/view/view.js','utf8');route.fulfill({contentType:'text/javascript',body:original.replace("const TILE = sheet === 'ladder' ? 440 : 360;",'const TILE = 1000;').replaceAll("'#22c3e6'",JSON.stringify(paint))});});
 await page.goto(`http://127.0.0.1:${server.address().port}/tools/vehicles/view/index.html?asset=/art/vehicles/${id}/${id}.asset.json&sheet=views&ortho=1.7&zoom=.6`);
 await page.waitForFunction(()=>document.title==='READY'||document.title.startsWith('ERROR'));
 if(await page.title()!=='READY')throw new Error(await page.title());
 const captures=await page.evaluate(()=>{const out={},src=document.querySelector('#sheet');for(const [i,name]of ['front','rear','left','right','top','front-three-quarter','rear-three-quarter'].entries()){const c=document.createElement('canvas');c.width=c.height=1000;c.getContext('2d').drawImage(src,(i%4)*1000,Math.floor(i/4)*1020+20,1000,1000,0,0,1000,1000);out[name]=c.toDataURL();}return out;});
 for(const[name,data]of Object.entries(captures))fs.writeFileSync(`docs/evidence/P1-V-roster-rework/${id}/current-loader/${name}.png`,Buffer.from(data.split(',')[1],'base64'));
 console.log(`${id}: seven 1000 px GLTFLoader views; Chromium ${browser.version()}`);await page.close();
}
}finally{await browser.close();server.close();}
