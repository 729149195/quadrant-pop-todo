const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quadrantTodo', {
  load: () => ipcRenderer.invoke('store:load'),
  save: (payload) => ipcRenderer.invoke('store:save', payload),
  hide: () => ipcRenderer.invoke('window:hide'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  resizeWindow: (size) => ipcRenderer.invoke('window:resize', size),
  setPinned: (pinned) => ipcRenderer.invoke('window:setPinned', pinned),
  openDataFolder: () => ipcRenderer.invoke('system:openDataFolder'),
  onShown: (callback) => {
    ipcRenderer.on('app:shown', callback);
  },
  onReminder: (callback) => {
    ipcRenderer.on('reminder:due', callback);
  }
});
