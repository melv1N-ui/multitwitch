// Tests für die Twitch-Verbindung mit einem nachgebauten Twitch-Server.
// Der nachgebaute Server verhält sich wie das echte Twitch: Jeder Erneuerungsschlüssel geht nur EINMAL.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTwitchApi } = require('../src/twitch-api');

function fakeTwitch({ offline = false } = {}) {
  const server = {
    validAccess: new Set(['access-0']),
    validRefresh: new Set(['refresh-0']),
    renewCalls: 0,
    offline,
    n: 0,
  };
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

  server.fetch = async (url, opts = {}) => {
    await new Promise((r) => setImmediate(r)); // wie im echten Netz: Antworten kommen später
    if (server.offline) throw new TypeError('fetch failed');
    if (url.startsWith('https://id.twitch.tv/oauth2/token')) {
      const body = new URLSearchParams(opts.body);
      if (body.get('grant_type') !== 'refresh_token') return json(400, { message: 'unsupported' });
      server.renewCalls++;
      const rt = body.get('refresh_token');
      if (!server.validRefresh.has(rt)) return json(400, { status: 400, message: 'Invalid refresh token' });
      server.validRefresh.delete(rt); // nur einmal benutzbar!
      server.n++;
      server.validAccess = new Set([`access-${server.n}`]);
      server.validRefresh.add(`refresh-${server.n}`);
      return json(200, { access_token: `access-${server.n}`, refresh_token: `refresh-${server.n}`, expires_in: 14400 });
    }
    if (url.startsWith('https://api.twitch.tv/helix/')) {
      const token = opts.headers.Authorization.replace('Bearer ', '');
      if (!server.validAccess.has(token)) return json(401, { message: 'Invalid OAuth token' });
      if (url.includes('/users')) return json(200, { data: [{ id: '1', login: 'ich', display_name: 'Ich', profile_image_url: '' }] });
      return json(200, { data: [] });
    }
    throw new Error(`unerwartete URL ${url}`);
  };
  return server;
}

function tempSettings(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-test-'));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify(content));
  return file;
}

// So sah die Datei bei dir aus: verbunden, aber der Zugangsschlüssel ist inzwischen abgelaufen
const expiredSettings = () => ({
  clientId: 'abc123',
  accessToken: 'access-alt',
  refreshToken: 'refresh-0',
  user: { id: '1', login: 'ich', name: 'Ich', avatar: '' },
});

test('Start nach ein paar Stunden: gleichzeitige Anfragen erneuern nur EINMAL und bleiben verbunden', async () => {
  const tw = fakeTwitch();
  const file = tempSettings(expiredSettings());
  const api = createTwitchApi({ file, fetchImpl: tw.fetch });

  // genau wie beim App-Start: Live-Liste und Stream-Infos gleichzeitig
  await Promise.all([api.followedLive(), api.streams(['a', 'b']), api.search('xy')]);

  assert.equal(tw.renewCalls, 1, 'Es darf nur eine Erneuerung geben');
  assert.equal(api.status().connected, true);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.refreshToken, 'refresh-1', 'Der neue Erneuerungsschlüssel muss gespeichert sein');
  assert.equal(saved.clientId, 'abc123');
});

test('Nach einem Neustart klappt es mit dem gespeicherten Schlüssel weiter', async () => {
  const tw = fakeTwitch();
  const file = tempSettings(expiredSettings());
  await createTwitchApi({ file, fetchImpl: tw.fetch }).streams(['a']);
  // App neu starten = neue Instanz, liest die Datei neu
  const again = createTwitchApi({ file, fetchImpl: tw.fetch });
  await again.followedLive();
  assert.equal(again.status().connected, true);
});

test('Kein Internet beim Erneuern: Fehler melden, aber NICHT abmelden', async () => {
  const tw = fakeTwitch({ offline: true });
  const file = tempSettings(expiredSettings());
  const api = createTwitchApi({ file, fetchImpl: tw.fetch });
  await assert.rejects(api.followedLive());
  assert.equal(api.status().connected, true);
  // Internet wieder da -> funktioniert
  tw.offline = false;
  await api.followedLive();
  assert.equal(api.status().connected, true);
});

test('Twitch lehnt den Schlüssel wirklich ab: abmelden, aber Client-ID behalten', async () => {
  const tw = fakeTwitch();
  tw.validRefresh.clear(); // z. B. Zugriff auf twitch.tv entzogen
  const file = tempSettings(expiredSettings());
  const api = createTwitchApi({ file, fetchImpl: tw.fetch });
  await assert.rejects(api.followedLive(), /neu verbinden/);
  assert.equal(api.status().connected, false);
  assert.equal(api.status().clientId, 'abc123');
});

test('Schlüssel läuft bald ab: wird vorher erneuert, ohne erst einen Fehler abzuwarten', async () => {
  const tw = fakeTwitch();
  let clock = 1_000_000;
  const file = tempSettings({ ...expiredSettings(), accessToken: 'access-0', expiresAt: clock + 60_000 });
  const api = createTwitchApi({ file, fetchImpl: tw.fetch, now: () => clock });
  await api.streams(['a']);
  assert.equal(tw.renewCalls, 1);
  clock += 1000; // kurz danach: kein erneutes Erneuern nötig
  await api.streams(['a']);
  assert.equal(tw.renewCalls, 1);
});

test('Einstellungsdatei wird sicher gespeichert (keine halben Dateien, keine Reste)', async () => {
  const tw = fakeTwitch();
  const file = tempSettings(expiredSettings());
  const api = createTwitchApi({ file, fetchImpl: tw.fetch });
  await api.streams(['a']);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});
