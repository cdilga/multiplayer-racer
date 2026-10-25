import http from 'node:http';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root='docs/evidence/P1-V-roster-visual';
const server=http.createServer((req,res)=>{
 const name=req.url.slice(1);
 const style=name==='scroll'?'body{height:1800px}p{margin-top:850px;line-height:100px}'
  :name==='fixed'?'body{overflow:hidden}p{margin-top:850px;line-height:100px}'
  :name==='floating'?'body{height:1800px}div{position:fixed;top:850px}p{margin:0;line-height:100px}'
  :'p{width:1800px}';
 res.end(`<html><style>body{margin:0}${style}</style><div><p>Verifier regression fixture: ${name}</p></div></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let log='';
try{
 const child=spawn('node',['art/ui/lib/live-check.mjs','--base',`http://127.0.0.1:${server.address().port}`,'--out',`${root}/verifier-fixtures`,'/scroll','/fixed','/floating','/horizontal']);
 child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 const code=await new Promise(resolve=>child.on('close',resolve));
 assert.equal(code,1);assert.match(log,/ok\s+\/scroll/);assert.match(log,/FAIL \/fixed/);assert.match(log,/FAIL \/floating/);assert.match(log,/FAIL \/horizontal/);
 fs.writeFileSync(`${root}/scroll-verifier.txt`,log+'\nPASS: scroll passes; fixed vertical clipping and horizontal overflow still fail.\n');
 console.log('PASS scrolling verifier regression fixtures');
}finally{server.close();}
