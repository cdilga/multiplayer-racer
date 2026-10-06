// Small DSP and file helpers for the engine-synth checks (Node, no dependencies): FFT, spectra, f0 search,
// 16-bit WAV, a decimator and a PNG encoder (for the spectrogram evidence).
import { deflateSync } from 'node:zlib';

export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

/** Hann-windowed magnitude spectrum (n/2 bins, linear magnitude) of n samples starting at `start`. */
export function spectrum(samples, start, n = 8192) {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = (samples[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  fft(re, im);
  const mag = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]) / (n / 4);
  return mag;
}

export const rms = (x, a = 0, b = x.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
};
export const peak = (x, a = 0, b = x.length) => {
  let p = 0;
  for (let i = a; i < b; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
};
export const dbfs = (v) => 20 * Math.log10(Math.max(v, 1e-9));

/** Spectral centroid (Hz) of a magnitude spectrum. */
export function centroid(mag, sr) {
  const binHz = sr / (mag.length * 2);
  let num = 0;
  let den = 0;
  for (let i = 1; i < mag.length; i++) {
    num += i * binHz * mag[i];
    den += mag[i];
  }
  return den > 0 ? num / den : 0;
}

/**
 * Fundamental via harmonic sum over candidate f0 values (searches [lo, hi] Hz in 0.25 Hz steps): the lowest
 * candidate scoring within 10% of the best, so an octave up (which shares most of the harmonics) never wins.
 */
export function estimateF0(mag, sr, lo, hi, harmonics = 8) {
  const binHz = sr / (mag.length * 2);
  const at = (f) => {
    const x = f / binHz;
    const i = Math.floor(x);
    const w = x - i;
    return (mag[i] ?? 0) * (1 - w) + (mag[i + 1] ?? 0) * w;
  };
  const scores = [];
  let bestScore = -1;
  for (let f = lo; f <= hi; f += 0.25) {
    let score = 0;
    for (let h = 1; h <= harmonics; h++) score += Math.log1p(at(f * h) * 1000);
    scores.push([f, score]);
    bestScore = Math.max(bestScore, score);
  }
  // Refine to the local peak of the first candidate that clears the bar.
  const first = scores.findIndex(([, sc]) => sc >= 0.9 * bestScore);
  let k = first;
  while (k + 1 < scores.length && scores[k + 1][1] >= scores[k][1]) k++;
  return scores[k][0];
}

/** Band energy (RMS of magnitudes) between two frequencies. */
export function bandLevel(mag, sr, loHz, hiHz) {
  const binHz = sr / (mag.length * 2);
  let s = 0;
  let c = 0;
  for (let i = Math.max(1, Math.floor(loHz / binHz)); i <= Math.min(mag.length - 1, Math.ceil(hiHz / binHz)); i++) {
    s += mag[i] * mag[i];
    c++;
  }
  return Math.sqrt(s / Math.max(1, c));
}

/** Halve the sample rate with a 63-tap windowed-sinc low-pass (cutoff 0.43 of the new rate). */
export function decimate2(x) {
  const taps = 63;
  const h = new Float64Array(taps);
  const fc = 0.21; // cycles/sample at the old rate
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const m = i - (taps - 1) / 2;
    const sinc = m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
    h[i] = sinc * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)));
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  const out = new Float32Array(Math.floor(x.length / 2));
  for (let o = 0; o < out.length; o++) {
    let acc = 0;
    const c = o * 2;
    for (let k = 0; k < taps; k++) acc += (x[c + k - (taps - 1) / 2] ?? 0) * h[k];
    out[o] = acc;
  }
  return out;
}

/** Mono 16-bit PCM WAV. */
export function wav16(samples, sampleRate) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v < 0 ? v * 32768 : v * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(sampleRate, 24);
  head.writeUInt32LE(sampleRate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** PNG (8-bit RGB) from an RGB byte array. */
export function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Spectrogram PNG: time on x, frequency (0..maxHz, linear) on y, ink -> cobalt -> saffron -> paper by level. */
export function spectrogramPng(samples, sr, { maxHz = 8000, seconds, width = 1200, height = 360, floorDb = -80, ceilDb = -20 } = {}) {
  const total = seconds ?? samples.length / sr;
  const n = 2048;
  const stops = [
    [0.0, [0x15, 0x20, 0x3a]],
    [0.4, [0x1e, 0x5b, 0xff]],
    [0.75, [0xff, 0xb4, 0x00]],
    [1.0, [0xff, 0xf4, 0xde]],
  ];
  const color = (t) => {
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, c0] = stops[i - 1];
        const [t1, c1] = stops[i];
        const u = (t - t0) / (t1 - t0);
        return c0.map((c, k) => Math.round(c + (c1[k] - c) * u));
      }
    }
    return stops[stops.length - 1][1];
  };
  const rgb = new Uint8Array(width * height * 3);
  for (let x = 0; x < width; x++) {
    const start = Math.floor(((x + 0.5) / width) * total * sr - n / 2);
    const mag = spectrum(samples, Math.max(0, start), n);
    for (let y = 0; y < height; y++) {
      const hz = (1 - y / (height - 1)) * maxHz;
      const bin = Math.min(mag.length - 1, Math.round((hz / sr) * n));
      const db = dbfs(mag[bin]);
      const [r, g, b] = color(Math.max(0, Math.min(1, (db - floorDb) / (ceilDb - floorDb))));
      const o = (y * width + x) * 3;
      rgb[o] = r;
      rgb[o + 1] = g;
      rgb[o + 2] = b;
    }
  }
  return png(width, height, rgb);
}
