// br-bbki.15.1 baseline: stills of the generated tracks on a DEPLOYED preview (the generator before the terrain change).
// Env: JJ_PREVIEW_URL, JJ_CAPTURE_DIR (required); JJ_RECIPES=rocks,outback-dirt,town,outback-bitumen; JJ_SEEDS=1,2,3,4 (session seeds start at 1).
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {chromiumArgs} from '../../web/tests/journeys/lib/chromium.mjs';

const out=process.env.JJ_CAPTURE_DIR;
assert.ok(out&&process.env.JJ_PREVIEW_URL,'set JJ_CAPTURE_DIR and JJ_PREVIEW_URL');
mkdirSync(out,{recursive:true});
const seeds=(process.env.JJ_SEEDS??'1,2,3,4').split(',').map(Number);
const recipes=(process.env.JJ_RECIPES??'rocks,outback-dirt,town,outback-bitumen').split(',');
const deployed=new URL(process.env.JJ_PREVIEW_URL);
const base=deployed.pathname.replace(/\/?$/,'/');
const rows=[],failures=[];
const browser=await chromium.launch({args:chromiumArgs});
try {
  for(const recipe of recipes) for(const seed of seeds) {
    const tag=`${recipe}-s${seed}`;
    const page=await browser.newPage({viewport:{width:1920,height:1080}});
    page.setDefaultTimeout(60000);
    try {
      await page.goto(`${deployed.origin}${base}host?test&room&recipe=${recipe}&laps=9&look=on&camdist=mid&res=1&autores=off`);
      await page.waitForFunction(()=>window.__jjPrepare&&window.__jjRoom&&window.__jjNet?.code(),undefined,{timeout:90000});
      await page.evaluate(()=>window.__jjTest.join('Baseline driver',{lobby:true}));
      let built;
      do {
        const count=await page.evaluate(()=>window.__jjPrepare.seeds().length);
        await page.evaluate(async()=>{window.__jjPrepare.reroll();await window.__jjTest.step(1);});
        await page.waitForFunction(count=>{const s=window.__jjPrepare.seeds();return s.length>count&&s.at(-1).lengthM!==undefined&&window.__jjPrepare.stats().delivered===s.length;},count,{timeout:90000});
        built=await page.evaluate(()=>window.__jjPrepare.seeds().at(-1));
        assert.ok(built.seed<=seed,`seed ${seed} skipped (at ${built.seed})`);
      } while(built.seed<seed);
      await page.evaluate(async()=>{window.__jjRoom.start();await window.__jjTest.step(1);window.__jjRoom.start();await window.__jjTest.step(1);});
      await page.waitForFunction(()=>window.__jjRoom.view()?.phase==='Running',undefined,{timeout:90000});
      await page.waitForFunction(()=>window.__jjPrepare.stats().committed===1,undefined,{timeout:90000});
      await page.evaluate(()=>window.__jjTest.command({cmd:'autopilot',on:false}));
      const route=(await page.evaluate(()=>window.__jjPrepare.mapInfo())).route;
      const n=route.length,ys=route.map(p=>p[2]);
      const idx=f=>ys.reduce((b,y,i)=>f(y,ys[b])?i:b,0);
      const climb=route.reduce((b,p,i)=>route[(i+40)%n][2]-p[2]>route[(b+40)%n][2]-route[b][2]?i:b,0);
      const targets={high:idx((y,b)=>y>b),low:idx((y,b)=>y<b),climb};
      const reliefM=Math.max(...ys)-Math.min(...ys);
      const paint=async()=>{
        const tick=await page.evaluate(async()=>(await window.__jjTest.observe()).tick);
        await page.waitForFunction(t=>{window.__jjRender.frame();return window.__jjRender.stats().tick>=t;},tick,{polling:100,timeout:60000});
        await page.evaluate(async()=>{
          window.__jjRender.frame();
          await document.fonts.ready;
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        });
      };
      const shoot=async(state,point)=>{
        if(point!==null) {
          const start=(point+n-6)%n;
          await page.evaluate(async t=>{
            const route=window.__jjPrepare.mapInfo().route,p=route[t],q=route[(t+1)%route.length];
            await window.__jjTest.command({cmd:'place',car:0,pose:{x:p[0],y:p[2]+.6,z:p[1],headingDeg:Math.atan2(q[0]-p[0],q[1]-p[1])*180/Math.PI},linvel:[0,0,0]});
            await window.__jjTest.step(120);
          },start);
        }
        await page.evaluate(p=>window.__jjRender.setFollow(p===null?null:[0]),point);
        await page.waitForFunction(()=>!document.querySelector('#jj-caption')?.textContent,undefined,{timeout:20000});
        await paint();
        const file=`${tag}-${state}.jpg`;
        await page.screenshot({path:join(out,file),type:'jpeg',quality:88});
        rows.push({recipe,seed,state,routePoint:point,file,reliefM});
        console.log('captured',file);
      };
      for(const [state,point] of Object.entries(targets)) await shoot(state,point);
      await shoot('field',null);
    } catch(e) {
      failures.push({recipe,seed,error:String(e.message).slice(0,300)});
      console.log('FAILED',tag,String(e.message).slice(0,200));
    } finally {await page.close();}
  }
} finally {await browser.close();}
writeFileSync(join(out,'capture.json'),JSON.stringify({source:deployed.href,sha:base.match(/v02-([0-9a-f]+)/)?.[1]??null,size:[1920,1080],seeds,recipes,rows,failures},null,2)+'\n');
console.log(`Captured ${rows.length} frames, ${failures.length} failures; inspect every image in ${out}.`);
