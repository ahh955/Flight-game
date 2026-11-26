// main.js — Langit Biru: Island Run.
// Game loop, input, states (menu -> flying -> landed/crashed),
// ring scoring, particles, camera and the screenshot staging hook.
// The 3D world lives in world.js, the renderer in render.js,
// the instruments in hud.js, the flight model in plane.js.
//
// How to play: W/S throttle, ArrowUp/Down pitch, ArrowLeft/Right bank,
// A/D rudder, C camera, R restart. Fly through all 8 gold rings,
// then land on the runway for a +500 bonus. 180 seconds on the clock.

import { clamp, TAU } from './util.js';
import { daylight, RINGS } from './world.js';
import { newPlane, resetRings, stepPlane } from './plane.js';
import { renderScene, updateCamera } from './render.js';
import { drawEnd, drawHUD, drawMenu } from './hud.js';
import { stageShot } from './shots.js';
import { newCombatState, stepCombat } from './combat.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

export const G = {
  state: 'menu', // menu | flying | landed | crashed | shotdown
  plane: newPlane(),
  cam: { pos: { x: 0, y: 30, z: 1260 }, yaw: 0, pitch: 0, roll: 0 },
  view: 'chase',
  time: 9.5,       // time of day (hours); drifts slowly while flying
  score: 0,
  timeLeft: 180,
  nextRing: 0,
  particles: [],
  propAngle: 0,
  elapsed: 0,
  message: '',
  messageT: 0,
  wasAirborne: false,
  shot: 0,
  combat: newCombatState(),
  firing: false,   // Space / mouse held: shoot
};

const keys = {};
let audio = null;
let mouseDown = false;

function beep(freq, dur, type, gain) {
  try {
    if (!audio) return;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain || 0.12, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + dur);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + dur);
  } catch (e) { /* audio is best-effort */ }
}

function ensureAudio() {
  if (!audio) {
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio = null; }
  }
  if (audio && audio.state === 'suspended') audio.resume();
}

// Ring-pass burst: gold + white sparks at the ring centre.
function burst(ring) {
  for (let i = 0; i < 42; i++) {
    const a = Math.random() * TAU;
    const b = Math.random() * Math.PI - Math.PI / 2;
    const sp = 18 + Math.random() * 42;
    G.particles.push({
      x: ring.x, y: ring.y, z: ring.z,
      vx: Math.cos(a) * Math.cos(b) * sp,
      vy: Math.sin(b) * sp,
      vz: Math.sin(a) * Math.cos(b) * sp,
      life: 0.9 + Math.random() * 0.5, maxLife: 1.4,
      c: Math.random() < 0.5 ? [255, 205, 80] : [255, 255, 255],
      size: 5 + Math.random() * 9,
    });
  }
}

function startFlight() {
  resetRings();
  G.plane = newPlane();
  G.score = 0;
  G.timeLeft = 180;
  G.nextRing = 0;
  G.particles = [];
  G.message = ''; G.messageT = 0;
  G.wasAirborne = false;
  G.time = 9.5;
  G.combat = newCombatState();
  G.firing = false;
  G.state = 'flying';
  ensureAudio();
}

function endFlight(landed) {
  if (landed && RINGS.every((r) => r.passed)) {
    G.score += 500;
    G.message = 'LANDING BONUS +500';
    G.messageT = 2;
  }
  G.state = landed ? 'landed' : 'crashed';
  if (!landed) beep(110, 0.5, 'sawtooth', 0.15);
}

function update(dt) {
  G.elapsed += dt;
  if (G.state === 'flying') {
    G.timeLeft -= dt;
    if (G.timeLeft <= 0) {
      G.timeLeft = 0;
      endFlight(G.plane.onGround);
      return;
    }
    // Slow drift of the sun while flying (a full flight spans ~1h).
    G.time += dt * 0.004;

    const input = {
      pitch: (keys['ArrowUp'] ? 1 : 0) - (keys['ArrowDown'] ? 1 : 0),
      roll: (keys['ArrowLeft'] ? 1 : 0) - (keys['ArrowRight'] ? 1 : 0),
      yaw: (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0),
      throttle: (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0) + (keys['ShiftLeft'] || keys['ShiftRight'] ? 1.2 : 0),
      brake: !!keys['KeyB'],
    };
    const ev = stepPlane(G.plane, input, dt);
    if (!G.plane.onGround) G.wasAirborne = true;

    if (ev.ring !== null && ev.ring !== undefined) {
      const ring = RINGS[ev.ring];
      G.score += 100;
      G.message = `RING ${ev.ring + 1}!  +100`;
      G.messageT = 2.2;
      burst(ring);
      beep(880, 0.12, 'sine', 0.14);
      setTimeout(() => beep(1318, 0.2, 'sine', 0.12), 90);
      G.nextRing = RINGS.find((r) => !r.passed)?.index ?? null;
    }
    if (ev.crashed) {
      endFlight(false);
      return;
    }
    if (ev.landed && G.wasAirborne) {
      G.wasAirborne = false;
      if (RINGS.every((r) => r.passed)) {
        endFlight(true);
        return;
      }
      G.message = 'TOUCHDOWN — LANJUT TERBANG!';
      G.messageT = 2;
    }

    // Dogfight: wingman + enemies, bullets, hull damage.
    const combatEv = stepCombat(G, dt, !!keys['Space'] || mouseDown);
    if (combatEv.kill) {
      G.score += 200;
      G.message = 'MUSUH HANCUR +200';
      G.messageT = 2.2;
      beep(660, 0.15, 'square', 0.12);
    }
    if (combatEv.shotdown) {
      G.state = 'shotdown';
      beep(110, 0.6, 'sawtooth', 0.15);
      return;
    }
  }

  if (G.messageT > 0) G.messageT -= dt;

  // Particles drift and fade.
  for (const pt of G.particles) {
    pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.z += pt.vz * dt;
    pt.vy -= 6 * dt;
    pt.life -= dt;
  }
  G.particles = G.particles.filter((pt) => pt.life > 0);

  // Camera follows the plane.
  updateCamera(G.cam, G.plane, G.view, dt);
  G.propAngle = G.plane.propAngle;
}

function render() {
  const light = daylight(G.time);
  renderScene({
    ctx, w: W, h: H,
    cam: G.cam, plane: G.plane, view: G.view,
    time: G.time, light,
    rings: RINGS, particles: G.particles,
    nextRing: G.nextRing, propAngle: G.propAngle,
    score: G.score, elapsed: G.elapsed,
    enemies: G.combat.enemies, bullets: G.combat.bullets,
    wingman: G.combat.wingman,
  });
  if (G.state === 'menu') {
    drawMenu(ctx, W, H);
  } else {
    drawHUD(ctx, W, H, G);
    if (G.state === 'landed' || G.state === 'crashed' || G.state === 'shotdown') drawEnd(ctx, W, H, G);
  }
}

let last = performance.now();
function frame(now) {
  const dt = clamp((now - last) / 1000, 0.001, 0.05);
  last = now;
  if (!G.shot) update(dt); // staged shots hold their pose
  else G.elapsed += dt; // keep the ring pulse + prop alive in shots
  render();
  window.__ready = true;
  requestAnimationFrame(frame);
}

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'Enter' && G.state === 'menu') startFlight();
  if (e.code === 'KeyR' && (G.state === 'landed' || G.state === 'crashed' || G.state === 'shotdown')) startFlight();
  if (e.code === 'KeyC') G.view = G.view === 'chase' ? 'cockpit' : 'chase';
});

window.addEventListener('keyup', (e) => { keys[e.code] = false; });
canvas.addEventListener('mousedown', () => {
  ensureAudio();
  mouseDown = true;
  if (G.state === 'menu') startFlight();
});
window.addEventListener('mouseup', () => { mouseDown = false; });

// Screenshot staging: ?shot=1..4 renders a fixed scene, no input.
const params = new URLSearchParams(location.search);
const shot = parseInt(params.get('shot') || '0', 10);
if (shot >= 1 && shot <= 4) {
  G.shot = shot;
  stageShot(shot, G);
}

// Exposed for the play-test driver.
window.__game = G;
window.__ready = false;
requestAnimationFrame(frame);
