import { BufferAttribute, BufferGeometry, Color, Mesh, type Material } from 'three';

/** A triangle soup with flat vertex colours, in the same winding/order as the map's collision geometry. */
export class Soup {
  private positions = new Float32Array(1024);
  private vertexColours = new Float32Array(1024);
  private used = 0;
  get pos(): Float32Array { return this.positions.subarray(0, this.used); }
  get colour(): Float32Array { return this.vertexColours.subarray(0, this.used); }
  /** One shading normal per face (3), or one per corner (9). */
  normals = new Map<number, number[]>();
  private colours = new Map<string, readonly [number, number, number]>();
  private col = new Color();

  private reserve(extra: number): void {
    if (this.used + extra <= this.positions.length) return;
    const size = Math.max(this.positions.length * 2, this.used + extra);
    const pos = new Float32Array(size), colour = new Float32Array(size);
    pos.set(this.positions);
    colour.set(this.vertexColours);
    this.positions = pos;
    this.vertexColours = colour;
  }

  private rgb(colour: string): readonly [number, number, number] {
    let rgb = this.colours.get(colour);
    if (!rgb) {
      this.col.set(colour);
      rgb = [this.col.r, this.col.g, this.col.b];
      this.colours.set(colour, rgb);
    }
    return rgb;
  }

  quad(a: number[], b: number[], c: number[], d: number[], colour: string): void {
    const [r, g, bl] = this.rgb(colour);
    // Grow storage with the input, then write the same a-b-c, a-c-d corners directly. Rounding to Float32 happens
    // here rather than in mesh(); no geometry arithmetic reads these positions before that conversion.
    this.reserve(18);
    const i = this.used, p = this.positions, co = this.vertexColours;
    p[i] = a[0]!; p[i + 1] = a[1]!; p[i + 2] = a[2]!;
    p[i + 3] = b[0]!; p[i + 4] = b[1]!; p[i + 5] = b[2]!;
    p[i + 6] = c[0]!; p[i + 7] = c[1]!; p[i + 8] = c[2]!;
    p[i + 9] = a[0]!; p[i + 10] = a[1]!; p[i + 11] = a[2]!;
    p[i + 12] = c[0]!; p[i + 13] = c[1]!; p[i + 14] = c[2]!;
    p[i + 15] = d[0]!; p[i + 16] = d[1]!; p[i + 17] = d[2]!;
    co[i] = co[i + 3] = co[i + 6] = co[i + 9] = co[i + 12] = co[i + 15] = r;
    co[i + 1] = co[i + 4] = co[i + 7] = co[i + 10] = co[i + 13] = co[i + 16] = g;
    co[i + 2] = co[i + 5] = co[i + 8] = co[i + 11] = co[i + 14] = co[i + 17] = bl;
    this.used += 18;
  }

  tri(a: number[], b: number[], c: number[], colour: string, normal?: number[]): void {
    if (normal) this.normals.set(this.used / 9, normal);
    const [r, g, bl] = this.rgb(colour);
    this.reserve(9);
    const i = this.used, p = this.positions, co = this.vertexColours;
    p[i] = a[0]!; p[i + 1] = a[1]!; p[i + 2] = a[2]!;
    p[i + 3] = b[0]!; p[i + 4] = b[1]!; p[i + 5] = b[2]!;
    p[i + 6] = c[0]!; p[i + 7] = c[1]!; p[i + 8] = c[2]!;
    co[i] = co[i + 3] = co[i + 6] = r;
    co[i + 1] = co[i + 4] = co[i + 7] = g;
    co[i + 2] = co[i + 5] = co[i + 8] = bl;
    this.used += 9;
  }

  mesh(material: Material): Mesh {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.colour), 3));
    // Soup is unindexed: each face owns its three corners, so its normal is calculated and
    // normalised once. The general BufferGeometry path repeats normalisation for every corner.
    // Keep its Float32 rounding before normalisation, including zero-area faces.
    const p = this.pos;
    const normals = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 9) {
      const cbx = p[i + 6]! - p[i + 3]!, cby = p[i + 7]! - p[i + 4]!, cbz = p[i + 8]! - p[i + 5]!;
      const abx = p[i]! - p[i + 3]!, aby = p[i + 1]! - p[i + 4]!, abz = p[i + 2]! - p[i + 5]!;
      const x = Math.fround(cby * abz - cbz * aby);
      const y = Math.fround(cbz * abx - cbx * abz);
      const z = Math.fround(cbx * aby - cby * abx);
      const inverseLength = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
      for (let k = 0; k < 9; k += 3) {
        normals[i + k] = x * inverseLength;
        normals[i + k + 1] = y * inverseLength;
        normals[i + k + 2] = z * inverseLength;
      }
    }
    g.setAttribute('normal', new BufferAttribute(normals, 3));
    if (this.normals.size) {
      const n = g.getAttribute('normal') as BufferAttribute;
      for (const [t, v] of this.normals) for (let k = 0; k < 3; k++) { const o = v.length === 9 ? 3 * k : 0; n.setXYZ(t * 3 + k, v[o]!, v[o + 1]!, v[o + 2]!); }
    }
    const m = new Mesh(g, material);
    m.receiveShadow = true;
    return m;
  }
}
