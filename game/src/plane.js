// plane.js — arcade flight physics for Langit Biru.
// Forgiving on purpose: the fun is threading rings, not fighting a
// simulator. Speed comes from the throttle, lift comes from speed,
// and the wings bank you into turns like a real plane.

import { clamp, wrapAngle } from './util.js';
import { groundHeight, onRunway, RINGS, runwayHeight } from './world.js';

// A fresh plane, parked at the south end of the runway, nose north.
export function newPlane() {
  return {
    pos: { x: 0, y: runwayHeight() + 0.4, z: 900 + 290 },
    yaw: 0,           // north, down the runway toward ring 1
    pitch: 0,
    roll: 0,
    speed: 0,          // units per second
    throttle: 0,       // 0..1
    onGround: true,
    propAngle: 0,
    vy: 0,             // vertical speed, for smooth climb/sink
  };
}

// One physics step. `input` = { pitch: -1..1 (stick back = up),
// roll: -1..1, yaw: -1..1, throttle: -1..1 (delta), brake: bool }.
// Returns events: { ring: index|null, crashed: bool, landed: bool }.
export function stepPlane(p, input, dt) {
  const ev = { ring: null, crashed: false, landed: false };

  // Throttle: W/S nudge it, Shift full, Ctrl idle.
  p.throttle = clamp(p.throttle + input.throttle * dt * 0.55, 0, 1);
  if (input.brake) p.throttle = Math.max(0, p.throttle - dt * 1.2);

  // Attitude: pitch and roll chase the stick with a little lag.
  const targetPitch = clamp(input.pitch * 0.42, -0.42, 0.42);
  const targetRoll = clamp(input.roll * 1.05, -1.05, 1.05);
  p.pitch += (targetPitch - p.pitch) * Math.min(1, dt * 3.2);
  p.roll += (targetRoll - p.roll) * Math.min(1, dt * 3.0);

  // Banked turns: rolling turns the nose (coordinated turn).
  p.yaw += input.yaw * dt * 0.5 - Math.sin(p.roll) * dt * 0.55;
  p.yaw = wrapAngle(p.yaw);

  // Speed: throttle pushes, drag pulls. Top speed ~95 u/s (~185 kt).
  // Idle throttle means no thrust: the plane rolls to a stop.
  const maxSpeed = p.throttle * 95;
  const accel = (maxSpeed - p.speed) * 0.55;
  p.speed = clamp(p.speed + accel * dt, 0, 110);

  // Lift: the wings hold the plane up at cruise speed. At level
  // attitude the plane holds altitude; below ~60 u/s it sinks
  // (a stall sink, not a fall), and pitch converts speed to climb.
  const lift = clamp(p.speed / 60, 0, 1);
  const sink = 12 * (1 - lift);
  const targetVy = clamp(Math.sin(p.pitch) * p.speed * 0.65 - sink, -25, 28);
  p.vy += (targetVy - p.vy) * Math.min(1, dt * 2.2);

  // Move along the nose.
  const cp = Math.cos(p.pitch);
  p.pos.x += Math.sin(p.yaw) * cp * p.speed * dt;
  p.pos.z += -Math.cos(p.yaw) * cp * p.speed * dt;
  p.pos.y += p.vy * dt;

  // Propeller spins with throttle.
  p.propAngle += (2 + p.throttle * 55) * dt;

  // Ground: wheels on the strip, or a crash into terrain/sea.
  const ground = groundHeight(p.pos.x, p.pos.z);
  const gearH = 1.6;
  if (p.pos.y <= ground + gearH) {
    const hardImpact = Math.abs(p.vy) > 12;
    if (onRunway(p.pos.x, p.pos.z) && !hardImpact) {
      // The runway is safe at any speed: taxi, takeoff roll, touchdown.
      p.pos.y = ground + gearH;
      p.onGround = true;
      p.vy = 0;
      p.pitch *= 0.6; p.roll *= 0.6;
      if (p.speed < 0.5 && p.throttle < 0.05) p.speed = 0; // parked
      if (p.speed > 0.5) ev.landed = true; // main.js gates on wasAirborne
    } else if (hardImpact || p.speed > 40) {
      ev.crashed = true;
    } else {
      // Gentle touch on grass: a rough landing, not a crash.
      p.pos.y = ground + gearH;
      p.onGround = true;
      p.vy = 0;
      p.speed *= 0.92;
    }
  } else {
    p.onGround = false;
  }

  // World bounds: soft turn-back past the edge.
  const R = 2950;
  const d = Math.hypot(p.pos.x, p.pos.z);
  if (d > R) {
    // Steer back toward the centre.
    const home = Math.atan2(-p.pos.x, p.pos.z);
    p.yaw += wrapAngle(home - p.yaw) * Math.min(1, dt * 1.5);
  }
  // Ceiling.
  if (p.pos.y > 620) { p.pos.y = 620; p.vy = Math.min(p.vy, 0); }

  // Ring check: pass through the disc of the NEXT ring only.
  // Project the offset onto the ring's normal: you must cross the
  // ring's plane (|along| < 6) inside the hole (perp < r - 4).
  const ring = RINGS.find((r) => !r.passed);
  if (ring && !p.onGround) {
    const nxt = RINGS[(ring.index + 1) % RINGS.length];
    const nd = [nxt.x - ring.x, nxt.y - ring.y, nxt.z - ring.z];
    const ndl = Math.hypot(nd[0], nd[1], nd[2]) || 1;
    const nn = [nd[0] / ndl, nd[1] / ndl, nd[2] / ndl];
    const ox = p.pos.x - ring.x, oy = p.pos.y - ring.y, oz = p.pos.z - ring.z;
    const along = ox * nn[0] + oy * nn[1] + oz * nn[2];
    const perp = Math.hypot(ox - nn[0] * along, oy - nn[1] * along, oz - nn[2] * along);
    if (Math.abs(along) < 7 && perp < ring.r - 4) {
      ring.passed = true;
      ev.ring = ring.index;
    }
  }
  return ev;
}

// Reset all rings for a new flight.
export function resetRings() {
  for (const r of RINGS) r.passed = false;
}

// Heading in degrees, compass style (0 = N, 90 = E, 180 = S, 270 = W).
export function headingDeg(p) {
  return ((p.yaw * 180) / Math.PI + 360) % 360;
}

// Knots and feet, for the HUD (1 unit = 10 ft, speed in kt = u/s * 1.9).
export function knots(p) { return Math.round(p.speed * 1.9); }
export function feet(p) { return Math.round(p.pos.y * 10); }
