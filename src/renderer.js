// Oberfläche: Streams hinzufügen/entfernen, Layout berechnen, Ton, Chat und Login steuern.
// Weitere Funktionen (Live-Liste, Sets, Einstellungen, Kino-Modus) stehen in features.js.
const PARTITION = 'persist:twitch';
const isMac = window.twitch.platform === 'darwin';
document.body.classList.add(isMac ? 'mac' : 'win');

hydrateIcons();

// ---------- Elemente ----------

const $ = (id) => document.getElementById(id);
const stageEl = $('stage');
const emptyEl = $('empty');
const chatEl = $('chat');
const chatTabsEl = $('chat-tabs');
const chatFramesEl = $('chat-frames');
const input = $('channel-input');
const chatBtn = $('chat-btn');
const chatStackBtn = $('chat-stack-btn');
const accountBtn = $('account-btn');
const accountMenu = $('account-menu');

$('shortcut-hint').textContent = isMac ? '⌘K' : 'Strg K';
document.querySelectorAll('kbd.mod').forEach((k) => (k.textContent = isMac ? '⌘' : 'Strg'));

// ---------- Zustand (bleibt nach Neustart erhalten) ----------

const state = {
  channels: load('channels', []),  // Reihenfolge = Anzeige-Reihenfolge
  layout: load('layout', 'equal'), // 'equal', 'focus' oder 'free'
  focus: load('focus', null),      // Kanal, der im Fokus-Layout groß ist
  free: load('free', {}),          // Kanal -> { x, y, w } als Anteil der Bühne (0..1), für das freie Layout
  maximized: null,                 // Kanal, der im freien Layout gerade maximiert ist
  chatOpen: load('chatOpen', false),
  chatStacked: load('chatStacked', false), // alle Chats untereinander statt Tabs
  sidebarOpen: load('sidebarOpen', true),
  volumes: load('volumes', {}),            // Kanal -> Lautstärke 0..1
  opts: load('opts', { autoQuality: true, hideOffline: false }),
  live: {},                                // Kanal -> Live-Infos von der Twitch-API (falls verbunden)
  apiConnected: false,
  cinema: false,
  chatChannel: null,
  loggedIn: false,
};

const tiles = new Map();     // Kanal -> { el, webview, muted, ready, quality }
const chatViews = new Map(); // Kanal -> webview

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function save() {
  try {
    for (const key of ['channels', 'layout', 'focus', 'free', 'chatOpen', 'chatStacked', 'sidebarOpen', 'volumes', 'opts']) {
      localStorage.setItem(key, JSON.stringify(state[key]));
    }
  } catch {}
}

// "https://twitch.tv/Shroud" -> "shroud"
function cleanName(raw) {
  const name = raw.trim().replace(/^.*twitch\.tv\//i, '').split(/[/?#]/)[0].toLowerCase();
  return /^[a-z0-9_]{2,25}$/.test(name) ? name : null;
}

// Seiten wie multitwitch.tv/a/b/c listen die Kanäle im Pfad auf
const MULTI_SITES = /^(www\.)?(multitwitch\.tv|multistre\.am|multitwitch\.live|twitchtheater\.tv|kadgar\.net)$/i;

// Text (Namen, Twitch-Links, multitwitch-Links) -> { names, invalid }
function parseChannels(text) {
  const names = [];
  const invalid = [];
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    let url = null;
    try {
      url = new URL(part.includes('://') ? part : `https://${part}`);
    } catch {}
    if (url && MULTI_SITES.test(url.hostname)) {
      url.pathname.split('/').forEach((seg) => {
        const n = cleanName(seg);
        if (n && n !== 'live') names.push(n);
      });
      continue;
    }
    const n = cleanName(part);
    if (n) names.push(n);
    else invalid.push(part);
  }
  return { names: [...new Set(names)], invalid };
}

// Fügt Kanäle hinzu, zeigt Hinweise an und gibt die Anzahl neuer Streams zurück
function addChannels(text) {
  const { names, invalid } = parseChannels(text);
  invalid.forEach((p) => toast(`„${p}“ ist kein gültiger Kanalname`));
  let added = 0;
  for (const name of names) {
    if (tiles.has(name)) {
      toast(`${name} läuft schon`);
      continue;
    }
    state.channels.push(name);
    addChannel(name);
    added++;
  }
  if (added) {
    save();
    render();
    refreshLiveInfo();
  }
  return added;
}

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  $('toasts').appendChild(el);
  if ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

// ---------- Streams ----------

function addChannel(name) {
  if (tiles.has(name)) return;

  const el = document.createElement('div');
  el.className = 'tile';
  el.innerHTML = `
    <div class="loader"><span></span></div>
    <div class="tile-bar">
      <div class="chip" title="Ziehen zum Verschieben">
        <span class="grip" data-icon="grip"></span>
        <span class="live-dot"></span>
        <span class="name"></span>
        <span class="viewers"></span>
        <span class="num"></span>
      </div>
      <div class="tools">
        <button class="mute" title="Ton an/aus"></button>
        <input class="vol" type="range" min="0" max="100" title="Lautstärke" />
        <button class="solo" title="Nur diesen Stream hören"><span data-icon="solo"></span></button>
        <button class="big" title="Groß anzeigen"><span data-icon="big"></span></button>
        <button class="pip" title="Bild-im-Bild (bleibt im Vordergrund)"><span data-icon="pip"></span></button>
        <button class="reload" title="Neu laden"><span data-icon="reload"></span></button>
        <button class="remove" title="Entfernen"><span data-icon="close"></span></button>
      </div>
    </div>
    <div class="mute-flag" data-icon="mute"></div>
    <div class="offline-flag">Offline</div>
    <div class="handle nw"></div><div class="handle ne"></div>
    <div class="handle sw"></div><div class="handle se"></div>`;
  hydrateIcons(el);
  el.querySelector('.name').textContent = name;
  el.querySelector('.loader span').textContent = name;

  // Der Player läuft direkt auf player.twitch.tv mit deinem Login -> Turbo greift.
  const webview = document.createElement('webview');
  webview.setAttribute('partition', PARTITION);
  webview.setAttribute('src', `https://player.twitch.tv/?channel=${name}&parent=twitch.tv&autoplay=true&muted=false`);
  el.prepend(webview);
  stageEl.appendChild(el);

  const tile = { el, webview, muted: false, ready: false, quality: null };
  tiles.set(name, tile);
  bringToFront(name);

  webview.addEventListener('dom-ready', () => {
    tile.ready = true;
    webview.setAudioMuted(tile.muted);
    // Lautstärke + Qualität im (neu geladenen) Player setzen
    setPlayerWant(webview, { volume: volumeOf(name), maxHeight: tile.quality });
  });
  webview.addEventListener('did-finish-load', () => el.classList.add('ready'));

  el.querySelector('.mute').onclick = () => setMuted(name, !tile.muted);
  const vol = el.querySelector('.vol');
  vol.value = Math.round(volumeOf(name) * 100);
  vol.oninput = () => setVolume(name, vol.value / 100);
  vol.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.querySelector('.pip').onclick = () => {
    window.twitch.pip(name);
    setMuted(name, true);
    toast(`${name} läuft jetzt im Bild-im-Bild-Fenster`);
  };
  el.querySelector('.solo').onclick = () => solo(name);
  el.querySelector('.big').onclick = () => {
    if (state.layout === 'free') return toggleMaximize(name);
    state.focus = name;
    state.layout = 'focus';
    save();
    render();
  };
  el.querySelector('.reload').onclick = () => {
    el.classList.remove('ready');
    webview.reload();
  };
  el.querySelector('.remove').onclick = () => removeChannel(name);
  enableDrag(el.querySelector('.chip'), name);
  enableResize(el, name);
  el.querySelector('.chip').addEventListener('dblclick', () => state.layout === 'free' && toggleMaximize(name));
  // Angeklicktes Fenster nach vorne holen
  el.addEventListener('pointerdown', () => bringToFront(name), true);
  webview.addEventListener('focus', () => bringToFront(name));

  // Ab dem zweiten Stream neue Streams stumm starten, damit es kein Tonchaos gibt
  setMuted(name, tiles.size > 1);
}

function removeChannel(name) {
  const tile = tiles.get(name);
  if (!tile) return;
  const wasAudible = !tile.muted;
  tile.el.remove();
  tiles.delete(name);
  chatViews.get(name)?.remove();
  chatViews.delete(name);
  state.channels = state.channels.filter((c) => c !== name);
  if (state.focus === name) state.focus = null;
  delete state.free[name];
  delete state.volumes[name];
  if (state.maximized === name) state.maximized = null;
  if (zOrder.includes(name)) zOrder.splice(zOrder.indexOf(name), 1);
  // Wenn der hörbare Stream weg ist, den ersten verbleibenden laut machen
  if (wasAudible && state.channels[0] && [...tiles.values()].every((t) => t.muted)) {
    setMuted(state.channels[0], false);
  }
  save();
  render();
}

function setMuted(name, muted) {
  const tile = tiles.get(name);
  if (!tile) return;
  tile.muted = muted;
  if (tile.ready) tile.webview.setAudioMuted(muted);
  const btn = tile.el.querySelector('.mute');
  btn.innerHTML = ICONS[muted ? 'mute' : 'volume'];
  btn.classList.toggle('on', !muted);
  tile.el.classList.toggle('audible', !muted);
  // Ton an bei Lautstärke 0 ergibt keinen Sinn -> auf 50 % stellen
  if (!muted && volumeOf(name) === 0) {
    tile.el.querySelector('.vol').value = 50;
    setVolume(name, 0.5);
  }
}

const volumeOf = (name) => state.volumes[name] ?? 1;

// Lautstärke eines Streams (0..1). Lauter als 0 schaltet den Ton automatisch ein.
function setVolume(name, v) {
  const tile = tiles.get(name);
  if (!tile) return;
  state.volumes[name] = v;
  save();
  if (tile.ready) setPlayerWant(tile.webview, { volume: v });
  if (v > 0 && tile.muted) setMuted(name, false);
  if (v === 0 && !tile.muted) setMuted(name, true);
}

function solo(name) {
  for (const other of tiles.keys()) setMuted(other, other !== name);
}

// ---------- Drag & Drop zum Umsortieren ----------

function enableDrag(handle, name) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (state.layout === 'free') return startFreeMove(e, handle, name);
    handle.setPointerCapture(e.pointerId);
    const tileEl = tiles.get(name).el;
    let target = null;
    document.body.classList.add('dragging');
    tileEl.classList.add('dragging');

    const onMove = (ev) => {
      target?.el.classList.remove('drop-target');
      target = null;
      for (const [other, t] of tiles) {
        if (other === name) continue;
        const r = t.el.getBoundingClientRect();
        if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
          target = { name: other, el: t.el };
          t.el.classList.add('drop-target');
        }
      }
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      document.body.classList.remove('dragging');
      tileEl.classList.remove('dragging');
      if (target) {
        target.el.classList.remove('drop-target');
        // Plätze tauschen
        const a = state.channels.indexOf(name);
        const b = state.channels.indexOf(target.name);
        [state.channels[a], state.channels[b]] = [state.channels[b], state.channels[a]];
        save();
        render();
      }
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });
}

// ---------- Layout ----------

const RATIO = 16 / 9;
const MIN_W = 220; // kleinste Fensterbreite im freien Layout
const SNAP = 10;   // so nah (px) muss man an eine Kante, damit es einrastet
const GAP = 10;

// Raster: probiert alle Spaltenanzahlen und nimmt die mit den größten Kacheln.
function equalLayout(names, W, H) {
  const n = names.length;
  let best = { w: 0 };
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

// Fokus: ein Stream groß links, der Rest klein rechts untereinander.
function focusLayout(names, W, H) {
  const main = names.includes(state.focus) ? state.focus : names[0];
  const others = names.filter((n) => n !== main);
  if (others.length === 0) return equalLayout(names, W, H);

  const sideW = Math.min(W * 0.24, ((H - GAP * (others.length - 1)) / others.length) * RATIO);
  const sideH = sideW / RATIO;
  const mainW = Math.min(W - sideW - GAP, H * RATIO);
  const mainH = mainW / RATIO;
  const offX = (W - (mainW + GAP + sideW)) / 2;
  const sideTotalH = others.length * sideH + GAP * (others.length - 1);

  return [
    { name: main, x: offX, y: (H - mainH) / 2, w: mainW, h: mainH },
    ...others.map((name, i) => ({
      name,
      x: offX + mainW + GAP,
      y: (H - sideTotalH) / 2 + i * (sideH + GAP),
      w: sideW,
      h: sideH,
    })),
  ];
}

// ---------- Freies Layout: Fenster selbst verschieben und vergrößern ----------

const zOrder = []; // hinterstes Fenster zuerst

function bringToFront(name) {
  const i = zOrder.indexOf(name);
  if (i !== -1) zOrder.splice(i, 1);
  zOrder.push(name);
  zOrder.forEach((n, idx) => {
    const t = tiles.get(n);
    if (t) t.el.style.zIndex = idx + 1;
  });
}

// Fenster so groß wie möglich in den Bereich einpassen (16:9 bleibt erhalten)
function fitBox(maxW, maxH) {
  const w = Math.min(maxW, maxH * RATIO);
  return { w, h: w / RATIO };
}

function freeLayout(names, W, H) {
  // Erstes Mal im freien Layout: Startpositionen aus dem Raster übernehmen
  if (names.length && names.every((n) => !state.free[n])) {
    for (const b of equalLayout(names, W, H)) saveFree(b.name, b, W, H, false);
  }
  return names.map((name, i) => {
    if (name === state.maximized) {
      const { w, h } = fitBox(W, H);
      return { name, x: (W - w) / 2, y: (H - h) / 2, w, h };
    }
    // Neue Fenster leicht versetzt übereinander stapeln
    if (!state.free[name]) {
      const k = Object.keys(state.free).length % 6;
      state.free[name] = { x: 0.04 + k * 0.03, y: 0.05 + k * 0.05, w: 0.42 };
      bringToFront(name);
    }
    const f = state.free[name];
    let w = Math.max(Math.min(f.w * W, W, H * RATIO), Math.min(MIN_W, W));
    const h = w / RATIO;
    const x = Math.min(Math.max(f.x * W, 0), W - w);
    const y = Math.min(Math.max(f.y * H, 0), H - h);
    return { name, x, y, w, h };
  });
}

function saveFree(name, box, W, H, persist = true) {
  state.free[name] = { x: box.x / W, y: box.y / H, w: box.w / W };
  if (persist) save();
}

function toggleMaximize(name) {
  state.maximized = state.maximized === name ? null : name;
  bringToFront(name);
  render();
}

function currentBox(el) {
  return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
}

function applyBox(el, b) {
  Object.assign(el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
}

// Kanten, an denen Fenster einrasten: Bühnenrand + Kanten der anderen Fenster
function snapTargets(name) {
  const xs = [0, stageEl.clientWidth];
  const ys = [0, stageEl.clientHeight];
  for (const [other, t] of tiles) {
    if (other === name) continue;
    const b = currentBox(t.el);
    xs.push(b.x, b.x + b.w, b.x - GAP, b.x + b.w + GAP);
    ys.push(b.y, b.y + b.h, b.y - GAP, b.y + b.h + GAP);
  }
  return { xs, ys };
}

// Sucht die nächste Kante in Reichweite: gibt Verschiebung + Position der Hilfslinie zurück
function nearest(values, targets) {
  let best = null;
  for (const v of values) {
    for (const t of targets) {
      const d = t - v;
      if (Math.abs(d) <= SNAP && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
    }
  }
  return best;
}

function showGuides(gx, gy) {
  stageEl.querySelectorAll('.guide').forEach((g) => g.remove());
  for (const [g, cls, prop] of [[gx, 'v', 'left'], [gy, 'h', 'top']]) {
    if (!g) continue;
    const el = document.createElement('div');
    el.className = `guide ${cls}`;
    el.style[prop] = `${g.at}px`;
    stageEl.appendChild(el);
  }
}

// Gemeinsamer Ablauf für Verschieben und Größe ändern
function trackPointer(e, captureEl, name, onMove) {
  captureEl.setPointerCapture(e.pointerId);
  const tileEl = tiles.get(name).el;
  const W = stageEl.clientWidth;
  const H = stageEl.clientHeight;
  bringToFront(name);
  document.body.classList.add('dragging');
  tileEl.classList.add('moving');

  // Ein maximiertes Fenster wird beim Anfassen wieder normal
  if (state.maximized === name) {
    state.maximized = null;
    render();
  }
  const start = currentBox(tileEl);
  const targets = snapTargets(name);
  let last = start;

  const move = (ev) => {
    last = onMove(start, ev.clientX - e.clientX, ev.clientY - e.clientY, targets, W, H);
    applyBox(tileEl, last);
  };
  const up = () => {
    captureEl.removeEventListener('pointermove', move);
    captureEl.removeEventListener('pointerup', up);
    document.body.classList.remove('dragging');
    tileEl.classList.remove('moving');
    showGuides(null, null);
    saveFree(name, last, W, H);
  };
  captureEl.addEventListener('pointermove', move);
  captureEl.addEventListener('pointerup', up);
}

function startFreeMove(e, handle, name) {
  trackPointer(e, handle, name, (s, dx, dy, targets, W, H) => {
    let x = Math.min(Math.max(s.x + dx, 0), W - s.w);
    let y = Math.min(Math.max(s.y + dy, 0), H - s.h);
    const gx = nearest([x, x + s.w], targets.xs);
    const gy = nearest([y, y + s.h], targets.ys);
    if (gx) x += gx.d;
    if (gy) y += gy.d;
    showGuides(gx, gy);
    return { x, y, w: s.w, h: s.h };
  });
}

function enableResize(el, name) {
  el.querySelectorAll('.handle').forEach((handle) => {
    const east = handle.classList.contains('ne') || handle.classList.contains('se');
    const south = handle.classList.contains('sw') || handle.classList.contains('se');

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || state.layout !== 'free') return;
      e.preventDefault();
      e.stopPropagation();
      trackPointer(e, handle, name, (s, dx, dy, targets, W, H) => {
        // Die gegenüberliegende Ecke bleibt fest stehen
        const anchorX = east ? s.x : s.x + s.w;
        const anchorY = south ? s.y : s.y + s.h;
        const sx = east ? 1 : -1;
        const sy = south ? 1 : -1;
        // Breite folgt der Maus – je nachdem, ob man eher seitlich oder nach unten zieht
        let w = Math.max(s.w + sx * dx, (s.h + sy * dy) * RATIO);

        // Rastet die bewegte Seite an einer Kante ein?
        const edgeX = east ? anchorX + w : anchorX - w;
        const gx = nearest([edgeX], targets.xs);
        if (gx) w += sx * gx.d;

        const maxW = Math.min(east ? W - anchorX : anchorX, (south ? H - anchorY : anchorY) * RATIO);
        w = Math.min(Math.max(w, Math.min(MIN_W, maxW)), maxW);
        const h = w / RATIO;
        showGuides(gx && Math.abs((east ? anchorX + w : anchorX - w) - gx.at) < 1 ? gx : null, null);
        return { x: east ? anchorX : anchorX - w, y: south ? anchorY : anchorY - h, w, h };
      });
    });
  });
}

// Welche Qualität passt zur Größe auf dem Bildschirm? (in Bildschirmpunkten)
function qualityFor(h) {
  if (!state.opts.autoQuality) return 'auto';
  if (h >= 500) return 4320; // groß: beste verfügbare Qualität
  if (h >= 280) return 720;
  return 480;
}

const isHidden = (name) => state.opts.hideOffline && state.apiConnected && state.live[name] === null;

function render() {
  const names = state.channels.filter((c) => tiles.has(c) && !isHidden(c));
  for (const [name, t] of tiles) t.el.style.display = isHidden(name) ? 'none' : '';
  emptyEl.style.display = names.length ? 'none' : '';
  document.querySelectorAll('#layout-switch button').forEach((b) =>
    b.classList.toggle('active', b.dataset.layout === state.layout)
  );
  chatEl.classList.toggle('open', state.chatOpen && !state.cinema);
  chatBtn.classList.toggle('active', state.chatOpen);
  chatStackBtn.classList.toggle('active', state.chatStacked);
  document.body.classList.toggle('sidebar-open', state.sidebarOpen && !state.cinema);
  $('sidebar-btn').classList.toggle('active', state.sidebarOpen);

  const W = stageEl.clientWidth;
  const H = stageEl.clientHeight;
  stageEl.classList.toggle('free', state.layout === 'free');
  const boxes =
    state.layout === 'free' ? freeLayout(names, W, H)
    : state.layout === 'focus' ? focusLayout(names, W, H)
    : equalLayout(names, W, H);

  // Nur Position/Größe ändern – die Webviews werden NICHT neu erstellt (kein Neuladen)
  boxes.forEach((b, i) => {
    const tile = tiles.get(b.name);
    Object.assign(tile.el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
    tile.el.querySelector('.num').textContent = i < 9 ? i + 1 : '';
    const q = qualityFor(b.h);
    if (q !== tile.quality) {
      tile.quality = q;
      if (tile.ready) setPlayerWant(tile.webview, { maxHeight: q });
    }
  });
  renderLiveInfo();

  renderChat(names);
}

// ---------- Chat ----------

function renderChat(names) {
  if (!names.includes(state.chatChannel)) state.chatChannel = names[0] || null;

  chatTabsEl.innerHTML = '';
  for (const name of names) {
    const b = document.createElement('button');
    b.textContent = name;
    b.classList.toggle('active', name === state.chatChannel);
    b.onclick = () => {
      state.chatChannel = name;
      renderChat(names);
    };
    chatTabsEl.appendChild(b);
  }

  chatTabsEl.classList.toggle('hidden', state.chatStacked);
  chatFramesEl.classList.toggle('stacked', state.chatStacked);
  if (!state.chatOpen || !state.chatChannel) return;

  // Chat erst laden, wenn er zum ersten Mal gebraucht wird
  const needed = state.chatStacked ? names : [state.chatChannel];
  for (const name of needed) {
    if (chatViews.has(name)) continue;
    const wv = document.createElement('webview');
    wv.setAttribute('partition', PARTITION);
    wv.setAttribute('src', `https://www.twitch.tv/popout/${name}/chat?darkpopout`);
    chatFramesEl.appendChild(wv);
    chatViews.set(name, wv);
  }
  for (const [name, wv] of chatViews) {
    wv.classList.toggle('visible', needed.includes(name));
    wv.style.order = names.indexOf(name); // gleiche Reihenfolge wie die Streams
  }
}

chatStackBtn.onclick = () => {
  state.chatStacked = !state.chatStacked;
  save();
  render();
};

// ---------- Login ----------

async function refreshLogin() {
  const { loggedIn, username } = await window.twitch.status();
  state.loggedIn = loggedIn;
  accountBtn.classList.toggle('cta', !loggedIn);
  $('account-name').textContent = loggedIn ? username || 'Twitch' : 'Mit Twitch einloggen';
  $('avatar').textContent = (username || '?')[0];
  const badge = $('turbo-badge');
  badge.textContent = loggedIn ? 'Turbo-Login' : 'Werbung aktiv';
  badge.classList.toggle('ok', loggedIn);
  $('menu-head').innerHTML = `Eingeloggt als<b></b>`;
  $('menu-head').querySelector('b').textContent = username || 'Twitch';
  $('step-login').classList.toggle('done', loggedIn);
}

accountBtn.onclick = (e) => {
  e.stopPropagation();
  if (state.loggedIn) accountMenu.classList.toggle('open');
  else window.twitch.login();
};
$('step-login').onclick = () => !state.loggedIn && window.twitch.login();
document.addEventListener('click', () => accountMenu.classList.remove('open'));

$('logout-btn').onclick = async () => {
  accountMenu.classList.remove('open');
  await window.twitch.logout();
  await refreshLogin();
  reloadAll();
  toast('Ausgeloggt – ab jetzt wieder mit Werbung');
};

// Nach dem Login alle Player neu laden, damit sie die Anmeldung benutzen
window.twitch.onLoginChanged(async () => {
  const before = state.loggedIn;
  await refreshLogin();
  if (state.loggedIn !== before) {
    reloadAll();
    if (state.loggedIn) toast('Eingeloggt – dein Turbo-Abo ist aktiv');
  }
});

function reloadAll() {
  for (const t of tiles.values()) {
    if (!t.ready) continue;
    t.el.classList.remove('ready');
    t.webview.reload();
  }
  for (const wv of chatViews.values()) wv.reload();
}

// ---------- Bedienung ----------

$('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const added = addChannels(input.value);
  input.value = '';
  if (added) input.blur();
});

document.querySelectorAll('#layout-switch button').forEach((b) => {
  b.onclick = () => {
    state.layout = b.dataset.layout;
    save();
    render();
  };
});

function toggleChat() {
  state.chatOpen = !state.chatOpen;
  save();
  render();
}
chatBtn.onclick = toggleChat;

// Tastenkürzel (funktionieren, solange der Fokus nicht in einem Stream/Chat liegt)
document.addEventListener('keydown', (e) => {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    input.focus();
    input.select();
    return;
  }
  // Beim Tippen in Eingabefeldern keine Kürzel auslösen
  if (e.target.closest('input, textarea')) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^[1-9]$/.test(e.key)) {
    const name = state.channels[Number(e.key) - 1];
    if (name) solo(name);
  } else if (e.key === '0') {
    for (const name of tiles.keys()) setMuted(name, false);
  } else if (e.key.toLowerCase() === 'c') {
    toggleChat();
  } else if (e.key.toLowerCase() === 'l') {
    const order = ['equal', 'focus', 'free'];
    state.layout = order[(order.indexOf(state.layout) + 1) % order.length];
    save();
    render();
  } else {
    handleFeatureKey(e); // F, S, Esc – siehe features.js
  }
});


