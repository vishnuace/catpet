const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  onSettings: (cb) => ipcRenderer.on('settings', (_e, data) => cb(data)),
  startPomodoro: () => ipcRenderer.send('start-pomodoro'),
  stopPomodoro: () => ipcRenderer.send('stop-pomodoro'),
  stretchNow: () => ipcRenderer.send('stretch-now')
});
