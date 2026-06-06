/* CatPet renderer — crisp pixel-art desktop cat.
 *
 * Everything is drawn as solid integer-aligned blocks (no anti-aliasing), so
 * the cat stays sharp at any size. Poses are expressed by changing block
 * coordinates, which keeps every frame pixel-perfect.
 */

const GW = 40;            // logical grid (cells)
const GH = 40;
let PX = 4;               // pixels per cell (set from settings)

const canvas = document.getElementById('cat');
const ctx = canvas.getContext('2d');

const bubble = document.getElementById('bubble');
const timerEl = document.getElementById('timer');

function resize(px) {
  PX = px;
  canvas.width = GW * PX;
  canvas.height = GH * PX;
  document.getElementById('stage').style.width = canvas.width + 'px';
  document.getElementById('stage').style.height = canvas.height + 'px';
  document.body.style.width = canvas.width + 'px';
  document.body.style.height = canvas.height + 'px';
  ctx.imageSmoothingEnabled = false;
}

// ---- settings -------------------------------------------------------------
let settings = {
  baseColor: '#f5c98a',
  patternColor: '#c6843e',
  bellyColor: '#fff4e2',
  eyeColor: '#6fcf57',
  pattern: 'tabby',
  size: 1.0,
  followCursor: true,
  reactToSpeed: true,
  userName: ''
};

// ---- colour helpers -------------------------------------------------------
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const int = parseInt(n, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}
function rgbToHex({ r, g, b }) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
function darken(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex({ r: r * (1 - amt), g: g * (1 - amt), b: b * (1 - amt) });
}
function lighten(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex({ r: r + (255 - r) * amt, g: g + (255 - g) * amt, b: b + (255 - b) * amt });
}
function mix(a, b, t) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

// ---- block primitives -----------------------------------------------------
function cell(gx, gy, color) {
  gx = Math.round(gx); gy = Math.round(gy);
  if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) return;
  ctx.fillStyle = color;
  ctx.fillRect(gx * PX, gy * PX, PX, PX);
}
function rect(gx, gy, w, h, color) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cell(gx + x, gy + y, color);
}
function disk(cx, cy, rx, ry, color) {
  const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx);
  const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      const nx = (gx + 0.5 - cx) / rx;
      const ny = (gy + 0.5 - cy) / ry;
      if (nx * nx + ny * ny <= 1) cell(gx, gy, color);
    }
  }
}
// filled disk with a 1px darker outline ring
function blob(cx, cy, rx, ry, color, outline) {
  disk(cx, cy, rx + 0.9, ry + 0.9, outline);
  disk(cx, cy, rx, ry, color);
}

// ---- runtime state --------------------------------------------------------
const state = {
  mood: 'idle',
  dragging: false,
  walking: false,
  dir: 1,

  // smoothed
  eye: { x: 0, y: 0 },
  tEyeX: 0, tEyeY: 0,
  stretch: 0, tStretch: 0,   // 0..1 vertical stretch
  blush: 0, tBlush: 0,
  happy: 0, tHappy: 0,

  cur: { x: 0, y: 0 },
  prevCur: { x: 0, y: 0 },
  speed: 0,
  catCenter: { x: 0, y: 0 },

  lastActivity: Date.now(),
  petMeter: 0,
  overheat: 0,
  stretchUntil: 0,
  typeUntil: 0,
  scrollUntil: 0,
  pawPhase: 0,
  typeRate: 0,
  keyTimes: [],

  blinkAt: Date.now() + 2000,
  blinkUntil: 0,
  hearts: [],
  steam: [],
  notes: [],
  paper: 0,
  t: 0
};

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, n) { return a + (b - a) * n; }

// ---- the sitting cat ------------------------------------------------------
function drawSit() {
  const base = settings.baseColor;
  const pat = settings.patternColor;
  const belly = settings.bellyColor;
  const out = darken(base, 0.5);
  const inEar = '#e98ba0';
  const t = state.t;

  const cx = 20;
  const st = state.stretch;                  // 0..1
  const headBob = Math.round(Math.sin(t * 2.2) * 0.5);
  const headY = Math.round(14 - st * 5) + headBob;
  const bodyY = 28 - Math.round(st * 1);
  const bodyRy = 8 + Math.round(st * 2);

  // ---- tail ----
  drawTail(base, pat, out);

  // ---- body ----
  blob(cx, bodyY, 9, bodyRy, base, out);
  // belly / chest
  disk(cx, bodyY + 3, 5, bodyRy - 2, belly);

  // body stripes / pattern
  drawBodyPattern(cx, bodyY, bodyRy, base, pat, belly);

  // ---- front paws (with tap animation) ----
  const tapping = (state.mood === 'type' || state.mood === 'scroll');
  let lp = 0, rp = 0;
  if (tapping) {
    lp = Math.sin(state.pawPhase) > 0 ? 1 : 0;
    rp = Math.sin(state.pawPhase) > 0 ? 0 : 1;
  } else if (state.mood === 'idle') {
    const tp = Math.sin(t * 2.5);
    if (tp > 0.96) lp = 1;
  }
  const pawBaseY = bodyY + bodyRy - 1;
  blob(cx - 4, pawBaseY - lp, 2.4, 2, mix(base, belly, 0.25), out);
  blob(cx + 4, pawBaseY - rp, 2.4, 2, mix(base, belly, 0.25), out);
  if (state.dragging) {
    rect(cx - 5, pawBaseY, 2, 4, base);
    rect(cx + 4, pawBaseY, 2, 4, base);
  }

  // scroll paper unspooling from the paws
  if (state.paper > 0.05) drawPaper(cx, pawBaseY);

  // ---- head ----
  blob(cx, headY, 9, 8, base, out);

  // ears
  drawEar(cx - 6, headY - 6, -1, base, out, inEar);
  drawEar(cx + 6, headY - 6, 1, base, out, inEar);

  // head pattern
  drawHeadPattern(cx, headY, base, pat);

  // face
  drawFace(cx, headY);

  // overheat tint overlay
  if (state.blush > 0.03) overheatTint();
}

function drawEar(x, y, side, base, out, inEar) {
  // triangle-ish ear from blocks
  for (let i = 0; i < 5; i++) {
    const w = 5 - i;
    rect(x - 2 + (side < 0 ? 0 : 0), y - i, w, 1, i === 0 ? out : base);
  }
  cell(x, y - 1, inEar);
  cell(x, y - 2, inEar);
}

function drawTail(base, pat, out) {
  const t = state.t;
  const wag = state.mood === 'hunt' ? Math.sin(t * 9) * 4
    : (state.mood === 'pet' ? Math.sin(t * 4) * 3 : Math.sin(t * 2) * 3);
  const dir = state.dir;
  const sx = 20 + dir * 8;
  const pts = [
    [sx, 31], [sx + dir * 3, 30], [sx + dir * 5, 27 + wag * 0.4],
    [sx + dir * 6, 24 + wag * 0.7], [sx + dir * 5, 21 + wag]
  ];
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const c = i >= 3 ? darken(pat, 0.05) : base;
    blob(x, y, 2.2, 2.2, c, out);
  }
}

function drawBodyPattern(cx, bodyY, bodyRy, base, pat, belly) {
  if (settings.pattern === 'solid') return;
  if (settings.pattern === 'tabby') {
    const c = darken(pat, 0.05);
    for (let i = -2; i <= 2; i++) {
      const y = bodyY - 2 + i * 3;
      rect(cx - 6, y, 4, 1, c);
      rect(cx + 2, y, 4, 1, c);
    }
  } else if (settings.pattern === 'tuxedo') {
    disk(cx, bodyY - 3, 8, 4, darken(pat, 0.1));
  } else if (settings.pattern === 'calico') {
    disk(cx - 5, bodyY - 1, 4, 3, pat);
    disk(cx + 5, bodyY + 2, 4, 3, darken(pat, 0.12));
  }
}

function drawHeadPattern(cx, headY, base, pat) {
  if (settings.pattern === 'solid') return;
  const c = darken(pat, 0.05);
  if (settings.pattern === 'tabby') {
    // forehead M
    rect(cx, headY - 7, 1, 4, c);
    rect(cx - 2, headY - 7, 1, 3, c);
    rect(cx + 2, headY - 7, 1, 3, c);
    rect(cx - 3, headY - 7, 1, 2, c);
    rect(cx + 3, headY - 7, 1, 2, c);
    // cheek hints
    rect(cx - 8, headY, 2, 1, c);
    rect(cx + 7, headY, 2, 1, c);
  } else if (settings.pattern === 'tuxedo') {
    disk(cx, headY - 4, 9, 5, c);
  } else if (settings.pattern === 'calico') {
    disk(cx - 5, headY - 3, 4, 4, pat);
    disk(cx + 5, headY - 1, 3, 3, darken(pat, 0.12));
  }
}

function drawFace(cx, headY) {
  const eyeY = headY + 1;
  const lx = cx - 4, rx = cx + 4;
  const closed = state.mood === 'sleep'
    || (state.mood === 'pet' && state.happy > 0.5)
    || state.stretch > 0.5
    || Date.now() < state.blinkUntil;

  if (closed) {
    // happy/sleepy arcs  ^  ^
    rect(lx - 2, eyeY, 1, 1, '#3a2f2a');
    rect(lx - 1, eyeY - 1, 2, 1, '#3a2f2a');
    rect(lx + 1, eyeY, 1, 1, '#3a2f2a');
    rect(rx - 2, eyeY, 1, 1, '#3a2f2a');
    rect(rx - 1, eyeY - 1, 2, 1, '#3a2f2a');
    rect(rx + 1, eyeY, 1, 1, '#3a2f2a');
  } else {
    const ex = Math.round(state.eye.x);
    const ey = Math.round(state.eye.y);
    const dil = state.mood === 'hunt' ? 1 : 0;
    // eye whites
    rect(lx - 2, eyeY - 2, 4, 4, '#ffffff');
    rect(rx - 2, eyeY - 2, 4, 4, '#ffffff');
    // iris
    rect(lx - 1, eyeY - 1, 2 + dil, 3, settings.eyeColor);
    rect(rx - 1, eyeY - 1, 2 + dil, 3, settings.eyeColor);
    // pupils follow cursor
    rect(lx + ex, eyeY + ey - 1, 1, 2 + dil, '#16121d');
    rect(rx + ex, eyeY + ey - 1, 1, 2 + dil, '#16121d');
    // glint
    cell(lx + ex - 1, eyeY + ey - 1, 'rgba(255,255,255,0.95)');
    cell(rx + ex - 1, eyeY + ey - 1, 'rgba(255,255,255,0.95)');
  }

  // nose
  rect(cx, headY + 4, 1, 1, '#e07b77');
  // mouth
  if (state.mood === 'drag') {
    rect(cx, headY + 5, 1, 2, '#7a4a44');
    rect(cx - 1, headY + 6, 3, 1, '#7a4a44');
  } else {
    cell(cx - 1, headY + 6, '#8a6a5a');
    cell(cx + 1, headY + 6, '#8a6a5a');
  }
  // whiskers
  const wc = 'rgba(255,255,255,0.6)';
  rect(cx - 9, headY + 3, 3, 1, wc);
  rect(cx - 9, headY + 5, 3, 1, wc);
  rect(cx + 6, headY + 3, 3, 1, wc);
  rect(cx + 6, headY + 5, 3, 1, wc);

  if (state.blush > 0.4) {
    // sweat drop
    rect(cx + 7, headY - 3, 1, 2, '#7fd0ff');
  }
}

function overheatTint() {
  ctx.save();
  ctx.globalAlpha = state.blush * 0.4;
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = '#ff4438';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

// ---- the walking cat (side view, 4 legs) ----------------------------------
function drawWalk() {
  const base = settings.baseColor;
  const pat = settings.patternColor;
  const belly = settings.bellyColor;
  const out = darken(base, 0.5);
  const inEar = '#e98ba0';
  const dir = state.dir;
  const t = state.t;

  const cx = 20;
  const bodyY = 25 + Math.round(Math.sin(t * 12) * 0.5);

  // tail (back)
  const bx = cx - dir * 11;
  const wag = Math.sin(t * 10) * 3;
  blob(bx, bodyY - 1, 2, 2, base, out);
  blob(bx - dir * 2, bodyY - 4, 2, 2, base, out);
  blob(bx - dir * 3, bodyY - 7 + wag * 0.3, 2, 2, darken(pat, 0.05), out);

  // legs (two-frame trot)
  const phase = Math.sin(t * 12) > 0;
  const legY = bodyY + 5;
  const legColor = darken(base, 0.06);
  function leg(x, up) { rect(x, legY - (up ? 1 : 0), 2, 5 - (up ? 1 : 0), legColor); rect(x, legY + 4, 2, 1, out); }
  leg(cx - dir * 7, phase);
  leg(cx - dir * 3, !phase);
  leg(cx + dir * 3, phase);
  leg(cx + dir * 6, !phase);

  // body
  blob(cx, bodyY, 11, 6, base, out);
  disk(cx, bodyY + 2, 8, 3, belly);
  if (settings.pattern === 'tabby') {
    for (let i = -2; i <= 2; i++) rect(cx + i * 4 - 1, bodyY - 4, 1, 4, darken(pat, 0.05));
  } else if (settings.pattern !== 'solid') {
    disk(cx - dir * 4, bodyY - 1, 4, 3, pat);
  }

  // head (front)
  const hx = cx + dir * 11;
  const hy = bodyY - 4;
  blob(hx, hy, 6, 6, base, out);
  drawEar(hx - 3, hy - 5, -1, base, out, inEar);
  drawEar(hx + 3, hy - 5, 1, base, out, inEar);
  // single visible eye
  rect(hx + dir * 1 - 1, hy - 1, 3, 3, '#ffffff');
  rect(hx + dir * 2 - 1, hy, 1, 2, '#16121d');
  // nose
  rect(hx + dir * 5, hy + 1, 1, 1, '#e07b77');
}

// ---- particles ------------------------------------------------------------
function drawParticles() {
  for (const h of state.hearts) {
    ctx.save();
    ctx.globalAlpha = clamp(h.life, 0, 1);
    pixelHeart(h.x, h.y);
    ctx.restore();
  }
  for (const p of state.steam) {
    ctx.save();
    ctx.globalAlpha = clamp(p.life, 0, 1) * 0.7;
    disk(p.x, p.y, p.size, p.size, '#e6edf5');
    ctx.restore();
  }
  for (const n of state.notes) {
    ctx.save();
    ctx.globalAlpha = clamp(n.life, 0, 1);
    ctx.fillStyle = '#fff7c2';
    ctx.font = `${PX * 4}px monospace`;
    ctx.fillText(n.ch, n.x * PX, n.y * PX);
    ctx.restore();
  }
}
function pixelHeart(gx, gy) {
  const c = '#ff6b8a';
  rect(gx, gy, 1, 1, c); rect(gx + 2, gy, 1, 1, c);
  rect(gx - 1, gy + 1, 5, 1, c);
  rect(gx - 1, gy + 2, 5, 1, c);
  rect(gx, gy + 3, 3, 1, c);
  rect(gx + 1, gy + 4, 1, 1, c);
}
function drawPaper(cx, y) {
  const len = Math.round(state.paper * 10);
  rect(cx - 3, y + 3, 6, len, '#fbfbf3');
  rect(cx - 3, y + 3, 6, 1, '#d8d8c8');
  for (let i = 2; i < len; i += 2) rect(cx - 2, y + 3 + i, 4, 1, '#cfcfbf');
  rect(cx - 4, y + 3 + len, 8, 2, '#e8e8d8'); // roll
}

// ---- update loop ----------------------------------------------------------
function update(dt) {
  const now = Date.now();
  state.t += dt;
  const k = 1 - Math.pow(0.0015, dt);

  // eye direction
  if (settings.followCursor) {
    const dx = state.cur.x - state.catCenter.x;
    const dy = state.cur.y - state.catCenter.y;
    const dist = Math.hypot(dx, dy) || 1;
    const reach = clamp(dist / 250, 0, 1);
    state.tEyeX = clamp((dx / dist) * 1.6 * reach, -1.6, 1.6);
    state.tEyeY = clamp((dy / dist) * 1.4 * reach, -1.4, 1.4);
  } else { state.tEyeX = 0; state.tEyeY = 0; }
  state.eye.x = lerp(state.eye.x, state.tEyeX, k);
  state.eye.y = lerp(state.eye.y, state.tEyeY, k);

  state.stretch = lerp(state.stretch, state.tStretch, k * 0.8);
  state.blush = lerp(state.blush, state.tBlush, k * 0.5);
  state.happy = lerp(state.happy, state.tHappy, k);
  state.paper = lerp(state.paper, now < state.scrollUntil ? 1 : 0, k);

  state.petMeter = Math.max(0, state.petMeter - dt * 0.6);
  state.overheat = Math.max(0, state.overheat - dt * 0.5);
  state.pawPhase += dt * 18;

  // typing rate from recent keys
  state.keyTimes = state.keyTimes.filter(tm => now - tm < 1500);
  state.typeRate = state.keyTimes.length;

  decideMood(now);

  // blink
  if (now > state.blinkAt && state.mood !== 'sleep') {
    state.blinkUntil = now + 110;
    state.blinkAt = now + 1800 + Math.random() * 3500;
  }

  // spawn particles
  if (state.mood === 'pet' && Math.random() < dt * 7)
    state.hearts.push({ x: 16 + Math.random() * 8, y: 8, size: 1, life: 1, vy: 9 });
  if (state.mood === 'overheat' && Math.random() < dt * 12)
    state.steam.push({ x: 17 + Math.random() * 6, y: 6, size: 1 + Math.random(), life: 1, vy: 11 });
  for (const h of state.hearts) { h.y -= h.vy * dt; h.life -= dt; }
  for (const p of state.steam) { p.y -= p.vy * dt; p.life -= dt * 1.2; p.size += dt * 1.5; }
  for (const n of state.notes) { n.y -= 6 * dt; n.x += n.vx * dt; n.life -= dt; }
  state.hearts = state.hearts.filter(h => h.life > 0);
  state.steam = state.steam.filter(p => p.life > 0);
  state.notes = state.notes.filter(n => n.life > 0);
}

function decideMood(now) {
  if (state.dragging) { setMood('drag'); state.tStretch = 0.9; state.tBlush = 0; state.tHappy = 0; return; }
  if (state.walking) { setMood('walk'); state.tStretch = 0; state.tBlush = 0; return; }
  if (now < state.stretchUntil) { setMood('stretch'); state.tStretch = 1; return; }
  state.tStretch = 0;

  if (state.petMeter > 1) { setMood('pet'); state.tHappy = 1; state.tBlush = 0; return; }
  state.tHappy = 0;

  if (settings.reactToSpeed && state.overheat > 3) { setMood('overheat'); state.tBlush = 1; return; }
  state.tBlush = 0;

  if (now < state.scrollUntil) { setMood('scroll'); return; }
  if (now < state.typeUntil) { setMood('type'); return; }

  if (settings.reactToSpeed && state.speed > 1300 && nearCursor(220)) { setMood('hunt'); return; }

  if (now - state.lastActivity > 14000) { setMood('sleep'); return; }

  setMood('idle');
}

let lastMood = 'idle';
function setMood(m) {
  if (m !== lastMood) { onMoodEnter(m, lastMood); lastMood = m; }
  state.mood = m;
}
function onMoodEnter(m, prev) {
  if (m === 'pet') say('purr~', 1500);
  else if (m === 'sleep') say('z z z', 4000);
  else if (m === 'overheat') say('slow down! >_<', 1600);
  else if (m === 'drag') say('!', 700);
  else if (m === 'idle' && prev === 'sleep') say('mrrp?', 1100);
}
function nearCursor(px) {
  return Math.hypot(state.cur.x - state.catCenter.x, state.cur.y - state.catCenter.y) < px;
}

let bubbleTimer = null;
function say(text, ms = 1500) {
  bubble.textContent = text;
  bubble.classList.remove('hidden');
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), ms);
}

// ---- render ---------------------------------------------------------------
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (state.walking && !state.dragging) drawWalk();
  else drawSit();
  drawParticles();
}

let last = performance.now();
let paused = false;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused) { update(dt); render(); }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---- pointer input (over the cat) -----------------------------------------
let ignoreState = true;
function hitCat(x, y) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return false;
  try { return ctx.getImageData(x, y, 1, 1).data[3] > 30; } catch (_) { return true; }
}
window.addEventListener('mousemove', (e) => {
  const hit = hitCat(e.clientX, e.clientY);
  if (window.cat.platform !== 'linux') {
    const wantIgnore = !hit && !state.dragging;
    if (wantIgnore !== ignoreState) { ignoreState = wantIgnore; window.cat.setIgnore(wantIgnore); }
  }
  if (hit && !state.dragging && e.clientY < canvas.height * 0.55) {
    state.petMeter = Math.min(6, state.petMeter + 0.25);
    state.lastActivity = Date.now();
  }
});
window.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !hitCat(e.clientX, e.clientY)) return;
  state.dragging = true; state.lastActivity = Date.now();
  window.cat.dragStart();
});
window.addEventListener('mouseup', () => {
  if (state.dragging) { state.dragging = false; window.cat.dragEnd(); }
});
window.addEventListener('contextmenu', (e) => { e.preventDefault(); if (hitCat(e.clientX, e.clientY)) window.cat.contextMenu(); });
window.addEventListener('dblclick', (e) => { if (hitCat(e.clientX, e.clientY)) window.cat.openSettings(); });

// ---- IPC ------------------------------------------------------------------
window.cat.onCursor((d) => {
  state.prevCur = state.cur;
  state.cur = { x: d.x, y: d.y };
  state.catCenter = { x: d.bounds.x + d.bounds.width / 2, y: d.bounds.y + d.bounds.height / 2 };
  const sp = Math.hypot(state.cur.x - state.prevCur.x, state.cur.y - state.prevCur.y) * 30;
  state.speed = sp;
  if (sp > 30) state.lastActivity = Date.now();
  if (settings.reactToSpeed && sp > 2200 && nearCursor(260)) state.overheat = Math.min(6, state.overheat + 0.1);
  if (d.dragging) state.dragging = true;
});
window.cat.onSettings((s) => {
  settings = { ...settings, ...s };
  if (s.px) resize(s.px);
});
window.cat.onWalk((w) => { state.walking = !!w.moving; if (w.dir) state.dir = w.dir; });
window.cat.onInput((info) => {
  // a global keystroke happened
  state.typeUntil = Date.now() + 600;
  state.lastActivity = Date.now();
  state.keyTimes.push(Date.now());
  if (settings.reactToSpeed && state.keyTimes.length > 6) state.overheat = Math.min(6, state.overheat + 0.5);
});
window.cat.onScroll(() => {
  state.scrollUntil = Date.now() + 700;
  state.lastActivity = Date.now();
});
window.cat.onAction((a) => {
  if (a.type === 'stretch') { state.stretchUntil = Date.now() + 3000; say('stretch~', 2800); }
  else if (a.type === 'timer-on') timerEl.classList.remove('hidden');
  else if (a.type === 'timer-off') timerEl.classList.add('hidden');
  else if (a.type === 'meow') { say(a.text || 'meow!', 3000); }
});
window.cat.onPomo((p) => {
  const total = Math.max(0, p.remainMs);
  const mm = String(Math.floor(total / 60000)).padStart(2, '0');
  const ss = String(Math.floor((total % 60000) / 1000)).padStart(2, '0');
  timerEl.textContent = `${mm}:${ss}`;
  timerEl.classList.toggle('break', p.phase === 'break');
  timerEl.classList.remove('hidden');
});

// ---- snapshot QA mode -----------------------------------------------------
window.cat.onSnapshot(async () => {
  paused = true;
  resize(6);
  const clear = () => { state.hearts = []; state.steam = []; state.notes = []; };
  const poses = [
    ['idle', () => { lastMood = state.mood = 'idle'; }],
    ['sleep', () => { state.mood = lastMood = 'sleep'; }],
    ['pet', () => { state.mood = lastMood = 'pet'; state.happy = 1; state.hearts = [{ x: 16, y: 8, size: 1, life: 1, vy: 0 }, { x: 22, y: 5, size: 1, life: 1, vy: 0 }]; }],
    ['hunt', () => { state.mood = lastMood = 'hunt'; state.eye.x = 1.5; }],
    ['drag', () => { state.dragging = true; state.mood = lastMood = 'drag'; state.stretch = 0.9; }],
    ['stretch', () => { state.dragging = false; state.mood = lastMood = 'stretch'; state.stretch = 1; }],
    ['type', () => { state.mood = lastMood = 'type'; }],
    ['overheat', () => { state.mood = lastMood = 'overheat'; state.blush = 1; state.steam = [{ x: 17, y: 6, size: 2, life: 1, vy: 0 }]; }],
    ['walk', () => { state.dragging = false; state.walking = true; state.mood = lastMood = 'walk'; state.dir = 1; }]
  ];
  for (const [name, set] of poses) {
    clear();
    state.dragging = false;
    state.walking = false;
    state.blush = 0;
    state.stretch = 0;
    state.eye.x = 0; state.eye.y = 0;
    set();
    render();
    await new Promise(r => setTimeout(r, 40));
    window.cat.saveSnapshot(name, canvas.toDataURL('image/png'));
    await new Promise(r => setTimeout(r, 80));
  }
});
