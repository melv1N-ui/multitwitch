// Automatische Tests für die Rechenfunktionen. Starten mit: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { RATIO, GAP, equalLayout, focusLayout, cleanName, parseChannels, qualityFor, fmtViewers, fmtUptime } = require('../src/lib');

const near = (a, b) => Math.abs(a - b) < 0.01;

// Prüft, dass alle Kacheln im Bereich liegen, 16:9 sind und sich nicht überlappen
function assertValidLayout(boxes, W, H) {
  for (const b of boxes) {
    assert.ok(b.x >= -0.01 && b.y >= -0.01, `${b.name} ragt links/oben raus`);
    assert.ok(b.x + b.w <= W + 0.01 && b.y + b.h <= H + 0.01, `${b.name} ragt rechts/unten raus`);
    assert.ok(near(b.w / b.h, RATIO), `${b.name} ist nicht 16:9`);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap = a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
      assert.ok(!overlap, `${a.name} und ${b.name} überlappen`);
    }
  }
}

const names = (n) => Array.from({ length: n }, (_, i) => `kanal${i}`);

test('Raster: gültig für 1 bis 12 Streams in verschiedenen Fenstergrößen', () => {
  for (const [W, H] of [[1600, 900], [1000, 1000], [800, 1200], [2560, 1080]]) {
    for (let n = 1; n <= 12; n++) assertValidLayout(equalLayout(names(n), W, H), W, H);
  }
});

test('Raster: ein Stream füllt die Breite eines 16:9-Bereichs', () => {
  const [b] = equalLayout(['a'], 1600, 900);
  assert.ok(near(b.w, 1600) && near(b.h, 900));
});

test('Raster: 4 Streams im 16:9-Fenster ergeben 2x2', () => {
  const boxes = equalLayout(names(4), 1600, 900);
  assert.equal(new Set(boxes.map((b) => Math.round(b.y))).size, 2);
  // Breite durch Breite ODER Höhe begrenzt – je nachdem, was knapper ist
  assert.ok(near(boxes[0].w, Math.min((1600 - GAP) / 2, ((900 - GAP) / 2) * RATIO)));
});

test('Fokus: gewählter Stream ist der größte', () => {
  for (const [W, H] of [[1600, 900], [900, 1200]]) {
    const boxes = focusLayout(names(4), W, H, 'kanal2');
    assertValidLayout(boxes, W, H);
    const main = boxes.find((b) => b.name === 'kanal2');
    for (const b of boxes) assert.ok(b.w <= main.w);
  }
});

test('Fokus: im hohen Fenster liegen die kleinen Streams unten', () => {
  const boxes = focusLayout(names(3), 900, 1400, 'kanal0');
  const [main, ...rest] = boxes;
  for (const b of rest) assert.ok(b.y >= main.y + main.h);
});

test('Fokus: unbekannter Fokus-Kanal -> erster wird groß', () => {
  assert.equal(focusLayout(names(3), 1600, 900, 'gibtsnicht')[0].name, 'kanal0');
});

test('Kanalnamen erkennen', () => {
  assert.equal(cleanName('Shroud'), 'shroud');
  assert.equal(cleanName('https://www.twitch.tv/OhnePixel?ref=x'), 'ohnepixel');
  assert.equal(cleanName('twitch.tv/papaplatte/videos'), 'papaplatte');
  assert.equal(cleanName('a'), null);
  assert.equal(cleanName('nicht erlaubt!'), null);
});

test('multitwitch-Links und gemischte Eingaben', () => {
  assert.deepEqual(parseChannels('https://www.multitwitch.tv/shroud/ohnepixel').names, ['shroud', 'ohnepixel']);
  assert.deepEqual(parseChannels('multistre.am/a_b/cc/').names, ['a_b', 'cc']);
  assert.deepEqual(parseChannels('shroud, Shroud trymacs').names, ['shroud', 'trymacs']);
  assert.deepEqual(parseChannels('shroud ???').invalid, ['???']);
});

test('Qualität passend zur Größe', () => {
  assert.equal(qualityFor(800, true), 4320);
  assert.equal(qualityFor(300, true), 720);
  assert.equal(qualityFor(150, true), 480);
  assert.equal(qualityFor(800, false), 'auto');
});

test('Formatierung', () => {
  assert.equal(fmtViewers(950), '950');
  assert.equal(fmtViewers(1234), '1,2K');
  assert.equal(fmtViewers(45678), '46K');
  const now = Date.parse('2026-01-01T12:00:00Z');
  assert.equal(fmtUptime('2026-01-01T09:45:00Z', now), '2 Std. 15 Min.');
  assert.equal(fmtUptime('2026-01-01T11:50:00Z', now), '10 Min.');
});
