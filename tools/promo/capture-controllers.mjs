// Current controller UI via its R90 state opener, plus committed real C08/C12 journey evidence.
// The stills illustrate controls; they are not new hardware or connection measurements.
import {chromium} from 'playwright';
import {build,serve} from '../../web/landing/tests/lib/site.mjs';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const out=process.env.JJ_PROMO_CAPTURE??'/tmp/jj-promo-crowd3';mkdirSync(out,{recursive:true});
const server=await serve(build('./','promo-controllers'),'/p/promo/',{JJ_STUN_URLS:''});
const browser=await chromium.launch();
try{
 const phone=await browser.newPage({viewport:{width:844,height:390},hasTouch:true,isMobile:true});
 await phone.goto(server.origin+'/p/promo/j/TEST#state=playing&round=racing&seat=1&name=Davo&boost=75');
 await phone.waitForFunction(()=>document.documentElement.dataset.jjController==='ready');
 await phone.screenshot({path:out+'/controller-phone.jpg',type:'jpeg',quality:95});
 const sources=[['controller-pad-phone.jpg','docs/evidence/P1-C08/captures/c08-phone-with-pad-phone-landscape-844x390.png'],['controller-keyboard.jpg','docs/evidence/P1-C12/frames/keyboard-actions-1366x768.jpg']];
 // Convert the old PNG to a consistently encoded JPEG; retain original hashes/provenance.
 const {execFileSync}=await import('node:child_process');
 for(const [name,source]of sources)execFileSync('ffmpeg',['-y','-v','error','-i',source,'-frames:v','1','-update','1','-q:v','2',out+'/'+name]);
 writeFileSync(out+'/controllers.json',JSON.stringify({phone:{source:'Current controller R90 state opener, no network connection',url:phone.url(),state:await phone.evaluate(()=>window.__jjController.inspect())},inserts:sources.map(([file,source])=>({file,source,sha256:createHash('sha256').update(readFileSync(source)).digest('hex')})),limitations:'Fresh Mac Chromium/Chrome WebRTC joins returned ICE no-route with STUN disabled, including mDNS-disabled runs. Controller inserts reuse committed real journey captures; no new device qualification is claimed.'},null,2));
}finally{await browser.close();await server.close();}
