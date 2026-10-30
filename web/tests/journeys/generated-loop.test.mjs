// br-xlvx.6.4: a loop-the-loop placed by the generator (jj procgen, loopsPerLap) in a real generated map, ridden in the real
// host: over the top upside down, out upright, the WASM run matching native, seen from the chase tile and the overview.
//   JJ_CAPTURE_DIR=docs/evidence/br-xlvx.6.4 node --test web/tests/journeys/generated-loop.test.mjs
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {before,after,test} from 'node:test';
import {readFileSync,mkdirSync,mkdtempSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {build,serve} from '../../landing/tests/lib/site.mjs';
import {chromiumArgs,gpu} from './lib/chromium.mjs';
import {evidencePath} from '../lib/evidence.mjs';
import {inFrameRide,labelClear,tilesFollowing} from './lib/in-frame.mjs';

const BASE='/p/genloop/';
const out=process.env.JJ_CAPTURE_DIR ?? evidencePath('br-xlvx.6.4');
const TICKS=420;
// The first rocks seed from 1 that gets a loop at loopsPerLap 1 (crates/jj-procgen/tests/loops.rs prints the bank): a
// fixed seed broke whenever a generator change moved its loop (seed 1 lost its loop in October 2026).
const RECIPE='rocks';
let SEED;
// The chase is a grid tile following the car; the overview is the host's own overview camera (no `tiles`).
const VIEWS=[['chase','tiles=1&follow=0'],['overview','']];
let scratch,server,mapJson,fixture,native;
before(async()=>{
  mkdirSync(out,{recursive:true});
  scratch=mkdtempSync(join(tmpdir(),'jj-genloop-'));
  symlinkSync(resolve('assets'),join(scratch,'assets'),'dir');
  const [bin,...args]=process.env.JJ_BIN ? [process.env.JJ_BIN] : ['cargo','run','--locked','-q','-p','jj-tools','--bin','jj','--'];
  const dir=join(scratch,'map');
  // Loops ship at loopsPerLap 0 until br-xlvx.6.5; `--loops 1` asks for one a lap.
  let map,loop;
  for(let s=1;s<=20&&!loop;s++){
    SEED=String(s);
    execFileSync(bin,[...args,'procgen','--seed',SEED,'--recipe',RECIPE,'--loops','1','--out',dir,'--json']);
    mapJson=readFileSync(join(dir,'map.json'),'utf8');
    map=JSON.parse(mapJson);
    loop=map.features.find(f=>f.kind==='loop');
  }
  assert.ok(loop,`a ${RECIPE} seed in 1-20 has a generated loop`);
  const p=loop.params,i=p.entry-10,a=map.route.points[i],b=map.route.points[i+1],h=Math.atan2(b.x-a.x,b.z-a.z),v=22;
  fixture={scenario:'generated-loop',what:'A Cruz rides a generator-placed loop at speed: over the top upside down, out along the road.',
    map:join(dir,'map.json'),seed:Number(SEED),ticks:TICKS,cars:[{routePoint:i,lift:.3,linvel:[v*Math.sin(h),0,v*Math.cos(h)]}],
    race:{laps:1,atTick:0},seats:[{name:'Loopy',car:0}],inputs:[{car:0,fromTick:0,toTick:TICKS,throttle:1}],
    expect:[{car:0,metric:'wrecks',min:0,max:0},{car:0,metric:'recoveries',min:0,max:0}]};
  const path=join(scratch,'fixture.json');writeFileSync(path,JSON.stringify(fixture,null,2)+'\n');
  [native]=JSON.parse(execFileSync(bin,[...args,'sim','--json','--out',join(scratch,'native'),path],{encoding:'utf8'}));
  assert.equal(native.ok,true,JSON.stringify(native));assert.equal(native.replayMatches,true);
  server=await serve(build('./','generated-loop'),BASE,{JJ_STUN_URLS:''});
});
after(async()=>{await server?.close?.();if(scratch)rmSync(scratch,{recursive:true,force:true});});

test('chromium: a generated loop is ridden upside down at the top, out upright, matching native; chase and overview see it',{timeout:300_000},async()=>{
  const browser=await chromium.launch({args:chromiumArgs});
  const errors=[],rows=[],tops=[];
  try {
    for(const [view,query] of VIEWS) {
      const page=await browser.newPage({viewport:{width:1920,height:1080}});
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/generated-loop.json',r=>r.fulfill({contentType:'application/json',body:mapJson}));
      await page.goto(`${server.origin}${BASE}host?test&${query}&look=on&res=1&autores=off&mapUrl=${encodeURIComponent(server.origin+'/generated-loop.json')}`);
      await page.waitForFunction(()=>window.__jjTest&&window.__jjRender);
      await page.evaluate(async({fixture,mapJson})=>{window.__jjRender.hold();await window.__jjTest.load(fixture,mapJson);},{fixture,mapJson});
      assert.equal((await page.evaluate(()=>window.__jjRender.loopShapes())).length,1,'the generated loop is drawn');
      const paint=async()=>{
        const t=await page.evaluate(async()=>(await window.__jjTest.observe()).tick);
        await page.waitForFunction(t=>{window.__jjRender.frame();return window.__jjRender.stats().tick>=t;},t,{polling:100});
      };
      const ride=[];
      let top=null;
      for(let tick=0;tick<TICKS;) {
        await page.evaluate(()=>window.__jjTest.step(2));tick+=2;
        const c=(await page.evaluate(()=>window.__jjTest.observe())).cars[0];
        ride.push({tick,position:c.position,upY:c.upY});
        if(!top&&c.upY<-.9) {
          top={tick,position:c.position,upY:c.upY};
          await page.waitForFunction(()=>!document.querySelector('#jj-caption')?.textContent,undefined,{timeout:20_000});
          for(const [width,height] of [[1920,1080],[1366,768]]) {
            await page.setViewportSize({width,height});await paint();
            const sees=await page.evaluate(async()=>{
              const s=await window.__jjTest.observe();
              return window.__jjRender.tilesSee(s.cars.map(c=>[c.position[0],c.position[1],c.position[2]]));
            });
            if(view==='chase')assert.ok(sees.length&&sees[0].sees.every(Boolean),'the car at the top is in the tile camera frustum');
            if(view==='overview'){
              // R141 (owner, 2026-10-26): a race draws no name badges (only a derby does), so nothing covers the car or its loop.
              const lab=await labelClear(page);
              assert.equal(lab.labelled,false,`a race draws no name badge over the car: ${JSON.stringify(lab)}`);
            }
            const file=`top-${view}-${width}x${height}.jpg`;
            if(process.env.JJ_CAPTURE_DIR)await page.screenshot({path:join(out,file),type:'jpeg',quality:85});
            rows.push({file,width,height,view});
          }
        }
      }
      assert.ok(top,`the car goes over the top upside down: ${JSON.stringify(ride.filter((_,k)=>k%10===0))}`);
      assert.ok(top.position[1]-ride[0].position[1]>12,`the top is high above the run-in: ${JSON.stringify(top)} from ${JSON.stringify(ride[0])}`);
      tops.push(top);
      const last=ride.at(-1);
      assert.ok(last.upY>.9,`the car is back on the road, upright: ${JSON.stringify(last)}`);
      const hash=await page.evaluate(()=>window.__jjTest.hash());
      assert.equal(hash.stateHash,native.stateHash,'full native/WASM state matches at the final tick');
      await page.close();
    }
    assert.deepEqual(tops[1],tops[0],'the camera does not change the ride');
    assert.deepEqual(errors,[]);
    writeFileSync(join(out,'generated-loop.json'),JSON.stringify({browser:'chromium',fixture:{...fixture,map:`jj procgen --seed ${SEED} --recipe ${RECIPE}`},native,top:tops[0],rows,errors},null,2)+'\n');
  } finally {await browser.close();}
});

// br-l4v5 (R125), br-8h3u.2: at every tile size the race camera keeps the car in frame all the way round the loop and
// through the eases in and out, never rolls, and zooms in on the car in the loop; checked 20 times a second.
// On the gpu runner (gpu.yml): nine SwiftShader tiles a frame are too slow for a CPU slot's budget.
test('chromium: the loop stays in frame in 1, 4 and 9 tiles, 20 times a second',{timeout:600_000,skip:!gpu&&'needs the gpu runner (JJ_CHROMIUM_GPU)'},async()=>{
  const browser=await chromium.launch({args:chromiumArgs});
  const rows=[];
  try {
    for(const n of [1,4,9]) {
      const page=await browser.newPage({viewport:{width:1366,height:768}});
      await page.route('**/generated-loop.json',r=>r.fulfill({contentType:'application/json',body:mapJson}));
      await page.goto(`${server.origin}${BASE}host?test&${tilesFollowing(n)}&look=on&res=1&autores=off&mapUrl=${encodeURIComponent(server.origin+'/generated-loop.json')}`);
      await page.waitForFunction(()=>window.__jjTest&&window.__jjRender);
      await page.evaluate(async({fixture,mapJson})=>{window.__jjRender.hold();await window.__jjTest.load(fixture,mapJson);},{fixture,mapJson});
      const r=await inFrameRide(page,{ticks:TICKS});
      // br-8h3u.2: no roll anywhere; once eased into the loop the car is framed closer than the chase frames it on the
      // road before the loop, and after the exit the chase eases back out to that framing.
      const before=r.cams.find(c=>c.tick>0&&c.loop===null&&c.loopIn===0),inLoop=r.cams.filter(c=>c.loopIn>.9),after=r.cams.at(-1);
      const maxRoll=Math.max(...r.cams.map(c=>Math.abs(c.rollDeg))),maxZoom=Math.max(...inLoop.map(c=>c.zoomM));
      rows.push({tiles:n,frames:r.frames,lost:r.lost.length,maxRollDeg:maxRoll,chaseZoomM:before?.zoomM,maxLoopZoomM:maxZoom,afterZoomM:after?.zoomM});
      console.log(`# ${n} tiles: ${r.frames} checks, ${r.lost.length} lost, roll ${maxRoll} deg, zoom ${before?.zoomM} m -> ${maxZoom} m -> ${after?.zoomM} m`);
      assert.deepEqual(r.lost,[],`${n} tiles: the car leaves a tile's frame`);
      assert.ok(maxRoll<.01,`${n} tiles: the camera stays world-up (max roll ${maxRoll} deg)`);
      assert.ok(inLoop.length&&before&&maxZoom<before.zoomM,`${n} tiles: the camera zooms in through the loop (${maxZoom} m vs ${before?.zoomM} m before it)`);
      // The ride ends about a second past the exit: the ease out is under way (web/host/tests/loop-camera.test.mjs rides
      // it all the way back to the road framing).
      const tail=r.cams.filter(c=>c.seat===after.seat).slice(-4).map(c=>c.loopIn);
      assert.ok(after.loop===null&&after.loopIn<.5&&tail.every((v,k)=>!k||v<tail[k-1]),`${n} tiles: the camera eases back out after the loop (ease ${tail})`);
      await page.close();
    }
    if(process.env.JJ_CAPTURE_DIR)writeFileSync(join(out,'in-frame.json'),JSON.stringify({browser:'chromium',viewport:'1366x768',rows},null,2)+'\n');
  } finally {await browser.close();}
});
