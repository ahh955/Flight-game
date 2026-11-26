// util.js — small math helpers for Langit Biru.
// Seeded random + smooth value noise so the whole world is identical
// on every load (same island, same runway, same rings, every run).

// Mulberry32: tiny deterministic PRNG. Seed is fixed per world.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;

// Wrap an angle to [-PI, PI].
export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

// Smoothstep 0..1.
export function smooth(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

// 2D value noise: a grid of random heights, bilinearly interpolated
// with smoothstep, stacked in 3 octaves. Fully deterministic.
export function makeNoise(seed) {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  function hash(ix, iz) {
    return perm[(perm[ix & 255] + iz) & 255] / 255;
  }
  function noise2(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const sx = smooth(fx), sz = smooth(fz);
    const a = hash(ix, iz), b = hash(ix + 1, iz);
    const c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
    return lerp(lerp(a, b, sx), lerp(c, d, sx), sz);
  }
  // Fractal: 3 octaves, returns roughly 0..1.
  return function (x, z) {
    return (
      noise2(x, z) * 0.55 +
      noise2(x * 2.13 + 7.7, z * 2.13 + 3.1) * 0.30 +
      noise2(x * 4.31 + 13.7, z * 4.31 + 9.4) * 0.15
    );
  };
}

// RGB helpers: returns [r, g, b] 0..255.
export function mixColor(c1, c2, t) {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
  ];
}

// Darken/lighten a color by a factor (0.5 = half brightness).
export function shade(c, f) {
  return [
    clamp(Math.round(c[0] * f), 0, 255),
    clamp(Math.round(c[1] * f), 0, 255),
    clamp(Math.round(c[2] * f), 0, 255),
  ];
}

// 'rgb(r,g,b)' string for canvas fillStyle.
export function css(c, alpha) {
  if (alpha === undefined) return `rgb(${c[0]},${c[1]},${c[2]})`;
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}
