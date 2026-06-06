const {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  Notification,
  globalShortcut
} = require('electron');
const path = require('path');
const { Store } = require('./store');

let store;
let catWin = null;
let settingsWin = null;
let tray = null;
let uio = null;
let lastActivityAt = Date.now();

const GRID = 40;
function pxForSize(size) {
  return Math.max(2, Math.min(8, Math.round(4 * (Number(size) || 1))));
}
function catDim() {
  return GRID * pxForSize(store.get('size'));
}

// Timers
let cursorTimer = null;
let stretchTimer = null;
let pomo = { active: false, phase: 'work', endsAt: 0, timer: null };

// Drag bookkeeping
let drag = { active: false, offsetX: 0, offsetY: 0 };
let lastCursor = { x: 0, y: 0 };

// Walking controller
let walk = { moving: false, dir: 1, tx: 0, ty: 0, nextAt: Date.now() + 5000 };
let walkTimer = null;

// Keep a single instance so the cat is never duplicated.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function createCatWindow() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  const dim = catDim();

  let x = store.get('posX');
  let y = store.get('posY');
  if (x === null || y === null) {
    x = width - dim - 24;
    y = height - dim - 24;
  }
  // Clamp on-screen in case the saved spot is now off the desktop.
  x = Math.max(0, Math.min(x, width - 40));
  y = Math.max(0, Math.min(y, height - 40));

  catWin = new BrowserWindow({
    width: dim,
    height: dim,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: store.get('alwaysOnTop'),
    focusable: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (store.get('alwaysOnTop')) {
    catWin.setAlwaysOnTop(true, 'screen-saver');
    catWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  catWin.loadFile(path.join(__dirname, 'cat.html'));

  catWin.on('closed', () => {
    catWin = null;
  });

  catWin.webContents.on('did-finish-load', () => {
    sendSettings();
    // On Windows/macOS, let clicks pass through transparent areas. The
    // renderer toggles this off when the pointer is over the cat itself.
    if (process.platform !== 'linux') {
      catWin.setIgnoreMouseEvents(true, { forward: true });
    }
    // Respect a previously saved hidden state (e.g. left hidden last time).
    if (store.get('hidden')) {
      catWin.hide();
    }
    if (process.env.CATPET_SNAPSHOT) {
      catWin.webContents.send('snapshot');
    }
  });

  startCursorTracking();
}

function startCursorTracking() {
  if (cursorTimer) clearInterval(cursorTimer);
  cursorTimer = setInterval(() => {
    if (!catWin || catWin.isDestroyed()) return;
    if (!catWin.isVisible()) return;
    const pt = screen.getCursorScreenPoint();
    const b = catWin.getBounds();

    if (drag.active) {
      const nx = pt.x - drag.offsetX;
      const ny = pt.y - drag.offsetY;
      catWin.setBounds({ x: Math.round(nx), y: Math.round(ny), width: b.width, height: b.height });
      catWin.webContents.send('cursor', { x: pt.x, y: pt.y, bounds: catWin.getBounds(), dragging: true });
      lastActivityAt = Date.now();
      return;
    }

    if (Math.hypot(pt.x - lastCursor.x, pt.y - lastCursor.y) > 2) lastActivityAt = Date.now();
    lastCursor = { x: pt.x, y: pt.y };
    catWin.webContents.send('cursor', { x: pt.x, y: pt.y, bounds: b, dragging: false });
  }, 1000 / 30);
}

function clampN(v, a, b) { return Math.max(a, Math.min(b, v)); }

function startWalking() {
  if (walkTimer) clearInterval(walkTimer);
  walkTimer = setInterval(stepWalk, 1000 / 30);
}

function stepWalk() {
  if (!catWin || catWin.isDestroyed() || !catWin.isVisible() || drag.active) return;
  const now = Date.now();
  const b = catWin.getBounds();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = display.workArea;

  if (walk.moving) {
    const dt = 1 / 30;
    const speed = 75;
    const dx = walk.tx - b.x;
    const dy = walk.ty - b.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 3) {
      walk.moving = false;
      walk.nextAt = now + 5000 + Math.random() * 9000;
      store.set({ posX: b.x, posY: b.y });
      if (catWin) catWin.webContents.send('walk', { moving: false, dir: walk.dir });
    } else {
      const step = Math.min(dist, speed * dt);
      const nx = b.x + (dx / dist) * step;
      const ny = b.y + (dy / dist) * step;
      catWin.setBounds({ x: Math.round(nx), y: Math.round(ny), width: b.width, height: b.height });
      walk.dir = dx >= 0 ? 1 : -1;
      catWin.webContents.send('walk', { moving: true, dir: walk.dir });
    }
    return;
  }

  // Decide whether to wander. Only while the user is active (so the cat can
  // sleep when you're away).
  const active = now - lastActivityAt < 14000;
  if (now > walk.nextAt && active && store.get('wander')) {
    const cur = screen.getCursorScreenPoint();
    let tx, ty;
    const r = Math.random();
    if (r < 0.35) {
      // curious — amble toward the cursor
      tx = cur.x - b.width / 2 + (Math.random() * 80 - 40);
      ty = cur.y - b.height + (Math.random() * 40 - 20);
    } else {
      // wander around the lower part of the screen
      tx = wa.x + Math.random() * (wa.width - b.width);
      ty = wa.y + (wa.height - b.height) - Math.random() * (wa.height * 0.35);
    }
    walk.tx = Math.round(clampN(tx, wa.x, wa.x + wa.width - b.width));
    walk.ty = Math.round(clampN(ty, wa.y, wa.y + wa.height - b.height));
    walk.dir = walk.tx >= b.x ? 1 : -1;
    walk.moving = true;
  }
}

function startInputHook() {
  try {
    const { uIOhook } = require('uiohook-napi');
    uio = uIOhook;
    uio.on('keydown', () => {
      lastActivityAt = Date.now();
      if (catWin && !catWin.isDestroyed() && catWin.isVisible()) {
        catWin.webContents.send('input', { kind: 'key' });
      }
    });
    uio.on('wheel', (e) => {
      lastActivityAt = Date.now();
      if (catWin && !catWin.isDestroyed() && catWin.isVisible()) {
        catWin.webContents.send('scroll', { rotation: e.rotation });
      }
    });
    uio.start();
  } catch (err) {
    // Global input hook unavailable (e.g. permissions) — the cat still works,
    // it just won't react to typing/scrolling.
    console.log('Input hook unavailable:', err && err.message);
  }
}

function rendererSettings() {
  return { ...store.getAll(), px: pxForSize(store.get('size')) };
}

function sendSettings() {
  if (catWin && !catWin.isDestroyed()) {
    catWin.webContents.send('settings', rendererSettings());
  }
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('settings', store.getAll());
  }
}

function applyWindowSize() {
  if (!catWin || catWin.isDestroyed()) return;
  const dim = catDim();
  const b = catWin.getBounds();
  if (b.width !== dim || b.height !== dim) {
    catWin.setBounds({ x: b.x, y: b.y, width: dim, height: dim });
  }
}

function createSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 460,
    height: 640,
    title: 'CatPet Settings',
    resizable: true,
    minimizable: true,
    maximizable: false,
    skipTaskbar: false,
    backgroundColor: '#1e1b2e',
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.webContents.on('did-finish-load', () => {
    settingsWin.webContents.send('settings', store.getAll());
  });
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

// ---- Reminders / Pomodoro -------------------------------------------------

function scheduleStretch() {
  if (stretchTimer) clearTimeout(stretchTimer);
  if (!store.get('stretchEnabled')) return;
  const mins = Math.max(1, Number(store.get('stretchEveryMin')) || 45);
  stretchTimer = setTimeout(() => {
    triggerStretch();
    scheduleStretch();
  }, mins * 60 * 1000);
}

function triggerStretch() {
  const name = store.get('userName');
  const who = name ? `${name}, ` : '';
  notify('Time to stretch! 🐱', `${who}let's stretch together. Stand up and reach for the sky!`);
  if (catWin && !catWin.isDestroyed()) {
    catWin.webContents.send('action', { type: 'stretch' });
  }
}

function notify(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: !store.get('sounds') }).show();
  }
}

function startPomodoro() {
  const workMin = Math.max(1, Number(store.get('pomodoroWorkMin')) || 25);
  pomo.active = true;
  pomo.phase = 'work';
  pomo.endsAt = Date.now() + workMin * 60 * 1000;
  tickPomodoro();
  notify('Focus time 🍅', `Pomodoro started — ${workMin} min of focus. You got this!`);
  if (catWin) catWin.webContents.send('action', { type: 'timer-on' });
  updateTrayMenu();
}

function stopPomodoro() {
  pomo.active = false;
  if (pomo.timer) clearInterval(pomo.timer);
  pomo.timer = null;
  if (catWin) catWin.webContents.send('action', { type: 'timer-off' });
  updateTrayMenu();
}

function tickPomodoro() {
  if (pomo.timer) clearInterval(pomo.timer);
  pomo.timer = setInterval(() => {
    if (!pomo.active) return;
    const remain = pomo.endsAt - Date.now();
    if (catWin && !catWin.isDestroyed()) {
      catWin.webContents.send('pomo', {
        phase: pomo.phase,
        remainMs: Math.max(0, remain)
      });
    }
    if (remain <= 0) {
      if (pomo.phase === 'work') {
        const breakMin = Math.max(1, Number(store.get('pomodoroBreakMin')) || 5);
        pomo.phase = 'break';
        pomo.endsAt = Date.now() + breakMin * 60 * 1000;
        notify('Break time! ☕', `Nice work. Take ${breakMin} min to relax with the cat.`);
        if (catWin) catWin.webContents.send('action', { type: 'stretch' });
      } else {
        const workMin = Math.max(1, Number(store.get('pomodoroWorkMin')) || 25);
        pomo.phase = 'work';
        pomo.endsAt = Date.now() + workMin * 60 * 1000;
        notify('Back to focus 🍅', `Break over — ${workMin} min of focus again.`);
      }
    }
  }, 1000);
}

// ---- Tray -----------------------------------------------------------------

function makeTrayIcon() {
  // A tiny 16x16 cat-ish icon drawn as a data URL so we need no asset file.
  const size = 16;
  const png = buildTrayPng();
  let img = nativeImage.createFromBuffer(png);
  if (img.isEmpty()) {
    img = nativeImage.createEmpty();
  }
  return img;
}

function buildTrayPng() {
  // Minimal: reuse the app icon if present, else empty.
  try {
    const p = path.join(__dirname, '..', 'build', 'icon.png');
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) return img.resize({ width: 16, height: 16 }).toPNG();
  } catch (_) {}
  return Buffer.alloc(0);
}

function prettyAccel(accel) {
  const isMac = process.platform === 'darwin';
  return accel
    .replace(/CommandOrControl|CmdOrCtrl/g, isMac ? 'Cmd' : 'Ctrl')
    .replace(/Command|Cmd/g, 'Cmd')
    .replace(/Control|Ctrl/g, 'Ctrl');
}

function updateTrayMenu() {
  if (!tray) return;
  const isHidden = !!store.get('hidden');
  const hk = (store.get('hotkeyToggle') || '').trim();
  const hkLabel = hk ? `  (${prettyAccel(hk)})` : '';
  const menu = Menu.buildFromTemplate([
    { label: 'CatPet 🐱', enabled: false },
    { type: 'separator' },
    {
      label: (isHidden ? 'Show cat' : 'Hide cat') + hkLabel,
      click: () => setCatVisible(isHidden)
    },
    { type: 'separator' },
    {
      label: 'Stretch now',
      click: () => triggerStretch()
    },
    pomo.active
      ? { label: 'Stop Pomodoro', click: () => stopPomodoro() }
      : { label: 'Start Pomodoro', click: () => startPomodoro() },
    {
      label: 'Call the cat (center)',
      click: () => recenterCat()
    },
    { type: 'separator' },
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: store.get('alwaysOnTop'),
      click: (item) => {
        store.set({ alwaysOnTop: item.checked });
        if (catWin) {
          catWin.setAlwaysOnTop(item.checked, 'screen-saver');
        }
      }
    },
    { label: 'Settings…', click: () => createSettingsWindow() },
    { type: 'separator' },
    { label: 'Quit CatPet', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
}

function recenterCat() {
  if (!catWin) return;
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  const dim = catDim();
  const x = Math.round(width / 2 - dim / 2);
  const y = Math.round(height / 2 - dim / 2);
  catWin.setBounds({ x, y, width: dim, height: dim });
  store.set({ posX: x, posY: y });
  if (store.get('hidden')) setCatVisible(true);
}

// ---- Hide / show ----------------------------------------------------------

function setCatVisible(visible) {
  store.set({ hidden: !visible });
  if (!catWin || catWin.isDestroyed()) return;
  if (visible) {
    catWin.showInactive();
    catWin.setAlwaysOnTop(!!store.get('alwaysOnTop'), 'screen-saver');
  } else {
    catWin.hide();
  }
  updateTrayMenu();
}

function toggleCatVisible() {
  setCatVisible(!!store.get('hidden'));
}

let registeredHotkey = null;
function registerHotkey() {
  if (registeredHotkey) {
    try { globalShortcut.unregister(registeredHotkey); } catch (_) {}
    registeredHotkey = null;
  }
  const accel = (store.get('hotkeyToggle') || '').trim();
  if (!accel) return true;
  try {
    const ok = globalShortcut.register(accel, () => toggleCatVisible());
    if (ok) registeredHotkey = accel;
    return ok;
  } catch (_) {
    return false;
  }
}

function createTray() {
  const icon = makeTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('CatPet — your desktop cat');
  updateTrayMenu();
  tray.on('click', () => createSettingsWindow());
  tray.on('double-click', () => createSettingsWindow());
}

// ---- IPC ------------------------------------------------------------------

ipcMain.on('drag-start', () => {
  if (!catWin) return;
  const pt = screen.getCursorScreenPoint();
  const b = catWin.getBounds();
  drag.active = true;
  drag.offsetX = pt.x - b.x;
  drag.offsetY = pt.y - b.y;
  walk.moving = false;
  walk.nextAt = Date.now() + 4000;
});

ipcMain.on('drag-end', () => {
  drag.active = false;
  if (catWin) {
    const b = catWin.getBounds();
    store.set({ posX: b.x, posY: b.y });
  }
});

ipcMain.on('set-ignore', (_e, val) => {
  if (catWin && !catWin.isDestroyed() && process.platform !== 'linux') {
    catWin.setIgnoreMouseEvents(!!val, { forward: true });
  }
});

ipcMain.on('open-settings', () => createSettingsWindow());

ipcMain.on('cat-context-menu', () => {
  const hk = (store.get('hotkeyToggle') || '').trim();
  const menu = Menu.buildFromTemplate([
    { label: 'Hide cat' + (hk ? `  (${prettyAccel(hk)})` : ''), click: () => setCatVisible(false) },
    { label: 'Stretch now', click: () => triggerStretch() },
    pomo.active
      ? { label: 'Stop Pomodoro', click: () => stopPomodoro() }
      : { label: 'Start Pomodoro', click: () => startPomodoro() },
    { label: 'Settings…', click: () => createSettingsWindow() },
    { type: 'separator' },
    { label: 'Quit CatPet', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  menu.popup({ window: catWin });
});

ipcMain.handle('get-settings', () => store.getAll());

ipcMain.handle('save-settings', (_e, patch) => {
  store.set(patch);
  // Apply live changes.
  if (catWin) {
    catWin.setAlwaysOnTop(!!store.get('alwaysOnTop'), 'screen-saver');
  }
  applyWindowSize();
  sendSettings();
  scheduleStretch();
  registerHotkey();
  updateTrayMenu();
  return store.getAll();
});

ipcMain.on('save-snapshot', (_e, { name, dataURL }) => {
  try {
    const fs = require('fs');
    const dir = path.join(__dirname, '..', 'snapshots');
    fs.mkdirSync(dir, { recursive: true });
    const b64 = dataURL.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(b64, 'base64'));
  } catch (_) {}
});

ipcMain.handle('reset-settings', () => {
  store.reset();
  sendSettings();
  scheduleStretch();
  registerHotkey();
  updateTrayMenu();
  return store.getAll();
});

ipcMain.on('toggle-visible', () => toggleCatVisible());
ipcMain.on('set-visible', (_e, val) => setCatVisible(!!val));

ipcMain.on('start-pomodoro', () => startPomodoro());
ipcMain.on('stop-pomodoro', () => stopPomodoro());
ipcMain.on('stretch-now', () => triggerStretch());

// ---- App lifecycle --------------------------------------------------------

app.on('second-instance', () => {
  if (catWin) {
    recenterCat();
  } else {
    createCatWindow();
  }
});

app.whenReady().then(() => {
  store = new Store();
  createCatWindow();
  createTray();
  scheduleStretch();
  registerHotkey();
  startWalking();
  startInputHook();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createCatWindow();
  });
});

// Desktop pet should keep running even with no visible "main" window.
app.on('window-all-closed', (e) => {
  // Do nothing — tray keeps the app alive. Quit only via tray menu.
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (cursorTimer) clearInterval(cursorTimer);
  if (stretchTimer) clearTimeout(stretchTimer);
  if (pomo.timer) clearInterval(pomo.timer);
  if (walkTimer) clearInterval(walkTimer);
  if (uio) { try { uio.stop(); } catch (_) {} }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
