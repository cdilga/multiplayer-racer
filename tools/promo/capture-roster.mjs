// Seven selectable roster vehicles, each driven by the actual Rust/WASM sim and host renderer.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {build,serve} from '../../web/landing/tests/lib/site.mjs';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const out=process.env.JJ_PROMO_CAPTURE??'/tmp/jj-promo-roster';mkdirSync(out,{recursive:true});
const roster=JSON.parse(readFileSync('web/shared/src/roster.json')).cars;
const server=await serve(build('./','promo-roster'),'/p/promo/',{JJ_STUN_URLS:''});
const browser=await chromium.launch({args:['--ignore-gpu-blocklist','--enable-gpu']});
const page=await browser.newPage({viewport:{width:1280,height:720}});page.setDefaultTimeout(120000);
const map=readFileSync('/tmp/jj-promo3/town/map.json','utf8');const receipt=[];
try{
 await page.route('**/promo-map.json',r=>r.fulfill({contentType:'application/json',body:map}));
 await page.goto(`${server.origin}/p/promo/host?test&look=on&res=1&autores=off&camdist=near&mapUrl=${encodeURIComponent(server.origin+'/promo-map.json')}`);
 await page.waitForFunction(()=>window.__jjTest&&window.__jjRender);
 for(const vehicle of roster){
  const fixture={scenario:`promo-roster-${vehicle.id}`,what:'Actual selectable roster gameplay',map:'promo.json',vehicle:vehicle.id,seed:1,ticks:1200,cars:[{routePoint:8,lift:.5}],seats:[{name:'Driver',car:0}],inputs:[]};
  await page.evaluate(async({fixture,map})=>{window.__jjRender.hold();await window.__jjTest.load(fixture,map);window.__jjRender.setFollow([0]);await window.__jjTest.command({cmd:'autopilot',on:true});await window.__jjTest.step(120);window.__jjRender.frame();}, {fixture,map});
  await page.addStyleTag({content:'body > :not(canvas):not(#app){visibility:hidden!important} #app > :not(canvas){visibility:hidden!important}'});
  const dir=join(out,vehicle.id+'-frames');mkdirSync(dir,{recursive:true});
  for(let f=0;f<90;f++){await page.evaluate(async()=>{await window.__jjTest.step(4);window.__jjRender.frame();});await page.screenshot({path:join(dir,`${String(f).padStart(5,'0')}.jpg`),type:'jpeg',quality:92});}
  const state=await page.evaluate(()=>window.__jjTest.observe());const inspected=await page.evaluate(()=>window.__jjRender.vehicles(0));
  receipt.push({vehicle,fixture,car:state.cars[0],renderer:inspected});
  assert.equal(state.cars.length,1);
  execFileSync('ffmpeg',['-y','-loglevel','error','-framerate','30','-i',join(dir,'%05d.jpg'),'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',join(out,vehicle.id+'.mp4')]);
  console.log('captured',vehicle.id);
 }
}finally{writeFileSync(join(out,'roster.json'),JSON.stringify(receipt,null,2));await browser.close();await server.close();}
