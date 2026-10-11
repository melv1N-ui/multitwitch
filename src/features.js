// Zusatzfunktionen: Live-Liste, Live-Infos auf den Streams, Sets, Einstellungen, Kino-Modus, Updates.
// Nutzt state, tiles, render(), addChannels() usw. aus renderer.js.

const api = window.twitch.api;

const fmtViewers = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',')}K` : String(n));

function fmtUptime(iso) {
  const min = Math.floor((Date.now() - new Date(iso)) / 60000);
  const h = Math.floor(min / 60);
  return h ? `${h} Std. ${min % 60} Min.` : `${min} Min.`;
}

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

function bindOption(id, key) {
  const box = $(id);
  box.checked = Boolean(state.opts[key]);
  box.onchange = () => {
    state.opts[key] = box.checked;
    save();
    render();
  };
}
bindOption('opt-quality', 'autoQuality');
bindOption('opt-offline', 'hideOffline');

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
function handleFeatureKey(e) {
  const key = e.key.toLowerCase();
  if (key === 'f') setCinema(!state.cinema);
  else if (key === 's') toggleSidebar();
  else if (e.key === 'Escape') {
    if (!modal.hidden) closeSettings();
    else if (state.cinema) setCinema(false);
    closeMenus();
  }
}

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
