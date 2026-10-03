//! A minimal binary-glTF (GLB 2.0) reader: the scene graph, node transforms, mesh primitives, materials, and the
//! position and index data the contracts check. Just what validation needs; no images, no extensions, no I/O.

use std::collections::BTreeMap;

use serde::Deserialize;

const MAGIC: u32 = 0x4654_6C67; // "glTF"
const CHUNK_JSON: u32 = 0x4E4F_534A;
const CHUNK_BIN: u32 = 0x004E_4942;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub children: Vec<usize>,
    #[serde(default)]
    pub mesh: Option<usize>,
    #[serde(default)]
    pub translation: Option<[f64; 3]>,
    #[serde(default)]
    pub rotation: Option<[f64; 4]>,
    #[serde(default)]
    pub scale: Option<[f64; 3]>,
    #[serde(default)]
    pub matrix: Option<[f64; 16]>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Primitive {
    #[serde(default)]
    pub attributes: BTreeMap<String, usize>,
    #[serde(default)]
    pub indices: Option<usize>,
    #[serde(default)]
    pub material: Option<usize>,
    #[serde(default)]
    pub mode: Option<u32>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Mesh {
    #[serde(default)]
    pub primitives: Vec<Primitive>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Accessor {
    #[serde(default)]
    buffer_view: Option<usize>,
    #[serde(default)]
    byte_offset: usize,
    component_type: u32,
    count: usize,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BufferView {
    #[serde(default)]
    byte_offset: usize,
    byte_length: usize,
    #[serde(default)]
    byte_stride: Option<usize>,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct Scene {
    #[serde(default)]
    nodes: Vec<usize>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Doc {
    #[serde(default)]
    nodes: Vec<Node>,
    #[serde(default)]
    meshes: Vec<Mesh>,
    #[serde(default)]
    accessors: Vec<Accessor>,
    #[serde(default)]
    buffer_views: Vec<BufferView>,
    #[serde(default)]
    materials: Vec<serde_json::Value>,
    #[serde(default)]
    scenes: Vec<Scene>,
    #[serde(default)]
    scene: Option<usize>,
}

/// A parsed GLB.
#[derive(Clone, Debug)]
pub struct Glb {
    doc: Doc,
    bin: Vec<u8>,
}

/// A column-major 4×4 transform.
pub type Mat4 = [f64; 16];

pub const IDENTITY: Mat4 = [
    1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.,
];

pub fn mul(a: &Mat4, b: &Mat4) -> Mat4 {
    let mut m = [0.0; 16];
    for c in 0..4 {
        for r in 0..4 {
            m[c * 4 + r] = (0..4).map(|k| a[k * 4 + r] * b[c * 4 + k]).sum();
        }
    }
    m
}

pub fn apply(m: &Mat4, p: [f64; 3]) -> [f64; 3] {
    [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ]
}

impl Node {
    /// The node's local transform (matrix, or translation · rotation · scale).
    pub fn local(&self) -> Mat4 {
        if let Some(m) = self.matrix {
            return m;
        }
        let t = self.translation.unwrap_or([0.0; 3]);
        let [x, y, z, w] = self.rotation.unwrap_or([0.0, 0.0, 0.0, 1.0]);
        let s = self.scale.unwrap_or([1.0; 3]);
        let r = [
            1.0 - 2.0 * (y * y + z * z),
            2.0 * (x * y + z * w),
            2.0 * (x * z - y * w),
            2.0 * (x * y - z * w),
            1.0 - 2.0 * (x * x + z * z),
            2.0 * (y * z + x * w),
            2.0 * (x * z + y * w),
            2.0 * (y * z - x * w),
            1.0 - 2.0 * (x * x + y * y),
        ];
        [
            r[0] * s[0],
            r[1] * s[0],
            r[2] * s[0],
            0.0,
            r[3] * s[1],
            r[4] * s[1],
            r[5] * s[1],
            0.0,
            r[6] * s[2],
            r[7] * s[2],
            r[8] * s[2],
            0.0,
            t[0],
            t[1],
            t[2],
            1.0,
        ]
    }
}

impl Glb {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let u32_at = |i: usize| -> Result<u32, String> {
            bytes
                .get(i..i + 4)
                .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .ok_or_else(|| "truncated GLB".to_owned())
        };
        if u32_at(0)? != MAGIC {
            return Err("not a GLB (bad magic)".into());
        }
        if u32_at(4)? != 2 {
            return Err(format!("GLB version {}, expected 2", u32_at(4)?));
        }
        let total = (u32_at(8)? as usize).min(bytes.len());
        let (mut json, mut bin) = (None, Vec::new());
        let mut at = 12;
        while at + 8 <= total {
            let (len, kind) = (u32_at(at)? as usize, u32_at(at + 4)?);
            let body = bytes
                .get(at + 8..at + 8 + len)
                .ok_or("chunk runs past the end")?;
            match kind {
                CHUNK_JSON => {
                    json = Some(
                        serde_json::from_slice::<Doc>(body)
                            .map_err(|e| format!("bad glTF JSON: {e}"))?,
                    )
                }
                CHUNK_BIN => bin = body.to_vec(),
                _ => {}
            }
            at += 8 + len;
        }
        Ok(Self {
            doc: json.ok_or("no JSON chunk")?,
            bin,
        })
    }

    pub fn nodes(&self) -> &[Node] {
        &self.doc.nodes
    }

    pub fn material_count(&self) -> usize {
        self.doc.materials.len()
    }

    pub fn mesh(&self, i: usize) -> Option<&Mesh> {
        self.doc.meshes.get(i)
    }

    /// The default scene's root nodes.
    pub fn roots(&self) -> Vec<usize> {
        self.doc
            .scenes
            .get(self.doc.scene.unwrap_or(0))
            .map(|s| s.nodes.clone())
            .unwrap_or_default()
    }

    /// World transform of every node reachable from the scene (node index → matrix).
    pub fn world(&self) -> BTreeMap<usize, Mat4> {
        let mut out = BTreeMap::new();
        let mut stack: Vec<(usize, Mat4)> =
            self.roots().into_iter().map(|r| (r, IDENTITY)).collect();
        while let Some((i, parent)) = stack.pop() {
            let Some(node) = self.doc.nodes.get(i) else {
                continue;
            };
            if out.contains_key(&i) {
                continue; // a cycle; glTF forbids them, so stop rather than loop
            }
            let m = mul(&parent, &node.local());
            out.insert(i, m);
            stack.extend(node.children.iter().map(|&c| (c, m)));
        }
        out
    }

    fn view(&self, accessor: usize, want: &str) -> Result<(Vec<u8>, usize, usize, u32), String> {
        let a = self
            .doc
            .accessors
            .get(accessor)
            .ok_or("accessor out of range")?;
        if a.kind != want {
            return Err(format!(
                "accessor {accessor} is {}, expected {want}",
                a.kind
            ));
        }
        let bv = self
            .doc
            .buffer_views
            .get(a.buffer_view.ok_or("sparse accessors aren't supported")?)
            .ok_or("bufferView out of range")?;
        let comp = match a.component_type {
            5121 => 1,
            5123 => 2,
            5125 | 5126 => 4,
            t => return Err(format!("component type {t} isn't supported")),
        };
        let width = comp * if want == "VEC3" { 3 } else { 1 };
        let stride = bv.byte_stride.unwrap_or(width);
        let start = bv.byte_offset + a.byte_offset;
        let need = if a.count == 0 {
            0
        } else {
            stride * (a.count - 1) + width
        };
        if need > bv.byte_length || start + need > self.bin.len() {
            return Err(format!("accessor {accessor} runs past its buffer"));
        }
        Ok((
            self.bin[start..start + need].to_vec(),
            a.count,
            stride,
            a.component_type,
        ))
    }

    /// `VEC3` float positions of an accessor.
    pub fn positions(&self, accessor: usize) -> Result<Vec<[f64; 3]>, String> {
        let (data, count, stride, comp) = self.view(accessor, "VEC3")?;
        if comp != 5126 {
            return Err("positions must be floats".into());
        }
        Ok((0..count)
            .map(|k| {
                let f = |o: usize| {
                    f64::from(f32::from_le_bytes([
                        data[k * stride + o],
                        data[k * stride + o + 1],
                        data[k * stride + o + 2],
                        data[k * stride + o + 3],
                    ]))
                };
                [f(0), f(4), f(8)]
            })
            .collect())
    }

    /// Triangles drawn by a primitive (indexed or not; triangle lists only).
    pub fn triangles(&self, p: &Primitive) -> Result<usize, String> {
        if p.mode.unwrap_or(4) != 4 {
            return Err("only triangle lists are supported".into());
        }
        let count = match p.indices {
            Some(i) => {
                self.doc
                    .accessors
                    .get(i)
                    .ok_or("indices accessor out of range")?
                    .count
            }
            None => {
                self.doc
                    .accessors
                    .get(*p.attributes.get("POSITION").ok_or("no POSITION")?)
                    .ok_or("accessor out of range")?
                    .count
            }
        };
        Ok(count / 3)
    }
}
