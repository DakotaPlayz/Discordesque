// Expose only the narrowly-scoped file writer operations to the renderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('discordesqueFiles', {
  start: (filename, size) => ipcRenderer.invoke('file:start', filename, size),
  write: (id, bytes) => ipcRenderer.invoke('file:write', id, bytes),
  finish: (id) => ipcRenderer.invoke('file:finish', id),
  cancel: (id) => ipcRenderer.invoke('file:cancel', id),
});
