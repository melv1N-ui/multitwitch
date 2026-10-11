// Steuert Lautstärke und Qualität eines Twitch-Players von außen.
// Dazu wird ein kleines Skript IN die Player-Seite gesetzt. Es sucht den internen Twitch-Player
// und setzt jede Sekunde die gewünschten Werte (falls der Player sie zwischendurch ändert).

const PLAYER_SCRIPT = `(() => {
  if (window.__mt) return;

  // Den Twitch-Player über React finden (vom <video>-Element aus nach oben suchen)
  function findPlayer() {
    let el = document.querySelector('video');
    let key;
    while (el && !(key = Object.keys(el).find((k) => k.startsWith('__reactFiber')))) el = el.parentElement;
    if (!key) return null;
    let fiber = el[key];
    for (let i = 0; fiber && i < 200; i++, fiber = fiber.return) {
      const p = fiber.memoizedProps?.mediaPlayerInstance || fiber.stateNode?.props?.mediaPlayerInstance;
      if (p) return p.core || p;
    }
    return null;
  }

  const height = (q) => q.height || parseInt(q.name, 10) || 0;

  function apply() {
    let player;
    try { player = findPlayer(); } catch { return; }
    if (!player) return;
    const want = window.__mt.want;

    if (typeof want.volume === 'number' && Math.abs(player.getVolume() - want.volume) > 0.01) {
      player.setVolume(want.volume);
    }

    const qualities = player.getQualities?.() || [];
    if (want.maxHeight == null || !qualities.length) return;
    const key = want.maxHeight + '|' + qualities.length;
    if (key === window.__mt.qualityKey) return; // schon erledigt
    window.__mt.qualityKey = key;

    if (want.maxHeight === 'auto') {
      player.setAutoSwitchQuality?.(true);
      return;
    }
    const sorted = [...qualities].sort((a, b) => height(b) - height(a));
    const pick = sorted.find((q) => height(q) <= want.maxHeight) || sorted[sorted.length - 1];
    if (pick && player.getQuality?.()?.name !== pick.name) player.setQuality(pick);
  }

  window.__mt = { want: {}, apply };
  setInterval(apply, 1000);
})()`;

// want = { volume?: 0..1, maxHeight?: Zahl | 'auto' }
function setPlayerWant(webview, want) {
  webview
    .executeJavaScript(`${PLAYER_SCRIPT}; Object.assign(window.__mt.want, ${JSON.stringify(want)}); window.__mt.apply();`)
    .catch(() => {}); // Player lädt gerade neu – wird beim nächsten "dom-ready" erneut gesetzt
}
