# Changelog

Alle Änderungen an MultiTwitch. Neueste Version oben.

## 1.1.1 – 2026-10-14

### Behoben
- **Die Twitch-Verbindung (Live-Liste) ging nach ein paar Stunden verloren und musste neu eingerichtet werden.** Ursache: Beim App-Start haben zwei Teile gleichzeitig den abgelaufenen Zugang erneuert – Twitch akzeptiert den Erneuerungsschlüssel aber nur einmal, und die App hat das fälschlich als „abgemeldet“ gewertet. Jetzt wird nur noch einmal erneuert, und zwar schon kurz bevor der Zugang abläuft.
- Ein kurzer Netzwerkfehler (z. B. WLAN beim Start noch nicht verbunden) meldet dich nicht mehr bei Twitch ab.
- Die Einstellungsdatei wird so gespeichert, dass sie beim Beenden der App nicht beschädigt werden kann.

## 1.1.0 – 2026-10-12

### Neu
- **Lautstärke angleichen** – leise Streams werden lauter, laute leiser, und plötzliche Schreie oder Alerts werden sofort abgefangen. Deine Regler pro Stream wirken zusätzlich. In den Einstellungen oder mit der Taste **N** an- und ausschaltbar.
- **Suchvorschläge beim Eintippen** – mit Profilbild und Live-Status (mit Twitch-Verbindung), dazu deine zuletzt geschauten Kanäle und wer gerade live ist. Mit ↑ ↓ und Enter auswählen.
- **Benachrichtigung „… ist jetzt live“** für Kanäle, denen du folgst. Ein Klick fügt den Stream direkt hinzu.
- **Chat folgt dem Ton** – wechselst du den hörbaren Stream, springt der Chat mit.
- **Ton folgt dem Klick** (optional) – ein Klick in einen Stream schaltet dessen Ton ein.
- **Deutsches App-Menü** mit Tastenkürzeln: ⌘1–3 für die Layouts, ⌘R lädt alle Streams neu, ⌘, öffnet die Einstellungen.
- Das **Fokus-Layout** legt die kleinen Streams in hohen Fenstern automatisch nach unten.

### Verbessert
- **Tastenkürzel (1–9, F, C, L, S, Esc) funktionieren jetzt auch, nachdem du in einen Stream geklickt hast.**
- Streams, die nicht laden (z. B. Internet kurz weg), versuchen es nach ein paar Sekunden selbst nochmal. Abgestürzte Player starten neu.
- Fenstergröße und -position werden gemerkt.
- Ein zweiter Start der App holt das vorhandene Fenster nach vorne, statt eine zweite App zu öffnen.
- Das Stumm-Symbol auf stummen Streams ist standardmäßig ausgeblendet (in den Einstellungen wieder einschaltbar).
- Die Tasten 1–9 passen zu den Nummern auf den Streams, auch wenn Offline-Streams ausgeblendet sind.

### Sicherheit & Technik
- Eingebettete Seiten dürfen nur Twitch laden und haben keinen Zugriff auf die App. Fremde Links öffnen im normalen Browser.
- Automatische Tests für Layouts und Kanal-Erkennung, die bei jedem Hochladen auf GitHub laufen.
- Aktualisierte Bausteine für den automatischen Build.

## 1.0.0 – 2026-10-11

Erste Version: mehrere Streams mit deinem Twitch-Login (Turbo), Layouts Raster/Fokus/Frei, Lautstärke pro Stream, automatische Qualität, Live-Liste, Sets, Kino-Modus, Bild-im-Bild, Chat mit Tabs oder gestapelt, multitwitch-Links.
