// Verbindung zur offiziellen Twitch-API (für "Wer ist live?", Zuschauerzahlen, Profilbilder, Suche).
// Login läuft über den "Device Code Flow": Die App zeigt einen Code, du bestätigst ihn auf twitch.tv.
// Dafür braucht es nur eine Client-ID von dev.twitch.tv – kein Passwort, kein Geheimnis.
//
// Wichtig zum Verständnis: Der Zugangsschlüssel (accessToken) läuft nach ein paar Stunden ab und wird
// mit dem Erneuerungsschlüssel (refreshToken) ausgetauscht. Den Erneuerungsschlüssel akzeptiert Twitch
// NUR EINMAL. Deshalb darf immer nur eine Erneuerung gleichzeitig laufen (siehe renew()).
const fs = require('fs');
const path = require('path');

const SCOPES = 'user:read:follows';
const RENEW_EARLY_MS = 5 * 60 * 1000; // 5 Minuten vor Ablauf schon erneuern

// file = Pfad zur settings.json, fetchImpl = für Tests austauschbar
function createTwitchApi({ file, fetchImpl = fetch, now = Date.now }) {
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}

  // Sicher speichern: erst in eine Hilfsdatei schreiben, dann umbenennen.
  // So kann die Datei nie halb geschrieben (= kaputt) sein, auch wenn die App mittendrin beendet wird.
  function saveSettings() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
    fs.renameSync(tmp, file);
  }

  const form = (data) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data),
  });

  function status() {
    return {
      clientId: settings.clientId || '',
      connected: Boolean(settings.refreshToken || settings.accessToken),
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
    settings = { clientId: settings.clientId }; // Client-ID bleibt immer erhalten
    saveSettings();
    return status();
  }

  function storeTokens(data) {
    settings.accessToken = data.access_token;
    if (data.refresh_token) settings.refreshToken = data.refresh_token;
    settings.expiresAt = data.expires_in ? now() + data.expires_in * 1000 : null;
  }

  // Schritt 1: Code bei Twitch anfordern
  async function startDeviceFlow() {
    if (!settings.clientId) throw new Error('Keine Client-ID eingetragen');
    const res = await fetchImpl('https://id.twitch.tv/oauth2/device', form({ client_id: settings.clientId, scopes: SCOPES }));
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Twitch hat die Client-ID abgelehnt');
    return data; // { device_code, user_code, verification_uri, interval, expires_in }
  }

  // Schritt 2: warten, bis du den Code auf twitch.tv bestätigt hast
  async function waitForApproval(flow, isCancelled) {
    const deadline = now() + flow.expires_in * 1000;
    while (now() < deadline && !isCancelled()) {
      await new Promise((r) => setTimeout(r, (flow.interval || 5) * 1000));
      const res = await fetchImpl(
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
        storeTokens(data);
        await loadUser();
        saveSettings();
        return status();
      }
      if (data.message !== 'authorization_pending') throw new Error(data.message || 'Anmeldung fehlgeschlagen');
    }
    throw new Error('Zeit abgelaufen – bitte nochmal versuchen');
  }

  // Zugang erneuern. Laufen mehrere Anfragen gleichzeitig hier hinein, warten alle auf DIESELBE Erneuerung.
  let renewing = null;
  function renew() {
    if (!renewing) renewing = doRenew().finally(() => (renewing = null));
    return renewing;
  }

  async function doRenew() {
    if (!settings.refreshToken) throw new Error('Nicht verbunden');
    let res;
    let data;
    try {
      res = await fetchImpl(
        'https://id.twitch.tv/oauth2/token',
        form({ client_id: settings.clientId, grant_type: 'refresh_token', refresh_token: settings.refreshToken })
      );
      data = await res.json().catch(() => ({}));
    } catch {
      // Kein Internet o. Ä.: NICHT abmelden, beim nächsten Mal einfach nochmal versuchen
      throw new Error('Twitch gerade nicht erreichbar');
    }
    if (!res.ok) {
      // Nur abmelden, wenn Twitch den Erneuerungsschlüssel wirklich ablehnt (z. B. App-Zugriff entzogen)
      if (res.status === 400 || res.status === 401) {
        disconnect();
        throw new Error('Twitch-Verbindung abgelaufen – bitte neu verbinden');
      }
      throw new Error(`Twitch gerade nicht erreichbar (${res.status})`);
    }
    storeTokens(data);
    saveSettings();
  }

  // Aufruf der Helix-API, erneuert den Zugang automatisch (vorher, wenn er bald abläuft, oder nach einem 401)
  async function helix(endpoint, retry = true) {
    if (!settings.refreshToken && !settings.accessToken) throw new Error('Nicht verbunden');
    if (!settings.accessToken || (settings.expiresAt && now() > settings.expiresAt - RENEW_EARLY_MS)) {
      await renew();
    }
    const usedToken = settings.accessToken;
    const res = await fetchImpl(`https://api.twitch.tv/helix/${endpoint}`, {
      headers: { 'Client-Id': settings.clientId, Authorization: `Bearer ${usedToken}` },
    });
    if (res.status === 401 && retry) {
      // Hat eine andere Anfrage inzwischen schon erneuert? Dann nur mit dem neuen Schlüssel wiederholen.
      if (settings.accessToken === usedToken) await renew();
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
    if (!settings.user) {
      await loadUser();
      saveSettings();
    }
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

  return { status, setClientId, disconnect, startDeviceFlow, waitForApproval, followedLive, streams, search };
}

module.exports = { createTwitchApi };
