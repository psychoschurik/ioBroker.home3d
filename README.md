![Logo](admin/home3d.svg)

# ioBroker.home3d

3D-Grundrisseditor und Live-Visualisierung für ioBroker. Die Oberfläche läuft komplett im **web-Adapter**, wie vis-2:
kein eigener Server, kein eigener Port, kein eigener Zugangsschlüssel.

## Voraussetzungen

- js-controller ≥ 6.0.11
- web-Adapter ≥ 7.0.0 mit aktiver Socket-Verbindung (integriert, oder über eine socketio-/ws-Instanz)

## Bedienung

Nach der Installation:

| | Adresse |
| --- | --- |
| Oberfläche (3D-Ansicht und Editor) | `http://<server>:8082/home3d/index.html` |
| Tabletansicht (z. B. als iframe in vis) | `http://<server>:8082/home3d/index.html?view=card` |

Beide Adressen stehen auch als Verweis im Reiter **Instanzen**. Die Instanz hat keine Einstellungen.

1. **Geräte verbinden** öffnet den ioBroker-Objektbaum. Datenpunkte auswählen und übernehmen.
2. Im **Editor** Etagen, Räume, Türen und Möbel anlegen und den ioBroker-Räumen (`enum.rooms.*`) zuordnen.
3. In der **3D-Ansicht** Räume öffnen und Geräte bedienen.

### Wie die Daten fließen

- **Anmeldung und Rechte** kommen vom web-Adapter. Ist dort die Authentifizierung an, meldet man sich an der
  Anmeldeseite von web an.
- **Werte** werden per `subscribeState` abonniert, und zwar nur für die Datenpunkte, die Geräten zugeordnet sind.
  Änderungen kommen sofort als Push, nicht per Abfrage.
- **Objekte** werden nur für die zugeordneten Datenpunkte gelesen. Der komplette Objektbaum wird erst geladen,
  wenn man den Dialog „Geräte verbinden“ öffnet, und Werte dort nur für die sichtbaren Zeilen.
- **Schalten** schreibt mit `ack: false` direkt über den Socket. Typ, Bereich (`min`/`max`) und Schreibrecht werden
  vorher geprüft.
- **Speichern**: Grundrisse, Wiederherstellungspunkte, Bilder und Gerätezuordnungen liegen als Dateien im
  ioBroker-Dateispeicher der Instanz `home3d.0`:
  - `data.json`: Grundrisse, Zuordnungen, Reihenfolge
  - `history/<grundriss>.json`: bis zu 30 Wiederherstellungspunkte je Grundriss
  - `images/<bild>.<png|jpg|webp|gif>`: Hintergrundbilder
- Mehrere Browser gleichzeitig: Änderungen an `data.json` werden per `subscribeFiles` an alle offenen Seiten
  gemeldet. Wer auf einem veralteten Stand speichern will, bekommt „Inzwischen anderswo gespeichert“.

### Rechte

Der angemeldete Benutzer braucht Leserechte auf Objekte und States der zugeordneten Datenpunkte, Schreibrechte auf
States zum Schalten und Schreibrechte auf Dateien zum Speichern von Grundrissen.

### Wechsel vom Adapter 3d-home (0.4.0)

Bis 0.4.0 hieß der Adapter `3d-home`, hatte einen eigenen Webserver (Port 8097) und speicherte alles im State
`3d-home.0.storage`. Weil ioBroker-Adapternamen mit einem Buchstaben beginnen müssen, heißt er jetzt `home3d`. Das ist
für ioBroker ein neuer Adapter:

1. `home3d` installieren, die alte Instanz `3d-home.0` vorerst **nicht** löschen.
2. `/home3d/index.html` einmal öffnen. Dabei wird der Inhalt von `3d-home.0.storage` einmalig nach `data.json`,
   `history/` und `images/` von `home3d.0` übernommen.
3. Danach den Adapter `3d-home` deinstallieren. Port und Zugangsschlüssel entfallen.

## Entwicklung

```bash
npm ci
npm run build          # tasks.ts: 3D-Frontend (vendor-src/home3d/src → www/vendor/) und Anbindung (frontend/ → www/bridge.js)
npm run check          # TypeScript-Prüfung (Browser-Code, Build-Tasks, Tests)
npm run lint           # @iobroker/eslint-config
npm test               # Unit-Tests (node:test) und Paketdateien (@iobroker/testing)
npm run test:pack      # npm pack und Prüfung des Tarballs
npm run demo           # lokale Demo ohne ioBroker: http://127.0.0.1:8099/home3d/index.html
```

Die Demo liefert `www/` wie der web-Adapter aus und ersetzt `/lib/js/socket.io.js` durch einen simulierten Socket mit
Demo-Geräten (Zustände und Dateien im localStorage des Browsers). `npm run demo:house` erzeugt ein größeres Demo-Haus,
`npm run demo -- artifacts/demo-house-0.2.0.json` startet die Demo damit.

Die erzeugten Bundles in `www/` sind nicht im Repository (`common.nogit`); das npm-Paket wird in der CI gebaut.
Aufbau und Konventionen: [CLAUDE.md](CLAUDE.md).

## Changelog

<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->
### **WORK IN PROGRESS**

- (bluefox) **Breaking:** Der Adapter heißt jetzt `home3d` (Adapternamen müssen mit einem Buchstaben beginnen).
  Übernahme der Daten siehe „Wechsel vom Adapter 3d-home“
- (bluefox) **Breaking:** Die Oberfläche läuft jetzt im web-Adapter unter `/home3d/`. Eigener Webserver, Port 8097
  und Zugangsschlüssel entfallen; Anmeldung und Rechte kommen von web. Voraussetzung: web ≥ 7.0.0
- (bluefox) Werte werden per Push nur für zugeordnete Datenpunkte abonniert statt alle zwei Sekunden komplett abgefragt
- (bluefox) Behoben: „Unexpected token '%' … is not valid JSON“ beim Laden – web liefert JSON-Dateien URL-kodiert
- (bluefox) Speicherung als Dateien in `home3d.0` (`data.json`, `history/`, `images/`); einmalige Übernahme aus
  `3d-home.0.storage`
- (bluefox) Sicherungsdateien aus älteren Versionen haben eine andere Formatkennung und lassen sich nicht direkt
  importieren
- (bluefox) Modernisiert: Build über `tasks.ts`, `@iobroker/eslint-config`, `@iobroker/testing`, ioBroker-Actions in
  der CI, release-script
- (bluefox) Neu: „Projekte“ – einen Grundriss mit Bildern und verbundenen Datenpunkten als Datei exportieren
  (Download oder in den ioBroker-Dateispeicher unter `home3d.0/projects/`) und als neuen Grundriss importieren.
  Fehlende Datenpunkte werden übersprungen, gleichnamige Bilder und Geräte umbenannt. Die Gesamtsicherung enthält
  jetzt auch die Gerätezuordnungen
- (bluefox) Neu: „Geräte verbinden“ hat den Objekt-Browser von ioBroker (`@iobroker/gui-components`)
- (bluefox) Neue Stile der 3D-Ansicht, direkt im Menü „Anzeige“ wählbar: „Puppenhaus“ (alle Wände durchscheinend in
  ihrer Farbe), „Comic“ (harte Lichtstufen, gezeichnete Umrisse) und „Gouache“ (gemalt, mit Pinselrändern und Papier)
- (bluefox) Knöpfe von Pro-Erweiterungen, die in ioBroker nicht freigeschaltet sind (Spur, Kameras, Wetter, Zeitreise,
  „Durch die Kamera“), werden nicht mehr mit Schloss angezeigt, sondern ausgeblendet
- (bluefox) Rückgängig (Strg+Z) im Editor behält seinen Verlauf beim Wechsel in die 3D-Ansicht und zurück
- (bluefox) Sensoren in 3D mit eigenem Symbol (Tropfen für Wasser, Flamme für Rauch, Bewegung, Fenster, Tür, Tank …);
  Temperatur zeigt die Luftfeuchte daneben, Klimawerte sind auch ohne geöffneten Raum sichtbar
- (bluefox) Neu: Detail-Dialog beim Antippen eines Geräts mit Verlauf aus dem History-Adapter (history, influxdb, sql):
  Kurve für Messwerte (Temperatur mit Luftfeuchte), Zeiten für Kontakte, Bewegung, Wasser und Rauch
- (bluefox) RGB-Lichter: Farbe als Hex-Text von ioBroker (`#rrggbb`, `#rrggbbww`) wird gelesen und geschrieben
- (bluefox) Neu: Zeitreise – der Tag (oder die Woche) wird aus dem History-Adapter abgespielt, mit Sonnenstand
- (bluefox) Neu: Wetter in 3D (Wolken, Regen, Schnee, Nebel, Wind) aus einem Wetter-Gerät; WMO-Wettercodes (z. B.
  open-meteo) werden mit `convert: "wmo"` umgerechnet, ein eigener Regensensor hat Vorrang
- (bluefox) Sonnenlicht in 3D aus der Position in den Systemeinstellungen
- (bluefox) Editor: Geräte im Grundriss mit denselben Symbolen wie in 3D; ein gewähltes Gerät blendet die Eckpunkte
  seines Raums aus (sie lagen über Sensoren und nahmen den nächsten Klick)
- (bluefox) Das gewählte Gerät ist deutlich markiert: im Grundriss ein pulsierender Ring (und es liegt über den Geräten
  daneben), in 3D ein pulsierender Rahmen, auch wenn die 3D-Ansicht erst nach der Auswahl geöffnet wird
- (bluefox) Energie: Stromfluss-Leitungen, leuchtende Solarmodule, Glas-Hologramme mit Tageskurve und die Energieleiste
  (Verbrauch, Netz, Solar, Akku); die Statistik (Fünf-Minuten-Mittel, Zählerstände pro Stunde) kommt aus dem
  History-Adapter
- (bluefox) Haushalt: Wasch- und Spülmaschinen zeigen ihre Restzeit und „Fertig!“, dazu die Glaskarte „Heute im
  Haushalt“; die Restzeit kann in Sekunden kommen (z. B. laundrylens)
- (bluefox) Zuordnungen mit Bedingung (`when`): der Zustand gilt nur, solange ein anderer Datenpunkt einen der Werte hat,
  z. B. Wasch- und Spülmaschine an einer Steckdose
- (bluefox) Energie: die Leistung jedes Solarfelds steht als Zahl auf seinen Modulen und dreht sich mit der Ansicht
- (bluefox) Fernseher zeigen das Bild ihres Media-Players (z. B. das Vorschaubild des YouTube-Videos von
  youtube-remote) und leuchten in der Farbe der App
- (bluefox) Gerätedetails: ohne History-Adapter am Datenpunkt zeigt der Dialog nur den Wert, ohne Zeiträume und Verlauf
- (bluefox) Build mit Vite statt esbuild; `npm run dev` startet einen Entwicklungsserver mit Hot Reload und
  simulierten Geräten

### 0.4.0 (2026-11-15)

- Eigenen Adapter-, Browser-, Skript- und Testcode auf TypeScript umgestellt.

### 0.3.0 (2026-11-15)

- Eigenständiger Adapter `iobroker.3d-home`, Instanz `3d-home.0`.

### 0.2.0 (2026-11-13)

- ioBroker-Design, eigene SVG-Grafiken und lokale Hilfe.
- Objektbaum-Auswahl mit Rollen- und Raumfilter, auch im Editor.

### 0.1.0 (2026-11-13)

- Erste Version mit Editor, 3D-Ansicht, Grundriss-Speicher und Gerätezuordnungen.

## License

MIT License. Das 3D-Frontend stammt aus einem MIT-lizenzierten Projekt von Mastershort und wurde für ioBroker
angepasst, siehe [NOTICE](NOTICE) und [LICENSE](LICENSE).

Copyright (c) 2026 Mastershort
