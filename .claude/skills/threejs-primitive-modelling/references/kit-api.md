# Kit API cheat sheet (`spikes/art-pipeline/H-primitive-kit/kit/`)

All files are ES modules importing `three` and `three/addons/...` from `node_modules` (no CDN).

## kit.js
| Export | Purpose |
|---|---|
| `geo(key, make)` | cache a geometry by string key; guarantees a white `color` attribute so everything merges |
| `material(kind)` | shared vertex-coloured material: `matte satin paint accent gloss rubber metal chrome glass emit` (rim light installed) |
| `tintedMaterial(kind, hex)` | per-instance clone (identity colour); vertex colours stay as relative shading |
| `texturedMaterial(name, kind, makeTexture, extra)` / `canvasTexture(w,h,draw,{repeat})` | canvas-drawn decals; pass `{transparent:true, alphaTest:.5}` for cut-outs |
| `installRim(mat, strength, colour)` | fresnel rim via `onBeforeCompile` (before `opaque_fragment`) |
| `P.sphere/cyl/cone/capsule/torus/ico/box/flat` | cached unit primitives; `P.box` clamps radius; `P.flat` is a plain 12-tri box |
| `lathe(points, seg, smooth, key)` | spline (or raw) profile `(radius, y)` → `LatheGeometry` |
| `extrude(key, shape, depth, bevel)`, `roundedRect`, `roundedPoly` | bevelled extrusions, centred |
| `tube(key, pts, r, segs, radial, caps, closed)` | Catmull-Rom tube with cheap end caps |
| `surfaceGrid(nu, nv, fn, {solid, inside, reverse, normal})` | parametric surface. `fn(u,v,out)`; normals by finite difference unless `normal(u,v,pos,out)` is given; `inside(u,v,out)` = an interior reference point so winding/normals point outward; `solid` adds liner + 4 skirts and a `region` attribute (0 outer, 1 liner, 2 skirt) |
| `aoBottom(geo,min,span)`, `shade`, `sstep`, `hash`, `rng` | vertex-AO and small maths helpers |
| `KitBuilder` | `push/pop(transform)`, `add(geo, kind|material, {p,r,s,q,ro,c,g,space:'world'|'local',order})`, `box(...)`, `build(name,{pivot,materials,dentable})` → `Group` (one mesh per material). `pivot` re-centres so the group origin is the hinge/hub. `dentable` = kinds whose meshes accept dents |
| `countTris(root)` | triangles + draws that would actually render (respects hidden parents) |

Paint function signature: `g(x,y,z,nx,ny,nz,colour,u,v,region)`; with `space:'world'` coordinates are already in the
builder's space (use it for whole-car dirt/AO/under-panel painting).

## loft.js
* `new Loft({stations:[{z,w,yb,yt,pT,pB,tumble}], caps:{min,max}, capPow, bulges:[{z,sigma,dw,dyt}]})` — PCHIP-interpolated
  superellipse sections. `.point(u,v,out)`, `.F(x,y,z)` implicit (<0 inside), `.normalAt`, `.probe(ox,oy,oz,dx,dy,dz)`,
  `.side(z,y,±1)`, `.top(x,z)`, `.front(x,y)`, `.rear(x,y)` (ray hits `{p,n}`), `.patch({u0,u1,v0,v1,nu,nv,off,solid})`,
  `.probed(nu,nv,map,{off|fn,solid})` (patch from a probe map). u: 0 bottom-centre → .25 right → .5 top → .75 left.
* `new LoftUnion(base, top, k)` — smooth-min union. Same probe API plus `.radial({nu,nv,inset,flank})`: a seamless mesh
  by marching rays from an axis (origin must be inside *both* lofts wherever the top exists). Use it for the chassis and
  cut every panel/decal from the union.
* `quad(corners, a, b)` — bilinear map of the unit square to 4 `(s,t)` corners.

## damage.js (`DamageSim`)
`await DamageSim.create(scene, RAPIER)` · `addCar(car,{position,yaw})` (uses `car.userData.proxy` boxes) ·
`hit(car,{partId,point,dir,severity,radius})` → `{state,events}` · `pick(car, raycaster)` · `loosen/detach/breakLamp/knock` ·
`step(dt)` (fixed 1/120) · `reset(car)`. Parts read metadata from `group.userData.jj = {id, kind:'door|lid|wheel|bumper|lamp|glass|accessory|junk|core', hp, mass, hinge:{point,axis,sign,max}, releasedBy}`.
`dentGeometry(geo, centreLocal, dirLocal, {radius,depth,crease,scuff,seed})` and `restoreGeometry(geo)` work standalone.

## intact.js · instance.js · ink.js · stage.js
`bakeIntact(car,{keepSeparate})`, `wake(car)`, `showIntact(car)` · `instantiate(template,{paint,accent})`, `ownGeometry(mesh)` (copy-on-write before any vertex edit) ·
`setInk(root,on,{width,color})` · `createStage({canvas,width,height})` → `{scene,camera,look(),renderViews(),render()}` (warm studio, PMREM env, soft shadows).

## Model module contract (cruze.js / bin.js)
`export async function build({lod, paint, accent}) → Group` with `userData.parts[id]`, each part `Group` at its hinge/hub
with `userData.jj`; chassis part has `jj.kind='core'`; optional `userData.proxy=[{half,offset}]` collider boxes;
markers (`lplate_front`, `cam_fp`, `com`, `roof_number`, …) as empty `Object3D`s.


## Added in round 3
* `loft.js`: `LoftUnion(base, top, k)` — smooth-min blend; `radial({nu,nv,inset,flank})` seamless whole-body mesh marched from an axis (rays bunched at the flanks);
  `line(p,q)`, `polyline(pts)`, `coons(bottom, top, left, right)` (boundary-curve patch: (a,b) → [s,t]), `softCorners(a,b,r)`.
* `kit.js`: `solidify(g, thick, div=2)` — half-resolution closed liner, no skirts; `surfaceGrid(..., {normal})` accepts analytic normals; `KitBuilder.add(..., {uvRect})` maps a patch into a
  sub-rect of a shared trim atlas; `tintedMaterial(kind, hex, {metalness, roughness})`; extra kinds `alloy`, `headlight`, `brakelight`, `indicator`.
* `contract.js`: `toContractScene(car, {lod, massKg})` → `{scene, meta}` (glTF space, mesh-on-part-node, `_trim` children, steer→spin wheels, `jj_*` extras, semantic materials, colliders, anchors).
* `rig.js`: `createVehicleRig(scene, sidecar)` (paint, lights, steer, spin, suspension, `openPanel`, `dent`, `detach`, `reset`, `wake`), `bakeIntactTemplate(scene)`, `pickLod`, `projectedHeightPx`.
* `tools/`: `glb.mjs` (reader/writer/scene graph), `bake.mjs`, `validate_asset.mjs`, `selftest.mjs`, `check_asset.mjs`, `budgets.json`, `physics/{physics_common,load_vehicle,gates}.mjs`,
  `render_gates.mjs` + `render_gates_page.js`.
* `recog/`: `measure_side.py`, `grid_overlay.py`, `spec.js` (example spec for the Cruze).
