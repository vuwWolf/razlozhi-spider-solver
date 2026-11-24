const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getInfo: () => ipcRenderer.invoke('app:info'),
  openProfile: () => ipcRenderer.invoke('app:open-profile'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
});
