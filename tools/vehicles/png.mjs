// png.mjs: a deterministic RGBA PNG encoder (P1-V02). Node's zlib picks matches with CPU-specific hashing, so its bytes
// can differ between machines; this writes the same bytes everywhere: Sub-filtered rows (flat colour → zero runs) and one
// fixed-Huffman DEFLATE block whose only matches are byte runs (distance 1). The atlases are flat colours, so that's
// small enough.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function adler32(bytes) {
  let a = 1, b = 0;
  for (const x of bytes) { a = (a + x) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}

class Bits {
  constructor() { this.out = []; this.acc = 0; this.n = 0; }
  // LSB-first, as DEFLATE packs everything but Huffman codes.
  put(value, count) { for (let i = 0; i < count; i++) { this.acc |= ((value >>> i) & 1) << this.n; if (++this.n === 8) { this.out.push(this.acc); this.acc = 0; this.n = 0; } } }
  // Huffman codes go MSB-first.
  code(value, count) { for (let i = count - 1; i >= 0; i--) this.put((value >>> i) & 1, 1); }
  flush() { if (this.n) { this.out.push(this.acc); this.acc = 0; this.n = 0; } return Uint8Array.from(this.out); }
}

// Fixed Huffman literal/length code for symbol s (RFC 1951 §3.2.6).
function sym(bits, s) {
  if (s < 144) bits.code(0x30 + s, 8);
  else if (s < 256) bits.code(0x190 + s - 144, 9);
  else if (s < 280) bits.code(s - 256, 7);
  else bits.code(0xc0 + s - 280, 8);
}
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
function length(bits, len) {
  let i = LEN_BASE.length - 1;
  while (LEN_BASE[i] > len) i--;
  sym(bits, 257 + i);
  bits.put(len - LEN_BASE[i], LEN_EXTRA[i]);
}

function deflate(data) {
  const bits = new Bits();
  bits.put(1, 1); // BFINAL
  bits.put(1, 2); // BTYPE = fixed Huffman
  let i = 0;
  while (i < data.length) {
    let run = 0;
    if (i > 0) while (run < 258 && i + run < data.length && data[i + run] === data[i - 1]) run++;
    if (run >= 3) {
      length(bits, run);
      bits.code(0, 5); // distance code 0 = distance 1
      i += run;
    } else {
      sym(bits, data[i]);
      i++;
    }
  }
  sym(bits, 256);
  const body = bits.flush(), a = adler32(data);
  return Uint8Array.from([0x78, 0x01, ...body, a >>> 24, (a >>> 16) & 0xff, (a >>> 8) & 0xff, a & 0xff]);
}

function chunk(type, data) {
  const t = Buffer.from(type, 'latin1'), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([t, Buffer.from(data)])));
  return Buffer.concat([len, t, Buffer.from(data), crc]);
}

/** RGBA pixels (rows top to bottom) → PNG bytes, identical on every machine. */
export function encodePNG(width, height, rgba) {
  const stride = width * 4, raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1), r = y * stride;
    raw[o] = 1; // Sub filter
    for (let x = 0; x < stride; x++) raw[o + 1 + x] = (rgba[r + x] - (x >= 4 ? rgba[r + x - 4] : 0)) & 0xff;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA, deflate, adaptive filter, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflate(raw)), chunk('IEND', new Uint8Array(0)),
  ]);
}
