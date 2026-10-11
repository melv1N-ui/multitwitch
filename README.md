# MultiTwitch

Mehrere Twitch-Streams gleichzeitig in einem Fenster schauen – für Mac und Windows.
Die Streams laufen mit deinem eigenen Twitch-Login, dadurch gilt dein **Turbo-Abo** (keine Werbung).

![Icon](build/icon.png)

## Funktionen
- Beliebig viele Streams: Layouts **Raster**, **Fokus** und **Frei** (Fenster selbst verschieben & vergrößern)
- Lautstärke pro Stream, „nur diesen hören“ per Taste 1–9
- **Live-Liste** deiner gefolgten Kanäle mit Zuschauerzahlen (Twitch-Verbindung in den Einstellungen)
- Automatische Qualität je nach Größe, Offline-Erkennung
- Gespeicherte **Sets**, **Kino-Modus**, **Bild-im-Bild**, Chat (Tabs oder gestapelt)
- multitwitch.tv-Links einfach einfügen

## Download
Unter [Releases](../../releases) gibt es die fertige App:
- **Mac:** `.dmg` öffnen, MultiTwitch in „Programme“ ziehen. Beim ersten Start ggf. *Systemeinstellungen → Datenschutz & Sicherheit → Trotzdem öffnen*.
- **Windows:** `.exe` ausführen. Falls SmartScreen warnt: *Weitere Informationen → Trotzdem ausführen*.

## Selbst starten (Entwicklung)
```bash
npm install
npm start
```

## Neue Version veröffentlichen
Version in `package.json` erhöhen, dann:
```bash
git commit -am "Version 1.0.1"
git tag v1.0.1
git push --follow-tags
```
GitHub baut dann automatisch Mac- und Windows-Version und hängt sie an ein Release.
