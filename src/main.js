// Hauptprozess: Fenster, Twitch-Login, Twitch-API, Bild-im-Bild, Vollbild und Update-Check.
const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('path');
const api = require('./twitch-api');
const pkg = require('../package.json');

// Alle Streams, der Chat und das Login-Fenster teilen sich diese Session.
// "persist:" = Login bleibt nach dem Neustart erhalten.
// Weil die Player mit DEINEM eingeloggten Twitch-Konto laufen, greift dein Turbo-Abo.
const PARTITION = 'persist:twitch';

// Twitch mag keine "Electron"-Browser -> wir geben uns als normales Chrome aus.
const chromeUA = () =>
  app.userAgentFallback.replace(/\s?Electron\/\S+/, '').replace(/\s?multitwitch\/\S+/i, '');

let mainWindow;
const pipWindows = new Map(); // Kanal -> Bild-im-Bild-Fenster

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 850,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#0b0b10',
    title: 'MultiTwitch',
    // Eigene Titelleiste: Mac behält die Ampel-Knöpfe, Windows die Fenster-Knöpfe rechts
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    titleBarOverlay: process.platform === 'win32'
      ? { color: '#0b0b10', symbolColor: '#e8e6f0', height: 52 }
      : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // nötig für die eingebetteten Streams
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Vollbild verlassen (z. B. per Esc oder grünem Knopf) -> Oberfläche Bescheid geben
  mainWindow.on('leave-full-screen', () => mainWindow.webContents.send('fullscreen-changed', false));
  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send('fullscreen-changed', true));
  mainWindow.on('closed', () => {
    mainWindow = null;
    for (const w of pipWindows.values()) w.close();
  });
}

function openLoginWindow() {
  const win = new BrowserWindow({
    width: 500,
    height: 750,
    parent: mainWindow,
    title: 'Bei Twitch einloggen',
    webPreferences: { partition: PARTITION },
  });
  win.loadURL('https://www.twitch.tv/login');

  // Sobald der Login durch ist, leitet Twitch weg von /login -> Fenster schließen.
  win.webContents.on('did-navigate', async (_e, url) => {
    if (!url.includes('/login') && (await isLoggedIn())) {
      win.close();
    }
  });
  win.on('closed', () => mainWindow?.webContents.send('login-changed'));
}

async function isLoggedIn() {
  const cookies = await session
    .fromPartition(PARTITION)
    .cookies.get({ domain: 'twitch.tv', name: 'auth-token' });
  return cookies.length > 0;
}

async function getUsername() {
  const cookies = await session
    .fromPartition(PARTITION)
    .cookies.get({ domain: 'twitch.tv', name: 'login' });
  return cookies[0]?.value || null;
}

// ---------- Bild-im-Bild: kleines Fenster, das immer im Vordergrund bleibt ----------

function openPip(channel) {
  if (pipWindows.has(channel)) return pipWindows.get(channel).focus();
  const win = new BrowserWindow({
    width: 480,
    height: 270,
    minWidth: 256,
    minHeight: 144,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#000000',
    title: `${channel} – Bild-im-Bild`,
    webPreferences: { webviewTag: true, contextIsolation: true },
  });
  win.setAspectRatio(16 / 9);
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'pip.html'), { query: { channel } });
  pipWindows.set(channel, win);
  win.on('closed', () => {
    pipWindows.delete(channel);
    mainWindow?.webContents.send('pip-closed', channel);
  });
}

// ---------- Update-Check über GitHub-Releases ----------

const newer = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

async function checkForUpdate() {
  const repo = pkg.multitwitch?.updateRepo; // z. B. "deinname/multitwitch"
  if (!repo) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`);
    if (!res.ok) return null;
    const rel = await res.json();
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    return newer(latest, app.getVersion()) ? { version: latest, url: rel.html_url } : null;
  } catch {
    return null;
  }
}

// ---------- Start ----------

app.whenReady().then(() => {
  app.userAgentFallback = chromeUA();
  session.fromPartition(PARTITION).setUserAgent(chromeUA());

  // Twitch-Login (Cookies, für Turbo)
  ipcMain.handle('login', () => openLoginWindow());
  ipcMain.handle('logout', async () => {
    await session.fromPartition(PARTITION).clearStorageData();
  });
  ipcMain.handle('status', async () => ({
    loggedIn: await isLoggedIn(),
    username: await getUsername(),
  }));

  // Twitch-API (für Live-Liste & Infos)
  let flowId = 0;
  ipcMain.handle('api:status', () => api.status());
  ipcMain.handle('api:set-client-id', (_e, id) => api.setClientId(id));
  ipcMain.handle('api:disconnect', () => {
    flowId++;
    return api.disconnect();
  });
  ipcMain.handle('api:connect', async () => {
    const id = ++flowId;
    const flow = await api.startDeviceFlow();
    // Bestätigungsseite im App-Browser öffnen – dort bist du schon bei Twitch eingeloggt
    const win = new BrowserWindow({
      width: 520,
      height: 760,
      parent: mainWindow,
      title: 'MultiTwitch mit Twitch verbinden',
      webPreferences: { partition: PARTITION },
    });
    win.loadURL(flow.verification_uri);
    api
      .waitForApproval(flow, () => id !== flowId || win.isDestroyed())
      .then((st) => mainWindow?.webContents.send('api:connected', st))
      .catch((err) => mainWindow?.webContents.send('api:error', err.message))
      .finally(() => !win.isDestroyed() && win.close());
    return { userCode: flow.user_code };
  });
  ipcMain.handle('api:followed-live', () => api.followedLive());
  ipcMain.handle('api:streams', (_e, logins) => api.streams(logins));

  // Fenster-Funktionen
  ipcMain.handle('pip', (_e, channel) => openPip(channel));
  ipcMain.handle('fullscreen', (_e, on) => mainWindow?.setFullScreen(on));
  ipcMain.handle('open-external', (_e, url) => url.startsWith('https://') && shell.openExternal(url));
  ipcMain.handle('version', () => app.getVersion());
  ipcMain.handle('check-update', () => checkForUpdate());

  // Links (z. B. aus dem Chat) im normalen Browser öffnen statt in der App.
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http')) shell.openExternal(url);
      return { action: 'deny' };
    });
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
