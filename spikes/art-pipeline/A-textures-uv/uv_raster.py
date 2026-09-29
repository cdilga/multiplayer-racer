"""Shared pure-stdlib UV-space triangle rasterization, used by both compose_mask.py (to transfer
UV1 bakes into UV0 atlas space and to draw procedural mask channels) and validate_textures.py (to
detect overlapping UV0 islands). No numpy (system python has none); PIL is used only by callers for
image I/O, not by this module.

UV convention: the UV coords this module consumes come straight out of a GLB's TEXCOORD_n accessors
(via read_accessor/mesh_triangles below), which are already glTF-convention: (0,0) at the TOP-LEFT of
the image -- Blender's own mesh.uv_layers are bottom-origin, but Blender's glTF exporter flips V on
write, so by the time data reaches here it matches PIL's row-major (0,0)=top-left directly. No extra
flip here. (Earlier draft of this module flipped again, which double-flipped real per-triangle UVs
read from a GLB relative to any Blender-native rect math done before export -- see REPORT.md.)
"""
import struct


def uv_to_px(u, v, res):
    return u * res, v * res


def edge(ax, ay, bx, by, px, py):
    return (bx - ax) * (py - ay) - (by - ay) * (px - ax)


def rasterize_triangle(uv_a, uv_b, uv_c, res):
    """Yield (x, y, bary_a, bary_b, bary_c) for every pixel CENTER inside the triangle formed by
    the three UV coords, mapped to a res x res pixel grid (top-left origin, v flipped)."""
    ax, ay = uv_to_px(*uv_a, res)
    bx, by = uv_to_px(*uv_b, res)
    cx, cy = uv_to_px(*uv_c, res)
    area = edge(ax, ay, bx, by, cx, cy)
    if abs(area) < 1e-9:
        return
    minx = max(int(min(ax, bx, cx)), 0)
    maxx = min(int(max(ax, bx, cx)) + 1, res - 1)
    miny = max(int(min(ay, by, cy)), 0)
    maxy = min(int(max(ay, by, cy)) + 1, res - 1)
    inv_area = 1.0 / area
    for y in range(miny, maxy + 1):
        py = y + 0.5
        for x in range(minx, maxx + 1):
            px = x + 0.5
            w0 = edge(bx, by, cx, cy, px, py) * inv_area
            w1 = edge(cx, cy, ax, ay, px, py) * inv_area
            w2 = edge(ax, ay, bx, by, px, py) * inv_area
            if w0 >= -1e-6 and w1 >= -1e-6 and w2 >= -1e-6:
                yield x, y, w0, w1, w2


def load_glb(path):
    """Parse a GLB into (json_dict, bin_bytes)."""
    data = open(path, "rb").read()
    magic, ver, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF", "not a GLB"
    off = 12
    json_chunk = bin_chunk = None
    while off < length:
        clen, ctype = struct.unpack_from("<I4s", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == b"JSON":
            json_chunk = chunk
        elif ctype == b"BIN\x00":
            bin_chunk = chunk
        off += 8 + clen
    import json as _json
    return _json.loads(json_chunk), bin_chunk


_COMP_TYPES = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
_TYPE_COUNTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_accessor(gltf, bin_bytes, accessor_index):
    """Return a flat list of tuples, one per element, decoding an accessor's raw buffer data
    (no interleaving support beyond byteStride; covers the simple exporter output we use)."""
    acc = gltf["accessors"][accessor_index]
    bv = gltf["bufferViews"][acc["bufferView"]]
    comp_fmt, comp_size = _COMP_TYPES[acc["componentType"]]
    ncomp = _TYPE_COUNTS[acc["type"]]
    count = acc["count"]
    stride = bv.get("byteStride") or (comp_size * ncomp)
    base = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    out = []
    fmt = "<" + comp_fmt * ncomp
    elem_bytes = comp_size * ncomp
    for i in range(count):
        off = base + i * stride
        raw = bin_bytes[off: off + elem_bytes]
        vals = struct.unpack(fmt, raw)
        if acc.get("normalized") and comp_fmt in ("B", "H"):
            maxv = 255.0 if comp_fmt == "B" else 65535.0
            vals = tuple(v / maxv for v in vals)
        out.append(vals)
    return out


def mesh_triangles(gltf, bin_bytes, mesh_index, prim_index=0):
    """Return (positions, uv0, uv1_or_None, indices_as_triples, material_index)."""
    prim = gltf["meshes"][mesh_index]["primitives"][prim_index]
    attrs = prim["attributes"]
    pos = read_accessor(gltf, bin_bytes, attrs["POSITION"]) if "POSITION" in attrs else None
    uv0 = read_accessor(gltf, bin_bytes, attrs["TEXCOORD_0"]) if "TEXCOORD_0" in attrs else None
    uv1 = read_accessor(gltf, bin_bytes, attrs["TEXCOORD_1"]) if "TEXCOORD_1" in attrs else None
    idx_flat = [v[0] for v in read_accessor(gltf, bin_bytes, prim["indices"])] if "indices" in prim else list(range(len(pos)))
    tris = [tuple(idx_flat[i:i + 3]) for i in range(0, len(idx_flat) - 2, 3)]
    return pos, uv0, uv1, tris, prim.get("material")
