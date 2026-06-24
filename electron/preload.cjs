const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aiBread', {
  ai: {
    status: () => ipcRenderer.invoke('ai:status'),
    train: () => ipcRenderer.invoke('ai:train'),
    predict: (imagePath) => ipcRenderer.invoke('ai:predict', imagePath),
    onEvent: (listener) => {
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on('ai:event', wrapped);
      return () => ipcRenderer.removeListener('ai:event', wrapped);
    },
  },
  capture: {
    save: (dataUrl) => ipcRenderer.invoke('capture:save', dataUrl),
  },
  pos: {
    listProducts: () => ipcRenderer.invoke('pos:list-products'),
    checkout: (items) => ipcRenderer.invoke('pos:checkout', items),
  },
});
