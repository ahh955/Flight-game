// hud.js — the 2D overlay of Langit Biru: instruments, HUD tapes,
// compass, minimap, menus and score screens. Everything is drawn on
// the same canvas, after the 3D scene, so the pilot always reads
// altitude, speed and heading at a glance.

import { clamp, css, lerp, TAU } from './util.js';
import { feet, headingDeg, knots } from './plane.js';
import { RINGS } from './world.js';

// A round gauge with a glowing needle. x, y = centre, r = radius.
function gauge(ctx, x, y, r, value, max, label, unit, accent) {
  ctx.save();
  ctx.translate(x, y);
  // Face.
  ctx.fillStyle = 'rgba(12,16,24,0.82)';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
  // Ticks.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * (r - 7), Math.sin(a) * (r - 7));
    ctx.lineTo(Math.cos(a) * (r - 2), Math.sin(a) * (r - 2));
    ctx.stroke();
  }
  // Needle (glows).
  const a = Math.PI * 0.75 + clamp(value / max, 0, 1) * Math.PI * 1.5;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.shadowColor = accent; ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(a) * (r - 10), Math.sin(a) * (r - 10));
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, TAU); ctx.fill();
  // Label + digital readout.
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, 0, r * 0.45);
  ctx.font = 'bold 15px monospace';
  ctx.fillStyle = '#fff';
  ctx.fillText(String(Math.round(value)), 0, -r * 0.28);
  ctx.font = '10px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(unit, 0, -r * 0.28 + 13);
  ctx.restore();
}

// Artificial horizon: a small ball that rolls and pitches with the plane.
function horizon(ctx, x, y, r, pitch, roll) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.clip();
  ctx.rotate(-roll);
  const dy = clamp(pitch, -0.5, 0.5) * r * 1.6;
  ctx.fillStyle = '#3f7fc4';
  ctx.fillRect(-r, -r + dy, r * 2, r - dy + r);
  ctx.fillStyle = '#7a5a34';
  ctx.fillRect(-r, dy, r * 2, r * 2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(-r, dy - 1.5, r * 2, 3);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  // Fixed wings marker.
  ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.7, y); ctx.lineTo(x - r * 0.25, y);
  ctx.moveTo(x + r * 0.25, y); ctx.lineTo(x + r * 0.7, y);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('ATTITUDE', x, y + r + 14);
}

// Compass strip across the top: N/E/S/W with the heading centred.
function compass(ctx, w, heading) {
  const y = 26;
  ctx.save();
  ctx.fillStyle = 'rgba(10,14,22,0.55)';
  ctx.fillRect(w / 2 - 190, 8, 380, 36);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.strokeRect(w / 2 - 190, 8, 380, 36);
  const pts = [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']];
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [deg, name] of pts) {
    let d = ((deg - heading + 540) % 360) - 180; // -180..180 from centre
    if (Math.abs(d) > 170) continue;
    const x = w / 2 + d * 1.05;
    ctx.fillStyle = Math.abs(d) < 12 ? '#ffd34d' : 'rgba(255,255,255,0.8)';
    ctx.fillText(name, x, y);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '10px sans-serif';
    ctx.fillText(String(deg), x, y + 13);
    ctx.font = 'bold 13px sans-serif';
  }
  // Centre caret + digital heading.
  ctx.fillStyle = '#ffd34d';
  ctx.beginPath();
  ctx.moveTo(w / 2 - 7, 8); ctx.lineTo(w / 2 + 7, 8); ctx.lineTo(w / 2, 17);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

// Minimap (top-down): islands, runway, rings, plane arrow, next-ring line.
function minimap(ctx, x, y, size, plane, nextRing) {
  const S = 6200; // world span shown
  const toMap = (wx, wz) => [x + ((wx + S / 2) / S) * size, y + ((wz + S / 2) / S) * size];
  ctx.save();
  ctx.fillStyle = 'rgba(10,18,28,0.72)';
  ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2 + 6, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2 + 6, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, TAU); ctx.clip();
  // Sea.
  ctx.fillStyle = '#14586e';
  ctx.fillRect(x, y, size, size);
  // Islands as soft blobs (same centres as world.js).
  ctx.fillStyle = '#5d9b58';
  for (const [ix, iz, ir] of [[0, 900, 1150], [-1750, -700, 800], [1700, -950, 720], [400, -2100, 560], [-2400, 1600, 520]]) {
    const [mx, my] = toMap(ix, iz);
    ctx.beginPath(); ctx.arc(mx, my, (ir / S) * size, 0, TAU); ctx.fill();
  }
  // Runway.
  const [rx, ry] = toMap(0, 900);
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(rx - 2, ry - 16, 4, 32);
  // Rings.
  for (const ring of RINGS) {
    const [mx, my] = toMap(ring.x, ring.z);
    ctx.fillStyle = ring.passed ? '#5adc82' : ring.index === nextRing ? '#ffd34d' : 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.arc(mx, my, ring.index === nextRing ? 5 : 3.5, 0, TAU); ctx.fill();
  }
  // Line to the next ring.
  if (nextRing !== null && nextRing !== undefined) {
    const ring = RINGS[nextRing];
    const [mx, my] = toMap(ring.x, ring.z);
    const [px, py] = toMap(plane.pos.x, plane.pos.z);
    ctx.strokeStyle = 'rgba(255,211,77,0.8)';
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(mx, my); ctx.stroke();
    ctx.setLineDash([]);
  }
  // Plane arrow.
  const [px, py] = toMap(plane.pos.x, plane.pos.z);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(Math.PI - plane.yaw);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(0, -8); ctx.lineTo(5.5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5.5, 6);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('MAP', x + size / 2, y + size + 20);
}

// Throttle bar (left edge).
function throttleBar(ctx, x, y, h, throttle) {
  ctx.save();
  ctx.fillStyle = 'rgba(10,14,22,0.6)';
  ctx.fillRect(x - 9, y, 18, h);
  const th = h * throttle;
  const g = ctx.createLinearGradient(0, y + h, 0, y);
  g.addColorStop(0, '#2f9e6e'); g.addColorStop(1, '#ffd34d');
  ctx.fillStyle = g;
  ctx.fillRect(x - 6, y + h - th, 12, th);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.strokeRect(x - 9, y, 18, h);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('THR', x, y + h + 14);
  ctx.fillText(Math.round(throttle * 100) + '%', x, y - 6);
  ctx.restore();
}

// Full flight HUD. G: game state (see main.js).
export function drawHUD(ctx, w, h, G) {
  const p = G.plane;
  compass(ctx, w, headingDeg(p));
  // Cockpit frame FIRST: the dashboard is the panel the instruments
  // sit on, so the gauges must be drawn after it, not under it.
  if (G.view === 'cockpit') {
    ctx.fillStyle = 'rgba(16,18,24,0.95)';
    // Dashboard.
    ctx.beginPath();
    ctx.moveTo(0, h); ctx.lineTo(0, h - 108);
    ctx.quadraticCurveTo(w / 2, h - 150, w, h - 108);
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    // Canopy pillars.
    ctx.fillRect(0, 0, 26, h * 0.55);
    ctx.fillRect(w - 26, 0, 26, h * 0.55);
    ctx.fillRect(0, 0, w, 18);
    // Dashboard glow strip.
    ctx.fillStyle = 'rgba(255,211,77,0.25)';
    ctx.fillRect(0, h - 112, w, 3);
    // Nose tip.
    ctx.fillStyle = '#e85a46';
    ctx.beginPath();
    ctx.moveTo(w / 2 - 34, h - 104); ctx.lineTo(w / 2 + 34, h - 104);
    ctx.lineTo(w / 2, h - 150); ctx.closePath(); ctx.fill();
  }
  // Left cluster: airspeed, altitude, attitude.
  gauge(ctx, 78, h - 84, 46, knots(p), 200, 'AIRSPEED', 'kt', '#7fd4ff');
  gauge(ctx, 188, h - 84, 46, feet(p), 6000, 'ALTITUDE', 'ft', '#ffd34d');
  horizon(ctx, 298, h - 84, 42, p.pitch, p.roll);
  // Throttle.
  throttleBar(ctx, 26, h - 210, 110, p.throttle);
  // Right: score, rings, kills, timer, hull.
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(10,14,22,0.6)';
  ctx.fillRect(w - 208, h - 204, 188, 184);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.strokeRect(w - 208, h - 204, 188, 184);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('SCORE', w - 32, h - 176);
  ctx.font = 'bold 30px monospace';
  ctx.fillStyle = '#ffd34d';
  ctx.fillText(String(G.score), w - 32, h - 142);
  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#fff';
  const passed = RINGS.filter((r) => r.passed).length;
  ctx.fillText(`RINGS  ${passed} / ${RINGS.length}`, w - 32, h - 112);
  ctx.fillText(`MUSUH  ${G.combat ? G.combat.kills : 0} / 2`, w - 32, h - 88);
  ctx.fillText(`TIME  ${Math.max(0, Math.ceil(G.timeLeft))}s`, w - 32, h - 64);
  // Hull bar (green -> amber -> red).
  const hp = G.combat ? G.combat.playerHp : 100;
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText(`HULL  ${Math.round(hp)}`, w - 32, h - 44);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(w - 190, h - 38, 152, 10);
  ctx.fillStyle = hp > 50 ? '#5adc82' : hp > 25 ? '#ffd34d' : '#ff7a5c';
  ctx.fillRect(w - 190, h - 38, 152 * clamp(hp / 100, 0, 1), 10);
  ctx.fillStyle = '#9fd8ff';
  ctx.font = '13px sans-serif';
  ctx.fillText(G.view === 'cockpit' ? 'VIEW: COCKPIT [C]' : 'VIEW: CHASE [C]', w - 32, h - 24);
  // Minimap top-right.
  minimap(ctx, w - 178, 62, 150, p, G.nextRing);
  // Next-ring hint.
  if (G.nextRing !== null && G.nextRing !== undefined && G.state === 'flying') {
    const ring = RINGS[G.nextRing];
    const d = Math.round(Math.hypot(ring.x - p.pos.x, ring.y - p.pos.y, ring.z - p.pos.z) * 3.2);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(10,14,22,0.55)';
    const label = `NEXT RING ${G.nextRing + 1} — ${d} m`;
    ctx.font = 'bold 14px sans-serif';
    const tw = ctx.measureText(label).width;
    ctx.fillRect(w / 2 - tw / 2 - 12, 54, tw + 24, 26);
    ctx.fillStyle = '#ffd34d';
    ctx.fillText(label, w / 2, 72);
  }
  // Transient message (ring passed, etc).
  if (G.message && G.messageT > 0) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillStyle = 'rgba(10,14,22,0.55)';
    const tw = ctx.measureText(G.message).width;
    ctx.fillRect(w / 2 - tw / 2 - 18, h * 0.3 - 26, tw + 36, 46);
    ctx.fillStyle = '#ffd34d';
    ctx.fillText(G.message, w / 2, h * 0.3 + 6);
  }
  // Off-screen ring indicator: arrow at the screen edge.
  if (G.state === 'flying' && G.nextRing !== null && G.nextRing !== undefined) {
    const ring = RINGS[G.nextRing];
    const dx = ring.x - p.pos.x, dy = ring.y - p.pos.y, dz = ring.z - p.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 500) {
      // Bearing relative to heading.
      const bearing = Math.atan2(dx, -dz);
      let rel = bearing - p.yaw;
      while (rel > Math.PI) rel -= TAU;
      while (rel < -Math.PI) rel += TAU;
      if (Math.abs(rel) > 0.6) {
        const dir = rel > 0 ? '▶' : '◀';
        ctx.textAlign = rel > 0 ? 'right' : 'left';
        ctx.font = 'bold 34px sans-serif';
        ctx.fillStyle = '#ffd34d';
        ctx.fillText(dir, rel > 0 ? w - 24 : 24, h / 2);
      }
    }
  }
}

// ---------- screens ----------
function panel(ctx, w, h, title, lines, accent) {
  ctx.save();
  ctx.fillStyle = 'rgba(8,12,20,0.72)';
  ctx.fillRect(0, 0, w, h);
  const bw = Math.min(680, w - 80);
  const bh = 130 + lines.length * 30;
  const bx = (w - bw) / 2, by = (h - bh) / 2;
  ctx.fillStyle = 'rgba(14,20,32,0.94)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = accent; ctx.lineWidth = 3;
  ctx.strokeRect(bx, by, bw, bh);
  ctx.textAlign = 'center';
  ctx.fillStyle = accent;
  ctx.font = 'bold 40px sans-serif';
  ctx.fillText(title, w / 2, by + 58);
  ctx.fillStyle = '#fff';
  ctx.font = '18px sans-serif';
  lines.forEach((ln, i) => ctx.fillText(ln, w / 2, by + 102 + i * 30));
  ctx.restore();
}

export function drawMenu(ctx, w, h) {
  panel(ctx, w, h, 'LANGIT BIRU', [
    'Island Run — terbang melewati 8 ring emas di atas kepulauan biru.',
    '',
    'W / S — throttle    ↑ / ↓ — pitch    ← / → — belok (bank)',
    'A / D — rudder    C — ganti kamera    Mouse — lihat sekitar',
    'SPACE / klik — TEMBAK (musuh muncul setelah ring 1, wingman ikut nembak!)',
    'Mendarat di runway setelah semua ring untuk bonus +500.',
    '',
    'Tekan ENTER atau klik untuk lepas landas.',
  ], '#ffd34d');
}

export function drawEnd(ctx, w, h, G) {
  const ok = G.state === 'landed';
  const shotdown = G.state === 'shotdown';
  const title = ok ? 'MISSION COMPLETE' : shotdown ? 'MISSION FAILED' : 'FLIGHT OVER';
  const lines = [
    `SCORE  ${G.score}`,
    `Rings dilewati: ${RINGS.filter((r) => r.passed).length} / ${RINGS.length}`,
    ok ? 'Bonus mendarat: +500 — pendaratan mulus di runway.'
      : shotdown ? 'Pesawatmu jatuh ditembak musuh — coba lagi.'
      : 'Pesawat jatuh — coba lagi, jaga kecepatan di atas 50 kt.',
    '',
    'Tekan R untuk terbang lagi.',
  ];
  panel(ctx, w, h, title, lines, ok ? '#5adc82' : '#ff7a5c');
}
