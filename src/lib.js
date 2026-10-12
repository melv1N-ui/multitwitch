// Reine Rechenfunktionen ohne Bildschirm-Zugriff: Layouts, Kanalnamen erkennen, Formatierung.
// Läuft in der App UND in den automatischen Tests (npm test).

const RATIO = 16 / 9;
const GAP = 10;

// Raster: probiert alle Spaltenanzahlen und nimmt die mit den größten Kacheln.
function equalLayout(names, W, H) {
  const n = names.length;
  let best = { w: 0, cols: 1, rows: 1 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = Math.min((W - GAP * (cols - 1)) / cols, ((H - GAP * (rows - 1)) / rows) * RATIO);
    if (w > best.w) best = { w, cols, rows };
  }
  const { w, cols, rows } = best;
  const h = w / RATIO;
  const offY = (H - (rows * h + GAP * (rows - 1))) / 2;
  return names.map((name, i) => {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, n - row * cols); // letzte Reihe zentrieren
    const offX = (W - (inRow * w + GAP * (inRow - 1))) / 2;
    return { name, x: offX + (i % cols) * (w + GAP), y: offY + row * (h + GAP), w, h };
  });
}

// Fokus: ein Stream groß, die anderen klein daneben (breites Fenster) oder darunter (hohes Fenster).
// Es wird die Variante genommen, bei der der große Stream größer ist.
function focusLayout(names, W, H, focus) {
  const main = names.includes(focus) ? focus : names[0];
  const others = names.filter((n) => n !== main);
  if (others.length === 0) return equalLayout(names, W, H);
  const k = others.length;

  // Variante A: kleine Streams rechts untereinander
  const sideW = Math.min(W * 0.24, ((H - GAP * (k - 1)) / k) * RATIO);
  const sideH = sideW / RATIO;
  const mainA = Math.min(W - sideW - GAP, H * RATIO);

  // Variante B: kleine Streams unten nebeneinander
  const botW = Math.min((W - GAP * (k - 1)) / k, H * 0.24 * RATIO);
  const botH = botW / RATIO;
  const mainB = Math.min(W, (H - botH - GAP) * RATIO);

  if (mainA >= mainB) {
    const mainH = mainA / RATIO;
    const offX = (W - (mainA + GAP + sideW)) / 2;
    const sideTotal = k * sideH + GAP * (k - 1);
    return [
      { name: main, x: offX, y: (H - mainH) / 2, w: mainA, h: mainH },
      ...others.map((name, i) => ({
        name,
        x: offX + mainA + GAP,
        y: (H - sideTotal) / 2 + i * (sideH + GAP),
        w: sideW,
        h: sideH,
      })),
    ];
  }
  const mainH = mainB / RATIO;
  const offY = (H - (mainH + GAP + botH)) / 2;
  const botTotal = k * botW + GAP * (k - 1);
  return [
    { name: main, x: (W - mainB) / 2, y: offY, w: mainB, h: mainH },
    ...others.map((name, i) => ({
      name,
      x: (W - botTotal) / 2 + i * (botW + GAP),
      y: offY + mainH + GAP,
      w: botW,
      h: botH,
    })),
  ];
}

// "https://twitch.tv/Shroud" -> "shroud"
function cleanName(raw) {
  const name = String(raw).trim().replace(/^.*twitch\.tv\//i, '').split(/[/?#]/)[0].toLowerCase();
  return /^[a-z0-9_]{2,25}$/.test(name) ? name : null;
}

// Seiten wie multitwitch.tv/a/b/c listen die Kanäle im Pfad auf
const MULTI_SITES = /^(www\.)?(multitwitch\.tv|multistre\.am|multitwitch\.live|twitchtheater\.tv|kadgar\.net)$/i;

// Text (Namen, Twitch-Links, multitwitch-Links) -> { names, invalid }
function parseChannels(text) {
  const names = [];
  const invalid = [];
  for (const part of String(text).split(/[\s,]+/).filter(Boolean)) {
    let url = null;
    try {
      url = new URL(part.includes('://') ? part : `https://${part}`);
    } catch {}
    if (url && MULTI_SITES.test(url.hostname)) {
      for (const seg of url.pathname.split('/')) {
        const n = cleanName(seg);
        if (n && n !== 'live') names.push(n);
      }
      continue;
    }
    const n = cleanName(part);
    if (n) names.push(n);
    else invalid.push(part);
  }
  return { names: [...new Set(names)], invalid };
}

// Welche Qualität passt zur Höhe auf dem Bildschirm (in Bildschirmpunkten)?
function qualityFor(h, autoQuality) {
  if (!autoQuality) return 'auto';
  if (h >= 500) return 4320; // groß: beste verfügbare Qualität
  if (h >= 280) return 720;
  return 480;
}

const fmtViewers = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',')}K` : String(n));

function fmtUptime(iso, now = Date.now()) {
  const min = Math.max(0, Math.floor((now - new Date(iso)) / 60000));
  const h = Math.floor(min / 60);
  return h ? `${h} Std. ${min % 60} Min.` : `${min} Min.`;
}

if (typeof module !== 'undefined') {
  module.exports = { RATIO, GAP, equalLayout, focusLayout, cleanName, parseChannels, qualityFor, fmtViewers, fmtUptime };
}
