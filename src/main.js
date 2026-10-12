// Hauptprozess: Fenster, Menü, Twitch-Login, Twitch-API, Bild-im-Bild, Vollbild und Update-Check.
const { app, BrowserWindow, Menu, ipcMain, screen, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');
// Test-Profil: MULTITWITCH_PROFILE=name startet mit komplett getrennten Daten (Login, Einstellungen, Streams)
if (process.env.MULTITWITCH_PROFILE) {
  app.setPath('userData', path.join(app.getPath('appData'), `MultiTwitch-${process.env.MULTITWITCH_PROFILE}`));
}

// Streams und Ton-Angleichung dürfen ohne vorherigen Klick abspielen
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

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

// Nur eine MultiTwitch-Instanz: ein zweiter Start holt das vorhandene Fenster nach vorne
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => {
  if (!mainWindow) return createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

// ---------- Fenstergröße und -position merken ----------

const windowStateFile = () => path.join(app.getPath('userData'), 'window.json');

function loadWindowState() {
  try {
    const st = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'));
    // Nur übernehmen, wenn das Fenster noch auf einem angeschlossenen Bildschirm liegt
    const area = screen.getDisplayMatching(st).workArea;
    const visible = st.x < area.x + area.width - 100 && st.x + st.width > area.x + 100 && st.y >= area.y - 20 && st.y < area.y + area.height - 100;
    return visible ? st : { width: st.width, height: st.height };
  } catch {
    return { width: 1400, height: 850 };
  }
}

function trackWindowState(win) {
  let timer;
  const store = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return;
      const st = { ...win.getNormalBounds(), maximized: win.isMaximized() };
      try {
        fs.writeFileSync(windowStateFile(), JSON.stringify(st));
      } catch {}
    }, 400);
  };
  win.on('resize', store);
  win.on('move', store);
  win.on('maximize', store);
  win.on('unmaximize', store);
}

function createMainWindow() {
  const st = loadWindowState();
  mainWindow = new BrowserWindow({
    x: st.x,
    y: st.y,
    width: st.width,
    height: st.height,
    show: false,
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
  if (st.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  trackWindowState(mainWindow);

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

// ---------- Menü (oben in der Mac-Menüleiste, unter Windows über die Tastenkürzel) ----------

const send = (cmd) => () => mainWindow?.webContents.send('menu', cmd);

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{
          label: 'MultiTwitch',
          submenu: [
            { role: 'about', label: 'Über MultiTwitch' },
            { type: 'separator' },
            { label: 'Einstellungen …', accelerator: 'Cmd+,', click: send('settings') },
            { type: 'separator' },
            { role: 'hide', label: 'MultiTwitch ausblenden' },
            { role: 'hideOthers', label: 'Andere ausblenden' },
            { role: 'unhide', label: 'Alle einblenden' },
            { type: 'separator' },
            { role: 'quit', label: 'MultiTwitch beenden' },
          ],
        }]
      : []),
    {
      label: 'Streams',
      submenu: [
        { label: 'Kanal hinzufügen …', accelerator: 'CmdOrCtrl+K', click: send('add') },
        { label: 'Alle Streams neu laden', accelerator: 'CmdOrCtrl+R', click: send('reload-all') },
        { type: 'separator' },
        { label: 'Alle Streams laut', click: send('unmute-all') },
        { label: 'Alle Streams stumm', click: send('mute-all') },
        { type: 'separator' },
        { label: 'Alle Streams entfernen', click: send('clear') },
        ...(!isMac ? [{ type: 'separator' }, { label: 'Einstellungen …', accelerator: 'Ctrl+,', click: send('settings') }] : []),
      ],
    },
    { role: 'editMenu', label: 'Bearbeiten' },
    {
      label: 'Ansicht',
      submenu: [
        { label: 'Raster', accelerator: 'CmdOrCtrl+1', click: send('layout:equal') },
        { label: 'Fokus', accelerator: 'CmdOrCtrl+2', click: send('layout:focus') },
        { label: 'Frei', accelerator: 'CmdOrCtrl+3', click: send('layout:free') },
        { type: 'separator' },
        { label: 'Live-Liste ein/aus', accelerator: 'CmdOrCtrl+Shift+S', click: send('sidebar') },
        { label: 'Chat ein/aus', accelerator: 'CmdOrCtrl+Shift+C', click: send('chat') },
        { label: 'Kino-Modus', accelerator: 'CmdOrCtrl+Shift+F', click: send('cinema') },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Originalgröße' },
        { role: 'zoomIn', label: 'Vergrößern' },
        { role: 'zoomOut', label: 'Verkleinern' },
      ],
    },
    { role: 'windowMenu', label: 'Fenster' },
    {
      label: 'Hilfe',
      submenu: [
        { label: 'Projektseite auf GitHub', click: () => shell.openExternal(`https://github.com/${pkg.multitwitch.updateRepo}`) },
        { label: 'Problem melden …', click: () => shell.openExternal(`https://github.com/${pkg.multitwitch.updateRepo}/issues/new`) },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Entwicklertools' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- Sicherheit & Tastenkürzel für die eingebetteten Twitch-Seiten ----------

const isTwitchUrl = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'twitch.tv' || u.hostname.endsWith('.twitch.tv'));
  } catch {
    return false;
  }
};

// Tasten, die auch funktionieren sollen, wenn man vorher in einen Stream geklickt hat
const FORWARDED_KEYS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'f', 'c', 'l', 's', 'n', 'escape']);

function secureContents(contents) {
  // Eingebettete Seiten dürfen nur Twitch laden – ohne Zugriff auf die App
  contents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    if (!isTwitchUrl(params.src)) e.preventDefault();
  });

  // Links öffnen im normalen Browser statt in der App
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (contents.getType() !== 'webview') return;

  // Ein Stream/Chat darf nicht auf fremde Seiten wegnavigieren
  contents.on('will-navigate', (e, url) => {
    if (!isTwitchUrl(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // Tastenkürzel aus den Playern (nicht aus dem Chat, da wird getippt) an die App weiterreichen
  contents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || input.meta || input.control || input.alt) return;
    if (!contents.getURL().startsWith('https://player.twitch.tv/')) return;
    const key = input.key.toLowerCase();
    if (!FORWARDED_KEYS.has(key)) return;
    const host = contents.hostWebContents;
    if (!host || host !== mainWindow?.webContents) return;
    e.preventDefault();
    host.send('shortcut', input.key);
  });
}

// ---------- Start ----------

app.whenReady().then(() => {
  if (!gotLock) return;
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
  ipcMain.handle('api:search', (_e, query) => api.search(query));

  // Fenster-Funktionen
  ipcMain.handle('pip', (_e, channel) => openPip(channel));
  ipcMain.handle('fullscreen', (_e, on) => mainWindow?.setFullScreen(on));
  ipcMain.handle('open-external', (_e, url) => url.startsWith('https://') && shell.openExternal(url));
  ipcMain.handle('version', () => app.getVersion());
  ipcMain.handle('check-update', () => checkForUpdate());

  ipcMain.handle('focus-app', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  });

  app.on('web-contents-created', (_e, contents) => secureContents(contents));

  app.setAboutPanelOptions({
    applicationName: 'MultiTwitch',
    applicationVersion: app.getVersion(),
    credits: 'Mehrere Twitch-Streams gleichzeitig – mit deinem eigenen Login.',
    website: `https://github.com/${pkg.multitwitch.updateRepo}`,
  });
  buildMenu();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
