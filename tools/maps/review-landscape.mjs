// br-bbki.15.1: terrain-first landscape review. Renders generated maps in the real host renderer: a whole-course overview
// plus chase stills at the highest, lowest, steepest-climb and deepest-cutting route points.
// Env: JJ_BIN, JJ_CAPTURE_DIR (required); JJ_ALLOW_INVALID=1; JJ_SEEDS=0,1,2,3; JJ_RECIPES=rocks,outback-dirt,town (or mix: the race's own biome mix); JJ_ENGINE=chromium|webkit|both; JJ_SIZE=1920x1080.
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
const scratch=mkdtempSync(join(tmpdir(),'jj-landscape-'));

// Bilinear terrain height in metres at world (x,z) metres; null outside the grid.
const heightAt=(t,x,z)=>{
  const fx=(x*1000-t.originX)/t.spacing, fz=(z*1000-t.originZ)/t.spacing;
  if(fx<0||fz<0||fx>t.cols-1||fz>t.rows-1) return null;
  const c=Math.min(Math.floor(fx),t.cols-2), r=Math.min(Math.floor(fz),t.rows-2), u=fx-c, v=fz-r;
  const h=(rr,cc)=>t.heights[rr*t.cols+cc]/100;
  return (h(r,c)*(1-u)+h(r,c+1)*u)*(1-v)+(h(r+1,c)*(1-u)+h(r+1,c+1)*u)*v;
};
// Route index where the ground 8-40 m to both sides is highest above the road (maximise min(left,right)-y), as
// crates/jj-procgen/tests/landforms.rs measures a corridor.
const cuttingPoint=(map)=>{
  const pts=map.route.points,n=pts.length,t=map.terrain;let best=0,bestV=-Infinity;
  pts.forEach((p,i)=>{
    const q=pts[(i+1)%n],dx=(q.x-p.x)/1000,dz=(q.z-p.z)/1000,len=Math.hypot(dx,dz)||1,nx=-dz/len,nz=dx/len,x=p.x/1000,z=p.z/1000;
    const side=s=>Math.max(...[8,12,16,20,24,28,32,36,40].map(d=>heightAt(t,x+s*nx*d,z+s*nz*d)??-Infinity));
    const l=side(1),r=side(-1);
    if(!Number.isFinite(l)||!Number.isFinite(r)) return;
    const v=Math.min(l,r)-p.y/1000;
    if(v>bestV){bestV=v;best=i;}
  });
  return {index:best,aboveRoadM:bestV};
};

const jobs=[];
for(const recipe of recipes) for(const seed of seeds) {
  const dir=join(scratch,`${recipe}-s${seed}`);
  // JJ_ALLOW_INVALID=1 reviews the map procgen wrote even when it failed validation (recorded as valid:false).
  let valid=true;
  // A recipe of `mix` prepares the seed as a race does (its own biome mix, P1-FL15c).
  const which=recipe==='mix'?['--mix']:['--recipe',recipe];
  try {execFileSync(process.env.JJ_BIN,['procgen','--seed',String(seed),...which,'--out',dir,'--json'],{stdio:['ignore','ignore','ignore']});}
  catch(e){if(process.env.JJ_ALLOW_INVALID!=='1') throw e; valid=false;}
  const map=JSON.parse(readFileSync(join(dir,'map.json'),'utf8'));
  const pts=map.route.points,n=pts.length,ys=pts.map(p=>p.y);
  const at=(i,k)=>pts[(i+k)%n];
  const idx=(f)=>ys.reduce((b,y,i)=>f(y,ys[b])?i:b,0);
  const climb=pts.reduce((b,p,i)=>at(i,40).y-p.y>at(b,40).y-pts[b].y?i:b,0);
  const cut=cuttingPoint(map);
  jobs.push({recipe,seed,valid,map,mapJson:readFileSync(join(dir,'map.json'),'utf8'),reliefM:(Math.max(...ys)-Math.min(...ys))/1000,
    targets:{high:idx((y,b)=>y>b),low:idx((y,b)=>y<b),climb,cutting:cut.index},cutAboveRoadM:cut.aboveRoadM});
}

const base='/p/landscape/';
const server=await serve(build('./','landscape'),base,{JJ_STUN_URLS:''});
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
        await page.route('**/landscape.json',r=>r.fulfill({contentType:'application/json',body:j.mapJson}));
        await page.goto(`${server.origin}${base}host?test&tiles=1&look=on&camdist=mid&res=1&autores=off&mapUrl=${encodeURIComponent(server.origin+'/landscape.json')}`);
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
          rows.push({recipe:j.recipe,seed:j.seed,valid:j.valid,state,routePoint,file,reliefM:j.reliefM,generator:j.map.header.generator});
          console.log('captured',file);
        };
        const base_={scenario:'landscape-review',what:'Terrain review of a generated map.',map:'generated.json',seed:j.seed};
        await page.evaluate(async({f,m})=>{window.__jjRender.setFollow(null);window.__jjRender.hold();await window.__jjTest.load(f,m);await window.__jjTest.step(1);},
          {f:{...base_,ticks:1,cars:[],seats:[],inputs:[]},m:j.mapJson});
        if(process.env.JJ_DEBUG) console.log('overview loaded');
        await shoot('overview',null);
        const n=j.map.route.points.length;
        for(const [state,target] of Object.entries(j.targets)) {
          const start=(target+n-(state==='cutting'?16:6))%n; // before the feature, facing along the route
          await page.evaluate(async({f,m})=>{
            window.__jjRender.setFollow([0]);
            await window.__jjTest.load(f,m);
            await window.__jjTest.step(60);
          },{f:{...base_,ticks:60,cars:[{routePoint:start,lift:.5,linvel:[0,0,0]}],seats:[{name:'Landscape driver',car:0}],inputs:[]},m:j.mapJson});
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
