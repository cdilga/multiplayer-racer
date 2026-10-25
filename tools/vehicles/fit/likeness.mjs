// Local reference checks supplement whole-car IoU. Coordinates are centred x / car height and y / car height,
// so an overall good silhouette cannot hide a wrong shoulder, tucked base, square nose or misplaced lamp.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { fillHoles } from './mask.js';

export function decodeDiff(png) {
  const { width: w, height: h, data } = png, reference = new Uint8Array(w*h), model = new Uint8Array(w*h);
  for (let i=0;i<w*h;i++) {
    const [r,g,b] = data.subarray(i*4,i*4+3), both=r>180&&g>180&&b>180;
    reference[i] = both || (r>180&&g<100) ? 1 : 0;
    model[i] = both || (g>150&&r<100) ? 1 : 0;
  }
  return { w,h,reference,model };
}

export function rowWidth(mask,w,h,t) {
  const y=Math.round(t*(h-1)); let lo=w,hi=-1;
  for(let x=0;x<w;x++)if(mask[y*w+x]){lo=Math.min(lo,x);hi=Math.max(hi,x);}
  if(hi<lo)throw new Error(`Missing silhouette at y=${t}; this band may be below the fit tool's ignored ground band`);
  return (hi-lo+1)/h;
}

export function contourChecks(diff, specs, lod = 0) {
  return specs.map(spec=>{
    const reference=spec.rows.map(t=>rowWidth(diff.reference,diff.w,diff.h,t));
    const model=spec.rows.map(t=>rowWidth(diff.model,diff.w,diff.h,t));
    // Width deltas remove overall scale and isolate the flare/roll's height and angle.
    const measured=spec.kind==='delta' ? Math.abs((model.at(-1)-model[0])-(reference.at(-1)-reference[0]))
      : Math.max(...reference.map((v,i)=>Math.abs(v-model[i])));
    const limit=Array.isArray(spec.tolerance)?spec.tolerance[lod]:spec.tolerance;
    return { name:spec.name,kind:spec.kind??'width',rows:spec.rows,reference,model,error:measured,limit,pass:measured<=limit };
  });
}

export function cameraChecks(actual, expected) {
  const out=[];
  function walk(a,e,key='camera') {
    if(e&&typeof e==='object')for(const [k,v]of Object.entries(e))walk(a?.[k],v,`${key}.${k}`);
    else out.push({name:key,reference:e,model:a,pass:typeof e==='number'? Number.isFinite(a)&&Math.abs(a-e)<1e-8 : a===e});
  }
  walk(actual,expected);return out;
}

export function inside(p,poly) {
  let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }return hit;
}

export function polygonMask(polys,w=768,h=512) {
  const out=new Uint8Array(w*h),scale=h;
  for(const poly of polys) {
    if(poly.length<3)continue;
    const loX=Math.max(0,Math.floor(Math.min(...poly.map(p=>p[0]))*scale+w/2));
    const hiX=Math.min(w-1,Math.ceil(Math.max(...poly.map(p=>p[0]))*scale+w/2));
    const loY=Math.max(0,Math.floor(Math.min(...poly.map(p=>p[1]))*scale));
    const hiY=Math.min(h-1,Math.ceil(Math.max(...poly.map(p=>p[1]))*scale));
    for(let y=loY;y<=hiY;y++)for(let x=loX;x<=hiX;x++)if(inside([(x+.5-w/2)/scale,(y+.5)/scale],poly))out[y*w+x]=1;
  }return out;
}

export function featureCheck(spec, modelPolys, lod=0) {
  const reference=spec.polygons.map(poly=>poly.map(([x,y])=>[(x-spec.size[0]/2)/spec.size[1],y/spec.size[1]]));
  const a=polygonMask(reference),raw=polygonMask(modelPolys),b=spec.envelope?fillHoles(raw,768,512):raw;let intersection=0,union=0;
  for(let i=0;i<a.length;i++){if(a[i]&&b[i])intersection++;if(a[i]||b[i])union++;}
  const iou=union?intersection/union:0,limit=Array.isArray(spec.minIou)?spec.minIou[lod]:spec.minIou;
  return {name:spec.name,kind:'feature-iou',iou,limit,pass:iou>=limit,envelope:!!spec.envelope,reference,model:modelPolys};
}

// Project the actual source triangles, preserving the shared fit camera's perspective. Swatch UVs identify the cue;
// no shader colour threshold, lighting or screenshot background can make a missing lamp pass.
export function projectFeatures(parts, specs, sheets, includeSilhouettes = false) {
  const box=new THREE.Box3(),point=new THREE.Vector3();
  for(const [id,part]of Object.entries(parts))if(!id.startsWith('interior_'))for(let i=0;i<part.positions.length;i+=3) {
    point.fromArray(part.positions,i).add(new THREE.Vector3(...part.pivot));box.expandByPoint(point);
  }
  const centre=box.getCenter(new THREE.Vector3()),out={};
  for(const view of new Set(specs.map(s=>s.view))) {
    const tilt=sheets.tilt?.[view]??0,distance=typeof sheets.camD==='object'?sheets.camD[view]:sheets.camD??10;
    const direction=view==='top'?new THREE.Vector3(0,1,0):view==='side'?new THREE.Vector3(1,0,0):new THREE.Vector3(0,Math.sin(tilt),Math.cos(tilt)*(view==='rear'?-1:1));
    const camera=new THREE.PerspectiveCamera(24,1,.1,1000);if(view==='top')camera.up.set(0,0,-1);camera.position.copy(centre).addScaledVector(direction,distance);camera.lookAt(centre);camera.updateMatrixWorld();
    let y0=Infinity,y1=-Infinity,x0=Infinity,x1=-Infinity;
    const projected={};
    for(const [id,part]of Object.entries(parts))if(!id.startsWith('interior_')) {
      const points=[];
      for(let i=0;i<part.positions.length;i+=3){point.fromArray(part.positions,i).add(new THREE.Vector3(...part.pivot)).project(camera);points.push([point.x,point.y]);y0=Math.min(y0,point.y);y1=Math.max(y1,point.y);x0=Math.min(x0,point.x);x1=Math.max(x1,point.x);}
      projected[id]=points;
    }
    const norm=p=>[(p[0]-(x0+x1)/2)/(y1-y0),(y1-p[1])/(y1-y0)];
    if(includeSilhouettes) {
      out[view]=Object.values(projected).flatMap(points=>Array.from({length:points.length/3},(_,i)=>points.slice(i*3,i*3+3).map(norm)));
      continue;
    }
    for(const spec of specs.filter(s=>s.view===view)) {
      const part=parts[spec.part],polys=[];
      for(let i=0;i<part.positions.length/3;i+=3) {
        if(!spec.uvs.some(uv=>[0,1,2].every(k=>Math.abs(part.uvs[(i+k)*2]-uv[0])<1e-6&&Math.abs(part.uvs[(i+k)*2+1]-uv[1])<1e-6)))continue;
        const xyz=[0,1,2].map(k=>new THREE.Vector3().fromArray(part.positions,(i+k)*3).add(new THREE.Vector3(...part.pivot)));
        if(spec.endDepth!=null&&xyz.some(p=>p.z>box.min.z+spec.endDepth))continue;
        if(spec.endFacing){const normal=xyz[1].clone().sub(xyz[0]).cross(xyz[2].clone().sub(xyz[0])).normalize();if(normal.dot(direction)<.3)continue;}
        polys.push([0,1,2].map(k=>norm(projected[spec.part][i+k])));
      }
      out[spec.name]=polys;
    }
  }return out;
}

/** Fast deterministic geometry gate for normal CI: project current triangles through the frozen reference camera.
 * The browser diff remains the visual acceptance source; this path makes future source edits fail without screenshots. */
export function sourceContourChecks(parts, fixture, sheets, maskDirectory, lod = 0) {
  const projected=projectFeatures(parts,Object.keys(fixture.contours).map(view=>({view})),sheets,true),out=[];
  for(const [view,specs]of Object.entries(fixture.contours)) {
    const png=PNG.sync.read(fs.readFileSync(path.join(maskDirectory,`${lod===2?'lowest':'lod1'}_${view}.mask.png`))),h=png.height;
    const half=Math.max(png.width/h/2,...projected[view].flat().map(p=>Math.abs(p[0]))),w=Math.ceil(2*half*h)+4;
    const model=polygonMask(projected[view],w,h),reference=new Uint8Array(w*h),offset=Math.floor((w-png.width)/2);
    for(let y=0;y<h;y++)for(let x=0;x<png.width;x++)reference[y*w+x+offset]=png.data[(y*png.width+x)*4]>127?1:0;
    out.push(...contourChecks({w,h,reference,model},specs,lod));
  }return out;
}

export function overlaySvg(checks) {
  const features=checks.filter(c=>c.kind==='feature-iou');
  const contours=checks.filter(c=>c.kind==='width'||c.kind==='delta'),panels=[];
  for(const c of features) {
    const a=polygonMask(c.reference),raw=polygonMask(c.model),b=c.envelope?fillHoles(raw,768,512):raw;
    const png=new PNG({width:768,height:512});
    for(let i=0;i<a.length;i++)png.data.set(a[i]&&b[i]?[110,110,120,255]:a[i]?[220,45,45,255]:b[i]?[35,165,65,255]:[244,244,246,255],i*4);
    panels.push(`<text x="10" y="20" font-size="14">${c.name}: IoU ${c.iou.toFixed(3)} (${c.pass?'PASS':'FAIL'})</text><image x="0" y="30" width="600" height="400" href="data:image/png;base64,${PNG.sync.write(png).toString('base64')}"/>`);
  }
  for(const c of contours) {
    const line=(values,col,offset)=>values.map((width,i)=>`<line x1="${300-width*180}" x2="${300+width*180}" y1="${65+i*70+offset}" y2="${65+i*70+offset}" stroke="${col}" stroke-width="3"/><text x="10" y="${65+i*70}" font-size="12">y=${c.rows[i]}</text>`).join('');
    panels.push(`<text x="10" y="20" font-size="14">${c.name} (${c.pass?'PASS':'FAIL'})</text><text x="10" y="40" font-size="12">error ${c.error.toFixed(4)} / limit ${c.limit}</text>${line(c.reference,'#df3030',0)}${line(c.model,'#209540',8)}`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1220" height="${Math.max(1,Math.ceil(panels.length/2))*440}">${panels.map((p,i)=>`<g transform="translate(${(i%2)*610},${Math.floor(i/2)*440})"><rect width="600" height="430" fill="#f4f4f6"/>${p}</g>`).join('')}</svg>`;
}

// Source overrides retain the vehicle's dependency base rather than the override file's location.
// Bikes import ../_kit/bike.js; data-URL modules cannot resolve those relative imports themselves.
export async function loadCandidate(car, {modelFile, paramsFile} = {}) {
  const dir=path.resolve('art/vehicles',car), sourceText=fs.readFileSync(modelFile??`${dir}/model.js`,'utf8'),paramsText=fs.readFileSync(paramsFile??`${dir}/params.json`,'utf8');
  const source=sourceText.replace(/(\bfrom\s*['"])([^'"]+)(['"])/g,(match,start,spec,end)=> {
    const target=spec==='three'?pathToFileURL(path.resolve('node_modules/three/build/three.module.js')).href
      :spec.startsWith('.')?new URL(spec,pathToFileURL(`${dir}/model.js`)).href:null;
    return target?`${start}${target}${end}`:match;
  });
  const model=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  return {model,P:JSON.parse(paramsText),sourceText,paramsText};
}

export async function checkCapture({car,capture,modelFile,paramsFile}) {
  const dir=path.resolve('art/vehicles',car),fixture=JSON.parse(fs.readFileSync(`${dir}/refs/likeness.json`)),score=JSON.parse(fs.readFileSync(path.join(capture,'score.json')));
  const checks=cameraChecks(score.cameras,fixture.cameras);
  const referenceHash=crypto.createHash('sha256').update(fs.readFileSync(fixture.reference)).digest('hex');
  checks.push({name:'canonical reference hash',pass:referenceHash===fixture.referenceSha256,reference:fixture.referenceSha256,model:referenceHash});
  for(const [view,specs]of Object.entries(fixture.contours)) {
    const diff=decodeDiff(PNG.sync.read(fs.readFileSync(path.join(capture,`diff_${view}.png`))));
    checks.push(...contourChecks(diff,specs,score.lod));
  }
  // A source override is for reproducing an earlier candidate without mutating the shared working tree.
  const {model,P,sourceText,paramsText}=await loadCandidate(car,{modelFile,paramsFile});
  const {parts}=model.soups(P,score.lod),sheets=JSON.parse(fs.readFileSync(`${dir}/refs/sheets.json`));
  const projected=projectFeatures(parts,fixture.features,sheets);
  checks.push(...fixture.features.map(f=>featureCheck(f,projected[f.name],score.lod)));
  return {car,lod:score.lod,sheet:score.sheet,reference:fixture.reference,sourceSha256:crypto.createHash('sha256').update(sourceText).digest('hex'),paramsSha256:crypto.createHash('sha256').update(paramsText).digest('hex'),notes:fixture.notes,pass:checks.every(c=>c.pass),checks};
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)) {
  const args=process.argv.slice(2),get=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d,car=args[0],capture=get('--capture');
  if(!car||!capture){console.error('Usage: node tools/vehicles/fit/likeness.mjs <car> --capture <fit-output-dir> [--out <dir>] [--model <model.js> --params <params.json>]');process.exit(2);}
  const result=await checkCapture({car,capture,modelFile:get('--model'),paramsFile:get('--params')}),out=get('--out',capture);
  fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'likeness.json'),JSON.stringify(result,null,2)+'\n');fs.writeFileSync(path.join(out,'likeness.svg'),overlaySvg(result.checks));
  for(const c of result.checks)console.log(`${c.pass?'PASS':'FAIL'} ${c.name}${c.error!=null?` error=${c.error.toFixed(4)} limit=${c.limit}`:c.iou!=null?` IoU=${c.iou.toFixed(3)} minimum=${c.limit}`:''}`);
  process.exitCode=result.pass?0:1;
}
