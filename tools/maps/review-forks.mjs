// br-bbki.16.1 (P1-FL16a): route fork review. Renders generated maps with forks in the real host renderer: a whole-course
// overview, then for each fork chase stills 3 s before its split (R4: readable before the commitment) and at the split.
// Env: JJ_BIN, JJ_CAPTURE_DIR (required); JJ_SEEDS=0,1,2,3; JJ_RECIPES=rocks,outback-dirt,town; JJ_ENGINE=chromium|webkit|both; JJ_SIZE=1920x1080.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium,webkit} from 'playwright';
import {build,serve} from '../../web/landing/tests/lib/site.mjs';
import {chromiumArgs} from '../../web/tests/journeys/lib/chromium.mjs';

const out=process.env.JJ_CAPTURE_DIR;
assert.ok(out&&process.env.JJ_BIN,'set JJ_CAPTURE_DIR and JJ_BIN');
mkdirSync(out,{recursive:true});
const seeds=(process.env.JJ_SEEDS??'0,1,2,3').split(',').map(Number);
const recipes=(process.env.JJ_RECIPES??'rocks,outback-dirt,town').split(',');
const [W,H]=(process.env.JJ_SIZE??'1920x1080').split('x').map(Number);
const engines=process.env.JJ_ENGINE==='webkit'?[webkit]:process.env.JJ_ENGINE==='both'?[chromium,webkit]:[chromium];
const scratch=mkdtempSync(join(tmpdir(),'jj-forks-'));

const jobs=[];
for(const recipe of recipes) for(const seed of seeds) {
  const dir=join(scratch,`${recipe}-s${seed}`);
  // A seed whose every draw fails validation has no map to review: say so and go on.
  try {execFileSync(process.env.JJ_BIN,['procgen','--seed',String(seed),'--recipe',recipe,'--out',dir,'--json'],{stdio:['ignore','ignore','ignore']});}
  catch {console.log('no valid map',recipe,seed);continue;}
  const map=JSON.parse(readFileSync(join(dir,'map.json'),'utf8'));
  const forks=map.features.filter(f=>f.kind==='fork');
  if(!forks.length) continue;
  // 3 s before the split at the autopilot's ~24 m/s, on the 2.5 m route spacing; and just before it.
  const targets={};
  forks.forEach((f,k)=>{targets[`fork${k}-3s-before`]=f.params.fromAt-29;targets[`fork${k}-split`]=f.params.fromAt-6;});
  jobs.push({recipe,seed,valid:true,map,mapJson:readFileSync(join(dir,'map.json'),'utf8'),targets});
}

const base='/p/forks/';
const server=await serve(build('./','forks'),base,{JJ_STUN_URLS:''});
const rows=[],errors=[];
try {
  for(const engine of engines) {
    const browser=await engine.launch(engine===chromium?{args:chromiumArgs}:{});
    try {
      for(const j of jobs) {
        const page=await browser.newPage({viewport:{width:W,height:H}});
        page.setDefaultTimeout(60000);
        page.on('pageerror',e=>errors.push(`${j.recipe} s${j.seed}: ${e.message}`));
        if(process.env.JJ_DEBUG) page.on('console',m=>console.log('console',m.type(),m.text().slice(0,200)));
        await page.route('**/forks.json',r=>r.fulfill({contentType:'application/json',body:j.mapJson}));
        await page.goto(`${server.origin}${base}host?test&tiles=1&look=on&camdist=mid&res=1&autores=off&mapUrl=${encodeURIComponent(server.origin+'/forks.json')}`);
        await page.waitForFunction(()=>window.__jjTest&&window.__jjRender);
        if(process.env.JJ_DEBUG) console.log('host ready');
        const paint=async()=>{
          const tick=await page.evaluate(async()=>(await window.__jjTest.observe()).tick);
          await page.waitForFunction(t=>{window.__jjRender.frame();return window.__jjRender.stats().tick>=t;},tick,{polling:100});
          await page.evaluate(async()=>{
            for(let i=0;i<4;i++){window.__jjRender.frame();await new Promise(r=>setTimeout(r,16));}
            window.__jjRender.hold();
          });
        };
        const shoot=async(state,routePoint)=>{
          await page.waitForFunction(()=>!document.querySelector('#jj-caption')?.textContent,undefined,{timeout:20000});
          // The keyboard-players panel and join pill cover the view; hide them for terrain review only.
          await page.evaluate(()=>{for(const el of document.querySelectorAll('body *')){const t=el.firstChild?.textContent??'';if(/^(KEYS & PADS|Keys & pads|Join at)/.test(t.trim())){(el.closest('aside,section,div[class]')??el).style.visibility='hidden';}}});
          await paint();
          const file=`${j.recipe}-s${j.seed}-${state}${engines.length>1?'-'+engine.name():''}.jpg`;
          await page.screenshot({path:join(out,file),type:'jpeg',quality:88});
          rows.push({recipe:j.recipe,seed:j.seed,valid:j.valid,state,routePoint,file,generator:j.map.header.generator});
          console.log('captured',file);
        };
        const base_={scenario:'fork-review',what:'Route fork review of a generated map.',map:'generated.json',seed:j.seed};
        await page.evaluate(async({f,m})=>{window.__jjRender.setFollow(null);window.__jjRender.hold();await window.__jjTest.load(f,m);await window.__jjTest.step(1);},
          {f:{...base_,ticks:1,cars:[],seats:[],inputs:[]},m:j.mapJson});
        if(process.env.JJ_DEBUG) console.log('overview loaded');
        await shoot('overview',null);
        const n=j.map.route.points.length;
        for(const [state,target] of Object.entries(j.targets)) {
          const start=(target+n)%n; // facing along the route
          await page.evaluate(async({f,m})=>{
            window.__jjRender.setFollow([0]);
            await window.__jjTest.load(f,m);
            await window.__jjTest.step(60);
          },{f:{...base_,ticks:60,cars:[{routePoint:start,lift:.5,linvel:[0,0,0]}],seats:[{name:'Fork driver',car:0}],inputs:[]},m:j.mapJson});
          await shoot(state,target);
        }
        await page.close();
      }
    } finally {await browser.close();}
  }
} finally {await server.close();rmSync(scratch,{recursive:true,force:true});}
writeFileSync(join(out,'capture.json'),JSON.stringify({source:'local real jj-server',size:[W,H],seeds,recipes,rows,errors},null,2)+'\n');
assert.deepEqual(errors,[],'page errors');
console.log(`Captured ${rows.length} frames; inspect every image in ${out}.`);
