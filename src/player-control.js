// Steuert Lautstärke, Qualität und Lautstärke-Angleichung eines Twitch-Players von außen.
// Dazu wird ein kleines Skript IN die Player-Seite gesetzt. Es sucht den internen Twitch-Player
// und setzt jede Sekunde die gewünschten Werte (falls der Player sie zwischendurch ändert).
//
// Lautstärke angleichen ("normalize"): Der Ton des Videos läuft durch eine kleine Audio-Kette:
//   Video -> automatische Verstärkung -> Kompressor -> deine Lautstärke -> Lautsprecher
// Die automatische Verstärkung misst laufend, wie laut der Stream im Schnitt ist, und regelt ihn
// langsam auf einen festen Zielpegel. Der Kompressor fängt plötzliche Spitzen (Schreie, Alerts) sofort ab.
// (Im Skript keine Backticks und kein Dollar-Klammer, weil alles in einem Template-String steckt.)

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

  // ---------- Lautstärke angleichen ----------

  const TARGET_DB = -28;   // Zielpegel (Durchschnitt) – etwa so laut wie ein normal abgemischter Stream
  const SILENCE_DB = -50;  // leiser als das = Pause, dann nicht nachregeln (sonst wird Rauschen laut)
  const MIN_GAIN = 0.25;   // höchstens 4x leiser ...
  const MAX_GAIN = 3;      // ... oder 3x lauter machen

  let ctx = null;

  async function audioContext() {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state !== 'running') {
      try { await ctx.resume(); } catch {}
    }
    return ctx.state === 'running' ? ctx : null;
  }

  async function buildChain(video) {
    const c = await audioContext();
    if (!c || video.__mtChain) return video.__mtChain || null; // ohne laufenden Audio-Kontext lieber nichts umleiten
    const source = c.createMediaElementSource(video);
    const analyser = c.createAnalyser();
    analyser.fftSize = 2048;
    const agc = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 10;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    const out = c.createGain();
    out.connect(c.destination);

    const chain = { source, analyser, agc, comp, out, normalized: null, level: null, buf: new Float32Array(analyser.fftSize) };
    video.__mtChain = chain;

    // Alle 100 ms messen und die Verstärkung sanft nachführen
    chain.timer = setInterval(() => {
      if (!video.isConnected) return clearInterval(chain.timer);
      if (!chain.normalized || video.paused) return;
      analyser.getFloatTimeDomainData(chain.buf);
      let sum = 0;
      for (let i = 0; i < chain.buf.length; i++) sum += chain.buf[i] * chain.buf[i];
      const power = sum / chain.buf.length;
      const db = 10 * Math.log10(power || 1e-12);
      if (db < SILENCE_DB) return;
      // gleitender Durchschnitt über ca. 3 Sekunden
      chain.level = chain.level == null ? power : chain.level * 0.97 + power * 0.03;
      const levelDb = 10 * Math.log10(chain.level);
      const gain = Math.min(MAX_GAIN, Math.max(MIN_GAIN, Math.pow(10, (TARGET_DB - levelDb) / 20)));
      agc.gain.setTargetAtTime(gain, c.currentTime, 1.2);
    }, 100);
    return chain;
  }

  // Kette umstecken: mit oder ohne Angleichung
  function route(chain, normalize) {
    if (chain.normalized === normalize) return;
    chain.normalized = normalize;
    chain.source.disconnect();
    chain.agc.disconnect();
    chain.comp.disconnect();
    if (normalize) {
      chain.source.connect(chain.analyser);
      chain.source.connect(chain.agc);
      chain.agc.connect(chain.comp);
      chain.comp.connect(chain.out);
    } else {
      chain.source.connect(chain.out);
    }
  }

  // Aktueller Messwert für die Anzeige/Tests
  function audioInfo() {
    const chain = document.querySelector('video')?.__mtChain;
    if (!chain) return { active: false };
    return {
      active: chain.normalized,
      gain: Math.round(chain.agc.gain.value * 100) / 100,
      levelDb: chain.level ? Math.round(10 * Math.log10(chain.level)) : null,
      reductionDb: Math.round(chain.comp.reduction * 10) / 10,
    };
  }

  let building = false;

  async function apply() {
    let player;
    try { player = findPlayer(); } catch { return; }
    if (!player) return;
    const want = window.__mt.want;
    const video = document.querySelector('video');

    // Audio-Kette erst anlegen, wenn Angleichung gewünscht ist (danach bleibt sie bestehen)
    if (want.normalize && video && !video.__mtChain && !building) {
      building = true;
      try { await buildChain(video); } catch {}
      building = false;
    }
    const chain = video?.__mtChain;

    if (chain) {
      route(chain, Boolean(want.normalize));
      // Mit Audio-Kette regelt die App die Lautstärke selbst, der Player bleibt auf 100 %
      if (player.getVolume() < 0.99) player.setVolume(1);
      if (typeof want.volume === 'number') chain.out.gain.setTargetAtTime(want.volume, chain.out.context.currentTime, 0.05);
    } else if (typeof want.volume === 'number' && Math.abs(player.getVolume() - want.volume) > 0.01) {
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

  window.__mt = { want: {}, apply, audioInfo };
  setInterval(apply, 1000);
})()`;

// want = { volume?: 0..1, maxHeight?: Zahl | 'auto', normalize?: true/false }
function setPlayerWant(webview, want) {
  webview
    .executeJavaScript(`${PLAYER_SCRIPT}; Object.assign(window.__mt.want, ${JSON.stringify(want)}); window.__mt.apply();`)
    .catch(() => {}); // Player lädt gerade neu – wird beim nächsten "dom-ready" erneut gesetzt
}
