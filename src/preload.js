// Brücke zwischen Oberfläche und Hauptprozess (nur diese Funktionen sind erlaubt).
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, ...args) => cb(...args));

contextBridge.exposeInMainWorld('twitch', {
  platform: process.platform,
  // Twitch-Login im App-Browser (für Turbo)
  login: () => ipcRenderer.invoke('login'),
  logout: () => ipcRenderer.invoke('logout'),
  status: () => ipcRenderer.invoke('status'),
  onLoginChanged: on('login-changed'),
  // Twitch-API (Live-Liste, Zuschauerzahlen)
  api: {
    status: () => ipcRenderer.invoke('api:status'),
    setClientId: (id) => ipcRenderer.invoke('api:set-client-id', id),
    connect: () => ipcRenderer.invoke('api:connect'),
    disconnect: () => ipcRenderer.invoke('api:disconnect'),
    followedLive: () => ipcRenderer.invoke('api:followed-live'),
    streams: (logins) => ipcRenderer.invoke('api:streams', logins),
    search: (query) => ipcRenderer.invoke('api:search', query),
    onConnected: on('api:connected'),
    onError: on('api:error'),
  },
  // Menü & Tastenkürzel aus den Streams
  onMenu: on('menu'),
  onShortcut: on('shortcut'),
  focusApp: () => ipcRenderer.invoke('focus-app'),
  // Fenster
  pip: (channel) => ipcRenderer.invoke('pip', channel),
  onPipClosed: on('pip-closed'),
  fullscreen: (onOff) => ipcRenderer.invoke('fullscreen', onOff),
  onFullscreenChanged: on('fullscreen-changed'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  version: () => ipcRenderer.invoke('version'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
});
