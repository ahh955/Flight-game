// combat.js — dogfight layer for Langit Biru: Island Run.
// Two friendly planes (the player + a wingman) trade fire with two
// enemy fighters. Bullets, hull HP, explosions and kill bonuses.
// The ring mission stays the main goal; combat is an extra layer
// that starts once the first ring is passed.

import { clamp, wrapAngle } from './util.js';

// Forward / right / up unit vectors from a plane's yaw + pitch.
// (Same convention as the renderer's basis(): yaw 0 = north (-z).)
function forwardOf(p) {
  const cp = Math.cos(p.pitch);
  return [Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp];
}
function rightOf(p) {
  return [Math.cos(p.yaw), 0, Math.sin(p.yaw)];
}
function upOf(p) {
  const f = forwardOf(p), r = rightOf(p);
  return [
    r[1] * f[2] - r[2] * f[1],
    r[2] * f[0] - r[0] * f[2],
    r[0] * f[1] - r[1] * f[0],
  ];
}
function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale3(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function len3(a) { return Math.hypot(a[0], a[1], a[2]); }
function norm3(a) {
  const l = len3(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

// Fresh combat state for a new flight.
export function newCombatState() {
  return {
    enemies: [],       // { pos, yaw, pitch, roll, speed, throttle, hp, alive, fireCd, evadeT, propAngle }
    bullets: [],       // { pos, vel, life, from, damage }
    wingman: null,     // { pos, yaw, pitch, roll, speed, throttle, propAngle, fireCd }
    playerHp: 100,
    kills: 0,
    enemiesSpawned: false,
    fireCd: 0,         // player fire cooldown (seconds)
  };
}

function newEnemy(x, y, z, yaw) {
  return {
    pos: { x, y, z },
    yaw, pitch: 0, roll: 0,
    speed: 62, throttle: 0.7,
    hp: 100, alive: true,
    fireCd: 0.5 + Math.random() * 0.6,
    evadeT: 0,
    propAngle: Math.random() * 6,
  };
}

function newWingman(p) {
  const f = forwardOf(p), r = rightOf(p), u = upOf(p);
  const off = add3(add3(scale3(r, 30), scale3(f, 0)), scale3(u, 4));
  const pos = add3([p.pos.x, p.pos.y, p.pos.z], off);
  return {
    pos: { x: pos[0], y: pos[1], z: pos[2] },
    yaw: p.yaw, pitch: p.pitch, roll: p.roll,
    speed: p.speed, throttle: p.throttle,
    propAngle: p.propAngle, fireCd: 0.2,
  };
}

// Spawn the fight: the wingman joins in formation and two enemy
// fighters appear ahead of the player, chasing.
export function spawnEnemies(G) {
  const c = G.combat;
  if (c.enemiesSpawned) return;
  c.enemiesSpawned = true;
  c.wingman = newWingman(G.plane);
  const f = forwardOf(G.plane);
  const p = G.plane.pos;
  c.enemies = [
    newEnemy(p.x + f[0] * 420, p.y + 25, p.z + f[2] * 420, wrapAngle(G.plane.yaw + Math.PI)),
    newEnemy(p.x + f[0] * 520 + 130, p.y + 55, p.z + f[2] * 520 - 90, wrapAngle(G.plane.yaw + Math.PI + 0.4)),
  ];
  G.message = 'MUSUH DI UDARA — WINGMAN MENEMANI!';
  G.messageT = 2.5;
}

// Explosion burst: hot fire + grey smoke, using the game's particle
// list (same shape as the ring-pass burst in main.js).
export function explodeAt(G, pos, big) {
  const n = big ? 70 : 40;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const b = Math.random() * Math.PI - Math.PI / 2;
    const sp = 14 + Math.random() * (big ? 60 : 40);
    const fire = Math.random() < 0.6;
    G.particles.push({
      x: pos.x, y: pos.y, z: pos.z,
      vx: Math.cos(a) * Math.cos(b) * sp,
      vy: Math.sin(b) * sp + 6,
      vz: Math.sin(a) * Math.cos(b) * sp,
      life: 0.8 + Math.random() * (big ? 1.6 : 0.8),
      maxLife: big ? 2.4 : 1.6,
      c: fire
        ? (Math.random() < 0.5 ? [255, 140, 40] : [255, 70, 30])
        : [110, 110, 115],
      size: 6 + Math.random() * (big ? 14 : 9),
    });
  }
}

// Muzzle flash: a few bright sparks at the nose.
function muzzle(G, pos) {
  for (let i = 0; i < 3; i++) {
    G.particles.push({
      x: pos.x, y: pos.y, z: pos.z,
      vx: (Math.random() - 0.5) * 12, vy: (Math.random() - 0.5) * 12,
      vz: (Math.random() - 0.5) * 12,
      life: 0.1 + Math.random() * 0.06, maxLife: 0.16,
      c: [255, 225, 140], size: 7 + Math.random() * 6,
    });
  }
}

// Fire one bullet from a plane's nose along its forward vector.
function fireBullet(G, plane, from, damage, spread) {
  const f = forwardOf(plane);
  const nose = add3([plane.pos.x, plane.pos.y, plane.pos.z], scale3(f, 8));
  const aim = [f[0], f[1], f[2]];
  if (spread) {
    aim[0] += (Math.random() - 0.5) * spread;
    aim[1] += (Math.random() - 0.5) * spread;
    aim[2] += (Math.random() - 0.5) * spread;
  }
  const dir = norm3(aim);
  const speed = plane.speed + 260;
  G.combat.bullets.push({
    pos: { x: nose[0], y: nose[1], z: nose[2] },
    vel: { x: dir[0] * speed, y: dir[1] * speed, z: dir[2] * speed },
    life: 2.2, from, damage,
  });
  muzzle(G, nose);
}

// Steer a flyer (enemy or wingman) toward a target point.
function steerToward(obj, target, dt, turnRate) {
  const d = [target.x - obj.pos.x, target.y - obj.pos.y, target.z - obj.pos.z];
  const dist = Math.hypot(d[0], d[1], d[2]) || 1;
  const wantYaw = Math.atan2(d[0], -d[2]);
  const wantPitch = Math.asin(clamp(d[1] / dist, -1, 1));
  const dy = wrapAngle(wantYaw - obj.yaw);
  obj.yaw = wrapAngle(obj.yaw + clamp(dy, -turnRate * dt, turnRate * dt));
  obj.pitch += clamp(wantPitch - obj.pitch, -turnRate * 0.7 * dt, turnRate * 0.7 * dt);
  obj.pitch = clamp(obj.pitch, -0.45, 0.45);
  obj.roll += (clamp(-dy * 0.9, -1, 1) - obj.roll) * Math.min(1, dt * 3);
  return dist;
}

function moveFlyer(obj, dt) {
  const f = forwardOf(obj);
  obj.pos.x += f[0] * obj.speed * dt;
  obj.pos.y += f[1] * obj.speed * dt;
  obj.pos.z += f[2] * obj.speed * dt;
  obj.propAngle += (2 + obj.throttle * 55) * dt;
  // Ceiling and floor: stay in the sky, above the sea.
  if (obj.pos.y > 600) { obj.pos.y = 600; obj.pitch = Math.min(obj.pitch, 0); }
  if (obj.pos.y < 30) { obj.pos.y = 30; obj.pitch = Math.max(obj.pitch, 0.08); }
  // Soft turn-back at the world edge.
  const R = 2950;
  const d = Math.hypot(obj.pos.x, obj.pos.z);
  if (d > R) {
    const home = Math.atan2(-obj.pos.x, obj.pos.z);
    obj.yaw += wrapAngle(home - obj.yaw) * Math.min(1, dt * 1.5);
  }
}

// One combat step. `firing` = the player holds Space / mouse.
// Returns { shotdown: bool, kill: enemy|null }.
export function stepCombat(G, dt, firing) {
  const c = G.combat;
  const ev = { shotdown: false, kill: null };
  const p = G.plane;

  // The fight starts once the first ring is passed.
  if (!c.enemiesSpawned) {
    const r0 = G.nextRing;
    if (r0 === 1 || (c.enemiesSpawned === false && G.score >= 100)) {
      spawnEnemies(G);
    }
  }

  // --- player fire (Space / mouse), ~6 shots per second ---
  c.fireCd -= dt;
  if (firing && c.fireCd <= 0) {
    fireBullet(G, p, 'player', 25, 0.012);
    c.fireCd = 1 / 6;
  }

  // --- wingman: hold formation, shoot the nearest enemy ---
  const w = c.wingman;
  if (w) {
    const f = forwardOf(p), r = rightOf(p), u = upOf(p);
    const off = add3(add3(scale3(r, 30), scale3(f, 0)), scale3(u, 4));
    const target = {
      x: p.pos.x + off[0], y: p.pos.y + off[1], z: p.pos.z + off[2],
    };
    const dist = steerToward(w, target, dt, 2.2);
    w.speed = clamp(dist > 120 ? 105 : p.speed, 20, 110);
    w.throttle = clamp(p.throttle, 0.2, 1);
    moveFlyer(w, dt);
    // Fire at the nearest living enemy in front of the wingman.
    w.fireCd -= dt;
    let best = null, bestD = 700;
    for (const e of c.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - w.pos.x, e.pos.y - w.pos.y, e.pos.z - w.pos.z);
      if (d < bestD) { best = e; bestD = d; }
    }
    if (best && w.fireCd <= 0) {
      const wf = forwardOf(w);
      const toE = norm3([best.pos.x - w.pos.x, best.pos.y - w.pos.y, best.pos.z - w.pos.z]);
      if (dot3(wf, toE) > 0.75) {
        // Aim the wingman's nose at the enemy before firing.
        const saveYaw = w.yaw, savePitch = w.pitch;
        w.yaw = Math.atan2(toE[0], -toE[2]);
        w.pitch = Math.asin(clamp(toE[1], -1, 1));
        fireBullet(G, w, 'wingman', 15, 0.03);
        w.yaw = saveYaw; w.pitch = savePitch;
        w.fireCd = 0.3;
      }
    }
  }

  // --- enemies: chase the player, evade, shoot back ---
  const pVel = scale3(forwardOf(p), p.speed);
  for (const e of c.enemies) {
    if (!e.alive) continue;
    // Evade: a friendly bullet closing in makes the enemy break away.
    if (e.evadeT <= 0) {
      for (const b of c.bullets) {
        if (b.from === 'enemy') continue;
        const d = Math.hypot(b.pos.x - e.pos.x, b.pos.y - e.pos.y, b.pos.z - e.pos.z);
        if (d < 90 && dot3([b.vel.x, b.vel.y, b.vel.z], [e.pos.x - b.pos.x, e.pos.y - b.pos.y, e.pos.z - b.pos.z]) > 0) {
          e.evadeT = 0.7;
          break;
        }
      }
    }
    if (e.evadeT > 0) {
      e.evadeT -= dt;
      e.roll = clamp(e.roll + dt * 2.4, -1.1, 1.1);
      e.pitch = clamp(e.pitch + dt * 0.4, -0.45, 0.45);
      e.speed = clamp(e.speed + 12 * dt, 0, 100);
    } else {
      // Chase: aim at where the player will be, keep 150–300 distance.
      const distP = Math.hypot(p.pos.x - e.pos.x, p.pos.y - e.pos.y, p.pos.z - e.pos.z);
      const lead = 0.6;
      const aimPt = {
        x: p.pos.x + pVel[0] * lead,
        y: p.pos.y + pVel[1] * lead,
        z: p.pos.z + pVel[2] * lead,
      };
      if (distP < 150) {
        // Too close: break off and climb instead of ramming.
        aimPt.x = e.pos.x - (p.pos.x - e.pos.x);
        aimPt.y = e.pos.y + 80;
        aimPt.z = e.pos.z - (p.pos.z - e.pos.z);
      }
      steerToward(e, aimPt, dt, 0.9);
      e.speed = clamp(e.speed + (distP > 300 ? 14 : -6) * dt, 45, 95);
      e.throttle = clamp(e.speed / 95, 0.2, 1);
    }
    moveFlyer(e, dt);
    // Shoot: player in the forward cone, within 600, ~35% accuracy
    // via a random spread on the predicted position.
    e.fireCd -= dt;
    const toP = [p.pos.x - e.pos.x, p.pos.y - e.pos.y, p.pos.z - e.pos.z];
    const distP = len3(toP);
    if (e.fireCd <= 0 && distP < 600 && e.evadeT <= 0) {
      const ef = forwardOf(e);
      const dirP = norm3(toP);
      if (dot3(ef, dirP) > 0.86) {
        const flight = distP / 300;
        const aimPt = [
          p.pos.x + pVel[0] * flight + (Math.random() - 0.5) * 16,
          p.pos.y + pVel[1] * flight + (Math.random() - 0.5) * 16,
          p.pos.z + pVel[2] * flight + (Math.random() - 0.5) * 16,
        ];
        const dir = norm3([aimPt[0] - e.pos.x, aimPt[1] - e.pos.y, aimPt[2] - e.pos.z]);
        const nose = add3([e.pos.x, e.pos.y, e.pos.z], scale3(dir, 8));
        const speed = e.speed + 260;
        c.bullets.push({
          pos: { x: nose[0], y: nose[1], z: nose[2] },
          vel: { x: dir[0] * speed, y: dir[1] * speed, z: dir[2] * speed },
          life: 2.2, from: 'enemy', damage: 8,
        });
        muzzle(G, nose);
        e.fireCd = 0.45 + Math.random() * 0.3;
      }
    }
  }

  // --- bullets: move, hit, expire ---
  const hitR = 7;
  for (const b of c.bullets) {
    b.pos.x += b.vel.x * dt;
    b.pos.y += b.vel.y * dt;
    b.pos.z += b.vel.z * dt;
    b.life -= dt;
    if (b.life <= 0 || b.pos.y < 1) { b.dead = true; continue; }
    if (b.from === 'enemy') {
      const d = Math.hypot(b.pos.x - p.pos.x, b.pos.y - p.pos.y, b.pos.z - p.pos.z);
      if (d < hitR) {
        b.dead = true;
        c.playerHp -= b.damage;
        // Hit spark on the player's nose.
        for (let i = 0; i < 6; i++) {
          G.particles.push({
            x: p.pos.x, y: p.pos.y, z: p.pos.z,
            vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30,
            vz: (Math.random() - 0.5) * 30,
            life: 0.25, maxLife: 0.3, c: [255, 90, 60], size: 6 + Math.random() * 5,
          });
        }
        if (c.playerHp <= 0) {
          c.playerHp = 0;
          explodeAt(G, p.pos, true);
          ev.shotdown = true;
        }
      }
    } else {
      for (const e of c.enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(b.pos.x - e.pos.x, b.pos.y - e.pos.y, b.pos.z - e.pos.z);
        if (d < hitR) {
          b.dead = true;
          e.hp -= b.damage;
          for (let i = 0; i < 6; i++) {
            G.particles.push({
              x: e.pos.x, y: e.pos.y, z: e.pos.z,
              vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30,
              vz: (Math.random() - 0.5) * 30,
              life: 0.25, maxLife: 0.3, c: [255, 210, 90], size: 6 + Math.random() * 5,
            });
          }
          if (e.hp <= 0) {
            e.hp = 0;
            e.alive = false;
            explodeAt(G, e.pos, true);
            c.kills += 1;
            ev.kill = e;
          }
          break;
        }
      }
    }
  }
  c.bullets = c.bullets.filter((b) => !b.dead);
  return ev;
}
