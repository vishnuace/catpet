/* CatPet renderer — a procedurally drawn pixel cat.
 *
 * The cat is drawn on a small 48x48 offscreen canvas using smooth shapes,
 * then scaled up 5x with nearest-neighbour sampling so it looks crisp and
 * pixelated. Poses are interpolated every frame for soft, springy motion.
 */

const DISPLAY = 240;
const S = 48;                 // logical grid
const SCALE = DISPLAY / S;    // 5

const canvas = document.getElementById('cat');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const off = document.createElement('canvas');
off.width = S;
off.height = S;
const octx = off.getContext('2d');

const bubble = document.getElementById('bubble');
const timerEl = document.getElementById('timer');

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

// ---- runtime state --------------------------------------------------------
const state = {
  // smoothed pose values
  stretchY: 1,
  leanX: 0,
  eyeOpen: 1,
  pupil: { x: 0, y: 0 },
  dilate: 0,
  blush: 0,         // overheat tint 0..1
  happy: 0,         // pet happiness 0..1
  bob: 0,

  // targets
  tStretchY: 1,
  tLeanX: 0,
  tEyeOpen: 1,
  tDilate: 0,
  tBlush: 0,
  tHappy: 0,

  mood: 'idle',     // idle | hunt | drag | pet | stretch | sleep | overheat
  dragging: false,

  // cursor tracking (screen space)
  cur: { x: 0, y: 0 },
  prevCur: { x: 0, y: 0 },
  speed: 0,
  catCenter: { x: 0, y: 0 },

  lastMoveAt: Date.now(),
  petMeter: 0,
  overheatMeter: 0,
  stretchUntil: 0,
  hopUntil: 0,

  blinkAt: Date.now() + 2000,
  blinking: false,
  hearts: [],
  steam: [],
  t: 0
};

// ---- helpers --------------------------------------------------------------
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, n) { return a + (b - a) * n; }

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h;
  const int = parseInt(n, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}
function rgbStr({ r, g, b }, a = 1) { return `rgba(${r},${g},${b},${a})`; }
function shade(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  const f = (c) => clamp(Math.round(c + 255 * amt), 0, 255);
  const g2 = (c) => clamp(Math.round(c * (1 + amt)), 0, 255);
  if (amt >= 0) return rgbStr({ r: g2(r), g: g2(g), b: g2(b) });
  return rgbStr({ r: f(r), g: f(g), b: f(b) });
}
function mix(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  return rgbStr({
    r: Math.round(lerp(a.r, b.r, t)),
    g: Math.round(lerp(a.g, b.g, t)),
    b: Math.round(lerp(a.b, b.b, t))
  });
}

// shorthand drawing on offscreen ctx
function fillEllipse(x, y, rx, ry, color) {
  octx.beginPath();
  octx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  octx.fillStyle = color;
  octx.fill();
}
function fillCircle(x, y, r, color) { fillEllipse(x, y, r, r, color); }
function tri(p, color) {
  octx.beginPath();
  octx.moveTo(p[0], p[1]);
  octx.lineTo(p[2], p[3]);
  octx.lineTo(p[4], p[5]);
  octx.closePath();
  octx.fillStyle = color;
  octx.fill();
}

// ---- the cat --------------------------------------------------------------
function drawCat() {
  octx.clearRect(0, 0, S, S);
  octx.save();

  const base = settings.baseColor;
  const pat = settings.patternColor;
  const belly = settings.bellyColor;
  const dark = shade(base, -0.55);
  const t = state.t;

  // squash & stretch around the base of the cat (feet at y≈46)
  const baseY = 46;
  const sy = state.stretchY;
  const sx = 1 + (1 - sy) * 0.45; // squash horizontally when short
  octx.translate(24 + state.leanX, baseY);
  octx.scale(sx, sy);
  octx.translate(-24, -baseY);

  const bob = Math.sin(t * 3) * state.bob;
  octx.translate(0, bob);

  // ---- tail (drawn behind body) ----
  const tailSpeed = state.mood === 'hunt' ? 7 : (state.mood === 'pet' ? 3 : 2);
  const tailWave = Math.sin(t * tailSpeed);
  octx.save();
  octx.lineCap = 'round';
  octx.lineWidth = 4;
  octx.strokeStyle = shade(base, -0.08);
  octx.beginPath();
  const tx = 35, ty = 38;
  octx.moveTo(tx, ty);
  octx.quadraticCurveTo(
    44 + tailWave * 2, 34 + tailWave * 2,
    42 + tailWave * 4, 24 + tailWave * 3
  );
  octx.stroke();
  // tail tip pattern
  octx.lineWidth = 4;
  octx.strokeStyle = shade(pat, -0.05);
  octx.beginPath();
  octx.moveTo(42 + tailWave * 3.4, 27 + tailWave * 3);
  octx.lineTo(42 + tailWave * 4, 24 + tailWave * 3);
  octx.stroke();
  octx.restore();

  // ---- body ----
  fillEllipse(24, 36, 12.5, 11.5, base);
  // belly highlight
  fillEllipse(24, 39, 7, 7.5, belly);

  // body pattern
  drawBodyPattern(base, pat, belly);

  // ---- front paws ----
  const tap = state.mood === 'idle' ? Math.max(0, Math.sin(t * 9)) * 0.6 : 0;
  const pawY = 45;
  fillEllipse(19, pawY - (state.dragging ? 2 : 0) + tap, 3.4, 2.6, mix(base, belly, 0.3));
  fillEllipse(29, pawY - (state.dragging ? 2 : 0), 3.4, 2.6, mix(base, belly, 0.3));
  if (state.dragging) {
    // dangling legs when picked up
    octx.lineWidth = 3.2;
    octx.lineCap = 'round';
    octx.strokeStyle = base;
    octx.beginPath();
    octx.moveTo(19, 42); octx.lineTo(19, 47);
    octx.moveTo(29, 42); octx.lineTo(29, 47);
    octx.stroke();
  }

  // ---- head ----
  const headY = 18;
  fillCircle(24, headY, 12.2, base);

  // ears
  const perk = state.mood === 'hunt' ? -1.5 : (state.mood === 'sleep' ? 1.5 : 0);
  tri([14, headY - 6 + perk, 12, headY - 14 + perk, 21, headY - 7], base);
  tri([34, headY - 6 + perk, 36, headY - 14 + perk, 27, headY - 7], base);
  tri([15.5, headY - 7 + perk, 14.5, headY - 11.5 + perk, 19, headY - 7.5], shade('#e98b9a', 0));
  tri([32.5, headY - 7 + perk, 33.5, headY - 11.5 + perk, 29, headY - 7.5], shade('#e98b9a', 0));

  // head pattern
  drawHeadPattern(headY, pat);

  // ---- face ----
  drawFace(headY);

  // ---- overheat tint ----
  if (state.blush > 0.02) {
    octx.save();
    octx.globalAlpha = state.blush * 0.45;
    octx.globalCompositeOperation = 'source-atop';
    octx.fillStyle = 'rgba(255,70,60,1)';
    octx.fillRect(0, 0, S, S);
    octx.restore();
  }

  octx.restore();

  // ---- particles drawn in screen space (not squashed) ----
  drawParticles();

  // blit to display with crisp pixels
  ctx.clearRect(0, 0, DISPLAY, DISPLAY);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, S, S, 0, 0, DISPLAY, DISPLAY);
}

function drawBodyPattern(base, pat, belly) {
  if (settings.pattern === 'solid') return;
  octx.save();
  // clip to body
  octx.beginPath();
  octx.ellipse(24, 36, 12.5, 11.5, 0, 0, Math.PI * 2);
  octx.clip();
  if (settings.pattern === 'tabby') {
    octx.strokeStyle = shade(pat, -0.05);
    octx.lineWidth = 1.6;
    for (let i = -2; i <= 2; i++) {
      octx.beginPath();
      octx.moveTo(13, 31 + i * 3.4);
      octx.quadraticCurveTo(24, 28 + i * 3.4, 35, 31 + i * 3.4);
      octx.stroke();
    }
  } else if (settings.pattern === 'tuxedo') {
    // dark back, light belly already; add dark patch on top
    fillEllipse(24, 30, 12.5, 6, shade(pat, -0.1));
  } else if (settings.pattern === 'calico') {
    fillEllipse(17, 33, 5, 4.5, pat);
    fillEllipse(31, 38, 6, 5, shade(pat, -0.15));
    fillEllipse(26, 30, 4, 3.5, mix(pat, base, 0.3));
  }
  octx.restore();
}

function drawHeadPattern(headY, pat) {
  if (settings.pattern === 'solid') return;
  octx.save();
  octx.beginPath();
  octx.arc(24, headY, 12.2, 0, Math.PI * 2);
  octx.clip();
  if (settings.pattern === 'tabby') {
    octx.strokeStyle = shade(pat, -0.05);
    octx.lineWidth = 1.4;
    // forehead "M"
    octx.beginPath();
    octx.moveTo(24, headY - 11); octx.lineTo(24, headY - 6);
    octx.moveTo(21, headY - 11); octx.lineTo(22.5, headY - 6);
    octx.moveTo(27, headY - 11); octx.lineTo(25.5, headY - 6);
    octx.stroke();
    // cheek stripes
    octx.beginPath();
    octx.moveTo(13.5, headY); octx.lineTo(17, headY + 1);
    octx.moveTo(34.5, headY); octx.lineTo(31, headY + 1);
    octx.stroke();
  } else if (settings.pattern === 'tuxedo') {
    octx.fillStyle = shade(pat, -0.1);
    octx.beginPath();
    octx.arc(24, headY - 3, 12.2, Math.PI, Math.PI * 2);
    octx.fill();
  } else if (settings.pattern === 'calico') {
    fillEllipse(18, headY - 4, 5, 5, pat);
    fillEllipse(30, headY - 2, 4.5, 4.5, shade(pat, -0.15));
  }
  octx.restore();
}

function drawFace(headY) {
  const dark = shade(settings.baseColor, -0.6);
  const eyeY = headY + 1;
  const lx = 19.5, rx = 28.5;
  const open = state.eyeOpen;

  if (state.mood === 'sleep' || (state.happy > 0.6 && state.mood === 'pet') || open < 0.12) {
    // happy/sleepy closed eyes ( ^ ^ )
    octx.strokeStyle = '#3a2f2a';
    octx.lineWidth = 1.4;
    octx.lineCap = 'round';
    octx.beginPath();
    octx.moveTo(lx - 2.4, eyeY + 0.5); octx.quadraticCurveTo(lx, eyeY - 2, lx + 2.4, eyeY + 0.5);
    octx.moveTo(rx - 2.4, eyeY + 0.5); octx.quadraticCurveTo(rx, eyeY - 2, rx + 2.4, eyeY + 0.5);
    octx.stroke();
  } else {
    const ry = 3.0 * open;
    // eye whites/colour
    fillEllipse(lx, eyeY, 2.6, ry, '#fdfdfd');
    fillEllipse(rx, eyeY, 2.6, ry, '#fdfdfd');
    fillEllipse(lx, eyeY, 2.2, ry * 0.92, settings.eyeColor);
    fillEllipse(rx, eyeY, 2.2, ry * 0.92, settings.eyeColor);
    // pupils follow cursor
    const pr = (1.1 + state.dilate * 0.9);
    const px = state.pupil.x, py = state.pupil.y;
    fillEllipse(lx + px, eyeY + py, pr * 0.8, pr * open, '#1c1726');
    fillEllipse(rx + px, eyeY + py, pr * 0.8, pr * open, '#1c1726');
    // glints
    octx.fillStyle = 'rgba(255,255,255,0.9)';
    fillCircle(lx + px - 0.7, eyeY + py - 0.8, 0.5, 'rgba(255,255,255,0.9)');
    fillCircle(rx + px - 0.7, eyeY + py - 0.8, 0.5, 'rgba(255,255,255,0.9)');
  }

  // nose
  tri([24, headY + 4.5, 22.6, headY + 3.2, 25.4, headY + 3.2], '#e7837f');
  // mouth
  octx.strokeStyle = '#7a5b4d';
  octx.lineWidth = 0.9;
  octx.lineCap = 'round';
  octx.beginPath();
  if (state.mood === 'drag') {
    // surprised "o"
    octx.restore();
    fillEllipse(24, headY + 6.5, 1.6, 2, '#7a4a44');
    octx.save();
  } else {
    octx.moveTo(24, headY + 4.8);
    octx.lineTo(24, headY + 6);
    octx.moveTo(24, headY + 6);
    octx.quadraticCurveTo(22.2, headY + 7.2, 21, headY + 6.2);
    octx.moveTo(24, headY + 6);
    octx.quadraticCurveTo(25.8, headY + 7.2, 27, headY + 6.2);
    octx.stroke();
  }

  // whiskers
  octx.strokeStyle = 'rgba(255,255,255,0.55)';
  octx.lineWidth = 0.6;
  octx.beginPath();
  octx.moveTo(17, headY + 4); octx.lineTo(10, headY + 3);
  octx.moveTo(17, headY + 5.2); octx.lineTo(10, headY + 6);
  octx.moveTo(31, headY + 4); octx.lineTo(38, headY + 3);
  octx.moveTo(31, headY + 5.2); octx.lineTo(38, headY + 6);
  octx.stroke();

  // overheat sweat drop
  if (state.blush > 0.4) {
    fillEllipse(33, headY - 2, 1.2, 1.8, 'rgba(120,200,255,0.9)');
  }
}

function drawParticles() {
  // hearts (pet) rise & fade
  for (const h of state.hearts) {
    octx.save();
    octx.globalAlpha = clamp(h.life, 0, 1);
    octx.fillStyle = '#ff6b8a';
    const x = h.x, y = h.y, s = h.size;
    octx.beginPath();
    octx.moveTo(x, y + s * 0.3);
    octx.bezierCurveTo(x, y, x - s, y, x - s, y + s * 0.4);
    octx.bezierCurveTo(x - s, y + s, x, y + s * 1.1, x, y + s * 1.4);
    octx.bezierCurveTo(x, y + s * 1.1, x + s, y + s, x + s, y + s * 0.4);
    octx.bezierCurveTo(x + s, y, x, y, x, y + s * 0.3);
    octx.fill();
    octx.restore();
  }
  // steam (overheat)
  for (const p of state.steam) {
    octx.save();
    octx.globalAlpha = clamp(p.life, 0, 1) * 0.7;
    octx.fillStyle = '#dfe7ef';
    fillCircle(p.x, p.y, p.size, '#dfe7ef');
    octx.restore();
  }
}

// ---- physics / update -----------------------------------------------------
function update(dt) {
  const now = Date.now();
  state.t += dt;

  // smoothing toward targets
  const k = 1 - Math.pow(0.001, dt); // frame-rate independent smoothing
  state.stretchY = lerp(state.stretchY, state.tStretchY, k * 0.9);
  state.leanX = lerp(state.leanX, state.tLeanX, k);
  state.eyeOpen = lerp(state.eyeOpen, state.tEyeOpen, k);
  state.dilate = lerp(state.dilate, state.tDilate, k);
  state.blush = lerp(state.blush, state.tBlush, k * 0.5);
  state.happy = lerp(state.happy, state.tHappy, k);

  // eye / head direction toward cursor
  if (settings.followCursor) {
    const dx = state.cur.x - state.catCenter.x;
    const dy = state.cur.y - state.catCenter.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist, ny = dy / dist;
    const reach = clamp(dist / 280, 0, 1);
    state.pupil.x = lerp(state.pupil.x, nx * 1.4 * reach, k);
    state.pupil.y = lerp(state.pupil.y, ny * 1.2 * reach, k);
    if (state.mood === 'idle' || state.mood === 'hunt') {
      state.tLeanX = clamp(nx * 3.2 * reach, -4, 4);
    }
  } else {
    state.pupil.x = lerp(state.pupil.x, 0, k);
    state.pupil.y = lerp(state.pupil.y, 0, k);
    state.tLeanX = 0;
  }

  // decay meters
  state.petMeter = Math.max(0, state.petMeter - dt * 0.6);
  state.overheatMeter = Math.max(0, state.overheatMeter - dt * 0.4);

  // determine mood (priority order)
  decideMood(now);

  // blinking
  if (now > state.blinkAt && state.mood !== 'sleep' && state.mood !== 'pet') {
    state.blinking = true;
    state.tEyeOpen = 0;
    setTimeout(() => { state.blinking = false; }, 120);
    state.blinkAt = now + 1800 + Math.random() * 3500;
  } else if (!state.blinking && state.mood !== 'sleep') {
    state.tEyeOpen = state.mood === 'hunt' ? 1.1 : 1;
  }

  // particles update
  if (state.mood === 'pet' && Math.random() < dt * 6) {
    state.hearts.push({ x: 18 + Math.random() * 12, y: 10, size: 1.4 + Math.random(), life: 1, vy: 8 + Math.random() * 4 });
  }
  if ((state.mood === 'overheat') && Math.random() < dt * 10) {
    state.steam.push({ x: 18 + Math.random() * 12, y: 8, size: 1 + Math.random() * 1.4, life: 1, vy: 10 });
  }
  for (const h of state.hearts) { h.y -= h.vy * dt; h.life -= dt * 0.9; }
  for (const p of state.steam) { p.y -= p.vy * dt; p.life -= dt * 1.1; p.size += dt * 1.5; }
  state.hearts = state.hearts.filter(h => h.life > 0);
  state.steam = state.steam.filter(p => p.life > 0);
}

function decideMood(now) {
  if (state.dragging) {
    setMood('drag');
    state.tStretchY = 1.45;
    state.tEyeOpen = 1.3;
    return;
  }
  if (now < state.stretchUntil) {
    setMood('stretch');
    const phase = (state.stretchUntil - now) / 1000;
    state.tStretchY = 1.55;
    state.tEyeOpen = 0.2;
    return;
  }
  if (state.petMeter > 1) {
    setMood('pet');
    state.tHappy = 1;
    state.tStretchY = 1;
    state.bob = 0.6;
    return;
  }
  state.tHappy = 0;
  state.bob = 0;

  if (settings.reactToSpeed && state.overheatMeter > 3) {
    setMood('overheat');
    state.tBlush = 1;
    state.tStretchY = 0.95;
    state.tDilate = 0.4;
    return;
  }
  state.tBlush = 0;

  if (settings.reactToSpeed && state.speed > 1400 && nearCursor(220)) {
    setMood('hunt');
    state.tStretchY = 0.9;     // crouch
    state.tDilate = 1;
    return;
  }
  state.tDilate = 0;

  if (now - state.lastMoveAt > 12000) {
    setMood('sleep');
    state.tStretchY = 0.92;
    state.tEyeOpen = 0;
    return;
  }

  setMood('idle');
  state.tStretchY = 1 + Math.sin(state.t * 1.6) * 0.03; // breathing
}

let lastMood = 'idle';
function setMood(m) {
  if (m !== lastMood) {
    onMoodEnter(m, lastMood);
    lastMood = m;
  }
  state.mood = m;
}

function onMoodEnter(m, prev) {
  if (m === 'pet') say('purr~', 1600);
  else if (m === 'sleep') say('z z z', 4000);
  else if (m === 'hunt') {} 
  else if (m === 'overheat') say('🔥 slow down!', 1800);
  else if (m === 'drag') say('!', 800);
  else if (m === 'idle' && (prev === 'sleep')) say('mrrp?', 1200);
}

function nearCursor(px) {
  return Math.hypot(state.cur.x - state.catCenter.x, state.cur.y - state.catCenter.y) < px;
}

// ---- speech bubble --------------------------------------------------------
let bubbleTimer = null;
function say(text, ms = 1500) {
  bubble.textContent = text;
  bubble.classList.remove('hidden');
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), ms);
}

// ---- main loop ------------------------------------------------------------
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  drawCat();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---- input ----------------------------------------------------------------
let overCat = false;
let ignoreState = true;

function hitCat(clientX, clientY) {
  // sample alpha from the displayed canvas
  if (clientX < 0 || clientY < 0 || clientX >= DISPLAY || clientY >= DISPLAY) return false;
  try {
    const p = ctx.getImageData(clientX, clientY, 1, 1).data;
    return p[3] > 30;
  } catch (_) { return true; }
}

window.addEventListener('mousemove', (e) => {
  const hit = hitCat(e.clientX, e.clientY);
  if (window.cat.platform !== 'linux') {
    const wantIgnore = !hit && !state.dragging;
    if (wantIgnore !== ignoreState) {
      ignoreState = wantIgnore;
      window.cat.setIgnore(wantIgnore);
    }
  }
  // pet detection: slow movement over the cat's upper half
  if (hit && !state.dragging && e.clientY < DISPLAY * 0.55) {
    state.petMeter = Math.min(6, state.petMeter + 0.25);
  }
});

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (!hitCat(e.clientX, e.clientY)) return;
  state.dragging = true;
  window.cat.dragStart();
});

window.addEventListener('mouseup', (e) => {
  if (state.dragging) {
    state.dragging = false;
    window.cat.dragEnd();
    state.hopUntil = Date.now() + 350;
  }
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (hitCat(e.clientX, e.clientY)) window.cat.contextMenu();
});

window.addEventListener('dblclick', (e) => {
  if (hitCat(e.clientX, e.clientY)) window.cat.openSettings();
});

// ---- IPC from main --------------------------------------------------------
window.cat.onCursor((d) => {
  state.prevCur = state.cur;
  state.cur = { x: d.x, y: d.y };
  state.catCenter = {
    x: d.bounds.x + d.bounds.width / 2,
    y: d.bounds.y + d.bounds.height / 2 + 10
  };
  const dx = state.cur.x - state.prevCur.x;
  const dy = state.cur.y - state.prevCur.y;
  const sp = Math.hypot(dx, dy) * 30; // px/sec approx (30fps)
  state.speed = sp;
  if (sp > 30) state.lastMoveAt = Date.now();
  if (settings.reactToSpeed && sp > 2200 && nearCursor(260)) {
    state.overheatMeter = Math.min(6, state.overheatMeter + 0.12);
  }
  state.dragging = d.dragging || state.dragging;
});

window.cat.onSettings((s) => {
  settings = { ...settings, ...s };
});

window.cat.onAction((a) => {
  if (a.type === 'stretch') {
    state.stretchUntil = Date.now() + 3200;
    const name = settings.userName ? settings.userName + ', ' : '';
    say('stretch~ 🙆', 3000);
  } else if (a.type === 'timer-on') {
    timerEl.classList.remove('hidden');
  } else if (a.type === 'timer-off') {
    timerEl.classList.add('hidden');
  }
});

window.cat.onPomo((p) => {
  const total = Math.max(0, p.remainMs);
  const mm = String(Math.floor(total / 60000)).padStart(2, '0');
  const ss = String(Math.floor((total % 60000) / 1000)).padStart(2, '0');
  timerEl.textContent = `${mm}:${ss}`;
  timerEl.classList.toggle('break', p.phase === 'break');
  timerEl.classList.remove('hidden');
});
