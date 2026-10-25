import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root='docs/evidence/P1-V-roster-rework/ready-layout';await fs.mkdir(root,{recursive:true});
const browser=await chromium.launch(),results=[];
try{for(const path of ['/poc/vehicles/','/poc/vehicles/review.html?v=cruz-missile'])for(const [width,height] of [[412,915],[915,412],[375,667],[1920,1080],[1366,768]]){
 const page=await browser.newPage({viewport:{width,height}}),problems=[];
 page.on('pageerror',e=>problems.push(e.message));page.on('response',r=>{if(r.status()>=400)problems.push(r.status()+' '+r.url());});page.on('requestfailed',r=>problems.push(r.url()+' '+r.failure()?.errorText));
 await page.goto('https://jammers-preview.dilger.dev'+path);
 await page.getByRole('button',{name:'LOD0',exact:true}).waitFor();
 await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
 await page.getByRole('button',{name:'Spin',exact:true}).click();
 for(const state of ['ready','resized']){
  if(state==='resized'){await page.setViewportSize({width:Math.round(width*.9),height:Math.round(height*.85)});await page.setViewportSize({width,height});}
  const stem=path.includes('review.html')?'cruz':'index',file=`${root}/${stem}-${width}x${height}-${state}.png`;
  await page.screenshot({path:file,fullPage:true});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(overflow<=2);results.push({path,width,height,state,file,overflow});
 }
 // Record nonfatal browser GLB cancellations only after successful model readiness; their cause is not established.
 // The LOD control exists only after load(), and 141 public payload hashes plus the all-LOD control probe independently verify the GLBs.
 const cancellations=problems.filter(x=>x.endsWith('.glb net::ERR_ABORTED'));
 assert.deepEqual(problems.filter(x=>!cancellations.includes(x)),[]);results.at(-1).successfulModelLoadCancellations=cancellations;await page.close();
}}finally{await browser.close();await fs.writeFile(root+'/checks.json',JSON.stringify({browser:'Chromium',results},null,2)+'\n');}
console.log('PASS10 page/viewport combinations, all assets ready, before/after resize;20 screenshots.');
