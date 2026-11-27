// shots.js — staged scenes for the four screenshots.
// ?shot=1..4 puts the game in a fixed, deterministic state and renders
// it with no input needed, so the screenshots are real gameplay frames:
// the plane, the terrain, the rings and the HUD are all live.

import { newPlane, resetRings } from './plane.js';
import { RINGS } from './world.js';
import { basis } from './render.js';
import { clamp } from './util.js';
import { newCombatState } from './combat.js';

// Place the camera for a staged scene: chase (behind + above, looking
// ahead of the plane) or cockpit (at the pilot seat). `back`/`up`
// widen the chase framing (shot 3 pulls back so the wingman and the
// enemy fit in the same frame).
function placeCamera(G, view, back, up) {
  const p = G.plane;
  const { f, u } = basis(p.yaw, p.pitch, p.roll);
  if (view === 'cockpit') {
    G.cam.pos = {
      x: p.pos.x + f[0] * 2.2 + u[0] * 2.6,
      y: p.pos.y + f[1] * 2.2 + u[1] * 2.6,
      z: p.pos.z + f[2] * 2.2 + u[2] * 2.6,
    };
    G.cam.yaw = p.yaw; G.cam.pitch = p.pitch; G.cam.roll = p.roll;
    return;
  }
  const b = back === undefined ? 44 : back;
  const upv = up === undefined ? 10 : up;
  G.cam.pos = {
    x: p.pos.x - f[0] * b + u[0] * upv,
    y: p.pos.y - f[1] * b + u[1] * upv,
    z: p.pos.z - f[2] * b + u[2] * upv,
  };
  const look = { x: p.pos.x + f[0] * 30, y: p.pos.y + f[1] * 30, z: p.pos.z + f[2] * 30 };
  const d = [look.x - G.cam.pos.x, look.y - G.cam.pos.y, look.z - G.cam.pos.z];
  const dl = Math.hypot(d[0], d[1], d[2]) || 1;
  G.cam.yaw = Math.atan2(d[0], -d[2]);
  G.cam.pitch = Math.asin(clamp(d[1] / dl, -1, 1));
  G.cam.roll = p.roll * 0.35;
}

// G is the game state object from main.js.
export function stageShot(n, G) {
  resetRings();
  G.score = 0;
  G.timeLeft = 180;
  G.message = '';
  G.messageT = 0;
  G.particles = [];
  G.wasAirborne = false;
  G.combat = newCombatState(); // no fight in shots 1, 2, 4 (set below for 3)

  if (n === 1) {
    // Takeoff, cockpit view, dawn: on the runway, throttle up,
    // instruments lit, runway stretching ahead.
    G.plane = newPlane();
    G.plane.throttle = 0.85;
    G.plane.speed = 34;
    G.view = 'cockpit';
    G.time = 6.6;
    G.state = 'flying';
    placeCamera(G, 'cockpit');
  } else if (n === 2) {
    // Chase view threading ring 2 over the sea between the islands.
    G.plane = newPlane();
    G.plane.pos = { x: -560, y: 200, z: 60 };
    G.plane.yaw = -0.59; G.plane.pitch = 0.02; G.plane.roll = 0.35;
    G.plane.speed = 72; G.plane.throttle = 0.8; G.plane.onGround = false;
    G.plane.propAngle = 2.4;
    RINGS[0].passed = true;
    G.score = 100;
    G.view = 'chase';
    G.time = 12.0;
    G.state = 'flying';
    placeCamera(G, 'chase');
  } else if (n === 3) {
    // Sunset DOGFIGHT in front of Gunung Api: two friendly planes
    // (the player + a blue-winged wingman in formation) trading fire
    // with two enemy fighters, the volcano's smoking cone and its
    // lava-lit flank behind them, sea and sunset sky around it.
    // Fixed values, no randomness — the frame is frozen while G.shot
    // is set, so the tracers stay put. Staged a good way off the
    // volcano (about 1100 units) so the fight reads against the
    // mountain instead of getting lost inside it.
    const yaw = -1.79; // facing north-west, toward the volcano
    G.plane = newPlane();
    G.plane.pos = { x: -650, y: 360, z: -950 };
    G.plane.yaw = yaw; G.plane.pitch = 0.05; G.plane.roll = -0.25;
    G.plane.speed = 66; G.plane.throttle = 0.72; G.plane.onGround = false;
    G.plane.propAngle = 5.1;
    for (let i = 0; i < 4; i++) RINGS[i].passed = true;
    G.score = 400;
    G.view = 'chase';
    G.time = 18.3;
    G.state = 'flying';
    // Combat state, staged explicitly. Enemies close enough to read
    // (dark fuselage + red fin + HP bar) on the volcano's flank, the
    // wingman fully in frame right-behind the player, tracers strung
    // between the two sides.
    const fx = Math.sin(yaw), fz = -Math.cos(yaw); // player forward
    const rx = Math.cos(yaw), rz = Math.sin(yaw); // player right
    const e1 = { x: -650 + fx * 180 - rx * 30, y: 375, z: -950 + fz * 180 - rz * 30 };
    const e2 = { x: -650 + fx * 260 + rx * 70, y: 395, z: -950 + fz * 260 + rz * 70 };
    G.combat.enemiesSpawned = true;
    G.combat.playerHp = 100;
    G.combat.enemies = [
      { pos: e1, yaw: yaw + Math.PI, pitch: 0, roll: 0.2, speed: 60, throttle: 0.7, hp: 55, alive: true, fireCd: 0.4, evadeT: 0, propAngle: 1.2 },
      { pos: e2, yaw: yaw + Math.PI, pitch: 0, roll: 0.3, speed: 60, throttle: 0.7, hp: 100, alive: true, fireCd: 0.9, evadeT: 0, propAngle: 3.0 },
    ];
    G.combat.wingman = {
      pos: { x: -650 + rx * 30, y: 365, z: -950 + rz * 30 },
      yaw, pitch: 0.05, roll: -0.25, speed: 66, throttle: 0.72, propAngle: 5.1, fireCd: 0.1,
    };
    // Tracers already in flight: the player and the wingman firing at
    // enemy 1, and one enemy round heading for the player.
    const nose = { x: -650 + fx * 8, y: 360, z: -950 + fz * 8 };
    const wNose = {
      x: G.combat.wingman.pos.x + fx * 8,
      y: G.combat.wingman.pos.y,
      z: G.combat.wingman.pos.z + fz * 8,
    };
    const dirTo = (a, b) => {
      const d = [b.x - a.x, b.y - a.y, b.z - a.z];
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      return [d[0] / l, d[1] / l, d[2] / l];
    };
    const d1 = dirTo(nose, e1);
    const dw = dirTo(wNose, e1);
    const de = dirTo(e1, { x: -650, y: 360, z: -950 });
    const mkBullet = (fromPos, dir, t, from, damage) => ({
      pos: { x: fromPos.x + dir[0] * t, y: fromPos.y + dir[1] * t, z: fromPos.z + dir[2] * t },
      vel: { x: dir[0] * 320, y: dir[1] * 320, z: dir[2] * 320 },
      life: 1.5, from, damage,
    });
    G.combat.bullets = [
      mkBullet(nose, d1, 40, 'player', 25),
      mkBullet(nose, d1, 90, 'player', 25),
      mkBullet(nose, d1, 140, 'player', 25),
      mkBullet(nose, d1, 185, 'player', 25),
      mkBullet(wNose, dw, 60, 'wingman', 15),
      mkBullet(e1, de, 90, 'enemy', 8),
    ];
    // Pulled-back chase camera so the wingman (right-back), the
    // enemy ahead and the volcano behind them share the frame.
    placeCamera(G, 'chase', 70, 22);
  } else {
    // Landing / final score: parked on the runway, mission complete.
    G.plane = newPlane();
    G.plane.pos = { x: 0, y: 15.6, z: 820 };
    G.plane.yaw = 0; G.plane.speed = 0; G.plane.throttle = 0;
    G.plane.onGround = true;
    for (const r of RINGS) r.passed = true;
    G.score = 1300; // 8 rings x 100 + 500 landing bonus
    G.view = 'chase';
    G.time = 12.0;
    G.state = 'landed';
    placeCamera(G, 'chase');
  }
  G.nextRing = RINGS.find((r) => !r.passed)?.index ?? null;
}
