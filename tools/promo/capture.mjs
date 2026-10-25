// Real host renderer, deterministic simulation stepping. JJ_PROMO_CAPTURE=/tmp/jj-promo node tools/promo/capture.mjs
import { chromium } from 'playwright';
import { build, serve } from '../../web/landing/tests/lib/site.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const out=process.env.JJ_PROMO_CAPTURE ?? '/tmp/jj-promo';
mkdirSync(out,{recursive:true});
const server=await serve(build('./','promo'),'/p/promo/',{JJ_STUN_URLS:''});
const browser=await chromium.launch({args:['--ignore-gpu-blocklist','--enable-gpu']});
const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
page.setDefaultTimeout(90000);
page.on('pageerror',e=>console.error(e.message));
const shots=[
 {id:'jump',scenario:'scenarios/lab/canyon-leap.json',seconds:6},
 {id:'dirt',recipe:'outback-dirt',seed:3,seconds:7},
 {id:'town',recipe:'town',seed:1,seconds:7},
 {id:'rivals',recipe:'outback-bitumen',seed:1,count:4,seconds:7},
 {id:'rocks',recipe:'rocks',seed:1,seconds:7},
];
const receipt=[];
try {
 for(const shot of shots){
  let fixture,map;
  if(shot.scenario){fixture=JSON.parse(readFileSync(shot.scenario));map=readFileSync(fixture.map,'utf8');fixture.seats=[{name:'Driver',car:0}];}
  else {
   const dir=join(out,shot.id);mkdirSync(dir,{recursive:true});
   execFileSync(process.env.JJ_BIN??'target/debug/jj',['procgen','--recipe',shot.recipe,'--seed',String(shot.seed),'--out',dir,'--json'],{stdio:'ignore'});
   map=readFileSync(join(dir,'map.json'),'utf8');
   fixture={scenario:`promo-${shot.id}`,what:'Promotional gameplay capture',map:'promo.json',seed:shot.seed,ticks:1800,cars:Array.from({length:shot.count??1},(_,i)=>({routePoint:8+i*3,lift:.5})),seats:Array.from({length:shot.count??1},(_,i)=>({name:`Racer ${i+1}`,car:i})),inputs:[]};
  }
  await page.unroute('**/promo-map.json');
  await page.route('**/promo-map.json',r=>r.fulfill({contentType:'application/json',body:map}));
  await page.goto(`${server.origin}/p/promo/host?test&tiles=${shot.count??1}&look=on&camdist=mid&res=1&autores=off&mapUrl=${encodeURIComponent(server.origin+'/promo-map.json')}`);
  await page.waitForFunction(()=>window.__jjTest&&window.__jjRender);
  await page.evaluate(async({fixture,map,count})=>{
   window.__jjRender.hold();await window.__jjTest.load(fixture,map);window.__jjRender.setFollow(Array.from({length:count},(_,i)=>i));
   await window.__jjTest.command({cmd:'autopilot',on:true});await window.__jjTest.step(120);window.__jjRender.frame();
  },{fixture,map,count:shot.count??1});
  await page.evaluate(()=>{
   const style=document.createElement('style');
   style.textContent='body > :not(canvas):not(#app) { visibility: hidden !important; } #app > :not(canvas) { visibility: hidden !important; }';
   document.head.append(style);
   for(const el of document.querySelectorAll('body *')){
    const text=el.firstChild?.textContent??'';
    if(/^(KEYS & PADS|Keys & pads|Join at)/.test(text.trim()))(el.closest('aside,section,div[class]')??el).style.visibility='hidden';
   }
  });
  // Canvas only: exclude joining/debug chrome editorially, leave all world content untouched.
  const canvas=page.locator('canvas').first();
  const dir=join(out,`${shot.id}-frames`);mkdirSync(dir,{recursive:true});
  for(let f=0;f<shot.seconds*30;f++){
   await page.evaluate(async()=>{await window.__jjTest.step(4);window.__jjRender.frame();});
   await canvas.screenshot({path:join(dir,`${String(f).padStart(5,'0')}.jpg`),type:'jpeg',quality:92});
  }
  const state=await page.evaluate(()=>window.__jjTest.observe());
  receipt.push({...shot,build:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),finalTick:state.tick,fixture});
  execFileSync('ffmpeg',['-y','-loglevel','error','-framerate','30','-i',join(dir,'%05d.jpg'),'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',join(out,`${shot.id}.mp4`)]);
  console.log(`captured ${shot.id}`);
  if(process.env.JJ_PROMO_ONE)break;
 }
 writeFileSync(join(out,'capture.json'),JSON.stringify(receipt,null,2));
}finally{await browser.close();await server.close();}
