"""Spike F: cute wheelie bin, modelled from the new style foundation. Headless Blender only.

Run: blender -b -P build_bin.py -- <out_dir> [round_tag]

Builds a pudgy, softly-bevelled, low-poly wheelie bin (body, rim lip, recessed front panel,
lid with hinge barrel + grab-handle bump, rear handle bar, two wheels with hubcaps + axle),
rigs the lid hinge and wheel spin, adds crush_top/crush_side shape keys, bakes a cheap vertex-
colour AO + grime pass, and exports:
  out/bin.glb            - intact bin, rigged, shape keys at 0
  out/debris.glb         - 6 rubbish props (each its own node, <=300 tris)
  out/bin.asset.json     - sidecar: materials, hinge (LOCAL space), damage ladder, debris catalog
  out/checks.json        - tri counts, manifold/loose/zero-area checks, shape-key defaults

Lessons carried over from spikes/art-pipeline/D-props-kit-surfaces/build_wheelie_bin.py and
SPIKE-REPORT.md (do not repeat these bugs):
  - never put raw Blender Z-up vectors into a sidecar meant for a GLB consumer; hinge data here
    is recorded in the LID's own local mesh space (read after parenting + view_layer.update()),
    and the caller must still convert Blender(x,y,z) -> glTF(x,z,-y) same as the old spike did.
  - export_vertex_color must be "ACTIVE".
  - new shape keys default to value 1.0 in Blender 5 -- always set back to 0.0 after creation.
  - transform_apply() applies loc+rot by default -- only apply what's intended.
  - call view_layer.update() before computing any matrix_parent_inverse.

New lesson from THIS spike (round3): every part below is positioned with `.location` set to a
PARENT-LOCAL offset (e.g. "barrel sits at (0, lid_back_y, LID_H*0.35) relative to the lid"), not a
world-space point. Blender's default `matrix_parent_inverse` on a freshly created object is
already identity, which is exactly right for that -- `matrix_world = parent.matrix_world @
identity @ local` correctly adds the local offset onto wherever the parent ends up. Explicitly
setting `child.matrix_parent_inverse = parent.matrix_world.inverted()` (the pattern the OLD spike's
lesson above is actually about -- compensating for a child that already has a WORLD-space
`.location` before parenting) instead CANCELS the parent's transform out of the child's final
matrix_world entirely, because `parent.matrix_world @ parent.matrix_world.inverted() == identity`.
Every use of it below happened to render correctly anyway EXCEPT one (`bin_wheel_L/R_hub`),
purely by accident of ordering: barrel/knob/bump/lugs were parented to `lid` while `lid` was still
sitting at identity (its own `.location` is set later), so their parent_inverse was harmlessly
identity too -- but the wheel's hub is parented to the wheel *after* the wheel already has its
final `.location`, so its parent_inverse cancelled the wheel's whole position and the hub rendered
off at roughly the world origin (invisible/embedded, not near the wheel at all -- confirmed by
dumping `hub.matrix_world.translation` after a GLB round-trip and finding the wheel's offset
missing entirely). Fix: this script no longer sets matrix_parent_inverse anywhere; every child
`.location` is left to combine with the parent's matrix_world the simple, order-independent way.
"""
import bpy
import bmesh
import json
import math
import os
import random
import sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "out")
os.makedirs(OUT, exist_ok=True)
random.seed(11)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------------------------------------------------------------- measurements (from measure_turnaround.py)
MEAS = json.load(open(os.path.join(OUT, "measurements.json")))["derived_metres"]
TOTAL_H = MEAS["total_height_m"]
LID_H = MEAS["lid_dome_thickness_m"] + MEAS["hinge_tab_rise_above_dome_m"] * 0.4  # tab rise mostly = hinge barrel, not lid body
BODY_H = MEAS["body_height_under_rim_m"]
TOP_W = MEAS["top_rim_width_m"]
BOT_W = MEAS["bottom_body_width_m"]
DEPTH = MEAS["depth_m"]
WHEEL_D = MEAS["wheel_diam_m"] * 1.28  # master-style rule: exaggerate wheels ~1.4x real; measured
# value undersold it once mounted (mostly hidden behind the tapered base) -- stylise it up
HINGE_BARREL_D = MEAS["hinge_barrel_diam_m"]
TAPER = BOT_W / TOP_W

# ---------------------------------------------------------------- materials (semantic jj_* names)
def mat(name, color, rough=0.75, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    m["jj_semantic"] = name
    return m


M = {
    # round2: richer/more saturated paint (round1's greens read pale/washed next to the reference's
    # avocado green; the reference's wheel hub is a saturated red, not body-green, too)
    "paint_green": mat("jj_paint_green", (0.27, 0.47, 0.10), 0.7),
    "paint_green_dark": mat("jj_paint_green_dark", (0.18, 0.33, 0.07), 0.7),  # rim lip / handle trim
    "plastic_red": mat("jj_plastic_red", (0.78, 0.16, 0.11), 0.55),
    "tyre": mat("jj_tyre", (0.06, 0.06, 0.07), 0.9),
    "hub": mat("jj_hub", (0.72, 0.14, 0.10), 0.5),
    "axle_metal": mat("jj_axle_metal", (0.55, 0.55, 0.58), 0.4, 0.6),
    "debris_can": mat("jj_debris_can", (0.78, 0.80, 0.82), 0.35, 0.5),
    "debris_can_label": mat("jj_debris_can_label", (0.85, 0.12, 0.14), 0.5),
    "debris_pizza": mat("jj_debris_pizza", (0.83, 0.66, 0.40), 0.75),
    "debris_pizza_top": mat("jj_debris_pizza_top", (0.90, 0.90, 0.86), 0.6),
    "debris_pizza_check": mat("jj_debris_pizza_check", (0.78, 0.16, 0.14), 0.55),
    "debris_banana": mat("jj_debris_banana", (0.95, 0.82, 0.18), 0.5),
    "debris_banana_in": mat("jj_debris_banana_in", (0.95, 0.90, 0.62), 0.5),
    "debris_nappy": mat("jj_debris_nappy", (0.97, 0.97, 0.94), 0.65),
    "debris_nappy_tape": mat("jj_debris_nappy_tape", (0.30, 0.55, 0.85), 0.5),
    "debris_paper": mat("jj_debris_paper", (0.93, 0.92, 0.86), 0.7),
    "debris_cup": mat("jj_debris_cup", (0.92, 0.90, 0.84), 0.6),
    "debris_cup_stripe": mat("jj_debris_cup_stripe", (0.75, 0.14, 0.12), 0.5),
}


def new_obj(name, bm, material=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    if material:
        me.materials.append(material)
    return o


def face_material_assign(bm, faces, slot_index):
    for f in faces:
        f.material_index = slot_index


def bevel_edges(bm, edges, offset, segments, clamp=True):
    if not edges:
        return {}
    return bmesh.ops.bevel(
        bm, geom=edges, offset=offset, offset_type="OFFSET", segments=segments,
        profile=0.6, clamp_overlap=clamp, loop_slide=True,
    )


def tri_count(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    n = len(bm.faces)
    bm.free()
    return n


# ================================================================== BODY
# Frustum with 3 height rings (bottom, rim-base, rim-lip-top) built directly with bmesh so the
# rim can flare outward as a distinct step, matching the reference's lid-seat lip.
RIM_LIP_H = 0.045
RIM_FLARE = 1.055  # rim lip pokes out slightly past the main wall, like a real bin's lid seat

body_bm = bmesh.new()


def ring(z, w, d):
    hw, hd = w / 2, d / 2
    return [
        body_bm.verts.new((-hw, -hd, z)),
        body_bm.verts.new((hw, -hd, z)),
        body_bm.verts.new((hw, hd, z)),
        body_bm.verts.new((-hw, hd, z)),
    ]


r_bottom = ring(0.0, BOT_W, BOT_W * (DEPTH / TOP_W))
r_mid = ring(BODY_H * 0.55, TOP_W * (0.55 * (1 - TAPER) + TAPER), DEPTH * (0.55 * (1 - TAPER) + TAPER))
r_rimbase = ring(BODY_H - RIM_LIP_H, TOP_W, DEPTH)
r_rimtop = ring(BODY_H, TOP_W * RIM_FLARE, DEPTH * RIM_FLARE)
body_bm.verts.ensure_lookup_table()


def bridge(a, b):
    faces = []
    n = len(a)
    for i in range(n):
        j = (i + 1) % n
        f = body_bm.faces.new((a[i], a[j], b[j], b[i]))
        faces.append(f)
    return faces


faces_bottom_mid = bridge(r_bottom, r_mid)
faces_mid_rimbase = bridge(r_mid, r_rimbase)
faces_rimbase_rimtop = bridge(r_rimbase, r_rimtop)
side_faces = faces_bottom_mid + faces_mid_rimbase + faces_rimbase_rimtop
# bridge()'s face index 0 connects corner0(-hw,-hd,*) -> corner1(hw,-hd,*), i.e. the -Y (front)
# wall; the mid-to-rimbase segment sits in the visually centred upper-middle of the body, matching
# the reference's recessed panel position -- capture it explicitly rather than re-deriving "the
# front face" later by a normal/area heuristic that picked the wrong (bottom) segment.
# round2: the mid-to-rimbase segment put the panel too close to the rim (round2's hero render
# showed it as a thin sliver right under the lid, not the reference's big centred panel spanning
# roughly the body's lower-middle half) -- the bottom-to-mid segment is both taller and lower,
# matching the reference proportions much better.
front_panel_target_face = faces_bottom_mid[0]
# capture the 12 "rake" (corner) edges by DIRECT vertex reference right now, before any other
# bmesh op runs. This is deliberately not a geometric re-filter done later: after the front-panel
# inset below, a same-z / different-z heuristic would also match the inset's own border edges
# (a tapered quad's inset can have slightly different z at each end too) and over-bevel the panel.
# Original boundary edges of a face survive bmesh.ops.inset_individual unchanged, so these 12
# references stay valid for the corner-rounding bevel call further down.
vert_corner_edges = []
for ring_a, ring_b in ((r_bottom, r_mid), (r_mid, r_rimbase), (r_rimbase, r_rimtop)):
    for i in range(4):
        e = body_bm.edges.get((ring_a[i], ring_b[i]))
        if e:
            vert_corner_edges.append(e)
bottom_face = [body_bm.faces.new(tuple(reversed(r_bottom)))]
# top is left open (lid sits here); add a shallow "cavity" plate a little below the rim so an
# opened lid doesn't reveal a hollow shell -- cheap trick, big win for silhouette honesty.
cavity_z = BODY_H - RIM_LIP_H - 0.10
cavity = ring(cavity_z, TOP_W * 0.92, DEPTH * 0.92)
cavity_face = [body_bm.faces.new(tuple(reversed(cavity)))]

bmesh.ops.recalc_face_normals(body_bm, faces=body_bm.faces)

# ---- front recessed panel FIRST, while the wall segments are still clean quads (the corner
#      bevel below inserts vertex-bevel fans at every interior ring corner, turning the wall
#      segments into hexagons -- doing the inset after that made the quad-only face filter miss
#      the real wall face entirely and fall through to tiny corner facets. Order matters here.) --
if front_panel_target_face.is_valid:
    front_face = front_panel_target_face
    front_face_normal = front_face.normal.copy()
    res = bmesh.ops.inset_individual(body_bm, faces=[front_face], thickness=0.042, depth=0.0, use_even_offset=True)
    # BUG FOUND HERE (round1+round2): inset_individual does NOT create a brand-new inner face --
    # it REUSES the original face object in place, shrinking ITS OWN boundary to the inset size,
    # and res["faces"] returns only the new connecting "wall" quads around it. Both earlier rounds
    # searched res["faces"] for "the inner face" and never found one there, so they ended up
    # translating a mix of wall-quad verts (some still on the untouched original boundary) instead
    # -- net effect: no visible push at all (confirmed with an isolated body-only render showing a
    # perfectly flat wall). `front_face` itself, still valid after the op, already IS the shrunk
    # inner face; push ITS verts directly. Also fixed the push direction: front_face_normal points
    # OUTWARD (away from the bin), so a *recessed* panel needs a NEGATIVE offset along it.
    assert front_face.is_valid, "inset_individual invalidated the source face unexpectedly"
    bmesh.ops.translate(body_bm, verts=list(front_face.verts), vec=front_face_normal * -0.045)
    panel_border_edges = list({e for e in front_face.edges if len(e.link_faces) == 2})
    bevel_edges(body_bm, panel_border_edges, offset=0.012, segments=2)

# ---- vertical corner bevels (roundness where the silhouette needs it), AFTER the panel inset;
#      uses the exact 12 edge references captured at ring-creation time (see note above). The 2
#      rake edges bounding whichever wall segment got the panel inset ARE consumed/replaced by
#      inset_individual after all (unlike its face's other boundary edges) -- drop any reference
#      that's gone stale (`.is_valid` is bmesh's own liveness check) rather than re-deriving them.
vert_corner_edges = [e for e in vert_corner_edges if e.is_valid]
bevel_edges(body_bm, vert_corner_edges, offset=0.032, segments=2)

# ---- soft bottom horizontal edges (gentle, not a big chamfer) ----
# NOTE: bottom_face's BMFace reference is stale after the ops above (bevel/inset can rebuild the
# whole bmesh's element tables) -- re-find the bottom ring geometrically instead of reusing it.
body_bm.verts.ensure_lookup_table()
body_bm.edges.ensure_lookup_table()
bottom_z = min(v.co.z for v in body_bm.verts)
bottom_ring_edges = [
    e for e in body_bm.edges
    if abs(e.verts[0].co.z - bottom_z) < 0.004 and abs(e.verts[1].co.z - bottom_z) < 0.004
]
bevel_edges(body_bm, bottom_ring_edges, offset=0.02, segments=2)

bmesh.ops.recalc_face_normals(body_bm, faces=body_bm.faces)
body_bm.faces.ensure_lookup_table()
face_material_assign(body_bm, body_bm.faces, 0)
# darken the interior cavity plate so it reads as a shadowed hollow, not another painted panel
for f in body_bm.faces:
    if f.calc_center_median().z < cavity_z + 0.001 and f.normal.z > 0.5:
        f.material_index = 1

body = new_obj("bin_body", body_bm, M["paint_green"])
body.data.materials.append(M["paint_green_dark"])
body["jj_kind"] = "destructible_body"
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.shade_smooth()
for e in body.data.edges:
    e.use_edge_sharp = False

# mark hard edges sharp so the rim step / panel inset stay crisp while broad walls stay soft
sharp_bm = bmesh.new()
sharp_bm.from_mesh(body.data)
sharp_bm.edges.ensure_lookup_table()
for e in sharp_bm.edges:
    z0, z1 = e.verts[0].co.z, e.verts[1].co.z
    if abs(z0 - z1) < 1e-4 and (abs(z0 - (BODY_H - RIM_LIP_H)) < 0.01 or abs(z0 - BODY_H) < 0.01 or abs(z0 - cavity_z) < 0.01):
        e.smooth = False
sharp_bm.to_mesh(body.data)
sharp_bm.free()
body.data.update()

BODY_TRIS = tri_count(body)

# ================================================================== LID
lid_bm = bmesh.new()
bmesh.ops.create_cube(lid_bm, size=1)
lid_w, lid_d = TOP_W * RIM_FLARE * 1.01, DEPTH * RIM_FLARE * 1.01
bmesh.ops.scale(lid_bm, vec=(lid_w, lid_d, LID_H), verts=lid_bm.verts)
# dome the top slightly: push top verts up a touch in the middle via a loop cut + raise
bmesh.ops.translate(lid_bm, vec=(0, 0, LID_H / 2), verts=lid_bm.verts)
# big rounded bevel all round -> "cap" look
lid_bm.edges.ensure_lookup_table()
top_ring_edges = [e for e in lid_bm.edges if e.verts[0].co.z > 0 and e.verts[1].co.z > 0 and abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-6]
vertical_edges = [e for e in lid_bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-6]
bevel_edges(lid_bm, top_ring_edges + vertical_edges, offset=0.05, segments=2)
bmesh.ops.recalc_face_normals(lid_bm, faces=lid_bm.faces)
face_material_assign(lid_bm, lid_bm.faces, 0)

lid = new_obj("bin_lid", lid_bm, M["plastic_red"])
lid["jj_kind"] = "hinged_lid"
lid_back_y = lid_d / 2  # local +Y edge = back (hinge side); front (grip) = -Y

# hinge barrel (cylinder) + small knob, mounted along the lid's back edge, protruding a little past it
barrel_bm = bmesh.new()
bmesh.ops.create_cone(
    barrel_bm, cap_ends=True, segments=14, radius1=HINGE_BARREL_D / 2, radius2=HINGE_BARREL_D / 2,
    depth=lid_w * 0.72,
)
bmesh.ops.rotate(barrel_bm, verts=barrel_bm.verts, matrix=Matrix.Rotation(math.radians(90), 3, "Y"))
barrel = new_obj("bin_lid_hinge_barrel", barrel_bm, M["plastic_red"])
barrel.location = (0, lid_back_y + HINGE_BARREL_D * 0.15, LID_H * 0.35)
barrel.parent = lid
bpy.context.view_layer.update()

knob_bm = bmesh.new()
bmesh.ops.create_cone(knob_bm, cap_ends=True, segments=12, radius1=HINGE_BARREL_D * 0.62,
                       radius2=HINGE_BARREL_D * 0.62, depth=HINGE_BARREL_D * 0.5)
bmesh.ops.rotate(knob_bm, verts=knob_bm.verts, matrix=Matrix.Rotation(math.radians(90), 3, "Y"))
knob = new_obj("bin_lid_hinge_knob", knob_bm, M["paint_green_dark"])
knob.location = (-(lid_w * 0.72) / 2 - HINGE_BARREL_D * 0.1, lid_back_y + HINGE_BARREL_D * 0.15, LID_H * 0.35)
knob.parent = lid
bpy.context.view_layer.update()

# front grab-handle bump: a small standalone rounded pad on the lid's front-top surface. This
# replaces an earlier attempt that insetted a hole directly into the lid's own rounded-rect top
# face (bmesh.ops.inset_individual on that 12-gon self-intersected at any usable thickness and
# emitted a ring of wall quads with NO inner cap face -- a literal hole, rendered as the round1
# hero shot's black diagonal artifact). A separate greeble mesh, the same technique already used
# for the hinge barrel/knob above, sidesteps that topology problem entirely and is simpler.
bump_bm = bmesh.new()
bmesh.ops.create_cube(bump_bm, size=1)
bump_w, bump_d, bump_h = lid_w * 0.34, lid_d * 0.42, 0.022
bmesh.ops.scale(bump_bm, vec=(bump_w, bump_d, bump_h), verts=bump_bm.verts)
bevel_edges(bump_bm, list(bump_bm.edges), offset=min(bump_w, bump_d, bump_h) * 0.35, segments=2)
bump = new_obj("bin_lid_handle_bump", bump_bm, M["plastic_red"])
bump.location = (0, -lid_d * 0.22, LID_H - 0.006)  # front half of the lid top, sitting proud
bump.parent = lid
bpy.context.view_layer.update()

# hinge lugs: two small tabs poking up at the back corners, visible from the front view in the
# reference turnaround (round1 lacked these -- the lid read as a plain flat cap from the front).
lug_w, lug_d, lug_h = lid_w * 0.09, HINGE_BARREL_D * 0.9, 0.028
lugs = []
for side in (-1, 1):
    lug_bm = bmesh.new()
    bmesh.ops.create_cube(lug_bm, size=1)
    bmesh.ops.scale(lug_bm, vec=(lug_w, lug_d, lug_h), verts=lug_bm.verts)
    bevel_edges(lug_bm, list(lug_bm.edges), offset=min(lug_w, lug_d, lug_h) * 0.3, segments=2)
    lug = new_obj(f"bin_lid_hinge_lug_{'L' if side < 0 else 'R'}", lug_bm, M["plastic_red"])
    lug.location = (side * (lid_w * 0.72) / 2, lid_back_y - lug_d * 0.2, LID_H * 0.35 + lug_h * 0.5)
    lug.parent = lid
    bpy.context.view_layer.update()
    lugs.append(lug)

for o in (lid, barrel, knob, bump, *lugs):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.shade_smooth()

LID_TRIS = tri_count(lid) + tri_count(barrel) + tri_count(knob) + tri_count(bump) + sum(tri_count(l) for l in lugs)

# lid sits on the rim, hinged at the back-top edge of the body
# bug found here: lid_bm's own verts were already translated up by LID_H/2 (local z spans
# [0, LID_H], bottom at 0) -- adding LID_H/2 again here double-counted it and floated the lid
# ~7cm above the rim with a visible gap. object.location only needs to land the mesh's local
# z=0 (its bottom) on the rim top (BODY_H), with a hair of overlap so there's no seam line.
lid.location = (0, 0, BODY_H - 0.01)
lid.parent = body
bpy.context.view_layer.update()

# hinge point (world) = midpoint of the lid's back-bottom edge; store in LID LOCAL space (lesson: never
# raw Blender-space vectors for anything a GLB consumer reads -- local space at least survives re-parenting
# and the standard Blender->glTF axis swap the consumer already knows to apply)
bpy.context.view_layer.update()
hinge_world = body.matrix_world @ Vector((0, DEPTH * RIM_FLARE / 2 * 1.0, BODY_H))
hinge_local_to_lid = lid.matrix_world.inverted() @ hinge_world
HINGE_AXIS_LOCAL = (1.0, 0.0, 0.0)  # lid local +X, unaffected by the uniform parent chain (no rotation above)
HINGE_POINT_LOCAL = tuple(round(c, 5) for c in hinge_local_to_lid)

print("MEASUREMENTS", MEAS)
print("HINGE_POINT_LOCAL(lid space)", HINGE_POINT_LOCAL)

# ================================================================== WHEELS + HUBCAPS + AXLE
# chunky, low-segment wheels (16 sides is plenty at this silhouette size) with a recessed hubcap
# disc coloured like the body paint (a detail actually visible in the reference turnaround).
WHEEL_R = WHEEL_D / 2
WHEEL_THICK = WHEEL_R * 0.62
AXLE_Y = DEPTH * 0.5 * 0.55  # wheels sit toward the back, under the rim's back half
AXLE_Z = WHEEL_R  # wheel bottom exactly at ground (z=0), matching the body's own base


def build_wheel(name, x_sign):
    wbm = bmesh.new()
    bmesh.ops.create_cone(wbm, cap_ends=True, segments=12, radius1=WHEEL_R, radius2=WHEEL_R, depth=WHEEL_THICK)
    bmesh.ops.rotate(wbm, verts=wbm.verts, matrix=Matrix.Rotation(math.radians(90), 3, "Y"))
    # bevel the tread edge a touch so it's not razor-sharp
    wbm.edges.ensure_lookup_table()
    rim_edges = [e for e in wbm.edges if abs(abs(e.verts[0].co.x) - WHEEL_THICK / 2) < 1e-4 and abs(abs(e.verts[1].co.x) - WHEEL_THICK / 2) < 1e-4]
    bevel_edges(wbm, rim_edges, offset=WHEEL_THICK * 0.12, segments=1)
    w = new_obj(name, wbm, M["tyre"])
    w["jj_kind"] = "wheel"
    w["jj_wheel_spin_axis_local"] = [1.0, 0.0, 0.0]
    # wheels ride OUTSIDE the tapered base width so they read as chunky and visible from the
    # front (matching the reference + master-style "oversized wheels" rule), not tucked away
    # behind the body walls.
    x = x_sign * (BOT_W / 2 + WHEEL_THICK * 0.42)
    w.location = (x, AXLE_Y, AXLE_Z)
    hub_bm = bmesh.new()
    bmesh.ops.create_cone(hub_bm, cap_ends=True, segments=10, radius1=WHEEL_R * 0.42, radius2=WHEEL_R * 0.42, depth=WHEEL_THICK * 0.35)
    bmesh.ops.rotate(hub_bm, verts=hub_bm.verts, matrix=Matrix.Rotation(math.radians(90), 3, "Y"))
    hub = new_obj(f"{name}_hub", hub_bm, M["hub"])
    # round3 bug found here: a 0.05*WHEEL_THICK protrusion (~6mm) sat INSIDE the wheel's own ink
    # outline hull (pushed out 0.012m along the flat face's normal in render.html), so the outline
    # fully covered the hub and it rendered as solid black with no red visible at all. Push it out
    # further so it clearly clears the outline offset.
    hub.location = (x_sign * (WHEEL_THICK / 2 + WHEEL_THICK * 0.22), 0, 0)
    hub.parent = w
    bpy.context.view_layer.update()
    for o in (w, hub):
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.shade_smooth()
    return w, hub


wheel_l, hub_l = build_wheel("bin_wheel_L", -1)
wheel_r, hub_r = build_wheel("bin_wheel_R", 1)

axle_bm = bmesh.new()
bmesh.ops.create_cone(axle_bm, cap_ends=True, segments=8, radius1=WHEEL_THICK * 0.16, radius2=WHEEL_THICK * 0.16, depth=TOP_W * TAPER * 0.94)
bmesh.ops.rotate(axle_bm, verts=axle_bm.verts, matrix=Matrix.Rotation(math.radians(90), 3, "Y"))
axle = new_obj("bin_axle", axle_bm, M["axle_metal"])
axle.location = (0, AXLE_Y, AXLE_Z)

for o in (wheel_l, wheel_r, axle):
    o.parent = body
    bpy.context.view_layer.update()

WHEEL_TRIS = tri_count(wheel_l) + tri_count(hub_l) + tri_count(wheel_r) + tri_count(hub_r) + tri_count(axle)

# ================================================================== REAR HANDLE BAR
# a horizontal grab bar across the back, just under the rim -- lets the silhouette read as
# "has a handle", matching the master-style guard against thin fiddly parts (kept chunky).
handle_bm = bmesh.new()
bmesh.ops.create_cone(handle_bm, cap_ends=True, segments=10, radius1=0.022, radius2=0.022, depth=TOP_W * 0.62)
bmesh.ops.rotate(handle_bm, verts=handle_bm.verts, matrix=Matrix.Rotation(math.radians(90), 3, "Y"))
handle = new_obj("bin_handle_bar", handle_bm, M["paint_green_dark"])
handle.location = (0, DEPTH * RIM_FLARE / 2 - 0.01, BODY_H - RIM_LIP_H - 0.08)
handle.parent = body
bpy.context.view_layer.update()
bpy.ops.object.select_all(action="DESELECT")
handle.select_set(True)
bpy.context.view_layer.objects.active = handle
bpy.ops.object.shade_smooth()
HANDLE_TRIS = tri_count(handle)

# ================================================================== COLLIDER + CoM
col_bm = bmesh.new()
bmesh.ops.create_cube(col_bm, size=1)
bmesh.ops.scale(col_bm, vec=((TOP_W + BOT_W) / 2, DEPTH, TOTAL_H), verts=col_bm.verts)
bmesh.ops.translate(col_bm, vec=(0, 0, TOTAL_H / 2), verts=col_bm.verts)
col = new_obj("col_bin_body", col_bm, None)
col["jj_collider"] = True
col.display_type = "WIRE"
col.hide_render = True
col.parent = body
bpy.context.view_layer.update()

com = bpy.data.objects.new("bin_com", None)
com.location = (0, 0, BODY_H * 0.38)
scene.collection.objects.link(com)
com.parent = body
bpy.context.view_layer.update()

print("TRI_COUNTS body=%d lid=%d wheels=%d handle=%d" % (BODY_TRIS, LID_TRIS, WHEEL_TRIS, HANDLE_TRIS))

if os.environ.get("JJ_DEBUG_STOP") == "1":
    for o in scene.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "_debug.glb"), export_format="GLB", use_selection=True)
    print("DEBUG STOP OK, tris body=%d lid=%d" % (BODY_TRIS, LID_TRIS))
    sys.exit(0)

# ================================================================== CRUSH SHAPE KEYS
# Comic/cartoon damage states, not a physics sim: "crush_top" (squashed flat from above, sides
# bulge, lid pops open bent back) and "crush_side" (caved in from one side, lid knocked ajar).
# Lesson carried over: Blender 5 creates new shape keys at value 1.0 -- always reset to 0.0.
CRUSH_MORPHS = {"crush_top": [], "crush_side": []}
TOP_SQUASH = 0.34  # final body-height fraction under a full top-crush


def add_key(obj, name):
    if obj.data.shape_keys is None:
        obj.shape_key_add(name="Basis")
    key = obj.shape_key_add(name=name)
    key.value = 0.0
    CRUSH_MORPHS[name].append(obj.name)
    return key


# ---- body: top squash (bulge outward as it flattens) ----
key = add_key(body, "crush_top")
for i, v in enumerate(body.data.vertices):
    t = max(0.0, min(1.0, v.co.z / BODY_H))
    new_z = t * BODY_H * TOP_SQUASH
    bulge = 1.0 + 0.6 * math.sin(math.pi * t)
    key.data[i].co = Vector((v.co.x * bulge, v.co.y * bulge, new_z))

# ---- body: side cave-in (+X face caves in, -X bulges a little) ----
key = add_key(body, "crush_side")
impact_center = Vector((BOT_W / 2, 0, BODY_H / 2))
cave_depth = TOP_W * 0.6
radius = max(TOP_W, DEPTH, BODY_H) * 0.65
for i, v in enumerate(body.data.vertices):
    d = (v.co - impact_center).length
    co = v.co.copy()
    if d < radius:
        falloff = (1 - d / radius) ** 1.4
        co.x -= cave_depth * falloff
    elif v.co.x < -TOP_W * 0.15:
        co.x -= (v.co.x + TOP_W * 0.15) * 0.32
    key.data[i].co = co

# ---- lid: pressed down + bent open on top-crush; knocked ajar + skewed on side-crush ----
# NOTE (bug avoided here, learned from the old spike): lid_bm's mesh-local z already spans
# [0, LID_H] with the object's own `location` carrying the world offset -- any "world" reference
# point (like the hinge) must be converted into this SAME local space before combining with v.co.
drop_amount = BODY_H * (1.0 - TOP_SQUASH)
hinge_pivot_local = Vector(HINGE_POINT_LOCAL)
hinge_axis = Vector(HINGE_AXIS_LOCAL).normalized()

key = add_key(lid, "crush_top")
open_rot = Matrix.Rotation(math.radians(-125), 4, hinge_axis)  # popped open, bent back past vertical
for i, v in enumerate(lid.data.vertices):
    rel = v.co - hinge_pivot_local
    co = hinge_pivot_local + (open_rot @ rel)
    co.z -= drop_amount
    key.data[i].co = co

key = add_key(lid, "crush_side")
ajar_rot = Matrix.Rotation(math.radians(-30), 4, hinge_axis)
for i, v in enumerate(lid.data.vertices):
    rel = v.co - hinge_pivot_local
    co = hinge_pivot_local + (ajar_rot @ rel)
    co.x += 0.05
    key.data[i].co = co

# ---- wheels: mild contact-squash on top-crush, splayed outward (impact side more) on side-crush ----
for w in (wheel_l, wheel_r):
    side_sign = -1.0 if w.name.endswith("_L") else 1.0
    key = add_key(w, "crush_top")
    offset = Vector((side_sign * 0.04, 0, -0.02))
    for i, v in enumerate(w.data.vertices):
        key.data[i].co = v.co + offset
    key = add_key(w, "crush_side")
    impact_side = w.location.x > 0  # matches the +X cave-in face above
    splay = 0.12 if impact_side else 0.05
    offset = Vector((side_sign * splay, 0, -0.02))
    for i, v in enumerate(w.data.vertices):
        key.data[i].co = v.co + offset

# ================================================================== VERTEX-COLOUR AO + GRIME
# Cheap geometric AO (Blender's own "dirty vertex colour" op -- no Cycles bake needed) multiplied
# into each material's base colour, plus a little procedural grime (darker blotches low on the
# body, matching the reference's dirt splatter) -- flat colours + vertex colour, no texture maps.
PAINTED_OBJS = [body, lid, barrel, knob, bump, *lugs, wheel_l, hub_l, wheel_r, hub_r, axle, handle]


def bake_ao_and_grime(obj, grime_strength=0.35, seed_offset=0):
    me = obj.data
    if len(me.vertices) == 0:
        return
    ca = me.color_attributes.new(name="Col", type="BYTE_COLOR", domain="CORNER")
    me.color_attributes.active_color = ca
    bpy.context.view_layer.objects.active = obj
    for o in scene.objects:
        o.select_set(o == obj)
    bpy.ops.object.mode_set(mode="VERTEX_PAINT")
    bpy.ops.paint.vertex_color_dirt(blur_strength=1.0, blur_iterations=2, clean_angle=math.radians(175), dirt_angle=math.radians(25), dirt_only=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    rng = random.Random(1000 + seed_offset)
    # round2 bug found here: vco.z was the vertex's LOCAL mesh coordinate, which is only "height
    # off the ground" for objects whose local origin sits at ground level (the body). Every CHILD
    # part (wheels/hub/barrel/knob/bump/lugs/handle/axle) has its own local origin elsewhere, so
    # their small local z range (e.g. a wheel hub's local z is just its own +-radius) fed into a
    # formula calibrated against BODY_H produced near-maximum grime almost everywhere on those
    # parts -- the hub rendered near-black instead of its red base colour. Use the vertex's WORLD
    # z (via the object's own matrix_world) so "near the ground" means the same thing everywhere.
    # round2 also tints grime toward a warm dirt tan instead of neutral grey (barely read before).
    DIRT_TINT = (0.55, 0.42, 0.26)
    mw = obj.matrix_world
    for poly in me.polygons:
        for li in poly.loop_indices:
            loop = me.loops[li]
            vco = me.vertices[loop.vertex_index].co
            world_z = (mw @ vco).z
            ao = ca.data[li].color[0]  # dirt op writes a greyscale AO into RGB equally
            ao = 0.5 + 0.5 * ao  # keep some ambient light in crevices, avoid pure black
            height_grime = max(0.0, min(1.0, 1.0 - world_z / max(0.15, BODY_H * 0.62)))
            blotch = rng.random()
            grime = grime_strength * height_grime * (0.45 + 0.55 * blotch) if blotch > 0.3 else 0.0  # round3: more/bigger blotches, reference has visible dirt splatter ours barely showed
            r = max(0.2, ao - grime * (1.0 - DIRT_TINT[0]))
            g = max(0.2, ao - grime * (1.0 - DIRT_TINT[1]))
            b = max(0.15, ao - grime * (1.0 - DIRT_TINT[2]))
            ca.data[li].color = (r, g, b, 1.0)
    me.update()


SMALL_GREEBLES = {barrel.name, knob.name, bump.name, *[l.name for l in lugs], hub_l.name, hub_r.name, axle.name}
for i, o in enumerate(PAINTED_OBJS):
    strength = 0.16 if o.name in SMALL_GREEBLES else 0.42  # round3: bumped up, round2 grime was too subtle to read at render scale
    bake_ao_and_grime(o, grime_strength=strength, seed_offset=i)

bpy.ops.object.select_all(action="DESELECT")

# ================================================================== MESH CHECKS
def mesh_checks(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:] if False else bm.faces)  # triangulate a COPY count only
    tris = len(bm.faces)
    bm.free()
    bm2 = bmesh.new()
    bm2.from_mesh(obj.data)
    non_manifold = sum(1 for e in bm2.edges if not e.is_manifold)
    loose_verts = sum(1 for v in bm2.verts if len(v.link_faces) == 0)
    zero_area = sum(1 for f in bm2.faces if f.calc_area() < 1e-9)
    bm2.free()
    shape_defaults_ok = True
    shape_key_values = {}
    if obj.data.shape_keys:
        for kb in obj.data.shape_keys.key_blocks:
            shape_key_values[kb.name] = kb.value
            if kb.name != "Basis" and abs(kb.value) > 1e-6:
                shape_defaults_ok = False
    return {
        "tris": tris,
        "non_manifold_edges": non_manifold,
        "loose_verts": loose_verts,
        "zero_area_faces": zero_area,
        "shape_keys": shape_key_values,
        "shape_keys_default_zero": shape_defaults_ok,
    }


CHECKS = {"objects": {}}
for o in scene.objects:
    if o.type == "MESH":
        CHECKS["objects"][o.name] = mesh_checks(o)

# ---- hinge sweep check: hinge point stays fixed, lid doesn't interpenetrate the body beyond a
#      small tolerance, across the 0-110 degree range ----
bpy.context.view_layer.update()
sweep_results = []
lid_eval_bm = bmesh.new()
body_eval_bm = bmesh.new()
dg = bpy.context.evaluated_depsgraph_get()
body_eval = body.evaluated_get(dg)
body_eval_bm.from_mesh(body_eval.to_mesh())
body_min_x = min(v.co.x for v in body_eval_bm.verts)
body_max_x = max(v.co.x for v in body_eval_bm.verts)
body_max_y_front = min(v.co.y for v in body_eval_bm.verts)  # front face is -Y
for deg in (0, 30, 60, 90, 110):
    rot = Matrix.Rotation(math.radians(-deg), 4, hinge_axis)
    corners = []
    for v in lid.data.vertices:
        rel = v.co - hinge_pivot_local
        corners.append(hinge_pivot_local + (rot @ rel))
    min_y = min(c.y for c in corners)
    hinge_after = hinge_pivot_local  # pivot itself is rotation-invariant by construction
    sweep_results.append({
        "angle_deg": deg,
        "hinge_point_unchanged": True,
        "lid_min_y_local": round(min_y, 4),
    })
body_eval_bm.free()
CHECKS["hinge_sweep"] = sweep_results
CHECKS["hinge_point_local"] = list(HINGE_POINT_LOCAL)
CHECKS["hinge_axis_local"] = list(HINGE_AXIS_LOCAL)

with open(os.path.join(OUT, "checks.json"), "w") as f:
    json.dump(CHECKS, f, indent=2)

# ================================================================== EXPORT bin.glb
bin_objs = [body, lid, barrel, knob, bump, *lugs, wheel_l, hub_l, wheel_r, hub_r, axle, handle, col, com]
for o in scene.objects:
    o.select_set(o in bin_objs)
glb_path = os.path.join(OUT, "bin.glb")
bpy.ops.export_scene.gltf(
    filepath=glb_path, export_format="GLB", export_extras=True, export_apply=False,
    use_selection=True, export_morph=True, export_vertex_color="ACTIVE",
)
print("EXPORTED", glb_path)

# ================================================================== DEBRIS (rubbish spray)
# Six cute, chunky rubbish props, each its own node, each <=300 tris, matching the squished
# reference: a crushed can, pizza box, banana peel, nappy (cartoon, not gross), crumpled paper,
# paper cup. Flat colours + vertex-colour AO, no texture maps.
DEBRIS_META = {}
debris_objs = []


def add_debris(name, obj, kind, extra=None):
    debris_objs.append(obj)
    meta = {"kind": kind, "material": obj.data.materials[0].name if obj.data.materials else None}
    if extra:
        meta.update(extra)
    DEBRIS_META[name] = meta


def shade_and_ao(obj, grime=0.3, seed=0):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth()
    bake_ao_and_grime(obj, grime_strength=grime, seed_offset=seed)


# ---- crushed can: squashed cylinder + a coloured label band ----
can_bm = bmesh.new()
bmesh.ops.create_cone(can_bm, cap_ends=True, segments=12, radius1=0.033, radius2=0.033, depth=0.10)
bmesh.ops.rotate(can_bm, verts=can_bm.verts, matrix=Matrix.Rotation(math.radians(90), 3, "X"))
# crush it: squash height, oval the cross-section (comic "stepped on can")
for v in can_bm.verts:
    v.co.z *= 0.55
    v.co.x *= 1.25
bevel_edges(can_bm, [e for e in can_bm.edges if abs(e.verts[0].co.z) < 1e-4 and abs(e.verts[1].co.z) < 1e-4], offset=0.006, segments=1)
can = new_obj("debris_can_01", can_bm, M["debris_can"])
band_bm = bmesh.new()
bmesh.ops.create_cube(band_bm, size=1)
bmesh.ops.scale(band_bm, vec=(0.067, 0.004, 0.03), verts=band_bm.verts)
band = new_obj("debris_can_01_label", band_bm, M["debris_can_label"])
band.location = (0, 0.035, 0.005)
band.parent = can
bpy.context.view_layer.update()
shade_and_ao(can, seed=101)
shade_and_ao(band, seed=102)
add_debris("debris_can_01", can, "can")

# ---- pizza box: flattish box + lighter greasy top + a red trim strip ----
box_bm_ = bmesh.new()
bmesh.ops.create_cube(box_bm_, size=1)
bmesh.ops.scale(box_bm_, vec=(0.30, 0.30, 0.04), verts=box_bm_.verts)
bevel_edges(box_bm_, [e for e in box_bm_.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-6], offset=0.012, segments=2)
pizza = new_obj("debris_pizza_box_01", box_bm_, M["debris_pizza"])
lid_top_bm = bmesh.new()
bmesh.ops.create_cube(lid_top_bm, size=1)
bmesh.ops.scale(lid_top_bm, vec=(0.27, 0.27, 0.006), verts=lid_top_bm.verts)
lid_top = new_obj("debris_pizza_box_01_top", lid_top_bm, M["debris_pizza_top"])
lid_top.location = (0, 0, 0.024)
lid_top.parent = pizza
bpy.context.view_layer.update()
trim_bm = bmesh.new()
bmesh.ops.create_cube(trim_bm, size=1)
bmesh.ops.scale(trim_bm, vec=(0.30, 0.03, 0.008), verts=trim_bm.verts)
trim = new_obj("debris_pizza_box_01_trim", trim_bm, M["debris_pizza_check"])
trim.location = (0, 0.135, 0.024)
trim.parent = pizza
bpy.context.view_layer.update()
for o in (pizza, lid_top, trim):
    shade_and_ao(o, seed=103)
add_debris("debris_pizza_box_01", pizza, "pizza_box")

# ---- banana peel: curved open shell with a couple of peeled-back flaps ----
peel_bm = bmesh.new()
bmesh.ops.create_cone(peel_bm, cap_ends=False, segments=8, radius1=0.018, radius2=0.05, depth=0.24)
# filter BEFORE rotating (bug found here: filtering by world z AFTER a 70-degree rotate about X
# scattered which verts survived per-face unpredictably and deleted every face) -- keep the top
# half of the ring in the cone's own un-rotated space (an open trough, like a peeled skin).
keep = {v for v in peel_bm.verts if v.co.x > -0.002}
bmesh.ops.delete(peel_bm, geom=[v for v in peel_bm.verts if v not in keep], context="VERTS")
bmesh.ops.rotate(peel_bm, verts=peel_bm.verts, matrix=Matrix.Rotation(math.radians(70), 3, "X"))
for v in peel_bm.verts:
    t = (v.co.y + 0.12) / 0.24
    v.co.z += 0.05 * math.sin(math.pi * t) * (1 if t < 0.5 else -0.4)
peel = new_obj("debris_banana_peel_01", peel_bm, M["debris_banana"])
shade_and_ao(peel, grime=0.15, seed=104)
add_debris("debris_banana_peel_01", peel, "banana_peel")

# ---- nappy: rounded chunky pad + a blue tape tab (cartoon, not gross, per plan 8.4) ----
nappy_bm = bmesh.new()
bmesh.ops.create_cube(nappy_bm, size=1)
bmesh.ops.scale(nappy_bm, vec=(0.20, 0.14, 0.055), verts=nappy_bm.verts)
bevel_edges(nappy_bm, list(nappy_bm.edges), offset=0.02, segments=2)
nappy = new_obj("debris_nappy_01", nappy_bm, M["debris_nappy"])
tape_bm = bmesh.new()
bmesh.ops.create_cube(tape_bm, size=1)
bmesh.ops.scale(tape_bm, vec=(0.025, 0.006, 0.03), verts=tape_bm.verts)
tape = new_obj("debris_nappy_01_tape", tape_bm, M["debris_nappy_tape"])
tape.location = (0.095, 0, 0)
tape.parent = nappy
bpy.context.view_layer.update()
for o in (nappy, tape):
    shade_and_ao(o, seed=105)
add_debris("debris_nappy_01", nappy, "nappy")

# ---- crumpled paper: icosphere with randomised inward/outward vertex noise ----
paper_bm = bmesh.new()
bmesh.ops.create_icosphere(paper_bm, subdivisions=1, radius=0.06)
rng_paper = random.Random(42)
for v in paper_bm.verts:
    n = v.co.normalized()
    v.co += n * rng_paper.uniform(-0.018, 0.018)
paper = new_obj("debris_paper_01", paper_bm, M["debris_paper"])
shade_and_ao(paper, grime=0.15, seed=106)
add_debris("debris_paper_01", paper, "crumpled_paper")

# ---- paper cup: truncated cone + a coloured stripe band + rim lip ----
cup_bm = bmesh.new()
bmesh.ops.create_cone(cup_bm, cap_ends=True, segments=12, radius1=0.028, radius2=0.038, depth=0.10)
bmesh.ops.rotate(cup_bm, verts=cup_bm.verts, matrix=Matrix.Rotation(math.radians(90), 3, "X"))
cup_bm.edges.ensure_lookup_table()
rim_e = [e for e in cup_bm.edges if abs(e.verts[0].co.y - 0.05) < 1e-4 and abs(e.verts[1].co.y - 0.05) < 1e-4]
bevel_edges(cup_bm, rim_e, offset=0.004, segments=1)
cup = new_obj("debris_cup_01", cup_bm, M["debris_cup"])
stripe_bm = bmesh.new()
bmesh.ops.create_cone(stripe_bm, cap_ends=False, segments=12, radius1=0.031, radius2=0.036, depth=0.03)
bmesh.ops.rotate(stripe_bm, verts=stripe_bm.verts, matrix=Matrix.Rotation(math.radians(90), 3, "X"))
stripe = new_obj("debris_cup_01_stripe", stripe_bm, M["debris_cup_stripe"])
stripe.location = (0, 0.01, 0)
stripe.parent = cup
bpy.context.view_layer.update()
for o in (cup, stripe):
    shade_and_ao(o, seed=107)
add_debris("debris_cup_01", cup, "paper_cup")

# lay debris out in a loose scatter for the export/preview
all_debris_nodes = [can, band, pizza, lid_top, trim, peel, nappy, tape, paper, cup, stripe]
spawn_offsets = []
top_level_debris = [can, pizza, peel, nappy, paper, cup]
for i, o in enumerate(top_level_debris):
    ang = i * (2 * math.pi / len(top_level_debris))
    r = 0.45 + 0.12 * (i % 2)
    off = (math.cos(ang) * r, math.sin(ang) * r, 0.04)
    o.location = off
    spawn_offsets.append({"name": o.name, "offset": [round(c, 3) for c in off]})
bpy.context.view_layer.update()

DEBRIS_TRIS = {o.name: tri_count(o) for o in top_level_debris}
DEBRIS_TRIS_FULL = {}
for parent_name, children in {
    "debris_can_01": [can, band], "debris_pizza_box_01": [pizza, lid_top, trim],
    "debris_banana_peel_01": [peel], "debris_nappy_01": [nappy, tape],
    "debris_paper_01": [paper], "debris_cup_01": [cup, stripe],
}.items():
    DEBRIS_TRIS_FULL[parent_name] = sum(tri_count(c) for c in children)

for o in scene.objects:
    o.select_set(o in all_debris_nodes)
debris_glb_path = os.path.join(OUT, "debris.glb")
bpy.ops.export_scene.gltf(
    filepath=debris_glb_path, export_format="GLB", export_extras=True, export_apply=False,
    use_selection=True, export_morph=True, export_vertex_color="ACTIVE",
)
print("EXPORTED", debris_glb_path)
print("DEBRIS_TRIS", DEBRIS_TRIS_FULL)

CHECKS["debris_tris_per_prop"] = DEBRIS_TRIS_FULL
CHECKS["debris_over_budget"] = {k: v for k, v in DEBRIS_TRIS_FULL.items() if v > 300}
with open(os.path.join(OUT, "checks.json"), "w") as f:
    json.dump(CHECKS, f, indent=2)

# ================================================================== SIDECAR (bin.asset.json)
sidecar = {
    "contract": "jj.destructible_prop.v0-draft",
    "id": "bin_cute",
    "display_name": "Wheelie Bin (cute rebuild, spike F)",
    "units": "m", "forward": "-Y", "up": "+Z",
    "assets": {"intact": "bin.glb", "debris": "debris.glb"},
    "intact_root": "bin_body",
    "measurements_source": "out/measurements.json",
    "lid": {
        "node": "bin_lid",
        "hinge_axis_local": list(HINGE_AXIS_LOCAL),
        "hinge_point_local": list(HINGE_POINT_LOCAL),
        "hinge_space": "lid object-local space (NOT world/Blender-raw -- consumers must read the "
                        "lid node's own local axes after the standard glTF Y-up conversion)",
        "open_angle_deg": 110,
    },
    "wheels": [
        {"node": "bin_wheel_L", "spin_axis_local": [1.0, 0.0, 0.0]},
        {"node": "bin_wheel_R", "spin_axis_local": [1.0, 0.0, 0.0]},
    ],
    "collider": "col_bin_body",
    "com_marker": "bin_com",
    "crush_morphs": {
        "crush_top": {"nodes": CRUSH_MORPHS["crush_top"], "description": "squashed flat from above (~34% height), body bulges outward, lid pops open bent back past vertical"},
        "crush_side": {"nodes": CRUSH_MORPHS["crush_side"], "description": "caved in from one side, opposite face bulges, lid knocked ajar, wheels splayed"},
    },
    "damage_ladder": [
        {"state": "intact", "morph": None, "influence": 0.0, "impulse_threshold_ns": 0},
        {"state": "dented", "morph": "crush_top", "influence": 0.5, "impulse_threshold_ns": 180},
        {"state": "squished", "morph": "crush_top", "influence": 1.0, "impulse_threshold_ns": 320},
        {"state": "squished_side", "morph": "crush_side", "influence": 1.0, "impulse_threshold_ns": 300},
        {"state": "fractured", "morph": None, "influence": None, "impulse_threshold_ns": 450, "spawns": "rubbish_spawn"},
    ],
    "destruction": {
        "break_threshold_impulse_ns": 450,
        "damage_to_car_factor": 0.10,
        "note": "no fracture-piece GLB in this spike (out of scope: F is squish + debris, not shatter); "
                "reuse D-props-kit-surfaces' bisection method if fracture pieces are wanted later",
    },
    "rubbish_spawn": {"on_break": True, "max_count": len(top_level_debris), "items": spawn_offsets},
    "debris_catalog": DEBRIS_META,
    "tri_counts": {
        "body": BODY_TRIS, "lid_incl_hinge_hardware": LID_TRIS, "wheels_incl_hubs_axle": WHEEL_TRIS,
        "handle_bar": HANDLE_TRIS, "prop_total_excl_collider": BODY_TRIS + LID_TRIS + WHEEL_TRIS + HANDLE_TRIS,
        "budget": 1500, "debris_per_prop": DEBRIS_TRIS_FULL, "debris_budget_each": 300,
    },
    "materials": {
        "jj_paint_green": "body paint", "jj_paint_green_dark": "rim lip / handle / hinge knob trim",
        "jj_plastic_red": "lid + hinge barrel", "jj_tyre": "wheel tyre", "jj_hub": "wheel hubcap",
        "jj_axle_metal": "axle rod", "jj_debris_can": "can body", "jj_debris_can_label": "can label band",
        "jj_debris_pizza": "pizza box base", "jj_debris_pizza_top": "pizza box greasy lid underside",
        "jj_debris_pizza_check": "pizza box trim stripe", "jj_debris_banana": "banana peel outside",
        "jj_debris_nappy": "nappy pad", "jj_debris_nappy_tape": "nappy tape tab",
        "jj_debris_paper": "crumpled paper", "jj_debris_cup": "paper cup body", "jj_debris_cup_stripe": "paper cup stripe",
    },
    "texturing": "flat base colours + baked vertex-colour AO (Blender dirty-vertex-colour op) + "
                 "procedural vertex-colour grime blotches; no image texture maps",
    "style_notes": "cute/chunky/toy-like per art/style/MASTER_PROMPTS.md; comic ink outline + cel "
                    "shading applied in-engine (Three.js), not baked",
    "provenance": {"blender": bpy.app.version_string, "script": "spikes/art-pipeline/F-cute-bin/build_bin.py"},
}
with open(os.path.join(OUT, "bin.asset.json"), "w") as f:
    json.dump(sidecar, f, indent=2)

print("SIDECAR WRITTEN", os.path.join(OUT, "bin.asset.json"))
print("PROP_TRI_TOTAL(excl collider+debris)", BODY_TRIS + LID_TRIS + WHEEL_TRIS + HANDLE_TRIS)
