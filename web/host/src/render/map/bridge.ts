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
  return {vertices,triangles,beams,surfaces};
}
