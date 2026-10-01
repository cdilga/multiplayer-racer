#!/usr/bin/env python3
"""Builds a synthetic, fully contract-conformant vehicle asset (3 LOD GLBs + sidecar) used
as the "good" baseline for test_validator.sh and as mutation input for make_broken_fixtures.py.

Why synthetic: this task explicitly forbids touching Blender, and the real Blender-exported
`art/vehicles/cruz-missile/*` asset may not exist yet. This script builds boxy/cylindrical
placeholder geometry directly as glTF (stdlib + PIL only) that satisfies every rule in
validate_asset.py -- it is a geometric conformance fixture, not a representative car model.

Run: python3 build_good_asset.py <out_dir>
Writes: good.lod0.glb, good.lod1.glb, good.lod2.glb, good.asset.json
"""
import io
import json
import math
import os
import struct
import sys

from PIL import Image

# ---------------------------------------------------------------------------
# Minimal glTF/GLB writer (stdlib only; PIL only to encode the mask PNG bytes).
# ---------------------------------------------------------------------------

_COMP = {"f": (5126, 4), "H": (5123, 2)}


class GltfBuilder:
    def __init__(self):
        self.buf = bytearray()
        self.bufferViews = []
        self.accessors = []
        self.meshes = []
        self.nodes = []
        self.materials = []
        self.images = []
        self.textures = []
        self.node_by_name = {}

    def _pad(self):
        while len(self.buf) % 4 != 0:
            self.buf.append(0)

    def add_buffer_view(self, data, target=None):
        self._pad()
        offset = len(self.buf)
        self.buf.extend(data)
        bv = {"byteOffset": offset, "byteLength": len(data)}
        if target is not None:
            bv["target"] = target
        self.bufferViews.append(bv)
        return len(self.bufferViews) - 1

    def add_accessor_vec3f(self, vecs, kind="VEC3"):
        data = b"".join(struct.pack("<3f", *v) for v in vecs)
        bv = self.add_buffer_view(data, target=34962)
        mins = [min(v[i] for v in vecs) for i in range(3)]
        maxs = [max(v[i] for v in vecs) for i in range(3)]
        acc = {"bufferView": bv, "componentType": 5126, "count": len(vecs), "type": kind,
               "min": mins, "max": maxs}
        self.accessors.append(acc)
        return len(self.accessors) - 1

    def add_accessor_vec2f(self, vecs):
        data = b"".join(struct.pack("<2f", *v) for v in vecs)
        bv = self.add_buffer_view(data, target=34962)
        acc = {"bufferView": bv, "componentType": 5126, "count": len(vecs), "type": "VEC2"}
        self.accessors.append(acc)
        return len(self.accessors) - 1

    def add_accessor_indices(self, idx):
        data = b"".join(struct.pack("<H", i) for i in idx)
        bv = self.add_buffer_view(data, target=34963)
        acc = {"bufferView": bv, "componentType": 5123, "count": len(idx), "type": "SCALAR"}
        self.accessors.append(acc)
        return len(self.accessors) - 1

    def add_image_png(self, pil_image):
        out = io.BytesIO()
        pil_image.save(out, format="PNG")
        data = out.getvalue()
        bv = self.add_buffer_view(data)
        self.images.append({"mimeType": "image/png", "bufferView": bv})
        return len(self.images) - 1

    def add_texture(self, image_index):
        self.textures.append({"source": image_index})
        return len(self.textures) - 1

    def add_material(self, name, semantic, base_color=(0.6, 0.6, 0.6, 1.0), emissive=(0, 0, 0),
                      base_color_texture=None, emissive_strength=None):
        mat = {
            "name": name,
            "pbrMetallicRoughness": {"baseColorFactor": list(base_color), "metallicFactor": 0.2,
                                     "roughnessFactor": 0.6},
            "emissiveFactor": list(emissive),
            "extras": {"jj_semantic": semantic},
        }
        if base_color_texture is not None:
            mat["pbrMetallicRoughness"]["baseColorTexture"] = {"index": base_color_texture}
        if emissive_strength:
            mat["extensions"] = {"KHR_materials_emissive_strength": {"emissiveStrength": emissive_strength}}
        self.materials.append(mat)
        return len(self.materials) - 1

    def add_mesh(self, name, positions, uv0, uv1, indices, material_index, targets=None, target_names=None):
        prim = {
            "attributes": {
                "POSITION": self.add_accessor_vec3f(positions),
            },
            "indices": self.add_accessor_indices(indices),
        }
        if material_index is not None:
            prim["material"] = material_index
        if uv0 is not None:
            prim["attributes"]["TEXCOORD_0"] = self.add_accessor_vec2f(uv0)
        if uv1 is not None:
            prim["attributes"]["TEXCOORD_1"] = self.add_accessor_vec2f(uv1)
        extras = {}
        if targets:
            prim["targets"] = [{"POSITION": self.add_accessor_vec3f(t)} for t in targets]
            extras["targetNames"] = target_names
        mesh = {"name": name, "primitives": [prim]}
        if extras:
            mesh["extras"] = extras
        self.meshes.append(mesh)
        return len(self.meshes) - 1

    def add_node(self, name, translation=(0.0, 0.0, 0.0), mesh=None, children=None, extras=None):
        node = {"name": name, "translation": list(translation)}
        if mesh is not None:
            node["mesh"] = mesh
        if children:
            node["children"] = children
        if extras:
            node["extras"] = extras
        self.nodes.append(node)
        idx = len(self.nodes) - 1
        self.node_by_name[name] = idx
        return idx

    def to_gltf_dict(self, root_node_indices):
        return {
            "asset": {"version": "2.0", "generator": "build_good_asset.py (synthetic fixture)"},
            "scene": 0,
            "scenes": [{"nodes": root_node_indices}],
            "nodes": self.nodes,
            "meshes": self.meshes,
            "materials": self.materials,
            "images": self.images,
            "textures": self.textures,
            "accessors": self.accessors,
            "bufferViews": self.bufferViews,
            "buffers": [{"byteLength": len(self.buf)}],
        }

    def write_glb(self, path, root_node_indices):
        gltf = self.to_gltf_dict(root_node_indices)
        json_bytes = json.dumps(gltf).encode("utf-8")
        while len(json_bytes) % 4 != 0:
            json_bytes += b" "
        bin_bytes = bytes(self.buf)
        while len(bin_bytes) % 4 != 0:
            bin_bytes += b"\x00"
        total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
        with open(path, "wb") as f:
            f.write(struct.pack("<4sII", b"glTF", 2, total_len))
            f.write(struct.pack("<I4s", len(json_bytes), b"JSON"))
            f.write(json_bytes)
            f.write(struct.pack("<I4s", len(bin_bytes), b"BIN\x00"))
            f.write(bin_bytes)


# ---------------------------------------------------------------------------
# Box / cylinder mesh generators with a non-overlapping per-part UV atlas cell.
# ---------------------------------------------------------------------------

# Cross/net unfold of a box's 6 faces into a 4x3 grid of unit cells (no overlap by
# construction): row0 col1=top, row1 col0..3=left/front/right/back, row2 col1=bottom.
_FACE_CELLS = {
    "top": (1, 0), "left": (0, 1), "front": (1, 1), "right": (2, 1), "back": (3, 1),
    "bottom": (1, 2),
}
_GRID_W, _GRID_H = 4, 3


def _cell_uv(face, u, v):
    cx, cy = _FACE_CELLS[face]
    return ((cx + u) / _GRID_W, (cy + v) / _GRID_H)


def box_mesh(lo, hi, atlas_cell):
    """lo/hi: (x,y,z) local-space min/max. atlas_cell: (x0,y0,w,h) in the shared [0,1]^2
    UV atlas this part is allocated. Returns (positions, uv0, uv1, indices)."""
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    cx0, cy0, cw, ch = atlas_cell
    faces = [
        # name, 4 corners (CCW as seen from outside), uv function per corner (u,v in [0,1] local)
        ("front", [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)]),
        ("back", [(x1, y0, z1), (x0, y0, z1), (x0, y1, z1), (x1, y1, z1)]),
        ("left", [(x0, y0, z1), (x0, y0, z0), (x0, y1, z0), (x0, y1, z1)]),
        ("right", [(x1, y0, z0), (x1, y0, z1), (x1, y1, z1), (x1, y1, z0)]),
        ("top", [(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)]),
        ("bottom", [(x0, y0, z1), (x1, y0, z1), (x1, y0, z0), (x0, y0, z0)]),
    ]
    face_uv_corners = [(0, 0), (1, 0), (1, 1), (0, 1)]
    positions, uvs, indices = [], [], []
    for face_name, corners in faces:
        base = len(positions)
        for (px, py, pz), (u, v) in zip(corners, face_uv_corners):
            positions.append((px, py, pz))
            lu, lv = _cell_uv(face_name, u, v)
            uvs.append((cx0 + lu * cw, cy0 + lv * ch))
        indices.extend([base, base + 1, base + 2, base, base + 2, base + 3])
    return positions, uvs, list(uvs), indices


def cylinder_mesh(axis_half_len, radius, atlas_cell, segments=10):
    """Cylinder with its axis along local X, centered at the origin. Side surface gets a
    real (non-degenerate) strip unwrap within the cell; cap triangles are collapsed onto a
    single UV point (zero UV area) since they are a tiny fraction of the wheel's silhouette
    and this keeps them from being a second, differently-shaped island to unwrap by hand."""
    cx0, cy0, cw, ch = atlas_cell
    positions, uvs, indices = [], [], []
    ring_neg = []
    ring_pos = []
    for i in range(segments):
        theta = 2 * math.pi * i / segments
        y, z = radius * math.cos(theta), radius * math.sin(theta)
        ring_neg.append((-axis_half_len, y, z))
        ring_pos.append((axis_half_len, y, z))
    # Side strip: two triangles per segment, u = around, v = 0/1 along axis.
    base = len(positions)
    for i in range(segments):
        u0 = i / segments
        u1 = (i + 1) / segments
        positions.extend([ring_neg[i], ring_pos[i], ring_pos[(i + 1) % segments], ring_neg[(i + 1) % segments]])
        uvs.extend([(cx0 + u0 * cw, cy0 + 0.15 * ch), (cx0 + u0 * cw, cy0 + 0.85 * ch),
                    (cx0 + u1 * cw, cy0 + 0.85 * ch), (cx0 + u1 * cw, cy0 + 0.15 * ch)])
        b = base + i * 4
        indices.extend([b, b + 1, b + 2, b, b + 2, b + 3])
    # Caps: fan triangles, all UVs collapsed to one point (degenerate UV area, skipped by
    # the overlap rasterizer, harmless for uv.bounds).
    cap_uv = (cx0 + 0.001 * cw, cy0 + 0.001 * ch)
    for ring, sign in ((ring_neg, -1), (ring_pos, 1)):
        center = (sign * axis_half_len, 0.0, 0.0)
        cbase = len(positions)
        positions.append(center)
        uvs.append(cap_uv)
        for p in ring:
            positions.append(p)
            uvs.append(cap_uv)
        for i in range(segments):
            a = cbase + 1 + i
            b = cbase + 1 + (i + 1) % segments
            if sign < 0:
                indices.extend([cbase, b, a])
            else:
                indices.extend([cbase, a, b])
    return positions, uvs, list(uvs), indices


def fix_convex_winding(positions, indices):
    """Flip any triangle whose face normal points away from the shape's centroid, so every
    face of a genuinely convex mesh ends up consistently outward-facing. Building a prism's
    side/cap triangles by hand is easy to get backwards on one face; a convexity checker that
    (correctly) does not assume orientation will flag that face's misdirected normal as if
    the whole shape were non-convex, so this keeps the two independent concerns separate."""
    cx_, cy_, cz_ = (sum(p[i] for p in positions) / len(positions) for i in range(3))
    centroid = (cx_, cy_, cz_)
    fixed = []
    for t in range(0, len(indices), 3):
        ia, ib, ic = indices[t], indices[t + 1], indices[t + 2]
        a, b, c = positions[ia], positions[ib], positions[ic]
        u = tuple(b[k] - a[k] for k in range(3))
        v = tuple(c[k] - a[k] for k in range(3))
        n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        d = sum(n[k] * a[k] for k in range(3))
        side = sum(n[k] * centroid[k] for k in range(3)) - d
        if side > 0:
            fixed.extend([ia, ic, ib])
        else:
            fixed.extend([ia, ib, ic])
    return fixed


def octagon_prism_points(cx, cz, rx, rz, y0, y1):
    pts = []
    for lvl in (y0, y1):
        for i in range(8):
            theta = 2 * math.pi * i / 8
            pts.append((cx + rx * math.cos(theta), lvl, cz + rz * math.sin(theta)))
    return pts


def octagon_prism_mesh(cx, cz, rx, rz, y0, y1):
    """Convex octagonal prism, no material (collider-only shape)."""
    positions = octagon_prism_points(cx, cz, rx, rz, y0, y1)
    indices = []
    # side quads
    for i in range(8):
        j = (i + 1) % 8
        a, b = i, j
        c, d = i + 8, j + 8
        indices.extend([a, b, d, a, d, c])
    # caps (fans)
    for i in range(1, 7):
        indices.extend([0, i, i + 1])
        indices.extend([8, 8 + i + 1, 8 + i])
    return positions, fix_convex_winding(positions, indices)


def box_points(lo, hi):
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    return [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]


def box_collider_indices():
    # 8 verts ordered by itertools.product(x,y,z) as in box_points: index = x*4+y*2+z
    def idx(x, y, z):
        return x * 4 + y * 2 + z
    faces = [
        [idx(0, 0, 0), idx(0, 0, 1), idx(0, 1, 1), idx(0, 1, 0)],  # x=0
        [idx(1, 0, 1), idx(1, 0, 0), idx(1, 1, 0), idx(1, 1, 1)],  # x=1
        [idx(0, 0, 0), idx(1, 0, 0), idx(1, 0, 1), idx(0, 0, 1)],  # y=0
        [idx(0, 1, 1), idx(1, 1, 1), idx(1, 1, 0), idx(0, 1, 0)],  # y=1
        [idx(0, 1, 0), idx(1, 1, 0), idx(1, 0, 0), idx(0, 0, 0)],  # z=0
        [idx(0, 0, 1), idx(1, 0, 1), idx(1, 1, 1), idx(0, 1, 1)],  # z=1
    ]
    indices = []
    for f in faces:
        indices.extend([f[0], f[1], f[2], f[0], f[2], f[3]])
    return indices


# ---------------------------------------------------------------------------
# Vehicle spec: every part's world translation + local box extents + joint/mass metadata.
# ---------------------------------------------------------------------------

WHEEL_R = 0.35
WHEEL_HALF_W = 0.12

PART_ORDER = [
    "chassis", "bonnet", "boot", "door_L", "door_R", "door_rear_L", "door_rear_R",
    "bumper_front", "bumper_rear", "glass", "light_head_L", "light_head_R",
    "light_brake_L", "light_brake_R", "mirror_L", "mirror_R",
    "wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR",
    "susp_FL", "susp_FR", "susp_RL", "susp_RR",
]

NON_CHASSIS_MASS_FRACTIONS = {
    "bonnet": 0.05, "boot": 0.05, "door_L": 0.05, "door_R": 0.05,
    "door_rear_L": 0.04, "door_rear_R": 0.04, "bumper_front": 0.03, "bumper_rear": 0.03,
    "glass": 0.04, "light_head_L": 0.005, "light_head_R": 0.005,
    "light_brake_L": 0.005, "light_brake_R": 0.005, "mirror_L": 0.005, "mirror_R": 0.005,
    "wheel_FL": 0.03, "wheel_FR": 0.03, "wheel_RL": 0.03, "wheel_RR": 0.03,
    "susp_FL": 0.01, "susp_FR": 0.01, "susp_RL": 0.01, "susp_RR": 0.01,
}
CHASSIS_MASS_FRACTION = round(1.0 - sum(NON_CHASSIS_MASS_FRACTIONS.values()), 6)

WHEEL_WORLD = {
    "wheel_FL": (-0.95, WHEEL_R, -1.25), "wheel_FR": (0.95, WHEEL_R, -1.25),
    "wheel_RL": (-0.95, WHEEL_R, 1.25), "wheel_RR": (0.95, WHEEL_R, 1.25),
}
SUSP_WORLD = {
    "susp_FL": (-0.95, 0.75, -1.25), "susp_FR": (0.95, 0.75, -1.25),
    "susp_RL": (-0.95, 0.75, 1.25), "susp_RR": (0.95, 0.75, 1.25),
}

HINGE_PANELS = {
    # part: (world_translation, local_lo, local_hi) -- origin sits on a face (see local_lo/hi).
    "bonnet": ((0.0, 0.55, -0.5), (-0.85, -0.02, -1.5), (0.85, 0.15, 0.0)),
    "boot": ((0.0, 0.55, 0.5), (-0.85, -0.02, 0.0), (0.85, 0.15, 1.5)),
    "door_L": ((-1.0, 0.4, -0.35), (-0.05, -0.35, 0.0), (0.05, 0.35, 0.7)),
    "door_R": ((1.0, 0.4, -0.35), (-0.05, -0.35, 0.0), (0.05, 0.35, 0.7)),
    "door_rear_L": ((-1.0, 0.4, 0.35), (-0.05, -0.35, 0.0), (0.05, 0.35, 0.7)),
    "door_rear_R": ((1.0, 0.4, 0.35), (-0.05, -0.35, 0.0), (0.05, 0.35, 0.7)),
}

FIXED_PANELS = {
    # part: (world_translation, half_extents)
    "bumper_front": ((0.0, 0.25, -2.05), (1.0, 0.1, 0.08)),
    "bumper_rear": ((0.0, 0.25, 2.05), (1.0, 0.1, 0.08)),
    "glass": ((0.0, 0.75, 0.1), (0.6, 0.2, 0.5)),
    "light_head_L": ((-0.7, 0.3, -2.08), (0.08, 0.08, 0.08)),
    "light_head_R": ((0.7, 0.3, -2.08), (0.08, 0.08, 0.08)),
    "light_brake_L": ((-0.7, 0.3, 2.08), (0.08, 0.08, 0.08)),
    "light_brake_R": ((0.7, 0.3, 2.08), (0.08, 0.08, 0.08)),
}
MIRROR_LOCAL = {  # child of door_L / door_R
    "mirror_L": ((0.15, 0.25, -0.05), (0.05, 0.05, 0.05)),
    "mirror_R": ((0.15, 0.25, -0.05), (0.05, 0.05, 0.05)),
}
MIRROR_PARENT = {"mirror_L": "door_L", "mirror_R": "door_R"}

CHASSIS_LOWER_BODY = ((-1.0, 0.0, -2.1), (1.0, 0.55, 2.1))
CHASSIS_CABIN = ((-0.65, 0.55, -0.5), (0.65, 1.25, 0.75))
COL_CHASSIS_BOX = ((-0.95, 0.02, -2.05), (0.95, 0.5, 2.05))  # subset of lower body
COL_CABIN_OCTAGON = dict(cx=0.0, cz=0.1, rx=0.55, rz=0.55, y0=0.56, y1=1.2)  # subset of cabin

DENT_TARGETS = {
    "chassis": ["chassis_dent_FL", "chassis_dent_FR", "chassis_dent_RL", "chassis_dent_RR",
                "chassis_dent_roof"],
    "bonnet": ["bonnet_dent"], "boot": ["boot_dent"],
    "door_L": ["door_L_dent"], "door_R": ["door_R_dent"],
    "door_rear_L": ["door_rear_L_dent"], "door_rear_R": ["door_rear_R_dent"],
    "bumper_front": ["bumper_front_dent"], "bumper_rear": ["bumper_rear_dent"],
}

JOINTS = {
    "chassis": {"jj_joint": "fixed"},
    "bonnet": {"jj_joint": "hinge", "jj_axis": [0, 0, 1], "jj_range_deg": 60},
    "boot": {"jj_joint": "hinge", "jj_axis": [0, 0, 1], "jj_range_deg": 60},
    "door_L": {"jj_joint": "hinge", "jj_axis": [0, 1, 0], "jj_range_deg": 70},
    "door_R": {"jj_joint": "hinge", "jj_axis": [0, 1, 0], "jj_range_deg": 70},
    "door_rear_L": {"jj_joint": "hinge", "jj_axis": [0, 1, 0], "jj_range_deg": 70},
    "door_rear_R": {"jj_joint": "hinge", "jj_axis": [0, 1, 0], "jj_range_deg": 70},
    "bumper_front": {"jj_joint": "fixed"}, "bumper_rear": {"jj_joint": "fixed"},
    "glass": {"jj_joint": "fixed"},
    "light_head_L": {"jj_joint": "fixed"}, "light_head_R": {"jj_joint": "fixed"},
    "light_brake_L": {"jj_joint": "fixed"}, "light_brake_R": {"jj_joint": "fixed"},
    "mirror_L": {"jj_joint": "fixed"}, "mirror_R": {"jj_joint": "fixed"},
    "wheel_FL": {"jj_joint": "compound", "jj_axis_steer": [0, 1, 0], "jj_range_steer_deg": 32,
                "jj_axis_spin": [1, 0, 0]},
    "wheel_FR": {"jj_joint": "compound", "jj_axis_steer": [0, 1, 0], "jj_range_steer_deg": 32,
                "jj_axis_spin": [1, 0, 0]},
    "wheel_RL": {"jj_joint": "spin", "jj_axis": [1, 0, 0], "jj_range_deg": 360},
    "wheel_RR": {"jj_joint": "spin", "jj_axis": [1, 0, 0], "jj_range_deg": 360},
    "susp_FL": {"jj_joint": "suspension", "jj_axis": [0, 1, 0], "jj_range_deg": 0.1},
    "susp_FR": {"jj_joint": "suspension", "jj_axis": [0, 1, 0], "jj_range_deg": 0.1},
    "susp_RL": {"jj_joint": "suspension", "jj_axis": [0, 1, 0], "jj_range_deg": 0.1},
    "susp_RR": {"jj_joint": "suspension", "jj_axis": [0, 1, 0], "jj_range_deg": 0.1},
}

DETACHABLE = {"bonnet", "boot", "door_L", "door_R", "door_rear_L", "door_rear_R",
              "bumper_front", "bumper_rear"}

PART_MATERIAL = {
    "chassis": "jj_paint", "bonnet": "jj_paint", "boot": "jj_paint",
    "door_L": "jj_paint", "door_R": "jj_paint", "door_rear_L": "jj_paint", "door_rear_R": "jj_paint",
    "bumper_front": "jj_plastic", "bumper_rear": "jj_plastic", "glass": "jj_glass",
    "light_head_L": "jj_headlight", "light_head_R": "jj_headlight",
    "light_brake_L": "jj_brakelight", "light_brake_R": "jj_brakelight",
    "mirror_L": "jj_plastic", "mirror_R": "jj_plastic",
    "wheel_FL": "jj_tyre", "wheel_FR": "jj_tyre", "wheel_RL": "jj_tyre", "wheel_RR": "jj_tyre",
    "susp_FL": "jj_metal", "susp_FR": "jj_metal", "susp_RL": "jj_metal", "susp_RR": "jj_metal",
}


def build_atlas_cells():
    n = len(PART_ORDER)
    grid = math.ceil(math.sqrt(n))
    cell = 1.0 / grid
    cells = {}
    for i, part in enumerate(PART_ORDER):
        row, col = divmod(i, grid)
        cells[part] = (col * cell, row * cell, cell, cell)
    return cells


def make_mask_png(size, seed):
    """RGBA mask with real (non-zero) content in every channel."""
    im = Image.new("RGBA", (size, size))
    px = im.load()
    for y in range(size):
        for x in range(size):
            r = 200
            g = 40 + ((x + seed) * 7) % 180
            b = 40 + ((y + seed) * 11) % 180
            a = 30 + ((x + y + seed) * 5) % 200
            px[x, y] = (r, g, b, a)
    return im


def build_lod(out_path, lod_number, mask_size):
    b = GltfBuilder()
    cells = build_atlas_cells()

    mask_img = make_mask_png(mask_size, seed=lod_number * 17 + 3)
    mask_img_idx = b.add_image_png(mask_img)
    mask_tex_idx = b.add_texture(mask_img_idx)

    mat_idx = {}
    mat_idx["jj_paint"] = b.add_material("jj_paint", "paint", base_color_texture=mask_tex_idx)
    mat_idx["jj_plastic"] = b.add_material("jj_plastic", "plastic", base_color=(0.1, 0.1, 0.1, 1))
    mat_idx["jj_glass"] = b.add_material("jj_glass", "glass", base_color=(0.6, 0.8, 0.9, 0.4))
    mat_idx["jj_headlight"] = b.add_material("jj_headlight", "headlight", base_color=(1, 1, 0.9, 1),
                                              emissive=(1.0, 1.0, 0.8), emissive_strength=3.0)
    mat_idx["jj_brakelight"] = b.add_material("jj_brakelight", "brakelight", base_color=(0.8, 0, 0, 1),
                                               emissive=(1.0, 0.0, 0.0), emissive_strength=3.0)
    mat_idx["jj_tyre"] = b.add_material("jj_tyre", "tyre", base_color=(0.05, 0.05, 0.05, 1))
    mat_idx["jj_metal"] = b.add_material("jj_metal", "metal", base_color=(0.5, 0.5, 0.55, 1))

    node_of = {}

    def add_part_box(part, translation, lo, hi, targets=None, target_names=None):
        pos, uv0, uv1, idx = box_mesh(lo, hi, cells[part])
        for tname in (target_names or []):
            pass
        target_deltas = None
        if targets:
            target_deltas = targets
        mesh_idx = b.add_mesh(part, pos, uv0, uv1, idx, mat_idx[PART_MATERIAL[part]],
                              targets=target_deltas, target_names=target_names)
        extras = {"jj_part": part, "jj_mass_fraction": NON_CHASSIS_MASS_FRACTIONS.get(part, CHASSIS_MASS_FRACTION)}
        extras.update(JOINTS[part])
        extras["jj_attach"] = "chassis"
        if part in DETACHABLE:
            extras["jj_detachable"] = True
        if part in DENT_TARGETS:
            extras["jj_dent"] = DENT_TARGETS[part]
        collider_name = f"col_{part}" if part not in ("chassis",) else None
        if collider_name:
            extras["jj_collider"] = collider_name
        n = b.add_node(part, translation=translation, mesh=mesh_idx, extras=extras)
        node_of[part] = n
        return n

    def make_dent_targets(positions, part):
        names = DENT_TARGETS.get(part, [])
        targets = []
        for i, _name in enumerate(names):
            deltas = [(0.0, 0.0, 0.0)] * len(positions)
            # Displace one vertex inward-ish by a fixed, in-budget amount (0.05m).
            vi = i % len(positions)
            deltas[vi] = (0.02, -0.03, 0.02)  # length ~= 0.0424, within [0.01, 0.25]
            targets.append(deltas)
        return targets, names

    # --- chassis (root): lower body + cabin combined in one visual mesh. They are two
    # distinct regions of the SAME atlas cell that must not share UV space, so split the
    # cell into left/right halves (each box's own cross-unwrap stays non-overlapping within
    # its half).
    ccx, ccy, ccw, cch = cells["chassis"]
    lower_cell = (ccx, ccy, ccw / 2, cch)
    cabin_cell = (ccx + ccw / 2, ccy, ccw / 2, cch)
    lower_pos, lower_uv0, lower_uv1, lower_idx = box_mesh(*CHASSIS_LOWER_BODY, lower_cell)
    cabin_pos, cabin_uv0, cabin_uv1, cabin_idx = box_mesh(*CHASSIS_CABIN, cabin_cell)
    off = len(lower_pos)
    chassis_pos = lower_pos + cabin_pos
    chassis_uv0 = lower_uv0 + cabin_uv0
    chassis_uv1 = lower_uv1 + cabin_uv1
    chassis_idx = lower_idx + [i + off for i in cabin_idx]
    dent_targets, dent_names = make_dent_targets(chassis_pos, "chassis")
    chassis_mesh = b.add_mesh("chassis", chassis_pos, chassis_uv0, chassis_uv1, chassis_idx,
                              mat_idx["jj_paint"], targets=dent_targets, target_names=dent_names)
    chassis_extras = {"jj_part": "chassis", "jj_mass_fraction": CHASSIS_MASS_FRACTION,
                       "jj_dent": dent_names}
    chassis_extras.update(JOINTS["chassis"])
    chassis_node = b.add_node("chassis", translation=(0, 0, 0), mesh=chassis_mesh, extras=chassis_extras)
    node_of["chassis"] = chassis_node

    # --- hinge panels (bonnet/boot/doors)
    for part, (t, lo, hi) in HINGE_PANELS.items():
        targets, names = make_dent_targets(box_mesh(lo, hi, cells[part])[0], part)
        add_part_box(part, t, lo, hi, targets=targets, target_names=names)

    # --- fixed panels (bumpers/glass/lights)
    for part, (t, he) in FIXED_PANELS.items():
        lo = tuple(-h for h in he)
        hi = tuple(h for h in he)
        if part in DENT_TARGETS:
            targets, names = make_dent_targets(box_mesh(lo, hi, cells[part])[0], part)
        else:
            targets, names = None, None
        add_part_box(part, t, lo, hi, targets=targets, target_names=names)

    # --- wheels (cylinders, axis = local X)
    for wname, wt in WHEEL_WORLD.items():
        pos, uv0, uv1, idx = cylinder_mesh(WHEEL_HALF_W, WHEEL_R, cells[wname])
        mesh_idx = b.add_mesh(wname, pos, uv0, uv1, idx, mat_idx["jj_tyre"])
        extras = {"jj_part": wname, "jj_mass_fraction": NON_CHASSIS_MASS_FRACTIONS[wname],
                  "jj_attach": "chassis", "jj_collider": f"col_{wname}"}
        extras.update(JOINTS[wname])
        n = b.add_node(wname, translation=wt, mesh=mesh_idx, extras=extras)
        node_of[wname] = n

    # --- suspension struts (small fixed boxes, no collider)
    for sname, st in SUSP_WORLD.items():
        he = (0.05, 0.25, 0.05)
        lo, hi = tuple(-h for h in he), tuple(h for h in he)
        pos, uv0, uv1, idx = box_mesh(lo, hi, cells[sname])
        mesh_idx = b.add_mesh(sname, pos, uv0, uv1, idx, mat_idx["jj_metal"])
        extras = {"jj_part": sname, "jj_mass_fraction": NON_CHASSIS_MASS_FRACTIONS[sname],
                  "jj_attach": "chassis"}
        extras.update(JOINTS[sname])
        n = b.add_node(sname, translation=st, mesh=mesh_idx, extras=extras)
        node_of[sname] = n

    # --- mirrors (children of front doors)
    mirror_children = {"door_L": [], "door_R": []}
    for mname, (mt, mhe) in MIRROR_LOCAL.items():
        lo, hi = tuple(-h for h in mhe), tuple(h for h in mhe)
        pos, uv0, uv1, idx = box_mesh(lo, hi, cells[mname])
        mesh_idx = b.add_mesh(mname, pos, uv0, uv1, idx, mat_idx["jj_plastic"])
        extras = {"jj_part": mname, "jj_mass_fraction": NON_CHASSIS_MASS_FRACTIONS[mname],
                  "jj_attach": MIRROR_PARENT[mname]}
        extras.update(JOINTS[mname])
        n = b.add_node(mname, translation=mt, mesh=mesh_idx, extras=extras)
        node_of[mname] = n
        mirror_children[MIRROR_PARENT[mname]].append(n)
    for door, kids in mirror_children.items():
        b.nodes[node_of[door]].setdefault("children", []).extend(kids)

    # --- trims (no mesh, jj_part_of only)
    trim_bft = b.add_node("bumper_front_trim", translation=(0, 0, 0),
                           extras={"jj_part_of": "bumper_front"})
    trim_boot = b.add_node("boot_trim", translation=(0, 0, 0), extras={"jj_part_of": "boot"})
    b.nodes[node_of["bumper_front"]].setdefault("children", []).append(trim_bft)
    b.nodes[node_of["boot"]].setdefault("children", []).append(trim_boot)

    # --- colliders (no material)
    def add_collider_box(name, parent, lo, hi):
        pos = box_points(lo, hi)
        idx = box_collider_indices()
        mesh_idx = b.add_mesh(name, pos, None, None, idx, None)
        extras = {"jj_collider": {"shape": "box", "part": parent}}
        n = b.add_node(name, translation=(0, 0, 0), mesh=mesh_idx, extras=extras)
        b.nodes[node_of[parent]].setdefault("children", []).append(n)
        return n

    add_collider_box("col_chassis", "chassis", *COL_CHASSIS_BOX)

    cab = COL_CABIN_OCTAGON
    cabin_pts = octagon_prism_points(cab["cx"], cab["cz"], cab["rx"], cab["rz"], cab["y0"], cab["y1"])
    cabin_idx2 = octagon_prism_mesh(**cab)[1]
    cabin_mesh_idx = b.add_mesh("col_cabin", cabin_pts, None, None, cabin_idx2, None)
    col_cabin_node = b.add_node("col_cabin", translation=(0, 0, 0), mesh=cabin_mesh_idx,
                                 extras={"jj_collider": {"shape": "hull", "part": "cabin"}})
    b.nodes[node_of["chassis"]].setdefault("children", []).append(col_cabin_node)

    for part, (t, lo, hi) in HINGE_PANELS.items():
        add_collider_box(f"col_{part}", part, lo, hi)
    for part, (t, he) in FIXED_PANELS.items():
        if part not in ("bumper_front", "bumper_rear"):
            continue
        lo = tuple(-h for h in he)
        hi = tuple(h for h in he)
        add_collider_box(f"col_{part}", part, lo, hi)
    for wname in WHEEL_WORLD:
        pos, _, _, idx = cylinder_mesh(WHEEL_HALF_W, WHEEL_R, (0, 0, 0.01, 0.01), segments=10)
        mesh_idx = b.add_mesh(f"col_{wname}", pos, None, None, idx, None)
        n = b.add_node(f"col_{wname}", translation=(0, 0, 0), mesh=mesh_idx,
                       extras={"jj_collider": {"shape": "cylinder", "part": wname}})
        b.nodes[node_of[wname]].setdefault("children", []).append(n)

    # --- anchors (empty nodes, children of chassis). Positions for lplate_front/rear are
    # computed AFTER all geometry exists, from the true world-space front/rear extremes.
    anchor_children = []
    anchor_world = {}
    for name, t in (("cam_fp", (0.0, 0.9, -0.3)), ("cam_tp_target", (0.0, 0.6, 0.3)),
                    ("com", (0.0, 0.5, 0.0)), ("exhaust_0", (0.3, 0.2, 2.1)),
                    ("roof_number", (0.0, 1.3, 0.1))):
        n = b.add_node(name, translation=t)
        anchor_children.append(n)
        anchor_world[name] = t

    world_by_node = _compute_world_translations(b)
    min_z, max_z = _visual_z_extent(b, world_by_node)
    lplate_front_t = (0.0, 0.25, min_z + 0.02)
    lplate_rear_t = (0.0, 0.25, max_z - 0.02)
    n_lf = b.add_node("lplate_front", translation=lplate_front_t)
    n_lr = b.add_node("lplate_rear", translation=lplate_rear_t)
    anchor_children.extend([n_lf, n_lr])
    anchor_world["lplate_front"] = lplate_front_t
    anchor_world["lplate_rear"] = lplate_rear_t
    b.nodes[node_of["chassis"]].setdefault("children", []).extend(anchor_children)

    root_indices = [node_of["chassis"]]
    b.write_glb(out_path, root_indices)

    triangle_count = 0
    for n in b.nodes:
        name = n.get("name", "")
        if "mesh" not in n or name.startswith("col_"):
            continue  # validator's budget.triangles counts visual primitives only
        for prim in b.meshes[n["mesh"]]["primitives"]:
            triangle_count += b.accessors[prim["indices"]]["count"] // 3
    return anchor_world, triangle_count, mask_img.size


def _compute_world_translations(b):
    """Only valid before any rotation/scale is used anywhere (true for this synthetic
    fixture): world translation = sum of ancestor translations."""
    parent_of = {}
    for i, n in enumerate(b.nodes):
        for c in n.get("children", []):
            parent_of[c] = i
    world = {}

    def resolve(i):
        if i in world:
            return world[i]
        t = b.nodes[i].get("translation", [0, 0, 0])
        if i in parent_of:
            pt = resolve(parent_of[i])
            w = tuple(pt[k] + t[k] for k in range(3))
        else:
            w = tuple(t)
        world[i] = w
        return w

    for i in range(len(b.nodes)):
        resolve(i)
    return world


def _visual_z_extent(b, world_by_node):
    """True min/max world Z across every visual (non-collider) mesh's vertices, using the
    accessor min/max already stamped onto each POSITION accessor plus the node's world
    translation (valid since no rotation/scale is used anywhere in this fixture)."""
    zs = []
    for i, n in enumerate(b.nodes):
        name = n.get("name", "")
        if "mesh" not in n or name.startswith("col_"):
            continue
        mesh = b.meshes[n["mesh"]]
        wt = world_by_node[i]
        for prim in mesh["primitives"]:
            acc = b.accessors[prim["attributes"]["POSITION"]]
            zs.append(acc["min"][2] + wt[2])
            zs.append(acc["max"][2] + wt[2])
    return min(zs), max(zs)


def build_sidecar(lod_entries, anchor_world):
    parts = {}
    for part in PART_ORDER:
        mf = NON_CHASSIS_MASS_FRACTIONS.get(part, CHASSIS_MASS_FRACTION)
        entry = {"node": part, "mass_fraction": mf, "joint": JOINTS[part]["jj_joint"],
                 "attach": "chassis", "detachable": part in DETACHABLE,
                 "dents": DENT_TARGETS.get(part, [])}
        if part == "chassis":
            entry["collider"] = ["col_chassis", "col_cabin"]
        elif part in WHEEL_WORLD:
            entry["collider"] = f"col_{part}"
        elif part in HINGE_PANELS or part in ("bumper_front", "bumper_rear"):
            entry["collider"] = f"col_{part}"
        parts[part] = entry

    wheels = {}
    for wid in ("FL", "FR", "RL", "RR"):
        wname = f"wheel_{wid}"
        wheels[wid] = {"hub_node": wname, "hub": list(WHEEL_WORLD[wname]), "radius": WHEEL_R,
                       "width": WHEEL_HALF_W * 2, "steer": wid in ("FL", "FR"), "driven": True}

    sidecar = {
        "contract": "jj.vehicle.v0.2-synthetic-fixture",
        "asset_id": "cruz-missile-synthetic-good",
        "archetype": "sedan",
        "display_name": "Synthetic conformance fixture",
        "space": "gltf", "units": "m", "origin": "ground-between-axles",
        "lods": lod_entries,
        "parts": parts,
        "wheels": wheels,
        "physics": {"mass_kg": 1200, "com": [0, 0.5, 0], "profile": "balanced"},
        "anchors": {name: list(pos) for name, pos in anchor_world.items()},
        "materials": {name: sem for name, sem in
                      [("jj_paint", "paint"), ("jj_plastic", "plastic"), ("jj_glass", "glass"),
                       ("jj_headlight", "headlight"), ("jj_brakelight", "brakelight"),
                       ("jj_tyre", "tyre"), ("jj_metal", "metal")]},
        "textures": {"mask": {"channels": {"r": "paint", "g": "pattern", "b": "dirt", "a": "emissive"},
                              "per_lod_px": {str(e["lod"]): e["mask_px"] for e in lod_entries}}},
        "identity": {"roof_number_anchor": "roof_number", "roof_number_size_m": 0.3,
                     "paint_semantic": "paint", "pattern_channel": "g"},
    }
    return sidecar


def main(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    lod_entries = []
    anchor_world = None
    for lod_number, mask_size in ((0, 32), (1, 16), (2, 8)):
        fname = f"good.lod{lod_number}.glb"
        anchors, tris, mask_dim = build_lod(os.path.join(out_dir, fname), lod_number, mask_size)
        anchor_world = anchors  # identical across LODs in this synthetic fixture
        lod_entries.append({"lod": lod_number, "file": fname, "triangles": tris,
                            "materials": 7, "draw_calls": 7, "mask_px": list(mask_dim),
                            "role": {0: "close", 1: "medium", 2: "distant"}[lod_number]})
    sidecar = build_sidecar(lod_entries, anchor_world)
    sidecar_path = os.path.join(out_dir, "good.asset.json")
    with open(sidecar_path, "w") as f:
        json.dump(sidecar, f, indent=2)
    print(f"wrote {sidecar_path} and {len(lod_entries)} LOD GLBs to {out_dir}")
    for e in lod_entries:
        print(f"  lod{e['lod']}: {e['file']}  triangles={e['triangles']}  mask_px={e['mask_px']}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
