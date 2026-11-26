// render.js — software 3D renderer for Langit Biru.
// No WebGL, no libraries: every frame the world is projected from
// 3D to 2D on a plain canvas, triangles sorted far-to-near (painter).
// Sky, sea, terrain, runway, rings, clouds, the plane and particles
// are all drawn this way.

import { clamp, css, lerp, mixColor, shade, smooth, TAU, wrapAngle } from './util.js';
import { CLOUDS, daylight, groundHeight, onRunway, RINGS, RUNWAY, runwayHeight, seaColors, terrainHeight } from './world.js';

// ---------- camera ----------
// Heading yaw: 0 = north (-z), PI/2 = east (+x). Pitch + = nose up.
export function basis(yaw, pitch, roll) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const f = [Math.sin(yaw) * cp, sp, -Math.cos(yaw) * cp];
  // right = forward x world-up = (cos yaw, 0, sin yaw)
  let r = [Math.cos(yaw), 0, Math.sin(yaw)];
  let u = [
    r[1] * f[2] - r[2] * f[1],
    r[2] * f[0] - r[0] * f[2],
    r[0] * f[1] - r[1] * f[0],
  ];
  // Apply roll around the forward axis.
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const r2 = [
    r[0] * cr + u[0] * sr,
    r[1] * cr + u[1] * sr,
    r[2] * cr + u[2] * sr,
  ];
  const u2 = [
    u[0] * cr - r[0] * sr,
    u[1] * cr - r[1] * sr,
    u[2] * cr - r[2] * sr,
  ];
  return { f, r: r2, u: u2 };
}

// Project a world point into screen space. Returns null if behind.
// projectPoly clips a polygon against the near plane (cz >= 2) in
// camera space before projecting, so polygons that straddle the
// camera (the runway under you, the sea below you) render instead
// of vanishing whole.
export function makeProjector(cam, w, h, fovDeg) {
  const f = (h / 2) / Math.tan(((fovDeg * Math.PI) / 180 / 2));
  const { f: fw, r, u } = basis(cam.yaw, cam.pitch, cam.roll);
  const cx0 = cam.pos.x, cy0 = cam.pos.y, cz0 = cam.pos.z;
  function toCam(p) {
    const dx = p.x - cx0, dy = p.y - cy0, dz = p.z - cz0;
    return {
      cx: dx * r[0] + dy * r[1] + dz * r[2],
      cy: dx * u[0] + dy * u[1] + dz * u[2],
      cz: dx * fw[0] + dy * fw[1] + dz * fw[2],
    };
  }
  function toScreen(c) {
    return {
      x: w / 2 + (c.cx * f) / c.cz,
      y: h / 2 - (c.cy * f) / c.cz,
      depth: c.cz,
      scale: f / c.cz,
    };
  }
  function project(p) {
    const c = toCam(p);
    if (c.cz < 2) return null;
    return toScreen(c);
  }
  function projectPoly(points) {
    // Sutherland–Hodgman clip against the near plane cz >= 2.
    let poly = points.map(toCam);
    const clipped = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const aIn = a.cz >= 2, bIn = b.cz >= 2;
      if (aIn) clipped.push(a);
      if (aIn !== bIn) {
        const t = (2 - a.cz) / (b.cz - a.cz);
        clipped.push({
          cx: a.cx + (b.cx - a.cx) * t,
          cy: a.cy + (b.cy - a.cy) * t,
          cz: 2,
        });
      }
    }
    if (clipped.length < 3) return null;
    return clipped.map(toScreen);
  }
  return { project, projectPoly };
}

// ---------- terrain colours ----------
const SAND = [232, 208, 148];
const GRASS = [96, 168, 92];
const GRASS2 = [126, 182, 98];
const FOREST = [62, 128, 76];
const ROCK = [128, 118, 106];
const SNOW = [238, 240, 244];

function terrainColor(h, slope) {
  let c;
  if (h < 5) c = SAND;
  else if (h < 55) c = mixColor(GRASS, GRASS2, (h - 5) / 50);
  else if (h < 105) c = mixColor(GRASS2, FOREST, (h - 55) / 50);
  else if (h < 155) c = mixColor(FOREST, ROCK, (h - 105) / 50);
  else c = mixColor(ROCK, SNOW, smooth((h - 155) / 25));
  if (slope < 0.72) c = mixColor(c, ROCK, 0.7); // cliffs are rock
  return c;
}

// ---------- the plane model ----------
// Local space: +z forward, +y up, +x right. ~14 units long.
// Palettes: the player flies coral, the wingman flies coral with
// blue wings/fin (same side, easy to tell apart), enemies fly dark
// charcoal with a dark-red fin so a dogfight reads at a glance.
export const PALETTES = {
  player: {
    fuse: [232, 90, 70], belly: [24, 140, 150], wing: [245, 238, 220],
    fin: [255, 190, 60], canopy: [28, 62, 112], nose: [255, 190, 60],
  },
  wingman: {
    fuse: [232, 90, 70], belly: [24, 140, 150], wing: [70, 140, 220],
    fin: [70, 140, 220], canopy: [28, 62, 112], nose: [255, 190, 60],
  },
  enemy: {
    fuse: [56, 60, 68], belly: [28, 30, 36], wing: [74, 78, 88],
    fin: [168, 44, 38], canopy: [14, 16, 20], nose: [168, 44, 38],
  },
};

function planeTriangles(propAngle, palette) {
  const P = palette || PALETTES.player;
  const tris = [];
  const CORAL = P.fuse;
  const CREAM = P.wing;
  const TEAL = P.belly;
  const GOLD = P.fin;
  const GLASS = P.canopy;
  const DARK = [40, 44, 52];
  const NOSE = P.nose;

  // Fuselage: hexagonal stations along z.
  const stations = [
    { z: 7.2, r: 0.05 }, { z: 6.4, r: 0.75 }, { z: 4.5, r: 1.15 },
    { z: 1.5, r: 1.35 }, { z: -2.0, r: 1.35 }, { z: -5.0, r: 1.05 },
    { z: -7.0, r: 0.35 },
  ];
  const hex = [
    [0, 1], [0.82, 0.5], [0.82, -0.62], [0, -1], [-0.82, -0.62], [-0.82, 0.5],
  ];
  const ringPts = (st) => hex.map(([hx, hy]) => [hx * st.r, hy * st.r, st.z]);
  for (let s = 0; s < stations.length - 1; s++) {
    const a = ringPts(stations[s]), b = ringPts(stations[s + 1]);
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      const top = i === 0 || i === 5; // upper faces coral, lower faces teal
      const col = top ? CORAL : (i === 2 || i === 3 ? TEAL : CORAL);
      tris.push({ v: [a[i], a[j], b[j]], c: col });
      tris.push({ v: [a[i], b[j], b[i]], c: col });
    }
  }
  // Nose cap.
  tris.push({ v: [[0, 0, 7.2], ringPts(stations[0])[1], ringPts(stations[0])[0]], c: NOSE });
  // Canopy (glass hump on top, z 1.5..4.5).
  const canopy = [
    [0, 2.35, 4.6], [0.85, 1.75, 4.4], [0.85, 1.75, 1.6], [0, 2.5, 1.4],
    [-0.85, 1.75, 4.4], [-0.85, 1.75, 1.6],
  ];
  tris.push({ v: [canopy[0], canopy[1], canopy[3]], c: GLASS });
  tris.push({ v: [canopy[1], canopy[2], canopy[3]], c: GLASS });
  tris.push({ v: [canopy[0], canopy[3], canopy[4]], c: GLASS });
  tris.push({ v: [canopy[4], canopy[3], canopy[5]], c: GLASS });

  // Main wings (flat, slightly swept): top cream, edge coral.
  function wingBox(cx, z0, z1, span, thick, top, side) {
    const x0 = cx - span, x1 = cx + span;
    const t = thick / 2;
    // top face
    tris.push({ v: [[x0, t, z0], [x1, t, z0], [x1, t, z1]], c: top });
    tris.push({ v: [[x0, t, z0], [x1, t, z1], [x0, t, z1]], c: top });
    // front + back edges
    tris.push({ v: [[x0, -t, z0], [x1, -t, z0], [x1, t, z0]], c: side });
    tris.push({ v: [[x0, -t, z0], [x1, t, z0], [x0, t, z0]], c: side });
    tris.push({ v: [[x0, -t, z1], [x1, t, z1], [x1, -t, z1]], c: side });
    tris.push({ v: [[x0, -t, z1], [x0, t, z1], [x1, t, z1]], c: side });
  }
  wingBox(0, -0.2, 2.4, 7.6, 0.28, CREAM, CORAL);      // main wings
  wingBox(0, -7.2, -5.6, 3.1, 0.22, CREAM, CORAL);     // tailplane
  // Vertical fin (gold, with a coral stripe).
  tris.push({ v: [[-0.14, 1.0, -7.0], [0.14, 1.0, -7.0], [0.14, 3.4, -5.2]], c: GOLD });
  tris.push({ v: [[-0.14, 1.0, -7.0], [0.14, 3.4, -5.2], [-0.14, 3.4, -5.2]], c: GOLD });
  tris.push({ v: [[-0.14, 1.0, -5.2], [0.14, 1.0, -5.2], [0.14, 3.4, -5.2]], c: CORAL });
  tris.push({ v: [[-0.14, 1.0, -5.2], [0.14, 3.4, -5.2], [-0.14, 3.4, -5.2]], c: CORAL });

  // Propeller: spinner + two blades (rotating).
  tris.push({ v: [[0, 0.5, 7.6], [0.5, 0, 7.6], [0, -0.5, 7.6]], c: NOSE });
  tris.push({ v: [[0, 0.5, 7.6], [0, -0.5, 7.6], [-0.5, 0, 7.6]], c: NOSE });
  const bl = 2.6, bw = 0.34;
  const ca = Math.cos(propAngle), sa = Math.sin(propAngle);
  for (const sgn of [1, -1]) {
    const dir = [ca * sgn, sa * sgn, 0];
    const perp = [-sa * sgn, ca * sgn, 0];
    const tip = [dir[0] * bl, dir[1] * bl, 7.35];
    const b1 = [perp[0] * bw, perp[1] * bw, 7.35];
    const b2 = [-perp[0] * bw, -perp[1] * bw, 7.35];
    tris.push({ v: [[0, 0, 7.35], [tip[0] + b1[0], tip[1] + b1[1], 7.35], [tip[0] + b2[0], tip[1] + b2[1], 7.35]], c: DARK });
  }
  // Landing gear: two wheels + struts.
  for (const sx of [-1, 1]) {
    tris.push({ v: [[sx * 1.1 - 0.3, -1.5, 2.2], [sx * 1.1 + 0.3, -1.5, 2.2], [sx * 1.1 + 0.3, -1.5, 3.0]], c: DARK });
    tris.push({ v: [[sx * 1.1 - 0.3, -1.5, 2.2], [sx * 1.1 + 0.3, -1.5, 3.0], [sx * 1.1 - 0.3, -1.5, 3.0]], c: DARK });
    tris.push({ v: [[sx * 0.9, -1.5, 2.6], [sx * 1.1, -1.5, 2.6], [sx * 1.0, -0.9, 2.6]], c: DARK });
  }
  // Wingtip lights: left red, right green (emissive).
  tris.push({ v: [[-7.6, 0.1, 0.8], [-7.9, 0.1, 0.8], [-7.9, 0.1, 1.6]], c: [255, 60, 60], glow: true });
  tris.push({ v: [[7.6, 0.1, 0.8], [7.9, 0.1, 1.6], [7.9, 0.1, 0.8]], c: [80, 255, 120], glow: true });
  return tris;
}

// Transform a local plane point to world space.
export function planeToWorld(plane, lx, ly, lz) {
  const { f, r, u } = basis(plane.yaw, plane.pitch, plane.roll);
  return {
    x: plane.pos.x + r[0] * lx + u[0] * ly + f[0] * lz,
    y: plane.pos.y + r[1] * lx + u[1] * ly + f[1] * lz,
    z: plane.pos.z + r[2] * lx + u[2] * ly + f[2] * lz,
  };
}

// ---------- main scene render ----------
// S: { ctx, w, h, cam, plane, view, time, light, rings, particles,
//      nextRing, propAngle, score, elapsed }
export function renderScene(S) {
  const { ctx, w, h } = S;
  const light = S.light;
  const { project, projectPoly } = makeProjector(S.cam, w, h, 68);
  // Project a world-space polygon (clipped at the near plane) and
  // fill it. Returns false when the polygon is fully behind us.
  // The projected polygon is also clipped to the viewport: a wall
  // right beside the camera would otherwise project to extreme
  // coordinates whose fill covers the whole screen.
  function clip2D(poly, x0, y0, x1, y1) {
    // Sutherland–Hodgman against one half-plane at a time.
    const clipEdge = (pts, inside, intersect) => {
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const aIn = inside(a), bIn = inside(b);
        if (aIn) out.push(a);
        if (aIn !== bIn) out.push(intersect(a, b));
      }
      return out;
    };
    let p = poly;
    p = clipEdge(p, (q) => q.x >= x0, (a, b) => ({ x: x0, y: a.y + ((b.y - a.y) * (x0 - a.x)) / (b.x - a.x), depth: a.depth }));
    p = clipEdge(p, (q) => q.x <= x1, (a, b) => ({ x: x1, y: a.y + ((b.y - a.y) * (x1 - a.x)) / (b.x - a.x), depth: a.depth }));
    p = clipEdge(p, (q) => q.y >= y0, (a, b) => ({ x: a.x + ((b.x - a.x) * (y0 - a.y)) / (b.y - a.y), y: y0, depth: a.depth }));
    p = clipEdge(p, (q) => q.y <= y1, (a, b) => ({ x: a.x + ((b.x - a.x) * (y1 - a.y)) / (b.y - a.y), y: y1, depth: a.depth }));
    return p;
  }
  function fillPoly(points, fill) {
    let p = projectPoly(points);
    if (!p) return false;
    p = clip2D(p, -40, -40, w + 40, h + 40);
    if (p.length < 3) return false;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
    ctx.closePath(); ctx.fill();
    return true;
  }
  const sunDir = light.sunDir;
  const sunLen = Math.hypot(sunDir[0], sunDir[1], sunDir[2]);
  const sunN = [sunDir[0] / sunLen, sunDir[1] / sunLen, sunDir[2] / sunLen];

  // Sky gradient.
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, css(light.skyTop));
  g.addColorStop(0.55, css(light.skyMid));
  g.addColorStop(1, css(light.skyBot));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Sun disc + glow.
  const sunAt = { x: S.cam.pos.x + sunN[0] * 4000, y: S.cam.pos.y + sunN[1] * 4000, z: S.cam.pos.z + sunN[2] * 4000 };
  const sp = project(sunAt);
  if (sp) {
    const glow = ctx.createRadialGradient(sp.x, sp.y, 4, sp.x, sp.y, 150);
    glow.addColorStop(0, css(light.sun, 0.9));
    glow.addColorStop(0.25, css(light.sun, 0.35));
    glow.addColorStop(1, css(light.sun, 0));
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 150, 0, TAU); ctx.fill();
    ctx.fillStyle = css(light.sun);
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 26, 0, TAU); ctx.fill();
  }

  // Draw list: { depth, draw() } — painter's algorithm.
  const items = [];
  const fogMix = (c, depth) => {
    const t = smooth((depth - 500) / 2400);
    return mixColor(c, light.fog, t * 0.85);
  };

  // ---- sea: grid of quads around the camera ----
  const seaCol = seaColors(light);
  const seaStep = 800;
  const seaHalf = 3200;
  const sx0 = Math.floor((S.cam.pos.x - seaHalf) / seaStep) * seaStep;
  const sz0 = Math.floor((S.cam.pos.z - seaHalf) / seaStep) * seaStep;
  for (let ix = 0; ix < seaHalf * 2 / seaStep; ix++) {
    for (let iz = 0; iz < seaHalf * 2 / seaStep; iz++) {
      const x0 = sx0 + ix * seaStep, z0 = sz0 + iz * seaStep;
      const x1 = x0 + seaStep, z1 = z0 + seaStep;
      const cxm = (x0 + x1) / 2 - S.cam.pos.x;
      const czm = (z0 + z1) / 2 - S.cam.pos.z;
      const depth = Math.hypot(cxm, czm);
      if (depth > 4200) continue;
      // Sun glint: quads roughly toward the sun azimuth shimmer.
      const glint = clamp(1 - Math.abs(Math.atan2(cxm, czm) - Math.atan2(sunN[0], sunN[2])) / 1.2, 0, 1);
      let c = mixColor(seaCol.near, seaCol.far, clamp(depth / 3000, 0, 1));
      c = mixColor(c, light.sun, glint * 0.22 * (1 - depth / 4200));
      items.push({
        depth,
        draw() {
          fillPoly([
            { x: x0, y: 0.5, z: z0 }, { x: x1, y: 0.5, z: z0 },
            { x: x1, y: 0.5, z: z1 }, { x: x0, y: 0.5, z: z1 },
          ], css(fogMix(c, depth)));
        },
      });
    }
  }

  // ---- terrain: grid cells around the camera ----
  const cell = 160;
  const range = 2000;
  const tx0 = Math.floor((S.cam.pos.x - range) / cell) * cell;
  const tz0 = Math.floor((S.cam.pos.z - range) / cell) * cell;
  const n = Math.ceil((range * 2) / cell);
  for (let ix = 0; ix < n; ix++) {
    for (let iz = 0; iz < n; iz++) {
      const x0 = tx0 + ix * cell, z0 = tz0 + iz * cell;
      const x1 = x0 + cell, z1 = z0 + cell;
      const cxm = (x0 + x1) / 2 - S.cam.pos.x;
      const czm = (z0 + z1) / 2 - S.cam.pos.z;
      const depth = Math.hypot(cxm, czm);
      if (depth > range + 300) continue;
      const h00 = groundHeight(x0, z0), h10 = groundHeight(x1, z0);
      const h01 = groundHeight(x0, z1), h11 = groundHeight(x1, z1);
      const maxH = Math.max(h00, h10, h01, h11);
      if (maxH < 1.5) continue; // open sea, already drawn
      const minH = Math.min(h00, h10, h01, h11);
      // Face normal from the diagonal, for shading + slope.
      const e1 = [cell, h10 - h00, 0], e2 = [0, h01 - h00, cell];
      let nx = e1[1] * e2[2] - e1[2] * e2[1];
      let ny = e1[2] * e2[0] - e1[0] * e2[2];
      let nz = e1[0] * e2[1] - e1[1] * e2[0];
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const slope = Math.abs(ny);
      const lambert = 0.62 + 0.38 * clamp((nx * sunN[0] + ny * sunN[1] + nz * sunN[2]) * 0.5 + 0.5, 0, 1);
      const base = terrainColor((maxH + minH) / 2, slope);
      const col = shade(base, lambert * light.ambient + 0.12);
      const pts = [
        { x: x0, y: h00, z: z0 }, { x: x1, y: h10, z: z0 },
        { x: x1, y: h11, z: z1 }, { x: x0, y: h01, z: z1 },
      ];
      items.push({
        depth,
        draw() {
          fillPoly(pts, css(fogMix(col, depth)));
        },
      });
    }
  }

  // ---- runway strip ----
  {
    const y = runwayHeight() + 0.6;
    const hw = RUNWAY.width / 2, hl = RUNWAY.length / 2;
    const corners = [
      { x: RUNWAY.x - hw, y, z: RUNWAY.z - hl },
      { x: RUNWAY.x + hw, y, z: RUNWAY.z - hl },
      { x: RUNWAY.x + hw, y, z: RUNWAY.z + hl },
      { x: RUNWAY.x - hw, y, z: RUNWAY.z + hl },
    ];
    const depth = Math.hypot(RUNWAY.x - S.cam.pos.x, RUNWAY.z - S.cam.pos.z);
    items.push({
      depth,
      draw() {
        fillPoly(corners, css(fogMix([52, 54, 62], depth)));
        // Centre dashes: white, every 60 units.
        const dashCol = css(fogMix([240, 240, 235], depth));
        for (let dz = -hl + 40; dz < hl - 40; dz += 60) {
          fillPoly([
            { x: RUNWAY.x - 2.2, y: y + 0.15, z: RUNWAY.z + dz },
            { x: RUNWAY.x + 2.2, y: y + 0.15, z: RUNWAY.z + dz },
            { x: RUNWAY.x + 2.2, y: y + 0.15, z: RUNWAY.z + dz + 26 },
            { x: RUNWAY.x - 2.2, y: y + 0.15, z: RUNWAY.z + dz + 26 },
          ], dashCol);
        }
        // Threshold bars at both ends.
        const barCol = css(fogMix([250, 250, 245], depth));
        for (const zend of [-hl + 14, hl - 26]) {
          for (let k = -3; k <= 3; k++) {
            fillPoly([
              { x: RUNWAY.x + k * 6 - 2.4, y: y + 0.15, z: RUNWAY.z + zend },
              { x: RUNWAY.x + k * 6 + 2.4, y: y + 0.15, z: RUNWAY.z + zend },
              { x: RUNWAY.x + k * 6 + 2.4, y: y + 0.15, z: RUNWAY.z + zend + 12 },
              { x: RUNWAY.x + k * 6 - 2.4, y: y + 0.15, z: RUNWAY.z + zend + 12 },
            ], barCol);
          }
        }
      },
    });
  }

  // ---- target rings (annulus fans) ----
  for (const ring of RINGS) {
    const depth = Math.hypot(ring.x - S.cam.pos.x, ring.y - S.cam.pos.y, ring.z - S.cam.pos.z);
    if (depth > 3600) continue;
    const isNext = S.nextRing === ring.index;
    const passed = ring.passed;
    const pulse = isNext ? 1 + 0.05 * Math.sin(S.elapsed * 5) : 1;
    // Normal = direction to the next ring.
    const nxt = RINGS[(ring.index + 1) % RINGS.length];
    const nd = [nxt.x - ring.x, nxt.y - ring.y, nxt.z - ring.z];
    const ndl = Math.hypot(nd[0], nd[1], nd[2]) || 1;
    const nn = [nd[0] / ndl, nd[1] / ndl, nd[2] / ndl];
    const up0 = [0, 1, 0];
    let u1 = [nn[1] * up0[2] - nn[2] * up0[1], nn[2] * up0[0] - nn[0] * up0[2], nn[0] * up0[1] - nn[1] * up0[0]];
    const u1l = Math.hypot(u1[0], u1[1], u1[2]) || 1;
    u1 = [u1[0] / u1l, u1[1] / u1l, u1[2] / u1l];
    const u2 = [nn[1] * u1[2] - nn[2] * u1[1], nn[2] * u1[0] - nn[0] * u1[2], nn[0] * u1[1] - nn[1] * u1[0]];
    const SEG = 22;
    const ringPts = (rad) => {
      const pts = [];
      for (let i = 0; i <= SEG; i++) {
        const a = (i / SEG) * TAU;
        pts.push({
          x: ring.x + (u1[0] * Math.cos(a) + u2[0] * Math.sin(a)) * rad * pulse,
          y: ring.y + (u1[1] * Math.cos(a) + u2[1] * Math.sin(a)) * rad * pulse,
          z: ring.z + (u1[2] * Math.cos(a) + u2[2] * Math.sin(a)) * rad * pulse,
        });
      }
      return pts;
    };
    const coreCol = passed ? [90, 220, 130] : isNext ? [255, 205, 80] : [255, 170, 60];
    const glowCol = passed ? [90, 220, 130] : [255, 180, 70];
    items.push({
      depth,
      draw() {
        // Annulus as per-segment quads, so the near plane clips
        // cleanly when the camera flies through the ring.
        const drawAnnulus = (rOut, rIn, fill) => {
          const outer = ringPts(rOut), inner = ringPts(rIn);
          for (let i = 0; i < SEG; i++) {
            fillPoly([outer[i], outer[i + 1], inner[i + 1], inner[i]], fill);
          }
        };
        drawAnnulus(ring.r + 5, ring.r - 5, css(glowCol, 0.22));
        drawAnnulus(ring.r + 2.4, ring.r - 2.4, css(fogMix(coreCol, depth)));
        // Ring number label at the centre.
        const cp = project({ x: ring.x, y: ring.y, z: ring.z });
        if (cp) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.font = `bold ${Math.max(13, Math.round(420 / cp.depth))}px sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(ring.index + 1), cp.x, cp.y);
        }
      },
    });
  }

  // ---- clouds (soft billboards) ----
  for (const cl of CLOUDS) {
    const depth = Math.hypot(cl.x - S.cam.pos.x, cl.y - S.cam.pos.y, cl.z - S.cam.pos.z);
    if (depth > 5200) continue;
    items.push({
      depth,
      draw() {
        const p = project({ x: cl.x, y: cl.y, z: cl.z });
        if (!p) return;
        const s = cl.s * p.scale;
        if (s < 4) return;
        const alpha = clamp(0.85 - depth / 6000, 0.25, 0.85);
        ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
        for (const [ox, oy, k] of [[-0.5, 0.08, 0.62], [0, -0.12, 0.78], [0.5, 0.06, 0.6], [0.15, 0.16, 0.5]]) {
          ctx.beginPath();
          ctx.ellipse(p.x + ox * s, p.y + oy * s, s * k, s * k * 0.42, 0, 0, TAU);
          ctx.fill();
        }
      },
    });
  }

  // ---- planes: the player, the wingman and the enemies ----
  // One helper draws any plane-like object (same triangles, its own
  // palette + attitude) into the painter's list.
  function drawPlaneObj(obj, palette, prop) {
    const tris = planeTriangles(prop, palette);
    const { f, r, u } = basis(obj.yaw, obj.pitch, obj.roll);
    const toWorld = (v) => ({
      x: obj.pos.x + r[0] * v[0] + u[0] * v[1] + f[0] * v[2],
      y: obj.pos.y + r[1] * v[0] + u[1] * v[1] + f[1] * v[2],
      z: obj.pos.z + r[2] * v[0] + u[2] * v[1] + f[2] * v[2],
    });
    const pdepth = Math.hypot(
      obj.pos.x - S.cam.pos.x,
      obj.pos.y - S.cam.pos.y,
      obj.pos.z - S.cam.pos.z
    );
    items.push({
      depth: pdepth,
      draw() {
        for (const tri of tris) {
          const w0 = toWorld(tri.v[0]), w1 = toWorld(tri.v[1]), w2 = toWorld(tri.v[2]);
          // Flat shading from the face normal vs the sun.
          let col = tri.c;
          if (!tri.glow) {
            const e1 = [w1.x - w0.x, w1.y - w0.y, w1.z - w0.z];
            const e2 = [w2.x - w0.x, w2.y - w0.y, w2.z - w0.z];
            let nx = e1[1] * e2[2] - e1[2] * e2[1];
            let ny = e1[2] * e2[0] - e1[0] * e2[2];
            let nz = e1[0] * e2[1] - e1[1] * e2[0];
            const nl = Math.hypot(nx, ny, nz) || 1;
            const lam = 0.6 + 0.4 * clamp((nx * sunN[0] + ny * sunN[1] + nz * sunN[2]) / nl * 0.5 + 0.5, 0, 1);
            col = shade(tri.c, lam * light.ambient + 0.15);
          }
          fillPoly([w0, w1, w2], css(col));
        }
      },
    });
  }
  // The player (skip in cockpit view: you ARE the pilot).
  if (S.view !== 'cockpit') {
    drawPlaneObj(S.plane, PALETTES.player, S.propAngle);
  }
  // The wingman: same coral plane, blue wings/fin.
  if (S.wingman) {
    drawPlaneObj(S.wingman, PALETTES.wingman, S.wingman.propAngle);
  }
  // Enemy fighters: dark charcoal with a dark-red fin.
  for (const e of (S.enemies || [])) {
    if (e.alive) drawPlaneObj(e, PALETTES.enemy, e.propAngle);
  }

  // ---- particles (ring-pass bursts, screen-space squares) ----
  for (const pt of S.particles) {
    const p = project({ x: pt.x, y: pt.y, z: pt.z });
    if (!p) continue;
    const size = clamp(pt.size * p.scale * 0.4, 1.5, 22);
    items.push({
      depth: p.depth,
      draw() {
        ctx.fillStyle = `rgba(${pt.c[0]},${pt.c[1]},${pt.c[2]},${(pt.life / pt.maxLife).toFixed(2)})`;
        ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      },
    });
  }

  // ---- bullets: glowing tracer segments ----
  for (const b of (S.bullets || [])) {
    const head = project(b.pos);
    const tail = project({
      x: b.pos.x - b.vel.x * 0.06,
      y: b.pos.y - b.vel.y * 0.06,
      z: b.pos.z - b.vel.z * 0.06,
    });
    if (!head || !tail) continue;
    const friendly = b.from !== 'enemy';
    items.push({
      depth: head.depth,
      draw() {
        ctx.strokeStyle = friendly ? 'rgba(255,220,120,0.95)' : 'rgba(255,90,60,0.95)';
        ctx.lineWidth = 3;
        ctx.shadowColor = friendly ? '#ffcf4d' : '#ff5a3c';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(tail.x, tail.y);
        ctx.lineTo(head.x, head.y);
        ctx.stroke();
        ctx.shadowBlur = 0;
      },
    });
  }

  // ---- enemy HP bars (small, above each living enemy) ----
  for (const e of (S.enemies || [])) {
    if (!e.alive) continue;
    const top = project({ x: e.pos.x, y: e.pos.y + 7, z: e.pos.z });
    if (!top) continue;
    const bw = 36;
    items.push({
      depth: top.depth,
      draw() {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(top.x - bw / 2, top.y - 14, bw, 6);
        ctx.fillStyle = e.hp > 50 ? '#5adc82' : e.hp > 25 ? '#ffd34d' : '#ff7a5c';
        ctx.fillRect(top.x - bw / 2 + 1, top.y - 13, (bw - 2) * (e.hp / 100), 4);
      },
    });
  }

  // Paint far to near.
  items.sort((a, b) => b.depth - a.depth);
  for (const it of items) it.draw();
}

// ---------- camera update ----------
// Chase: behind + above the plane, smoothed. Cockpit: at the pilot seat.
export function updateCamera(cam, plane, view, dt) {
  const { f, r, u } = basis(plane.yaw, plane.pitch, plane.roll);
  let target, tyaw, tpitch, troll;
  if (view === 'cockpit') {
    target = {
      x: plane.pos.x + f[0] * 2.2 + u[0] * 2.6,
      y: plane.pos.y + f[1] * 2.2 + u[1] * 2.6,
      z: plane.pos.z + f[2] * 2.2 + u[2] * 2.6,
    };
    tyaw = plane.yaw; tpitch = plane.pitch; troll = plane.roll;
  } else {
    const back = 40, up = 13;
    target = {
      x: plane.pos.x - f[0] * back + u[0] * up,
      y: plane.pos.y - f[1] * back + u[1] * up,
      z: plane.pos.z - f[2] * back + u[2] * up,
    };
    // Look slightly ahead of the plane.
    const look = {
      x: plane.pos.x + f[0] * 30,
      y: plane.pos.y + f[1] * 30,
      z: plane.pos.z + f[2] * 30,
    };
    const d = [look.x - target.x, look.y - target.y, look.z - target.z];
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    tyaw = Math.atan2(d[0], -d[2]);
    tpitch = Math.asin(clamp(d[1] / dl, -1, 1));
    troll = plane.roll * 0.35;
  }
  const k = view === 'cockpit' ? 1 : 1 - Math.pow(0.0001, dt); // smooth chase
  cam.pos.x = lerp(cam.pos.x, target.x, k);
  cam.pos.y = lerp(cam.pos.y, target.y, k);
  cam.pos.z = lerp(cam.pos.z, target.z, k);
  cam.yaw = lerp(cam.yaw, cam.yaw + wrapAngle(tyaw - cam.yaw), k);
  cam.pitch = lerp(cam.pitch, tpitch, k);
  cam.roll = lerp(cam.roll, troll, k);
}
