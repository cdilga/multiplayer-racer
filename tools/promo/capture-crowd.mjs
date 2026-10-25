// Owner-feedback sequel: real room, synthetic controller cohort, real scoring and weapons.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build, serve } from '../../web/landing/tests/lib/site.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const out=process.env.JJ_PROMO_CAPTURE??'/tmp/jj-promo-crowd';
mkdirSync(out,{recursive:true});
const N=64; // A filmed sample, never a gameplay limit.
const server=await serve(build('./','promo-crowd'),'/p/promo/',{JJ_STUN_URLS:''});
const browser=await chromium.launch({args:['--ignore-gpu-blocklist','--enable-gpu']});
const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
page.setDefaultTimeout(180000);
page.on('pageerror',e=>console.error(e.message));
const evidence={build:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cohort:N,controllers:'Synthetic inputs through real host controller path; not 64 human players',shots:[]};
const wait=fn=>page.waitForFunction(fn,undefined,{timeout:180000});
const input=frames=>page.evaluate(async frames=>{for(const [endpoint,frame]of frames)window.__jjTest.input({type:'controller',endpoint,frame});await window.__jjTest.step(1);},frames);
const observe=()=>page.evaluate(()=>window.__jjTest.observe());
let seq=0;
const neutral=()=>input(Array.from({length:N},(_,i)=>[`crowd-${i}`,{state:{source:0,seq:seq++%65536,drive:[0,0],action:[0,0]}}]));
const chrome=on=>page.evaluate(on=>{
 let s=document.querySelector('#promo-hide');if(!s){s=document.createElement('style');s.id='promo-hide';document.head.append(s);}
 s.textContent=on?'':'body > :not(canvas):not(#app){visibility:hidden!important} #app > :not(canvas){visibility:hidden!important} [data-jj-input-drawer],#jj-caption{visibility:hidden!important}';
},on);
async function record(id,seconds,action,ui=false){
 const dir=join(out,id+'-frames');mkdirSync(dir,{recursive:true});
 await chrome(ui);
 for(let f=0;f<seconds*30;f++){
  if(action)await action(f);
  if(id!=='joining'&&id!=='winner'&&f%3===0)await neutral();
  await page.evaluate(async()=>{await window.__jjTest.step(4);window.__jjRender.frame();});
  await page.screenshot({path:join(dir,`${String(f).padStart(5,'0')}.jpg`),type:'jpeg',quality:92});
 }
 execFileSync('ffmpeg',['-y','-loglevel','error','-framerate','30','-i',join(dir,'%05d.jpg'),'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',join(out,id+'.mp4')]);
 const state=await observe();writeFileSync(join(out,id+'-state.json'),JSON.stringify(state));
 evidence.shots.push({id,seconds,tick:state.tick,cars:state.cars.length,debris:state.debris.length});
 writeFileSync(join(out,'capture.json'),JSON.stringify(evidence,null,2));console.log('captured',id);
}
async function ring(impact=false){
 await page.evaluate(async({N,impact})=>{
  const s=window.__jjTest;const o=await s.observe();
  for(let i=0;i<o.cars.length;i++){
   const a=(i%16)*Math.PI*2/16+(Math.floor(i/16)%2)*.065;
   const r=impact?24+Math.floor(i/16)*7:22+Math.floor(i/16)*6;
   const x=Math.sin(a)*r,z=Math.cos(a)*r;
   await s.command({cmd:'place',car:o.cars[i].car,pose:{x,y:1.6,z,headingDeg:a*180/Math.PI+180},linvel:impact?[-Math.sin(a)*30,0,-Math.cos(a)*30]:[0,0,0]});
  }
  window.__jjRender.setFollow(null);window.__jjRender.frame();
 },{N,impact});
}
try{
 await page.goto(`${server.origin}/p/promo/host?room&test=live&mode=derby&derbyMs=45000&look=on&res=1&autores=off`);
 await wait(()=>window.__jjNet?.code()&&window.__jjRoom?.view()?.phase==='Lobby');
 await page.evaluate(()=>window.__jjTest.hold(true));
 // Actual lobby grows from zero to the full cohort. Each addition is a real Hello/Claim.
 if(process.env.JJ_PROMO_REUSEJOIN){
  for(let i=0;i<N;i++)await input([[`crowd-${i}`,{hello:true}],[`crowd-${i}`,{claim:i===0?'Davo':`Mate ${i+1}`}]]);
 }else await record('joining',8,async f=>{
  if(f%3===0&&f/3<N){const i=f/3;await input([[`crowd-${i}`,{hello:true}],[`crowd-${i}`,{claim:i===0?'Davo':`Mate ${i+1}`}]]);}
 },true);
 await wait(()=>window.__jjRoom.view().seats.length===64);
 const lobby=await page.evaluate(()=>window.__jjRoom.view());assert.equal(lobby.seats.length,N);
 evidence.lobbySeats=lobby.seats.length;
 await input(Array.from({length:N},(_,i)=>[`crowd-${i}`,{ready:true}]));
 await page.evaluate(()=>window.__jjTest.hold(false));
 await wait(()=>window.__jjRoom.view().phase==='Running');
 await page.evaluate(()=>{window.__jjTest.hold(true);window.__jjRender.hold();window.__jjRender.setFollow(null);});
 await page.evaluate(()=>window.__jjTest.step(360));
 await neutral();
 await page.evaluate(()=>window.__jjTest.command({cmd:'autopilot',on:false}));
 assert.equal((await observe()).cars.length,N);
 await ring(false);
 await record('crowd',4);
 await ring(true);
 await record('pileup',8);
 // A separate shot uses the same real round, with a journalled reset of positions for a clear volley.
 await ring(false);
 for(let k=0;k<20;k++){
  await neutral();
  await page.evaluate(async()=>{await window.__jjTest.command({cmd:'autopilot',on:false});await window.__jjTest.step(18);});
 }
 evidence.volleys=[];
 await record('derby',10,async f=>{
  if(f%60===0){
   const volley=await page.evaluate(async()=>{
    const s=window.__jjTest,o=await s.observe();let accepted=0,fired=0;
    for(const c of o.cars){const p=await s.command({cmd:'pickupItem',car:c.car,item:'boomerang'});if(p.accepted)accepted++;const u=await s.command({cmd:'utility',car:c.car,forward:true});if(u.outcome.startsWith('Applied'))fired++;}
    const state=await s.observe();return{tick:state.tick,accepted,fired,items:state.items};
   });evidence.volleys.push(volley);
  }
 });
 assert.ok(evidence.volleys.some(v=>v.fired>20),'large real boomerang volley accepted');
 // Close shot: all cars remain simulated, four actual chase cameras show the aftermath.
 await page.evaluate(()=>window.__jjRender.setFollow([0,1,2,3]));
 await record('rivalry',5);
 // Let the real derby clock rank the damage already scored; do not invent a result.
 for(let k=0;k<120&&await page.evaluate(()=>window.__jjRoom.view().phase==='Running');k++)await page.evaluate(()=>window.__jjTest.step(120));
 await page.evaluate(()=>window.__jjTest.hold(false));
 await wait(()=>window.__jjRoom.view().phase==='Intermission'&&document.querySelector('[data-screen=results]'));
 evidence.result=await page.evaluate(()=>window.__jjRoom.view());
 assert.equal(evidence.result.results.length,N);
 assert.ok(evidence.result.seats.some(s=>s.derby?.points>0),'real collisions scored');
 await page.evaluate(()=>window.__jjTest.hold(true));
 await record('winner',5,undefined,true);
}finally{writeFileSync(join(out,'capture.json'),JSON.stringify(evidence,null,2));await browser.close();await server.close();}
