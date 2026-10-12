// Zusatzfunktionen: Live-Liste, Live-Infos auf den Streams, Sets, Einstellungen, Kino-Modus, Updates.
// Nutzt state, tiles, render(), addChannels() usw. aus renderer.js.

const api = window.twitch.api;

// ---------- Live-Infos auf den Streams (Zuschauer, offline) ----------

function renderLiveInfo() {
  for (const [name, tile] of tiles) {
    const info = state.live[name];
    const known = state.apiConnected && info !== undefined;
    tile.el.classList.toggle('is-live', known && info !== null);
    tile.el.classList.toggle('is-offline', known && info === null);
    tile.el.querySelector('.viewers').textContent = info ? fmtViewers(info.viewers) : '';
    tile.el.querySelector('.chip').title = info
      ? `${info.title}\n${info.game} · ${info.viewers.toLocaleString('de')} Zuschauer · seit ${fmtUptime(info.startedAt)}`
      : 'Ziehen zum Verschieben';
  }
}

async function refreshLiveInfo() {
  if (!state.apiConnected || !state.channels.length) return;
  try {
    const live = await api.streams(state.channels);
    for (const name of state.channels) state.live[name] = live[name] || null;
    render();
  } catch (err) {
    handleApiError(err);
  }
}

// ---------- Live-Liste (gefolgte Kanäle) ----------

const liveListEl = $('live-list');

function renderSidebarMessage(html, withButton) {
  liveListEl.innerHTML = `<div class="side-empty">${html}</div>`;
  if (withButton) {
    const b = document.createElement('button');
    b.className = 'primary';
    b.textContent = 'Jetzt einrichten';
    b.onclick = openSettings;
    liveListEl.firstChild.appendChild(b);
  }
  $('live-count').textContent = '';
}

async function refreshFollowed() {
  if (!state.apiConnected) {
    return renderSidebarMessage(
      '<b>Wer ist live?</b>Verbinde MultiTwitch einmal mit Twitch, dann siehst du hier alle Kanäle, denen du folgst und die gerade live sind.',
      true
    );
  }
  $('live-refresh').classList.add('spinning');
  try {
    const list = await api.followedLive();
    notifyNewLive(list);
    $('live-count').textContent = list.length;
    if (!list.length) return renderSidebarMessage('Gerade ist niemand live, dem du folgst.');
    liveListEl.innerHTML = '';
    for (const s of list) {
      const item = document.createElement('button');
      item.className = 'live-item';
      item.classList.toggle('added', tiles.has(s.login));
      item.title = `${s.title}\n\nseit ${fmtUptime(s.startedAt)} live`;
      item.innerHTML = `
        <img alt="" />
        <div class="live-meta"><b></b><small></small></div>
        <span class="live-viewers"><i></i></span>
        <span class="added-mark" data-icon="check"></span>`;
      hydrateIcons(item);
      if (s.avatar) item.querySelector('img').src = s.avatar;
      item.querySelector('b').textContent = s.name;
      item.querySelector('small').textContent = s.game || '–';
      item.querySelector('.live-viewers').append(fmtViewers(s.viewers));
      item.onclick = () => {
        if (tiles.has(s.login)) return toast(`${s.name} läuft schon`);
        addChannels(s.login);
        item.classList.add('added');
      };
      liveListEl.appendChild(item);
    }
  } catch (err) {
    handleApiError(err);
  } finally {
    $('live-refresh').classList.remove('spinning');
  }
}

$('live-refresh').onclick = () => {
  refreshFollowed();
  refreshLiveInfo();
};

function toggleSidebar() {
  state.sidebarOpen = !state.sidebarOpen;
  save();
  render();
}
$('sidebar-btn').onclick = toggleSidebar;

function handleApiError(err) {
  const msg = String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  if (/abgelaufen|Nicht verbunden/.test(msg)) {
    state.apiConnected = false;
    refreshFollowed();
    renderApiSettings();
  }
  console.warn(msg);
}

// Alle 60 Sekunden aktualisieren
setInterval(() => {
  refreshFollowed();
  refreshLiveInfo();
}, 60000);

// ---------- Benachrichtigung, wenn jemand live geht ----------

let knownLive = null; // beim ersten Laden nur merken, nicht benachrichtigen

function notifyNewLive(list) {
  followedCache = list;
  const now = new Set(list.map((s) => s.login));
  if (knownLive && state.opts.notify) {
    for (const s of list) {
      if (knownLive.has(s.login) || tiles.has(s.login)) continue;
      const n = new Notification(`${s.name} ist jetzt live`, {
        body: `${s.game || 'Live'} – ${s.title}`.slice(0, 140),
        icon: s.avatar || undefined,
        silent: false,
      });
      // Klick auf die Benachrichtigung: App nach vorne holen und Stream hinzufügen
      n.onclick = () => {
        window.twitch.focusApp();
        if (!tiles.has(s.login)) addChannels(s.login);
      };
    }
  }
  knownLive = now;
}

// ---------- Vorschläge beim Eintippen ----------

const suggestEl = document.createElement('div');
suggestEl.id = 'suggestions';
suggestEl.hidden = true;
$('add-form').appendChild(suggestEl);
let suggestions = [];
let activeSuggestion = -1;
let searchTimer;
let searchSeq = 0;
let followedCache = [];

function hideSuggestions() {
  suggestEl.hidden = true;
  activeSuggestion = -1;
}

function showSuggestions(items, heading) {
  suggestions = items;
  activeSuggestion = -1;
  if (!items.length) return hideSuggestions();
  suggestEl.innerHTML = heading ? `<div class="suggest-head">${heading}</div>` : '';
  items.forEach((it, i) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'suggest-item';
    row.innerHTML = `<span class="suggest-avatar"></span><span class="suggest-text"><b></b><small></small></span><span class="suggest-state"></span>`;
    const av = row.querySelector('.suggest-avatar');
    if (it.avatar) av.innerHTML = `<img alt="" src="${encodeURI(it.avatar)}" />`;
    else av.textContent = it.login[0];
    row.querySelector('b').textContent = it.name || it.login;
    row.querySelector('small').textContent = it.live ? it.game || 'Live' : it.note || 'Offline';
    row.querySelector('.suggest-state').textContent = tiles.has(it.login) ? 'läuft' : it.live ? 'LIVE' : '';
    row.classList.toggle('is-live', Boolean(it.live));
    row.addEventListener('mousedown', (e) => e.preventDefault()); // Fokus im Suchfeld behalten
    row.onclick = () => pickSuggestion(i);
    suggestEl.appendChild(row);
  });
  suggestEl.hidden = false;
}

function pickSuggestion(i) {
  const it = suggestions[i];
  if (!it) return;
  hideSuggestions();
  input.value = '';
  if (tiles.has(it.login)) return toast(`${it.name || it.login} läuft schon`);
  addChannels(it.login);
  input.blur();
}

function highlight(i) {
  const rows = suggestEl.querySelectorAll('.suggest-item');
  activeSuggestion = (i + rows.length) % rows.length;
  rows.forEach((r, idx) => r.classList.toggle('active', idx === activeSuggestion));
}

// Ohne Eingabe: zuletzt geschaut + gerade live. Mit Eingabe: Twitch-Suche (falls verbunden)
async function updateSuggestions() {
  const q = input.value.trim().toLowerCase();
  const seq = ++searchSeq;
  if (!q) {
    const live = followedCache.filter((s) => !tiles.has(s.login)).slice(0, 5);
    const recent = state.recent
      .filter((n) => !tiles.has(n) && !live.some((s) => s.login === n))
      .slice(0, 5)
      .map((n) => ({ login: n, name: n, live: state.live[n] ? true : false, note: 'Zuletzt geschaut' }));
    return showSuggestions([...live, ...recent], live.length || recent.length ? 'Vorschläge' : '');
  }
  if (/[\s,/]/.test(q)) return hideSuggestions(); // mehrere Kanäle oder Link -> keine Vorschläge
  const local = [
    ...followedCache.filter((s) => s.login.includes(q)),
    ...state.recent.filter((n) => n.includes(q)).map((n) => ({ login: n, name: n, note: 'Zuletzt geschaut' })),
  ];
  if (!state.apiConnected) return showSuggestions(dedupe(local).slice(0, 8));
  try {
    const found = await api.search(q);
    if (seq !== searchSeq) return; // inzwischen weitergetippt
    // Live-Kanäle zuerst
    found.sort((a, b) => Number(b.live) - Number(a.live));
    showSuggestions(dedupe([...local, ...found]).slice(0, 8));
  } catch (err) {
    handleApiError(err);
    showSuggestions(dedupe(local).slice(0, 8));
  }
}

const dedupe = (list) => {
  const seen = new Set();
  return list.filter((s) => !seen.has(s.login) && seen.add(s.login));
};

input.addEventListener('focus', updateSuggestions);
input.addEventListener('blur', () => setTimeout(hideSuggestions, 100));
input.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(updateSuggestions, 200);
});
input.addEventListener('keydown', (e) => {
  if (suggestEl.hidden) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    highlight(activeSuggestion + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    highlight(activeSuggestion - 1);
  } else if (e.key === 'Enter' && activeSuggestion >= 0) {
    e.preventDefault();
    pickSuggestion(activeSuggestion);
  }
});

// ---------- Sets: ganze Zusammenstellungen speichern und laden ----------

let sets = load('sets', []);

function renderSets() {
  const list = $('sets-list');
  list.innerHTML = '';
  if (!sets.length) {
    list.innerHTML = '<div class="menu-empty">Noch keine Sets gespeichert</div>';
    return;
  }
  sets.forEach((set, i) => {
    const row = document.createElement('div');
    row.className = 'set-row';
    row.innerHTML = `<button class="set-load"><b></b><small></small></button>
      <button class="set-delete" title="Löschen"><span data-icon="trash"></span></button>`;
    hydrateIcons(row);
    row.querySelector('b').textContent = set.name;
    row.querySelector('small').textContent = set.channels.join(', ');
    row.querySelector('.set-load').onclick = () => loadSet(set);
    row.querySelector('.set-delete').onclick = (e) => {
      e.stopPropagation();
      sets.splice(i, 1);
      saveSets();
    };
    list.appendChild(row);
  });
}

function saveSets() {
  try {
    localStorage.setItem('sets', JSON.stringify(sets));
  } catch {}
  renderSets();
}

$('set-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('set-name').value.trim();
  if (!name) return;
  if (!state.channels.length) return toast('Füge zuerst Streams hinzu');
  const set = {
    name,
    channels: [...state.channels],
    layout: state.layout,
    focus: state.focus,
    free: structuredClone(state.free),
    volumes: structuredClone(state.volumes),
  };
  const existing = sets.findIndex((s) => s.name === name);
  if (existing >= 0) sets[existing] = set;
  else sets.push(set);
  $('set-name').value = '';
  saveSets();
  toast(`Set „${name}“ gespeichert`);
});

function loadSet(set) {
  closeMenus();
  // Streams, die im Set nicht vorkommen, entfernen; vorhandene bleiben ohne Neuladen
  for (const name of [...tiles.keys()]) if (!set.channels.includes(name)) removeChannel(name);
  Object.assign(state, {
    layout: set.layout,
    focus: set.focus,
    free: structuredClone(set.free || {}),
    volumes: structuredClone(set.volumes || {}),
    maximized: null,
  });
  state.channels = [...set.channels];
  set.channels.forEach(addChannel);
  for (const name of set.channels) {
    const tile = tiles.get(name);
    tile.el.querySelector('.vol').value = Math.round(volumeOf(name) * 100);
    if (tile.ready) setPlayerWant(tile.webview, { volume: volumeOf(name) });
  }
  solo(set.channels[0]);
  save();
  render();
  refreshLiveInfo();
  toast(`Set „${set.name}“ geladen`);
}

// ---------- Menüs (Sets, Konto) ----------

function closeMenus() {
  document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu')) closeMenus();
});
$('sets-btn').onclick = (e) => {
  e.stopPropagation();
  const open = !$('sets-menu').classList.contains('open');
  closeMenus();
  if (open) {
    renderSets();
    $('sets-menu').classList.add('open');
    $('set-name').focus();
  }
};

// ---------- Einstellungen ----------

const modal = $('settings-modal');

function openSettings() {
  closeMenus();
  modal.hidden = false;
  renderApiSettings();
}
function closeSettings() {
  modal.hidden = true;
}
$('settings-btn').onclick = openSettings;
modal.addEventListener('click', (e) => {
  if (e.target === modal || e.target.closest('[data-close]')) closeSettings();
});
modal.querySelectorAll('[data-link]').forEach((a) => {
  a.onclick = (e) => {
    e.preventDefault();
    window.twitch.openExternal(a.dataset.link);
  };
});

async function renderApiSettings() {
  const st = await api.status();
  state.apiConnected = st.connected;
  $('client-id').value = st.clientId;
  $('api-pill').textContent = st.connected ? 'verbunden' : 'nicht verbunden';
  $('api-pill').classList.toggle('ok', st.connected);
  $('api-connected').hidden = !st.connected;
  $('api-howto').hidden = st.connected;
  $('client-id').parentElement.hidden = st.connected;
  if (st.connected && st.user) {
    $('api-user').textContent = st.user.name;
    $('api-avatar').src = st.user.avatar;
  }
}

$('api-connect').onclick = async () => {
  const id = $('client-id').value.trim();
  if (!/^[a-z0-9]{20,40}$/i.test(id)) return toast('Das sieht nicht nach einer Client-ID aus');
  await api.setClientId(id);
  try {
    const { userCode } = await api.connect();
    $('device-code-value').textContent = userCode;
    $('device-code').hidden = false;
  } catch (err) {
    toast(String(err.message).replace(/^.*Error: /, ''));
  }
};

api.onConnected(async () => {
  $('device-code').hidden = true;
  await renderApiSettings();
  toast('Mit Twitch verbunden – die Live-Liste ist jetzt aktiv');
  refreshFollowed();
  refreshLiveInfo();
});
api.onError((msg) => {
  $('device-code').hidden = true;
  toast(msg);
});

$('api-disconnect').onclick = async () => {
  await api.disconnect();
  state.live = {};
  await renderApiSettings();
  refreshFollowed();
  render();
};

function bindOption(id, key, onChange) {
  const box = $(id);
  box.checked = Boolean(state.opts[key]);
  box.onchange = () => {
    state.opts[key] = box.checked;
    save();
    render();
    onChange?.(box.checked);
  };
}
bindOption('opt-quality', 'autoQuality');
bindOption('opt-offline', 'hideOffline');
bindOption('opt-chat-follows', 'chatFollowsAudio');
bindOption('opt-audio-click', 'audioFollowsClick');
bindOption('opt-notify', 'notify');
bindOption('opt-mute-icon', 'muteIcon');
// Lautstärke angleichen: sofort an alle laufenden Player weitergeben
function applyNormalize(on) {
  for (const t of tiles.values()) if (t.ready) setPlayerWant(t.webview, { normalize: on });
}
bindOption('opt-normalize', 'normalize', applyNormalize);

// Per Taste N an/aus
function setNormalize(on) {
  state.opts.normalize = on;
  $('opt-normalize').checked = on;
  save();
  applyNormalize(on);
  toast(on ? 'Lautstärke angleichen: an' : 'Lautstärke angleichen: aus – Originalton');
}

window.twitch.version().then((v) => ($('app-version').textContent = `v${v}`));

// ---------- Kino-Modus: nur noch Streams, im Vollbild ----------

function setCinema(on) {
  if (state.cinema === on) return;
  state.cinema = on;
  document.body.classList.toggle('cinema', on);
  window.twitch.fullscreen(on);
  if (on) toast('Kino-Modus – mit Esc oder F wieder raus');
  // Kurz warten, bis das Fenster im Vollbild ist, dann neu anordnen
  render();
}
$('cinema-btn').onclick = () => setCinema(true);
window.twitch.onFullscreenChanged((full) => {
  if (!full) setCinema(false);
});

// Tastenkürzel, die renderer.js nicht selbst behandelt
function handleFeatureKey(key) {
  const k = key.toLowerCase();
  if (k === 'f') setCinema(!state.cinema);
  else if (k === 's') toggleSidebar();
  else if (k === 'n') setNormalize(!state.opts.normalize);
  else if (k === 'escape') {
    if (!modal.hidden) closeSettings();
    else if (state.cinema) setCinema(false);
    closeMenus();
    hideSuggestions();
  } else return false;
  return true;
}

// ---------- Befehle aus dem App-Menü ----------

window.twitch.onMenu((cmd) => {
  if (cmd.startsWith('layout:')) return setLayout(cmd.slice(7));
  switch (cmd) {
    case 'add': return focusSearch();
    case 'settings': return openSettings();
    case 'sidebar': return toggleSidebar();
    case 'chat': return toggleChat();
    case 'cinema': return setCinema(!state.cinema);
    case 'reload-all': return reloadAll();
    case 'unmute-all': return tiles.forEach((_, n) => setMuted(n, false));
    case 'mute-all': return tiles.forEach((_, n) => setMuted(n, true));
    case 'clear':
      if (tiles.size && confirm('Alle Streams entfernen?')) [...tiles.keys()].forEach(removeChannel);
  }
});

// ---------- Links einfügen: Cmd/Strg+V irgendwo in der App ----------

document.addEventListener('paste', (e) => {
  if (e.target.closest('input, textarea')) return;
  const text = e.clipboardData.getData('text');
  if (text && addChannels(text) === 0 && !parseChannels(text).names.length) {
    toast('In der Zwischenablage war kein Kanal');
  }
});

// ---------- Bild-im-Bild geschlossen ----------

window.twitch.onPipClosed((name) => {
  if (tiles.has(name)) toast(`Bild-im-Bild von ${name} geschlossen`);
});

// ---------- Update-Hinweis ----------

window.twitch.checkUpdate().then((upd) => {
  if (!upd) return;
  $('update-version').textContent = `v${upd.version}`;
  $('update-banner').hidden = false;
  $('update-open').onclick = () => window.twitch.openExternal(upd.url);
  $('update-close').onclick = () => ($('update-banner').hidden = true);
});

// ---------- Start ----------

state.channels.forEach(addChannel);
new ResizeObserver(render).observe(stageEl);
render();
refreshLogin();
renderApiSettings().then(() => {
  refreshFollowed();
  refreshLiveInfo();
});
