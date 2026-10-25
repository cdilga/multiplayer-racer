// P1-OGVIDEO / P1-PROMO: scraper-visible metadata and a real native player under both deployment bases.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { build, serve } from './lib/site.mjs';

let dist;
before(()=>{dist=build('./','promo-journey');});
for(const base of ['/', '/p/trailer/']) {
  for(const engine of [chromium,webkit]) {
    test(`trailer ${base} ${engine.name()}: social metadata, captions, deferred download, playback and seeking`, {timeout:60_000}, async()=>{
    const server=await serve(dist,base,{JJ_PUBLIC_ORIGIN:'https://jammers.example',JJ_STUN_URLS:''});
    try {
      // Fetch raw HTML: social scrapers do not execute the landing page's JavaScript.
      const html=await (await fetch(server.origin+base)).text();
      for(const property of ['og:video','og:video:secure_url']) {
        const content=new RegExp(`<meta property="${property}" content="([^"]+)"`).exec(html)?.[1];
        assert.ok(content?.startsWith(`https://jammers.example${base}assets/`),content);
        const url=new URL(content);
        const media=await fetch(server.origin+url.pathname);
        assert.equal(media.status,200);
        assert.equal(media.headers.get('content-type'),'video/mp4');
        const bytes=new Uint8Array(await media.arrayBuffer());
        assert.equal(new TextDecoder().decode(bytes.slice(4,8)),'ftyp');
        const probe=await fetch(server.origin+url.pathname,{headers:{Range:'bytes=0-1'}});
        assert.equal(probe.status,206);
        assert.equal(probe.headers.get('content-range'),`bytes 0-1/${bytes.length}`);
        assert.equal((await probe.arrayBuffer()).byteLength,2);
      }
      assert.match(html,/property="og:image"/);
      assert.match(html,/property="og:video:width" content="1280"/);
      assert.match(html,/property="og:video:height" content="720"/);
        const browser=await engine.launch();
        try {
          const page=await browser.newPage({viewport:{width:375,height:667}});
          const mediaRequests=[];
          page.on('request',r=>r.url().endsWith('.mp4')&&mediaRequests.push(r.url()));
          await page.goto(server.origin+base);
          const player=page.locator('#promo-video');
          assert.deepEqual(await player.evaluate(v=>({paused:v.paused,controls:v.controls,inline:v.playsInline,preload:v.preload,autoplay:v.autoplay})),{paused:true,controls:true,inline:true,preload:'none',autoplay:false});
          assert.equal(mediaRequests.length,0,'no video download before the viewer presses play');
          const track=await page.locator('track').getAttribute('src');
          const captions=await fetch(new URL(track,server.origin+base));
          assert.equal(captions.headers.get('content-type'),'text/vtt; charset=utf-8');
          assert.match(await captions.text(),/^WEBVTT/);
          await player.scrollIntoViewIfNeeded();
          await player.evaluate(v=>v.play());
          await page.waitForFunction(()=>document.querySelector('video').currentTime>.3);
          await player.evaluate(v=>{v.textTracks[0].mode='showing';});
          await page.waitForFunction(()=>document.querySelector('video').textTracks[0].cues?.length===7);
          const duration=await player.evaluate(v=>v.duration);
          assert.ok(duration>30&&duration<90,`finished trailer duration: ${duration}`);
          await player.evaluate(v=>{v.currentTime=v.duration-2;});
          await page.waitForFunction(()=>{const v=document.querySelector('video');return !v.seeking&&v.currentTime>v.duration-3&&v.readyState>=2;});
          assert.equal(await player.evaluate(v=>v.error),null);
          assert.equal(await page.locator('#host-link').getAttribute('href'),base+'host');
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        } finally {await browser.close();}
    } finally {await server.close();}
    });
  }
}
