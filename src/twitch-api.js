// Verbindung zur offiziellen Twitch-API (für "Wer ist live?", Zuschauerzahlen, Profilbilder).
// Login läuft über den "Device Code Flow": Die App zeigt einen Code, du bestätigst ihn auf twitch.tv.
// Dafür braucht es nur eine Client-ID von dev.twitch.tv – kein Passwort, kein Geheimnis.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const SCOPES = 'user:read:follows';
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
} catch {}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
}

const form = (data) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(data),
});

function status() {
  return {
    clientId: settings.clientId || '',
    connected: Boolean(settings.accessToken),
    user: settings.user || null,
  };
}

function setClientId(id) {
  const clean = String(id || '').trim();
  if (clean !== settings.clientId) {
    settings = { clientId: clean }; // neue Client-ID -> alte Anmeldung passt nicht mehr
    saveSettings();
  }
  return status();
}

function disconnect() {
  settings = { clientId: settings.clientId };
  saveSettings();
  return status();
}

// Schritt 1: Code bei Twitch anfordern
async function startDeviceFlow() {
  if (!settings.clientId) throw new Error('Keine Client-ID eingetragen');
  const res = await fetch('https://id.twitch.tv/oauth2/device', form({ client_id: settings.clientId, scopes: SCOPES }));
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Twitch hat die Client-ID abgelehnt');
  return data; // { device_code, user_code, verification_uri, interval, expires_in }
}

// Schritt 2: warten, bis du den Code auf twitch.tv bestätigt hast
async function waitForApproval(flow, isCancelled) {
  const deadline = Date.now() + flow.expires_in * 1000;
  while (Date.now() < deadline && !isCancelled()) {
    await new Promise((r) => setTimeout(r, (flow.interval || 5) * 1000));
    const res = await fetch(
      'https://id.twitch.tv/oauth2/token',
      form({
        client_id: settings.clientId,
        scopes: SCOPES,
        device_code: flow.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      })
    );
    const data = await res.json();
    if (res.ok) {
      settings.accessToken = data.access_token;
      settings.refreshToken = data.refresh_token;
      await loadUser();
      saveSettings();
      return status();
    }
    if (data.message !== 'authorization_pending') throw new Error(data.message || 'Anmeldung fehlgeschlagen');
  }
  throw new Error('Zeit abgelaufen – bitte nochmal versuchen');
}

async function refresh() {
  if (!settings.refreshToken) throw new Error('Nicht verbunden');
  const res = await fetch(
    'https://id.twitch.tv/oauth2/token',
    form({ client_id: settings.clientId, grant_type: 'refresh_token', refresh_token: settings.refreshToken })
  );
  const data = await res.json();
  if (!res.ok) {
    disconnect();
    throw new Error('Twitch-Verbindung abgelaufen – bitte neu verbinden');
  }
  settings.accessToken = data.access_token;
  settings.refreshToken = data.refresh_token;
  saveSettings();
}

// Aufruf der Helix-API, erneuert den Zugang automatisch, wenn er abgelaufen ist
async function helix(endpoint, retry = true) {
  if (!settings.accessToken) throw new Error('Nicht verbunden');
  const res = await fetch(`https://api.twitch.tv/helix/${endpoint}`, {
    headers: { 'Client-Id': settings.clientId, Authorization: `Bearer ${settings.accessToken}` },
  });
  if (res.status === 401 && retry) {
    await refresh();
    return helix(endpoint, false);
  }
  if (!res.ok) throw new Error(`Twitch-API Fehler ${res.status}`);
  return res.json();
}

async function loadUser() {
  const { data } = await helix('users');
  const u = data[0];
  settings.user = { id: u.id, login: u.login, name: u.display_name, avatar: u.profile_image_url };
}

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function avatars(logins) {
  const out = {};
  for (const part of chunks(logins, 100)) {
    const { data } = await helix(`users?${part.map((l) => `login=${encodeURIComponent(l)}`).join('&')}`);
    for (const u of data) out[u.login] = u.profile_image_url;
  }
  return out;
}

const streamInfo = (s) => ({
  login: s.user_login,
  name: s.user_name,
  game: s.game_name,
  title: s.title,
  viewers: s.viewer_count,
  startedAt: s.started_at,
});

// Gefolgte Kanäle, die gerade live sind (mit Profilbild)
async function followedLive() {
  if (!settings.user) await loadUser();
  const { data } = await helix(`streams/followed?user_id=${settings.user.id}&first=100`);
  const list = data.map(streamInfo);
  const pics = list.length ? await avatars(list.map((s) => s.login)) : {};
  return list.map((s) => ({ ...s, avatar: pics[s.login] || null }));
}

// Live-Infos zu beliebigen Kanälen (für die Streams auf der Bühne). Nicht enthalten = offline.
async function streams(logins) {
  const out = {};
  for (const part of chunks(logins, 100)) {
    const { data } = await helix(`streams?first=100&${part.map((l) => `user_login=${encodeURIComponent(l)}`).join('&')}`);
    for (const s of data) out[s.user_login] = streamInfo(s);
  }
  return out;
}

// Kanalsuche für die Vorschläge beim Eintippen
async function search(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const { data } = await helix(`search/channels?first=8&query=${encodeURIComponent(q)}`);
  return data.map((c) => ({
    login: c.broadcaster_login,
    name: c.display_name,
    live: c.is_live,
    game: c.game_name,
    title: c.title,
    avatar: c.thumbnail_url,
  }));
}

module.exports = { status, setClientId, disconnect, startDeviceFlow, waitForApproval, followedLive, streams, search };
