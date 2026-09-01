'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kuubikDesktop', Object.freeze({
  isDesktop: true,
  getAppInfo: () => ipcRenderer.invoke('app:info'),
}));
