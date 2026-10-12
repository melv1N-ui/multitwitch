# MultiTwitch

Mehrere Twitch-Streams gleichzeitig in einem Fenster schauen – für Mac und Windows.
Die Streams laufen mit deinem eigenen Twitch-Login, dadurch gilt dein **Turbo-Abo** (keine Werbung).

![Icon](build/icon.png)

## Funktionen
- Beliebig viele Streams: Layouts **Raster**, **Fokus** und **Frei** (Fenster selbst verschieben & vergrößern)
- **Lautstärke angleichen** (abschaltbar): alle Streams ähnlich laut, Schreie & Alerts werden abgefangen
- Lautstärke pro Stream, „nur diesen hören“ per Taste 1–9 – auch wenn du gerade in einen Stream geklickt hast
- **Suchvorschläge** beim Eintippen mit Live-Status, dazu deine zuletzt geschauten Kanäle
- **Live-Liste** deiner gefolgten Kanäle und **Benachrichtigung**, wenn jemand live geht
- **Chat folgt dem Ton**, Chat als Tabs oder gestapelt
- Automatische Qualität je nach Größe, Offline-Erkennung, selbstständiges Neuladen bei Verbindungsproblemen
- Gespeicherte **Sets**, **Kino-Modus**, **Bild-im-Bild**
- multitwitch.tv-Links einfach einfügen
- Deutsches App-Menü mit Tastenkürzeln

Alle Änderungen stehen im [Changelog](CHANGELOG.md).

## Download
Unter [Releases](../../releases) gibt es die fertige App:
- **Mac:** `.dmg` öffnen, MultiTwitch in „Programme“ ziehen. Beim ersten Start ggf. *Systemeinstellungen → Datenschutz & Sicherheit → Trotzdem öffnen*.
- **Windows:** `.exe` ausführen. Falls SmartScreen warnt: *Weitere Informationen → Trotzdem ausführen*.

## Selbst starten (Entwicklung)
```bash
npm install
npm start
npm test        # automatische Tests
```
Mit getrennten Testdaten (eigener Login, eigene Streams):
```bash
MULTITWITCH_PROFILE=test npm start
```

## Projektaufbau
| Datei | Aufgabe |
|---|---|
| `src/main.js` | Fenster, Menü, Login, Sicherheit, Bild-im-Bild, Update-Check |
| `src/twitch-api.js` | Offizielle Twitch-API (Live-Liste, Suche) |
| `src/lib.js` | Layouts & Kanal-Erkennung (getestet in `test/`) |
| `src/renderer.js` | Streams, Ton, Layout-Steuerung, Chat |
| `src/features.js` | Live-Liste, Suche, Sets, Einstellungen, Kino-Modus |
| `src/player-control.js` | Lautstärke & Qualität im Twitch-Player |

## Neue Version veröffentlichen
Version in `package.json` erhöhen und in `CHANGELOG.md` beschreiben, dann:
```bash
git commit -am "Version 1.0.1"
git tag v1.0.1
git push --follow-tags
```
GitHub baut dann automatisch Mac- und Windows-Version und hängt sie an ein Release.
