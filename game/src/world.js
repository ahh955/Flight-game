// world.js — the island chain of Langit Biru.
// One seeded world: a big home island with a runway, three smaller
// islands, open turquoise sea, and 8 glowing target rings strung
// between them. Everything is deterministic (same seed every load).

import { clamp, lerp, makeNoise, mulberry32, smooth, TAU, wrapAngle } from './util.js';

export const WORLD_SIZE = 6000; // world spans -3000..3000 on x and z
export const SEA_LEVEL = 0;

// Island bumps: [x, z, radius, height]. The runway sits on island 0.
// Exported so the renderer can paint shallow water around each shore.
export const ISLANDS = [
  { x: 0, z: 900, r: 1150, h: 165 },     // home island (runway)
  { x: -1750, z: -700, r: 850, h: 300 }, // GUNUNG API — the active volcano
  { x: 1700, z: -950, r: 720, h: 120 },  // palm island, north-east
  { x: 400, z: -2100, r: 560, h: 90 },   // far north islet
  { x: -2400, z: 1600, r: 520, h: 70 },  // far west islet
];

// The volcano ("Gunung Api"): island 1 is an active volcano. Its
// summit is a glowing crater; three lava flows run down its flanks
// and a smoke column leans away on the wind. Ring 3 hangs right
// above the crater, so the loop flies over the fire.
export const VOLCANO = {
  x: -1750, z: -700, r: 850, summit: 300,
  craterR: 150, craterFloor: 215,
};
// Lava flows leave the crater at these azimuths (radians, 0 = +x).
export const LAVA_AZIMUTHS = [0.6, 2.3, 4.1];

// Volcanic character of a point: crater (1 inside the glowing bowl),
// lava (1 in the middle of a flow), basalt (1 on the volcano's dark
// flanks). All 0..1, all 0 away from the volcano.
export function volcanoAt(x, z) {
  const dx = x - VOLCANO.x, dz = z - VOLCANO.z;
  const d = Math.hypot(dx, dz);
  if (d > VOLCANO.r + 120) return { crater: 0, lava: 0, basalt: 0 };
  const crater = d < VOLCANO.craterR ? 1 - smooth(d / VOLCANO.craterR) : 0;
  let lava = 0;
  if (d > 90 && d < 760) {
    const az = Math.atan2(dz, dx);
    for (const a0 of LAVA_AZIMUTHS) {
      const da = Math.abs(wrapAngle(az - a0));
      const halfW = 0.09 + (d / 760) * 0.10;
      if (da < halfW) {
        const across = 1 - da / halfW;
        const along = 1 - (d - 90) / 670;
        lava = Math.max(lava, across * across * clamp(along, 0, 1));
      }
    }
  }
  const basalt = clamp(1 - smooth((d - VOLCANO.r * 0.55) / (VOLCANO.r * 0.45)), 0, 1);
  return { crater, lava, basalt };
}

const noise = makeNoise(20261126);

// Terrain height at (x, z). Sea floor is below 0; land rises on the
// island bumps, with noise-carved hills on top.
export function terrainHeight(x, z) {
  let h = -26; // sea floor
  for (const isl of ISLANDS) {
    const dx = (x - isl.x) / isl.r;
    const dz = (z - isl.z) / isl.r;
    const d2 = dx * dx + dz * dz;
    if (d2 < 1) {
      const fall = Math.cos(d2 * Math.PI * 0.5); // 1 at centre, 0 at edge
      h += fall * isl.h;
    }
  }
  if (h > -2) {
    // Hills only on land: more noise where the island is higher.
    const n = noise(x * 0.0016 + 31, z * 0.0016 + 17);
    h += (n - 0.42) * 95 * smooth(h / 60);
  }
  // The volcano's crater: a bowl carved into the summit, its floor
  // glowing with lava. Blends from the rim (natural height) down to
  // the crater floor at the centre; ring 3 hangs just above it.
  {
    const dx = x - VOLCANO.x, dz = z - VOLCANO.z;
    const d = Math.hypot(dx, dz);
    if (d < VOLCANO.craterR) {
      const k = smooth((VOLCANO.craterR - d) / VOLCANO.craterR);
      h = lerp(h, VOLCANO.craterFloor, k);
    }
  }
  // The crater rim: cap the terrain at 292 in a ring around the bowl
  // (radius 130..300), so the rim reads as a flat crater lip and a
  // plane threading ring 3 (y 330) never meets a noise spike on the
  // way in. Below the rim the flanks keep their rugged noise.
  {
    const dx = x - VOLCANO.x, dz = z - VOLCANO.z;
    const d = Math.hypot(dx, dz);
    if (d >= 130 && d < 300) {
      const k = smooth((300 - d) / 170);
      h = lerp(h, Math.min(h, 292), k);
    }
  }
  // Departure valley: a wide flat corridor down the home island along
  // the runway centreline, so takeoff and landing never meet a
  // mountain and the cockpit sees sky, not a wall of green.
  // Flat for |x| < 240, rising to the island's hills at |x| = 420;
  // the island's peaks stay on the east and west flanks.
  if (x > -420 && x < 420 && z > -450 && z < 1350) {
    const cx = 1 - smooth((Math.abs(x) - 240) / 180);
    // Flat along the whole runway (z 590..1210) and beyond, tapering
    // only past z = 1250 to the south and z = 500 to the north: the
    // ground beside the runway must stay at valley height, or the
    // camera (which sits 1 unit above the strip) ends up underneath
    // a terrain cell and the sky fills with green.
    // Blend fully (1.0) to the runway height 14.6 in the flat zone:
    // a 0.95 blend left the ground 6-8 units above the strip, which
    // put the cockpit camera underneath the terrain cells.
    const cz = smooth((z - 250) / 250) * smooth((1500 - z) / 250);
    h = lerp(h, 14.6, cx * cz);
  }
  return h;
}

// The runway: a flat strip on the home island, heading north (-z).
export const RUNWAY = {
  x: 0, z: 900,          // centre
  heading: 0,            // runway points north (-z); heading measured like the plane
  length: 620,
  width: 46,
  y: 0,                  // filled in by flattenRunway()
};

// Flatten the terrain under the runway so takeoff/landing is fair.
export function runwayHeight() {
  return 14; // the strip is graded to a flat 14 units above sea level
}

// Is (x, z) on the runway strip (with a small margin)?
export function onRunway(x, z) {
  const dx = x - RUNWAY.x;
  const dz = z - RUNWAY.z;
  // Runway runs along z; heading PI means its long axis is the z axis.
  return Math.abs(dx) < RUNWAY.width / 2 + 6 && Math.abs(dz) < RUNWAY.length / 2 + 6;
}

// Terrain height with the runway graded flat.
export function groundHeight(x, z) {
  if (onRunway(x, z)) return runwayHeight();
  return terrainHeight(x, z);
}

// 8 target rings: a scenic loop home island -> NW island -> NE island
// -> far north -> back home. Each ring: centre, radius, next pointer.
function buildRings() {
  const defs = [
    { x: 0, z: 480, y: 120, r: 34 },
    { x: -700, z: -150, y: 200, r: 34 },
    { x: -1750, z: -700, y: 330, r: 36 },
    { x: -900, z: -1400, y: 200, r: 34 },
    { x: 700, z: -1500, y: 190, r: 34 },
    { x: 1700, z: -950, y: 230, r: 36 },
    { x: 1300, z: 100, y: 130, r: 34 },
    { x: 450, z: 700, y: 240, r: 34 },
  ];
  return defs.map((d, i) => ({
    ...d,
    index: i,
    // Ring faces the previous ring so you fly through it head-on.
    yaw: 0,
    passed: false,
  }));
}

export const RINGS = buildRings();

// Aim each ring at the next ring in the loop.
for (let i = 0; i < RINGS.length; i++) {
  const a = RINGS[i];
  const b = RINGS[(i + 1) % RINGS.length];
  a.yaw = Math.atan2(b.x - a.x, b.z - a.z);
}

// Clouds: soft puffs drifting slowly, placed once from the seed.
export function buildClouds() {
  const rand = mulberry32(777);
  const clouds = [];
  for (let i = 0; i < 46; i++) {
    clouds.push({
      x: (rand() - 0.5) * 5600,
      z: (rand() - 0.5) * 5600,
      y: 320 + rand() * 260,
      s: 90 + rand() * 190, // size
      drift: 2 + rand() * 4,
    });
  }
  return clouds;
}

export const CLOUDS = buildClouds();

// Time of day: t = hours 0..24. Returns sky colours, sun direction
// and fog colour. Three moods: dawn (6.5), day (12), sunset (18.3).
// cloudTop/cloudBot tint the clouds with the sun's colour; haze is
// the warm band that sits on the horizon at low sun.
export function daylight(t) {
  const day = {
    skyTop: [38, 110, 196], skyMid: [110, 178, 228], skyBot: [206, 232, 244],
    sun: [255, 244, 214], fog: [196, 220, 236], sunDir: [0.45, 0.62, 0.55],
    ambient: 1.0, sunI: 1.0,
    cloudTop: [255, 255, 255], cloudBot: [188, 208, 226], haze: [214, 234, 244],
  };
  const dawn = {
    skyTop: [46, 58, 124], skyMid: [214, 128, 110], skyBot: [255, 198, 142],
    sun: [255, 196, 120], fog: [232, 178, 150], sunDir: [0.85, 0.18, 0.3],
    ambient: 0.82, sunI: 0.9,
    cloudTop: [255, 232, 214], cloudBot: [196, 148, 156], haze: [255, 186, 132],
  };
  const sunset = {
    skyTop: [30, 34, 96], skyMid: [190, 88, 80], skyBot: [255, 156, 90],
    sun: [255, 150, 70], fog: [238, 150, 110], sunDir: [-0.8, 0.14, -0.42],
    ambient: 0.8, sunI: 0.9,
    cloudTop: [255, 210, 176], cloudBot: [172, 106, 126], haze: [255, 148, 88],
  };
  const mix = (a, b, k) => ({
    skyTop: a.skyTop.map((v, i) => Math.round(lerp(v, b.skyTop[i], k))),
    skyMid: a.skyMid.map((v, i) => Math.round(lerp(v, b.skyMid[i], k))),
    skyBot: a.skyBot.map((v, i) => Math.round(lerp(v, b.skyBot[i], k))),
    sun: a.sun.map((v, i) => Math.round(lerp(v, b.sun[i], k))),
    fog: a.fog.map((v, i) => Math.round(lerp(v, b.fog[i], k))),
    sunDir: a.sunDir.map((v, i) => lerp(v, b.sunDir[i], k)),
    ambient: lerp(a.ambient, b.ambient, k),
    sunI: lerp(a.sunI, b.sunI, k),
    cloudTop: a.cloudTop.map((v, i) => Math.round(lerp(v, b.cloudTop[i], k))),
    cloudBot: a.cloudBot.map((v, i) => Math.round(lerp(v, b.cloudBot[i], k))),
    haze: a.haze.map((v, i) => Math.round(lerp(v, b.haze[i], k))),
  });
  if (t < 9) return mix(dawn, day, smooth((t - 6.5) / 2.5));
  if (t < 16.5) return day;
  return mix(day, sunset, smooth((t - 16.5) / 1.8));
}

// Sea colour shifts with the light too. Deeper blue-green near the
// camera, paler toward the horizon; `shallow` is the pale turquoise
// of water over sand near a shore.
export function seaColors(light) {
  const k = light.ambient;
  return {
    near: [12 + Math.round(22 * (1 - k)), 100, 132],
    far: [22, 130, 165],
    shallow: [64, 196, 190],
    sparkle: light.sun,
  };
}

// How shallow the sea is at (x, z): 1 right at a shoreline, fading
// to 0 about 260 units out. Used to tint the water pale turquoise
// over the sand shelf around each island.
export function seaShallow(x, z) {
  let best = 0;
  for (const isl of ISLANDS) {
    const d = Math.hypot(x - isl.x, z - isl.z) - isl.r;
    if (d < 260) best = Math.max(best, 1 - smooth((d + 40) / 300));
  }
  return best;
}

export { TAU };
