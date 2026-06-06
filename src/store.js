const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  // Appearance
  baseColor: '#f5c98a',   // body color
  patternColor: '#c6843e', // stripes / patches
  bellyColor: '#fff4e2',
  pattern: 'tabby',        // 'solid' | 'tabby' | 'tuxedo' | 'calico'
  size: 1.0,               // scale multiplier
  eyeColor: '#6fcf57',

  // Behaviour
  followCursor: true,
  reactToSpeed: true,
  alwaysOnTop: true,
  sounds: false,

  // Personality
  userName: '',

  // Reminders / Pomodoro
  stretchEnabled: true,
  stretchEveryMin: 45,
  pomodoroWorkMin: 25,
  pomodoroBreakMin: 5,

  // Window position (null => default bottom-right)
  posX: null,
  posY: null
};

class Store {
  constructor(fileName = 'catpet-settings.json') {
    this.path = path.join(app.getPath('userData'), fileName);
    this.data = { ...DEFAULTS };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.path)) {
        const raw = fs.readFileSync(this.path, 'utf-8');
        const parsed = JSON.parse(raw);
        this.data = { ...DEFAULTS, ...parsed };
      }
    } catch (err) {
      // Corrupt file — fall back to defaults but keep a backup.
      try { fs.renameSync(this.path, this.path + '.bak'); } catch (_) {}
      this.data = { ...DEFAULTS };
    }
  }

  get(key) {
    return key === undefined ? this.data : this.data[key];
  }

  getAll() {
    return { ...this.data };
  }

  set(patch) {
    this.data = { ...this.data, ...patch };
    this._save();
    return this.data;
  }

  reset() {
    this.data = { ...DEFAULTS };
    this._save();
    return this.data;
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
      fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      // best effort
    }
  }
}

module.exports = { Store, DEFAULTS };
