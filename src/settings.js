const fields = {
  baseColor: 'value',
  patternColor: 'value',
  bellyColor: 'value',
  eyeColor: 'value',
  pattern: 'value',
  userName: 'value',
  hotkeyToggle: 'value',
  stretchEveryMin: 'value',
  pomodoroWorkMin: 'value',
  pomodoroBreakMin: 'value',
  followCursor: 'checked',
  reactToSpeed: 'checked',
  alwaysOnTop: 'checked',
  stretchEnabled: 'checked'
};

const el = (id) => document.getElementById(id);
const statusEl = el('status');
let saveTimer = null;

function showStatus(msg) {
  statusEl.textContent = msg;
  statusEl.classList.add('show');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => statusEl.classList.remove('show'), 1200);
}

function fill(settings) {
  for (const [id, prop] of Object.entries(fields)) {
    const node = el(id);
    if (!node) continue;
    if (prop === 'checked') node.checked = !!settings[id];
    else node.value = settings[id] ?? '';
  }
}

function collect() {
  const out = {};
  for (const [id, prop] of Object.entries(fields)) {
    const node = el(id);
    if (!node) continue;
    if (prop === 'checked') out[id] = node.checked;
    else if (node.type === 'number') out[id] = Number(node.value);
    else out[id] = node.value;
  }
  return out;
}

async function save() {
  await window.api.saveSettings(collect());
  showStatus('Saved ✓');
}

async function init() {
  const settings = await window.api.getSettings();
  fill(settings);

  for (const id of Object.keys(fields)) {
    const node = el(id);
    if (!node) continue;
    const ev = (node.type === 'text' || node.type === 'number') ? 'input' : 'change';
    node.addEventListener(ev, save);
  }

  document.querySelectorAll('.preset').forEach((b) => {
    b.addEventListener('click', () => {
      el('baseColor').value = b.dataset.base;
      el('patternColor').value = b.dataset.pat;
      el('bellyColor').value = b.dataset.belly;
      el('eyeColor').value = b.dataset.eye;
      el('pattern').value = b.dataset.pattern;
      save();
    });
  });

  el('startPomo').addEventListener('click', async () => { await save(); window.api.startPomodoro(); showStatus('Pomodoro started 🍅'); });
  el('stopPomo').addEventListener('click', () => { window.api.stopPomodoro(); showStatus('Stopped'); });
  el('stretchNow').addEventListener('click', () => { window.api.stretchNow(); showStatus('Stretch! 🙆'); });
  el('hideNow').addEventListener('click', () => { window.api.setVisible(false); showStatus('Hidden — use the shortcut to bring it back'); });
  el('showNow').addEventListener('click', () => { window.api.setVisible(true); showStatus('Cat is back 🐱'); });
  el('reset').addEventListener('click', async () => {
    const s = await window.api.resetSettings();
    fill(s);
    showStatus('Reset ✓');
  });
}

window.api.onSettings((s) => fill(s));
init();
