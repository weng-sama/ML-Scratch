// 只暴露前端需要的少數功能（contextIsolation 下的安全橋接）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mlscratch', {
  backendInfo: () => ipcRenderer.invoke('backend:info'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  openFile: (filters) => ipcRenderer.invoke('dialog:openFile', filters),
  saveProject: (content) => ipcRenderer.invoke('project:save', content),
  openProject: () => ipcRenderer.invoke('project:open'),
});
