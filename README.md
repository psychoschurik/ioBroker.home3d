![Logo](admin/home3d.svg)

# ioBroker.home3d

3D-Grundrisseditor und Live-Visualisierung für ioBroker. Die Oberfläche läuft komplett im **web-Adapter**, wie vis-2:
kein eigener Server, kein eigener Port, kein eigener Zugangsschlüssel.

## Voraussetzungen

- js-controller ≥ 6.0.11
- web-Adapter ≥ 7.0.0 mit aktiver Socket-Verbindung (integriert, oder über eine socketio-/ws-Instanz)

## Bedienung

Nach der Installation:

|                                             | Adresse                                            |
|---------------------------------------------|----------------------------------------------------|
| Oberfläche (3D-Ansicht und Editor)          | `http://<server>:8082/home3d/index.html`           |
| Kiosk (Wandtablet, ohne die oberen Leisten) | `http://<server>:8082/home3d/index.html?kiosk`     |
| Nur die 3D-Karte (als iframe in vis)        | `http://<server>:8082/home3d/index.html?view=card` |

Die ersten beiden Adressen stehen auch als Verweis im Reiter **Instanzen**. Die Instanz hat keine Einstellungen.

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
npm run build          # tasks.ts: 3D-Frontend (src-www/src → www/vendor/) und Anbindung (frontend/ → www/bridge.js)
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
- (bluefox) Einstellung „Sonnenbogen auf Höhe von“: Sonnenbogen und Kompassring können auf einer anderen Etage stehen
  als dem Erdgeschoss, z. B. auf einem Boot am Unterdeck
- (bluefox) Editor und 3D-Ansicht bleiben beim Umschalten auf derselben Etage
- (bluefox) Datenpunkte am Gerät wählen: im Editor zeigt ein Gerät seinen ioBroker-Datenpunkt mit „Ändern …“ (Objekt-Browser),
  die Geräteliste eines Raums hat „+ Datenpunkt aus ioBroker“ (neue Geräte, gleich im Raum platziert); auch in
  „Geräte verbinden“ lässt sich der Datenpunkt eines Geräts ändern
- (bluefox) Boote: „Kurs aus Kompass“ in den Hauseinstellungen dreht Sonne, Schatten und Kompassring mit dem Kurs
- (bluefox) Position für den Sonnenstand aus einem Datenpunkt (z. B. GPS von serial-gps) statt aus den Systemeinstellungen
- (bluefox) Build mit Vite statt esbuild; `npm run dev` startet einen Entwicklungsserver mit Hot Reload und
  simulierten Geräten
- (bluefox) Neu: `index.html?kiosk` für Wandtablets – die 3D-Ansicht ohne die beiden oberen Leisten; Editor, „Projekte“
  und „Geräte verbinden“ sind dort nicht erreichbar
- (bluefox) Editor: „Kiosk ↗“ öffnet den bearbeiteten Plan im Kiosk-Modus in einem neuen Tab
- (bluefox) Der Verweis „Tabletansicht“ in der Kopfzeile und im Reiter Instanzen ist durch „Kiosk“ ersetzt;
  `?view=card` (3D-Karte als iframe in VIS) füllt jetzt die ganze Höhe statt 420 px und zeigt keine Kopfzeile mehr
- (bluefox) Boote: „Meer um das Boot“ in den Hauseinstellungen – Wasser an der Wasserlinie mit Wellen aus einem
  Wellenhöhe- und einem Wellenlänge-Sensor (Länge in m oder Periode in s); die Wellen kommen von vorn
- (bluefox) Die Quellen des 3D-Frontends liegen jetzt in `src-www/` statt in `vendor-src/home3d/`
- (bluefox) Mit dem Meer stehen Sonnenbogen und Kompassring auf dem Wasser statt auf der Etage darunter
- (bluefox) Zeitreise: In den Hauseinstellungen ist wählbar, aus welchem Verlauf sie liest, z. B. recorder.0 (zeichnet
  alles Wichtige ohne Einstellung je Datenpunkt auf); was die Instanz nicht aufzeichnet, kommt weiter aus dem Verlauf,
  der es aufzeichnet
- (bluefox) Boote: neues Möbelstück „Anker“ (Draußen) für den Bugbeschlag – mit Kettenzähler und Wassertiefe liegt er
  im Beschlag, hängt an der Kette oder liegt auf dem Grund, die Kette als Kettenlinie durchs Wasser; darüber Kettenlänge
  und Tiefe, der Alarmradius als Kreis auf dem Wasser (rot bei Alarm)
- (bluefox) Boote: neuer Bibliotheksbereich „Boot“ mit Anker, Tank, Ruder, Antrieb und Positionslicht. Tanks als
  Glaskasten mit der Flüssigkeit bis zum Füllstand (Frischwasser, Diesel, Gas, Grau-, Schwarzwasser), mit Litern und
  Warnfarbe; das Ruderblatt dreht sich mit der Ruderlage; der Propeller dreht sich mit der Motordrehzahl;
  Positionslichter (Anker-, Dampfer-, Seiten-, Hecklicht) leuchten mit ihrem Schalter, nachts mit Lichthof und
  Spiegelung auf dem Meer
- (bluefox) Meer: mit einem Fahrt-Sensor (kn, km/h oder m/s) strömt das Wasser am Rumpf vorbei, mit Bugwelle,
  Kielwasser und Heckwelle
- (bluefox) Zurück aus der 3D-Ansicht zeigt der Editor wieder, was er vorher zeigte: Etage, Auswahl, Werkzeug, Zoom,
  die Seitenleiste mit ihrer Scrollposition und Suche und Bereiche der Möbelbibliothek
- (bluefox) Ein Fernseher, der gerade nichts abspielt (YouTube, während man ein Video sucht), zeigt das YouTube-Logo
  bzw. den Namen der App statt des Vorschaubilds des letzten Videos oder nur eines farbigen Leuchtens
- (bluefox) Wind: Sensoren für Wind, Windrichtung und Böen (sonst gilt die Wetter-Entität) und ein Windanzeiger
  (Verklicker, Windsack, Flagge), der sich mit dem Wind dreht und Wind, Richtung und Beaufort zeigt; Böen lassen ihn
  schwingen
- (bluefox) Meer: die Wellen laufen mit dem Wind, ab 4 Bft mit Schaumkronen, Böen kräuseln das Wasser, Regen macht Ringe;
  Deck und Dächer werden im Regen nass, Wolkenschatten ziehen mit dem Wind über Meer, Deck und Dächer
- (bluefox) Nebel auch aus der Sichtweite oder daraus, wie nah die Temperatur am Taupunkt ist
- (bluefox) Luftdruck (Sensor oder Wetter-Entität): fällt er in 3 Stunden um 3 hPa oder mehr, erscheint eine Warnung, ab
  6 hPa eine Sturmwarnung, und der Himmel wird dunkler
- (bluefox) Ansicht „Technik“: Räume nach dem Zustand ihrer Geräte gefärbt, Schilder an Geräten mit schwacher Batterie
  oder ohne Verbindung, Liste und Zusammenfassung; die Batterie- und Erreichbarkeits-Datenpunkte (auch die Verbindung
  und der Lauf des Adapters) werden zu jedem verbundenen Gerät selbst gefunden
- (bluefox) Schimmelrisiko: aus Temperatur, Feuchte und Außentemperatur die Feuchte in der kältesten Ecke; dunkle Ecken
  und „Lüften“ ab 80 %
- (bluefox) Offene Fenster zeigen Luft, die je nach Wind hinein- oder hinausströmt (Querlüften sichtbar); heizt der Raum,
  zieht rote Wärme hinaus, nach 10 Minuten mit Warnung
- (bluefox) Garten: Mähroboter (Worx, Husqvarna, Gardena …) fährt Bahnen und hinterlässt Streifen, Regner sprühen,
  solange ihr Ventil offen ist, trockener Boden färbt den Rasen gelblich
- (bluefox) Strompreis (z. B. Tibber, aWATTar): das Haus leuchtet grün bis rot, mit Vorschau die günstigste Stunde
- (bluefox) Unwetterwarnung (z. B. DWD): Rahmen und Banner in der Farbe der Warnstufe
- (bluefox) Ansicht „Bewegung“: wo heute Bewegung war, aus dem Verlauf der Bewegungsmelder
- (bluefox) Schallringe an spielenden Lautsprechern (nach Lautstärke) und an Lärmsensoren
- (bluefox) Wasser: läuft an Dusche, Wanne und Waschbecken sichtbar, Warnung nach 30 Minuten Durchfluss, bei einem Leck
  steigt das Wasser im Raum
- (bluefox) Autos als Möbel: Limousine, Kompaktwagen und Transporter in wählbarer Farbe; mit einem Anwesenheits-Datenpunkt
  parken sie ein oder fahren weg
- (bluefox) Boote: neues Möbelstück „Luke“ fürs Deck, eckig mit runden Ecken oder rund – mit ihrem Kontakt steht der
  getönte Deckel im Öffnungswinkel auf Gasfedern; offen bei Regen gibt es eine Warnung
- (bluefox) Fenster, die nach oben aufgehen: Klappfenster mit eigenem Öffnungswinkel, auch nach innen; neuer Fensterstil
  „Bullauge / rund“ mit abgerundetem Rahmen und Flügel, der als Klappe nach oben öffnet
- (bluefox) Technik: „nicht erreichbar nach … Minuten ohne Update“ einstellbar, statt sich auf die Meldung des Geräts zu
  verlassen; Batteriegeräte, die zwischen zwei Meldungen schlafen, gelten erst nach 48 Stunden als nicht erreichbar,
  Fernseher und Player im Standby nie. Die Batterie von Shelly-Geräten (Kanal DevicePower0) wird gefunden; ein einzelner
  Datenpunkt ohne Wert macht ein Gerät, das seinen Zustand selbst meldet, nicht mehr „nicht erreichbar“
- (bluefox) Technik: einstellbar, ob Räume ohne Problem grün werden oder ihre Farbe behalten; ein Hinweis am Schild zeigt
  Gerät, Grund und letztes Update; die Liste steht rechts unten und verdeckt die Etagen nicht mehr
- (bluefox) Das Mausrad zoomt die 3D-Ansicht auch, wenn der Zeiger auf einem Sensor oder Schild steht
- (bluefox) Datenpunkt-Felder der Einstellungen zeigen unter dem Namen die ioBroker-ID des gewählten Datenpunkts

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
