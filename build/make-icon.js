// Erzeugt build/icon.png (1024x1024) aus build/icon.svg. Aufruf: npx electron build/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  win.webContents.setZoomFactor(1);
  const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
  const html = `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg width="1024" height="1024" ')}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 500));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const png = image.resize({ width: 1024, height: 1024 }).toPNG();
  fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
  console.log('icon.png geschrieben', image.getSize());
  app.quit();
});
