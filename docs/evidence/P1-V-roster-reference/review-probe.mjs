// Run the actual POC controls for each revised vehicle in Chromium and WebKit.
// --base https://jammers-preview.dilger.dev checks publication; default serves the checkout.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {serveArtUi} from '../../../art/ui/lib/serve.mjs';
const args=process.argv.slice(2),take=(flag,d)=>args.includes(flag)?args[args.indexOf(flag)+1]:d;
const root='docs/evidence/P1-V-roster-reference',out=take('--out',`${root}/local-interactions`);
const local=args.includes('--base')?null:await serveArtUi(),base=take('--base',local?.base);
const ids=['au-hawk','cruz-missile','lion-president','pig-catcher','postie-bike','tradie-ute'];
await fs.mkdir(out,{recursive:true});
const results=[];
try {
  for(const [name,type,viewport]of [['chromium',chromium,{width:1366,height:768}],['webkit',webkit,{width:412,height:915}]]) {
    const browser=await type.launch();
    try {
      for(const id of ids) {
        const page=await browser.newPage({viewport,hasTouch:name==='webkit'}),problems=[];
        page.on('pageerror',e=>problems.push(e.message));
        page.on('response',r=>{if(r.status()>=400)problems.push(`${r.status()} ${r.url()}`);});
        const review=JSON.parse(await fs.readFile(`art/ui/poc/vehicles/${id}/review.json`,'utf8'));
        await page.goto(`${base}/poc/vehicles/review.html?v=${id}`);
        await page.getByRole('button',{name:'LOD0',exact:true}).waitFor();
        await page.getByRole('button',{name:'Spin',exact:true}).click();
        const stage=page.locator('#stage');await stage.scrollIntoViewIfNeeded();
        const files=[],capture=async state=>{
          await page.waitForTimeout(250);
          const file=`${out}/${name}-${id}-${state}.png`;await stage.screenshot({path:file});files.push(file);
        };
        for(const {lod,tris}of review.turntable.lods) {
          await page.getByRole('button',{name:`LOD${lod}`,exact:true}).click();
          await page.waitForFunction(n=>document.querySelector('.vstats')?.textContent.includes(`${n} tris`),tris);
          await capture(`lod${lod}`);
        }
        await page.getByRole('button',{name:'LOD0',exact:true}).click();
        for(const i of [1,2]){await page.locator('button.swatch').nth(i).click();await capture(`paint${i}`);}
        for(const [label,state]of [['All loose','loose'],['All detached','detached'],['Intact','intact']]) {
          await page.getByRole('button',{name:label,exact:true}).click();await capture(state);
        }
        const layout=await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
          brokenImages:[...document.images].filter(i=>!i.complete||!i.naturalWidth).map(i=>i.src)}));
        assert.ok(layout.scrollWidth<=layout.viewport+2,`${id} horizontal overflow`);
        assert.deepEqual(layout.brokenImages,[],`${id} broken images`);assert.deepEqual(problems,[],`${id} page errors`);
        results.push({id,browser:name,version:browser.version(),viewport,files,layout,problems});await page.close();
      }
    }finally{await browser.close();}
  }
}finally{
  await local?.close();await fs.writeFile(`${out}/checks.json`,JSON.stringify({base,results},null,2)+'\n');
}
console.log(`PASS ${results.length} vehicle/browser combinations; inspect all stage captures.`);
