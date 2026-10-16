// R124: exact counterpart of jj-map::bridge. The uploaded f32 triangles are compared with native collision geometry.
import type { Params } from '../kit/types';
import type { MapJson } from './map';

export function bridgeIndices(map: MapJson, p: Params): number[] {
  const [a,b,n] = [p.upperFrom!,p.upperTo!,map.route.points.length];
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= n || b >= n || a === b || (!map.route.closed && a > b)) return [];
  return Array.from({length:(b+n-a)%n+1},(_,i)=>(a+i)%n);
}

function edges(map: MapJson, i: number): number[][] {
  const r = map.route, n = r.points.length;
  const a = r.points[r.closed ? (i+n-1)%n : Math.max(0,i-1)]!;
  const b = r.points[r.closed ? (i+1)%n : Math.min(n-1,i+1)]!;
  const [dx,dz] = [b.x-a.x,b.z-a.z], len = Math.max(1,Math.hypot(dx,dz));
  const q = r.points[i]!, half = q.width/2000, bank = Math.tan((q.bank ?? 0)*Math.PI/18000);
  return [1,-1].map(side=>[q.x/1000+side*dz/len*half,q.y/1000-side*bank*half,q.z/1000-side*dx/len*half]);
}

// Piers: counterpart of jj-map::bridge::piers (same constants, same order, same arithmetic).
const PIER_EVERY = 8, PIER_END = 4, PIER_HALF_M = 0.4, PIER_INSET_M = 1.2, PIER_MIN_M = 1.0, PIER_CLEAR_M = 2.5, PIER_SINK_M = 0.3;

/** jj-map::jump::ground_height_m: bilinear on the heightfield, clamped to the grid. */
function groundHeightM(map: MapJson, x: number, z: number): number {
  const t = map.terrain, sp = t.spacing/1000;
  const c = Math.min(Math.max((x - t.originX/1000)/sp, 0), t.cols-1);
  const r = Math.min(Math.max((z - t.originZ/1000)/sp, 0), t.rows-1);
  const [c0,r0] = [Math.floor(c),Math.floor(r)];
  const [c1,r1] = [Math.min(c0+1,t.cols-1),Math.min(r0+1,t.rows-1)];
  const [fc,fr] = [c-c0,r-r0];
  const g = (cc:number,rr:number) => t.heights[rr*t.cols+cc]!/100;
  const top = g(c0,r0)+(g(c1,r0)-g(c0,r0))*fc;
  const bot = g(c0,r1)+(g(c1,r1)-g(c0,r1))*fc;
  return top+(bot-top)*fr;
}

/** Each pier as (centre x, z, foot y, head y), m: a column under each deck edge where the deck stands clear of the ground,
 *  never within reach of the lower road. */
export function bridgePiers(map: MapJson, p: Params, ix: number[]): number[][] {
  const lower = bridgeIndices(map,{...p,upperFrom:p.lowerFrom!,upperTo:p.lowerTo!});
  const depth = (p.thicknessMm ?? 0)/1000;
  if (!lower.length) return [];
  const out: number[][] = [];
  for (const [k,i] of ix.entries()) {
    if (k < PIER_END || k + PIER_END >= ix.length || (k - PIER_END) % PIER_EVERY !== 0) continue;
    const [left,right] = edges(map,i) as [number[],number[]];
    for (const [edge,other] of [[left,right],[right,left]] as const) {
      const width = Math.max(Math.hypot(other[0]!-edge[0]!,other[2]!-edge[2]!),1e-9);
      const [x,z] = [edge[0]!+(other[0]!-edge[0]!)/width*PIER_INSET_M, edge[2]!+(other[2]!-edge[2]!)/width*PIER_INSET_M];
      const head = edge[1]!-depth;
      const ground = groundHeightM(map,x,z);
      if (head - ground < PIER_MIN_M) continue;
      const open = lower.every(j => {
        const q = map.route.points[j]!;
        return Math.hypot(q.x/1000-x,q.z/1000-z) > q.width/2000+PIER_CLEAR_M;
      });
      if (open) out.push([x,z,ground-PIER_SINK_M,head]);
    }
  }
  return out;
}

export function bridgeMesh(map: MapJson, p: Params): {vertices:number[][];triangles:number[][];beams:number[];surfaces:string[]} | null {
  const ix = bridgeIndices(map,p), depth = (p.thicknessMm ?? 0)/1000;
  const h = (p.barrierHeightMm ?? 0)/1000, w = (p.barrierWidthMm ?? 0)/1000;
  if (!ix.length || depth <= 0 || h <= 0 || w <= 0) return null;
  const vertices:number[][] = [], triangles:number[][] = [], beams:number[] = [], surfaces:string[] = [];
  for (let beam=0;beam<3;beam++) {
    const start = vertices.length;
    for (const i of ix) {
      const [left,right] = edges(map,i) as [number[],number[]];
      let [l,r,d] = [left,right,depth] as [number[],number[],number];
      if (beam) {
        const [edge,sign] = beam === 1 ? [left,1] as const : [right,-1] as const;
        const width = map.route.points[i]!.width/1000;
        const offset = [sign*(left[0]!-right[0]!)/width*w,sign*(left[2]!-right[2]!)/width*w];
        const outer = [edge[0]!+offset[0]!,edge[1]!,edge[2]!+offset[1]!];
        [l,r] = beam === 1 ? [outer,edge] : [edge,outer];
        [l,r,d] = [[l[0]!,l[1]!+h,l[2]!],[r[0]!,r[1]!+h,r[2]!],h];
      }
      vertices.push(l,r,[l[0]!,l[1]!-d,l[2]!],[r[0]!,r[1]!-d,r[2]!]);
    }
    const quad = (a:number,b:number,c:number,d:number,surface:string) => {
      triangles.push([a,b,c],[a,c,d]);beams.push(beam,beam);surfaces.push(surface,surface);
    };
    for (let k=0;k<ix.length-1;k++) {
      const a = start+k*4, surface = map.route.points[ix[k]!]!.surface;
      quad(a+1,a+5,a+4,a,surface);
      quad(a+2,a+6,a+7,a+3,surface);
      quad(a,a+4,a+6,a+2,surface);
      quad(a+1,a+3,a+7,a+5,surface);
    }
    const end = start+(ix.length-1)*4;
    quad(start,start+2,start+3,start+1,map.route.points[ix[0]!]!.surface);
    quad(end,end+1,end+3,end+2,map.route.points[ix.at(-1)!]!.surface);
  }
  // Beam 3: the piers, closed boxes (the same faces and order as the native mesh).
  for (const [x,z,foot,head] of bridgePiers(map,p,ix)) {
    const a = vertices.length;
    for (const y of [foot!,head!]) vertices.push([x!-PIER_HALF_M,y,z!-PIER_HALF_M],[x!+PIER_HALF_M,y,z!-PIER_HALF_M],[x!+PIER_HALF_M,y,z!+PIER_HALF_M],[x!-PIER_HALF_M,y,z!+PIER_HALF_M]);
    const quad = (q:number,r:number,t:number,e:number) => {triangles.push([a+q,a+r,a+t],[a+q,a+t,a+e]);beams.push(3,3);surfaces.push('rock','rock');};
    quad(0,1,2,3); quad(4,7,6,5); quad(0,4,5,1); quad(1,5,6,2); quad(2,6,7,3); quad(3,7,4,0);
  }
  return {vertices,triangles,beams,surfaces};
}
