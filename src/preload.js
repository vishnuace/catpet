const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cat', {
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, data) => cb(data)),
  onSettings: (cb) => ipcRenderer.on('settings', (_e, data) => cb(data)),
  onAction: (cb) => ipcRenderer.on('action', (_e, data) => cb(data)),
  onPomo: (cb) => ipcRenderer.on('pomo', (_e, data) => cb(data)),
  onWalk: (cb) => ipcRenderer.on('walk', (_e, data) => cb(data)),
  onInput: (cb) => ipcRenderer.on('input', (_e, data) => cb(data)),
  onScroll: (cb) => ipcRenderer.on('scroll', (_e, data) => cb(data)),
  onSnapshot: (cb) => ipcRenderer.on('snapshot', () => cb()),
  saveSnapshot: (name, dataURL) => ipcRenderer.send('save-snapshot', { name, dataURL }),

  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  setIgnore: (val) => ipcRenderer.send('set-ignore', val),
  platform: process.platform,
  openSettings: () => ipcRenderer.send('open-settings'),
  contextMenu: () => ipcRenderer.send('cat-context-menu'),
  startPomodoro: () => ipcRenderer.send('start-pomodoro'),
  stopPomodoro: () => ipcRenderer.send('stop-pomodoro'),
  stretchNow: () => ipcRenderer.send('stretch-now')
});
