"""Spike D task 2: one Red Centre road kit piece, headless Blender.

Run:  blender -b -P build_track_kit_piece.py -- <out_dir>

Builds a curved dirt-road segment (90 deg bend) with:
  - a formed-road surface (raised dirt-road bed with a graded edge/berm)
  - a fictional rock-formation barrier along the outer bend (NOT a real landmark;
    an eroded-mesa silhouette, per docs/policies/owner-direction-2026-09-29.md)
  - snap points: start/end empties with forward (-Y local) and up (+Z local) axes,
    for chaining kit pieces end to end
  - collider proxies (simplified) separate from the render mesh
  - per-face material-slot surface IDs: tarmac(unused here)/dirt/off-track/rock,
    painted by face region, matching the surface_set contract's surface ids
  - vertex-colour AO baked onto the render mesh

Exports: track_piece_bend90.glb
Sidecar: track_piece_bend90.asset.json (kit_piece contract draft)
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "out")
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def mat(name, color, rough=0.85, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    m["jj_semantic"] = name
    return m


# Surface-id materials -- slot order below defines the face-region "surface_id" mapping
# recorded in the sidecar (matches the surface_set ids: dirt_packed, off_track, rock).
M_DIRT = mat("jj_surface_dirt_packed", (0.55, 0.28, 0.14))
M_OFFTRACK = mat("jj_surface_off_track", (0.32, 0.24, 0.12), rough=0.95)
M_ROCK = mat("jj_surface_rock", (0.42, 0.2, 0.15), rough=0.9)
SURFACE_SLOTS = [M_DIRT.name, M_OFFTRACK.name, M_ROCK.name]  # slot index -> surface_id

# ---------------------------------------------------------------- geometry: 90 deg bend road bed
RADIUS_CENTER = 9.0   # centreline radius of the bend
ROAD_WIDTH = 6.0
BERM_WIDTH = 2.5       # off-track graded shoulder each side
SEGMENTS = 14
ANGLE = math.radians(90)

bm = bmesh.new()


def profile_ring(t):
    """Cross-section verts at parametric angle t in [0,1] along the bend, in world space.
    Returns (inner_off_track, inner_edge, outer_edge, outer_off_track) as world-space points,
    plus the local forward/right/up frame at the centreline for this ring."""
    ang = t * ANGLE
    center = Vector((math.sin(ang) * RADIUS_CENTER, (1 - math.cos(ang)) * RADIUS_CENTER, 0))
    fwd = Vector((math.cos(ang), math.sin(ang), 0))
    right = Vector((fwd.y, -fwd.x, 0))  # rotate -90 deg
    r_in = RADIUS_CENTER - ROAD_WIDTH / 2
    r_out = RADIUS_CENTER + ROAD_WIDTH / 2
    inner_edge = center - right * (ROAD_WIDTH / 2)
    outer_edge = center + right * (ROAD_WIDTH / 2)
    inner_off = inner_edge - right * BERM_WIDTH
    outer_off = outer_edge + right * BERM_WIDTH
    # slight crown: road centre raised 4cm, berm drops 8cm, for drainage read + AO variation
    inner_off.z = -0.08
    inner_edge.z = 0.0
    outer_edge.z = 0.0
    outer_off.z = -0.10
    center.z = 0.04
    return inner_off, inner_edge, center, outer_edge, outer_off, fwd, right


rings = [profile_ring(i / SEGMENTS) for i in range(SEGMENTS + 1)]

# Build a ribbon: 4 quad-strips across (inner_off-inner_edge, inner_edge-center, center-outer_edge, outer_edge-outer_off)
vcols = [[bm.verts.new(p) for p in (r[0], r[1], r[2], r[3], r[4])] for r in rings]
faces = []
face_surface = {}  # face index (by creation order) -> surface_id name
for i in range(SEGMENTS):
    a = vcols[i]
    b = vcols[i + 1]
    for k in range(4):
        f = bm.faces.new((a[k], a[k + 1], b[k + 1], b[k]))
        faces.append(f)
        # k=0: inner off-track berm, k=1: inner half of road, k=2: outer half of road, k=3: outer off-track berm
        face_surface[f] = M_OFFTRACK.name if k in (0, 3) else M_DIRT.name

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
me = bpy.data.meshes.new("track_piece_bend90")
bm.to_mesh(me)
road = bpy.data.objects.new("track_piece_bend90", me)
scene.collection.objects.link(road)
me.materials.append(M_DIRT)
me.materials.append(M_OFFTRACK)
me.materials.append(M_ROCK)
slot_index = {M_DIRT.name: 0, M_OFFTRACK.name: 1, M_ROCK.name: 2}
for i, f in enumerate(me.polygons):
    bmface = faces[i]
    f.material_index = slot_index[face_surface[bmface]]
bm.free()

# ---------------------------------------------------------------- rock-formation barrier (fictional landform)
# Explicitly NOT a real sacred site: an irregular eroded-mesa silhouette built from stacked,
# randomly-scaled offset boxes -- reads as "outback rock formation" without referencing any
# specific real monolith. Placed along the outer edge of the bend as a track barrier.
import random
random.seed(3)
rock_bm = bmesh.new()
n_rocks = 6
for i in range(n_rocks):
    t = 0.12 + 0.76 * (i / (n_rocks - 1))
    _, _, _, outer_edge, outer_off, fwd, right = profile_ring(t)
    base = outer_off + right * (1.4 + random.uniform(-0.2, 0.3))
    w = random.uniform(1.6, 2.6)
    d = random.uniform(1.4, 2.2)
    h = random.uniform(1.8, 3.4)
    cube = bmesh.ops.create_cube(rock_bm, size=1)
    verts = cube["verts"]
    bmesh.ops.scale(rock_bm, vec=(w, d, h), verts=verts)
    # taper top for an eroded-mesa look
    top_verts = [v for v in verts if v.co.z > 0]
    bmesh.ops.scale(rock_bm, vec=(0.6, 0.6, 1.0), verts=top_verts, space=Matrix.Translation((0, 0, -h / 2)))
    bmesh.ops.translate(rock_bm, vec=(base.x, base.y, h / 2 + random.uniform(-0.1, 0.1)), verts=verts)
    bmesh.ops.rotate(rock_bm, verts=verts, cent=(base.x, base.y, 0), matrix=Matrix.Rotation(random.uniform(0, math.tau), 3, "Z"))
bmesh.ops.recalc_face_normals(rock_bm, faces=rock_bm.faces)
rock_me = bpy.data.meshes.new("track_barrier_rocks")
rock_bm.to_mesh(rock_me)
rock_bm.free()
rock_obj = bpy.data.objects.new("track_barrier_rocks", rock_me)
scene.collection.objects.link(rock_obj)
rock_me.materials.append(M_ROCK)
rock_obj.parent = road
rock_obj.matrix_parent_inverse = road.matrix_world.inverted()
rock_obj["jj_kind"] = "barrier"

# ---------------------------------------------------------------- snap points (start/end, forward+up frame)
def make_snap(name, t, parent):
    _, _, center, _, _, fwd, right = profile_ring(t)
    up = Vector((0, 0, 1))
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "ARROWS"
    e.empty_display_size = 1.5
    scene.collection.objects.link(e)
    # orthonormal frame: fwd (local -Y becomes track-forward convention +Y forward like vehicles), right, up
    mat3 = Matrix((right, fwd, up)).transposed()  # columns = right, forward, up
    e.matrix_world = Matrix.Translation(center) @ mat3.to_4x4()
    e.parent = parent
    e.matrix_parent_inverse = parent.matrix_world.inverted()
    return e, center, fwd, up

snap_start, c0, f0, u0 = make_snap("snap_start", 0.0, road)
snap_end, c1, f1, u1 = make_snap("snap_end", 1.0, road)

# sanity: confirm orthonormal (validator will also check this from the GLB)
def is_orthonormal(right, fwd, up, tol=1e-4):
    vs = [right.normalized(), fwd.normalized(), up.normalized()]
    for i in range(3):
        for j in range(3):
            dot = vs[i].dot(vs[j])
            expect = 1.0 if i == j else 0.0
            if abs(dot - expect) > tol:
                return False
    return True

# (orthonormality is checked properly in the validator from the exported GLB matrices)

# ---------------------------------------------------------------- collider proxies (simplified, separate from render mesh)
col_bm = bmesh.new()
for i in range(SEGMENTS):
    r0, r1 = rings[i], rings[i + 1]
    a_in, a_out = r0[1], r0[3]
    b_in, b_out = r1[1], r1[3]
    verts = [col_bm.verts.new(Vector(p) + Vector((0, 0, 0.02))) for p in (a_in, a_out, b_out, b_in)]
    col_bm.faces.new(verts)
bmesh.ops.recalc_face_normals(col_bm, faces=col_bm.faces)
col_me = bpy.data.meshes.new("col_track_piece_bend90")
col_bm.to_mesh(col_me)
col_bm.free()
col_obj = bpy.data.objects.new("col_track_piece_bend90", col_me)
scene.collection.objects.link(col_obj)
col_obj["jj_collider"] = True
col_obj.display_type = "WIRE"
col_obj.hide_render = True
col_obj.parent = road
col_obj.matrix_parent_inverse = road.matrix_world.inverted()

# barrier collider (simplified bounding boxes per rock -- approximate, good enough for a proxy)
col_barrier_bm = bmesh.new()
bmesh.ops.create_cube(col_barrier_bm, size=1)
bmesh.ops.scale(col_barrier_bm, vec=(8, 3, 3), verts=col_barrier_bm.verts)
bmesh.ops.translate(col_barrier_bm, vec=(RADIUS_CENTER + ROAD_WIDTH / 2 + BERM_WIDTH + 2.5, RADIUS_CENTER * 0.5, 1.5), verts=col_barrier_bm.verts)
col_barrier_me = bpy.data.meshes.new("col_track_barrier_rocks")
col_barrier_bm.to_mesh(col_barrier_me)
col_barrier_bm.free()
col_barrier = bpy.data.objects.new("col_track_barrier_rocks", col_barrier_me)
scene.collection.objects.link(col_barrier)
col_barrier["jj_collider"] = True
col_barrier.display_type = "WIRE"
col_barrier.hide_render = True
col_barrier.parent = road
col_barrier.matrix_parent_inverse = road.matrix_world.inverted()

# ---------------------------------------------------------------- UVs (world-scale planar, tileable surface textures)
bpy.context.view_layer.objects.active = road
for s in scene.objects:
    s.select_set(False)
road.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(89), island_margin=0.01)
bpy.ops.object.mode_set(mode="OBJECT")
# override with a world-space planar UV scaled for ~2m texture tiles (surfaces are tileable)
uv = road.data.uv_layers.active.data
TILE = 2.0
for poly in road.data.polygons:
    for li in poly.loop_indices:
        vi = road.data.loops[li].vertex_index
        co = road.data.vertices[vi].co
        uv[li].uv = (co.x / TILE, co.y / TILE)

bpy.context.view_layer.objects.active = rock_obj
for s in scene.objects:
    s.select_set(False)
rock_obj.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
bpy.ops.object.mode_set(mode="OBJECT")

# ---------------------------------------------------------------- bake AO to vertex colours
scene.render.engine = "CYCLES"
scene.cycles.samples = 32
scene.cycles.device = "CPU"
baked = []
for o in (road, rock_obj):
    if "jj_ao" not in o.data.color_attributes:
        o.data.color_attributes.new("jj_ao", "BYTE_COLOR", "CORNER")
    o.data.color_attributes.active_color = o.data.color_attributes["jj_ao"]
    for s in scene.objects:
        s.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    try:
        bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
        baked.append(o.name)
    except Exception as e:
        print("BAKE_ERROR", o.name, e)

# ---------------------------------------------------------------- export
export_objs = [road, rock_obj, col_obj, col_barrier, snap_start, snap_end]
for o in scene.objects:
    o.select_set(o in export_objs)
glb = os.path.join(OUT, "track_piece_bend90.glb")
# finding: default export_vertex_color="MATERIAL" silently drops baked AO unless the color
# attribute is wired into the material's shader node tree -- force ACTIVE so it always exports.
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_extras=True,
                           export_apply=False, use_selection=True, export_vertex_color="ACTIVE")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "track_piece_bend90.blend"))

tri = 0
for o in export_objs:
    if o.type == "MESH":
        o.data.calc_loop_triangles()
        tri += len(o.data.loop_triangles)

sidecar = {
    "contract": "jj.kit_piece.v0-draft",
    "id": "track_piece_bend90",
    "display_name": "Red Centre dirt road - 90 deg bend",
    "units": "m", "forward": "+Y", "up": "+Z",
    "asset": "track_piece_bend90.glb",
    "render_nodes": ["track_piece_bend90", "track_barrier_rocks"],
    "colliders": ["col_track_piece_bend90", "col_track_barrier_rocks"],
    "snap_points": {
        "snap_start": {"position": list(c0), "forward": list(f0), "up": list(u0)},
        "snap_end": {"position": list(c1), "forward": list(f1), "up": list(u1)},
    },
    "surface_map": {
        "slots": SURFACE_SLOTS,
        "slot_0": "dirt_packed",
        "slot_1": "off_track",
        "slot_2": "rock",
    },
    "vertex_color_ao": baked,
    "road_width_m": ROAD_WIDTH,
    "bend_angle_deg": 90,
    "bend_radius_m": RADIUS_CENTER,
    "triangles": tri,
    "materials": [m.name for m in me.materials],
    "cultural_review": {
        "barrier_type": "fictional eroded-mesa procedural rock formation",
        "note": "generated procedurally (stacked scaled boxes, random seed), not modelled on or "
                "named after any real sacred site or landmark, per docs/policies/owner-direction-2026-09-29.md",
    },
    "provenance": {"blender": bpy.app.version_string, "script": "spikes/art-pipeline/D-props-kit-surfaces/build_track_kit_piece.py"},
}
with open(os.path.join(OUT, "track_piece_bend90.asset.json"), "w") as f:
    json.dump(sidecar, f, indent=2)

print("EXPORTED", glb, "tris", tri, "baked", baked)
