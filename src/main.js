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

const CAT_W = 240;
const CAT_H = 240;

// Timers
let cursorTimer = null;
let stretchTimer = null;
let pomo = { active: false, phase: 'work', endsAt: 0, timer: null };

// Drag bookkeeping
let drag = { active: false, offsetX: 0, offsetY: 0 };

// Keep a single instance so the cat is never duplicated.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function createCatWindow() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;

  let x = store.get('posX');
  let y = store.get('posY');
  if (x === null || y === null) {
    x = width - CAT_W - 24;
    y = height - CAT_H - 24;
  }
  // Clamp on-screen in case the saved spot is now off the desktop.
  x = Math.max(0, Math.min(x, width - 40));
  y = Math.max(0, Math.min(y, height - 40));

  catWin = new BrowserWindow({
    width: CAT_W,
    height: CAT_H,
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

  catWin.on('moved', () => {
    if (!catWin) return;
    const b = catWin.getBounds();
    store.set({ posX: b.x, posY: b.y });
  });

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
      return;
    }

    catWin.webContents.send('cursor', { x: pt.x, y: pt.y, bounds: b, dragging: false });
  }, 1000 / 30);
}

function sendSettings() {
  if (catWin && !catWin.isDestroyed()) {
    catWin.webContents.send('settings', store.getAll());
  }
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('settings', store.getAll());
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
  const x = Math.round(width / 2 - CAT_W / 2);
  const y = Math.round(height / 2 - CAT_H / 2);
  catWin.setBounds({ x, y, width: CAT_W, height: CAT_H });
  store.set({ posX: x, posY: y });
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
  sendSettings();
  scheduleStretch();
  registerHotkey();
  updateTrayMenu();
  return store.getAll();
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
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
