import {createHash} from 'node:crypto';
import {readdirSync,statSync} from 'node:fs';
// Seven selectable roster vehicles, each driven by the actual Rust/WASM sim and host renderer.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {build,serve} from '../../web/landing/tests/lib/site.mjs';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const out=process.env.JJ_PROMO_CAPTURE??'/tmp/jj-promo-roster';mkdirSync(out,{recursive:true});
const roster=JSON.parse(readFileSync('web/shared/src/roster.json')).cars;
const buildDir=process.env.JJ_PROMO_BUILD;assert.ok(buildDir,'Set JJ_PROMO_BUILD to the recorded current game build');
const server=await serve(buildDir,'/p/promo/',{JJ_STUN_URLS:''});
const browser=await chromium.launch({args:['--ignore-gpu-blocklist','--enable-gpu']});
const page=await browser.newPage({viewport:{width:1920,height:1080}});page.setDefaultTimeout(120000);
// The page clock advances exactly 1/60 s per captured frame, so render interpolation matches the 2 ticks stepped.
await page.addInitScript(() => {
  const real = performance.now.bind(performance);
  let virt = null;
  window.__promoClock = { start: () => (virt = real()), advance: (ms) => (virt += ms) };
  performance.now = () => virt ?? real();
});

const map=readFileSync(process.env.JJ_PROMO_MAP??'/tmp/jj-promo3/town/map.json','utf8');const receipt=[];
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourceGlbs=Object.fromEntries(roster.flatMap(v=>[0,1,2].map(l=>{const file=`art/vehicles/${v.id}/${v.id}.lod${l}.glb`;return[file,sha(readFileSync(file))];})));
const responseBodies=[];const network=[];
page.on('response',response=>{if(!new URL(response.url()).pathname.endsWith('.glb'))return;responseBodies.push((async()=>{const bytes=await response.body(),hash=sha(bytes),source=Object.keys(sourceGlbs).find(p=>sourceGlbs[p]===hash);assert.ok(source,'Unknown or stale HTTP GLB '+response.url());network.push({url:response.url(),status:response.status(),bytes:bytes.length,sha256:hash,source});})());});
const original={buildDir,git:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),fps:60,simHz:120,sourceGlbs};
const provenance={...original,origin:server.origin,captureKind:'close-front-three-quarter-and-side',network,captured:[]};
writeFileSync(join(out,'provenance.json'),JSON.stringify(provenance,null,2));

try{
 await page.route('**/promo-map.json',r=>r.fulfill({contentType:'application/json',body:map}));
 for(const vehicle of roster){
  const fixture={scenario:`promo-roster-${vehicle.id}`,what:'Actual selectable roster driving shown from existing renderer orbit cameras',map:'promo.json',vehicle:vehicle.id,seed:1,ticks:1200,cars:[{routePoint:8,lift:.5}],seats:[{name:'Driver',car:0}],inputs:[]};
  const dir=join(out,vehicle.id+'-frames');mkdirSync(dir,{recursive:true});
  const bike=vehicle.id.endsWith('bike')||vehicle.id==='pig-catcher';
  const camera={distance:bike?2.9:4.7,height:bike?1.25:1.65,targetHeight:bike?.75:.65};
  for(const [a,orbit] of [135,90].entries()){
   await page.goto(`${server.origin}/p/promo/host?test&look=on&res=1&autores=off&tiles=1&follow=0&orbit=${orbit}&orbitDistance=${camera.distance}&orbitHeight=${camera.height}&orbitTargetHeight=${camera.targetHeight}&mapUrl=${encodeURIComponent(server.origin+'/promo-map.json')}`);
   await page.waitForFunction(()=>window.__jjTest&&window.__jjRender);
   await page.evaluate(async({fixture,map})=>{window.__jjRender.hold();await window.__jjTest.load(fixture,map);await window.__jjTest.command({cmd:'autopilot',on:true});await window.__jjTest.step(120);window.__promoClock.start();window.__jjRender.frame();}, {fixture,map});
   await page.waitForFunction(id=>{window.__jjRender.frame();const r=window.__jjRender.vehicles(0);return r.parts?.length>0&&r.parts.every(p=>p.vehicle===id)&&r.vehicles.some(v=>v.id===id&&v.loaded&&v.cars===1);},vehicle.id);
   await page.addStyleTag({content:'body > :not(canvas):not(#app){visibility:hidden!important} #app > :not(canvas){visibility:hidden!important}'});
   for(let f=0;f<90;f++){await page.evaluate(async()=>{await window.__jjTest.step(2);window.__promoClock.advance(1000/60);window.__jjRender.frame();});await page.screenshot({path:join(dir,`${String(a*90+f).padStart(5,'0')}.jpg`),type:'jpeg',quality:92});}
  }
  const state=await page.evaluate(()=>window.__jjTest.observe());const inspected=await page.evaluate(()=>window.__jjRender.vehicles(0));
  await Promise.all(responseBodies);
  const glbs=[0,1,2].map(l=>{const file=`art/vehicles/${vehicle.id}/${vehicle.id}.lod${l}.glb`,observed=network.find(r=>r.source===file);assert.ok(observed,'GLB was not fetched: '+file);assert.equal(sha(readFileSync(file)),sourceGlbs[file],'Source changed during capture');return observed;});
  assert.ok(inspected.parts.every(p=>p.vehicle===vehicle.id));
  receipt.push({vehicle,fixture,camera:{...camera,orbitDegrees:[135,90],secondsPerAngle:1.5},car:state.cars[0],renderer:inspected,glbs});
  provenance.captured.push({id:vehicle.id,glbs});
  writeFileSync(join(out,'provenance.json'),JSON.stringify(provenance,null,2));
  assert.equal(state.cars.length,1);
  execFileSync('ffmpeg',['-y','-loglevel','error','-framerate','60','-i',join(dir,'%05d.jpg'),'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',join(out,vehicle.id+'.mp4')]);
  console.log('captured',vehicle.id);
 }
}finally{await Promise.all(responseBodies);writeFileSync(join(out,'provenance.json'),JSON.stringify(provenance,null,2));writeFileSync(join(out,'roster.json'),JSON.stringify(receipt,null,2));await browser.close();await server.close();}
