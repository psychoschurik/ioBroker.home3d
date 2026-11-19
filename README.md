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
- (bluefox) Wolken in 3D (in den Looks „Tag“ und „Wohnlich“): sie schweben über dem Haus genau über ihren Schatten
  und ziehen mit dem Wind; ihre Menge folgt der Bewölkung, bei Regen eine flache graue Decke, bei Gewitter dunkle
  Türme; tagsüber weiß, bei Sonnenauf- und -untergang rosa, nachts graublau; über dem Haus und nah vor der Kamera
  blenden sie aus, damit sie nichts verdecken
- (bluefox) Mond und Sterne: der Mond steht in seiner Himmelsrichtung mit seiner Phase (Sichel, Halbmond, Vollmond
  mit Mondmeeren und Hof, die dunkle Seite schwach im Erdschein), die helle Seite zur Sonne; nachts ein Sternenhimmel,
  der sich mit der Sternzeit um den Polarstern dreht, schwächer hinter Wolken und im hellen Mondlicht; beides wird aus
  dem Standort berechnet und läuft auch in der Zeitreise mit
- (bluefox) Regenbogen: steht die Sonne tief (unter 42°) und scheint, während es regnet oder bis zu zehn Minuten danach,
  wölbt sich gegenüber der Sonne ein Regenbogen hinter dem Haus – Violett innen, Rot außen, mit schwächerem Nebenbogen
  in umgekehrten Farben und hellerem Himmel innen
- (bluefox) Bäume und Jahreszeiten: Laubbaum, Nadelbaum, Obstbaum und Strauch unter „Garten & Außen“. Sie tragen die
  Jahreszeit nach Datum und Breitengrad (auf der Südhalbkugel umgekehrt): kahl im Winter, frisches Grün und Blüten am
  Obstbaum im Frühling, Äpfel im Spätsommer, gelbes, oranges und rotes Laub im Herbst, das im Wind fällt, Schnee auf
  Kronen und Ästen, solange es schneit. Im Wind neigen sie sich, die Krone schwingt, Böen schütteln sie; auch die
  Bibliothek zeigt jetzt Bilder der Bäume und Autos
- (bluefox) Rauch: löst ein Rauchmelder aus, füllt Rauch den Raum von der Decke her, in drei Minuten immer tiefer
- (bluefox) Kaffeemaschine (Küche): steht auf der Arbeitsplatte; solange sie brüht (Steckdose an oder ab 300 W), läuft
  Kaffee in die Tasse und Dampf steigt auf
- (bluefox) Regenwassertank (Garten): Regentonne oder Zisterne im Boden, gefüllt nach dem Füllstandssensor (%, l, m³,
  cm oder m), darüber Liter und Prozent, unter 10 % in der Warnfarbe; solange es regnet, läuft Wasser hinein
- (bluefox) Alle Looks auch im Menü „Anzeige“ (bisher dort nur fünf, die übrigen hinter ⚙)
- (bluefox) Recorder: Ist ein Recorder installiert, liest der Verlauf automatisch aus ihm, für die Datenpunkte, die er
  aufzeichnet (auch Verlaufskurve und Energie-Ansicht). Die Zeitreise holt sie mit einem Schnappschuss und den
  Ereignissen des Zeitraums auf einmal statt mit zwei Anfragen je Datenpunkt
- (bluefox) Markise, Kühlschranktüren, motorisierte Vorhänge und Leinwände lassen sich in 3D antippen (bisher nur über
  ihr Symbol), ebenso Autos, Mähroboter mit Ladestation, Sprenger, Kaffeemaschine und Regenwassertank
- (bluefox) Server / NAS (Technik & Smart Home): Serverschrank (19″) oder NAS, dessen LEDs der Steckdose folgen: aus
  dunkel, an die grüne Betriebs-LED, die Aktivitäts-LEDs flackern umso schneller, je mehr Leistung er zieht; ist die
  Steckdose nicht erreichbar, blinkt die Betriebs-LED orange
- (bluefox) Fensterstil „Durchreiche (ohne Rahmen und Glas)“: eine Öffnung mit Brüstung und Höhe, nur als Loch in der
  Wand, z. B. von der Küche ins Wohnzimmer
- (bluefox) MJPEG-Kamerastreams (z. B. `stream.mjpeg` von Frigate) laufen durch, statt sich alle paar Sekunden neu zu
  verbinden; Standbilder werden weiter aufgefrischt
- (bluefox) Dicke Luft: ab 1000 ppm CO₂ liegt ein leichter Dunst im Raum, ab 1400 ppm ein deutlicher mit dem Schild
  „CO₂ … ppm · Lüften“ (aus mit der Luft an offenen Fenstern; im Raum mit Rauch nur der Rauch)
- (bluefox) Schnee bleibt liegen, auch ohne das Paket „Winter“: meldet das Wetter Schnee, werden Dach und Rasen weiß und
  bleiben es bei Frost bis zu drei Tage (bei Tauwetter schmilzt er in sechs Stunden); auch die PV-Module liegen unter
  Schnee, ein Feld wird frei, sobald es Leistung liefert. Die Leistung auf den Modulen der Dachfelder wird wieder
  aktualisiert
- (bluefox) Briefkasten: ein rotes Fähnchen an der Seite klappt hoch, solange Post darin liegt, und legt sich wieder an,
  wenn sie geholt ist – an jeder Form (bisher hatte nur der US-Briefkasten ein festes Fähnchen)
- (bluefox) Mülltonnen an der Straße: neues Möbelstück „Tonnenplatz (Straße)“ unter Haushalt. Steht eine Tonne draußen
  (ihr Datenpunkt „rausgestellt“, sonst vom Vorabend der Abholung bis zum Morgen), steht sie mit Schild und Schatten
  nebeneinander mit den anderen auf dem nächsten Tonnenplatz und kommt danach wieder an ihren Platz
- (bluefox) Paket nach dem Klingeln: hat die Klingel geläutet, liegt ein Paket vor der Haustür mit „📦 Paket · Uhrzeit“,
  bis die Tür aufgeht (höchstens vier Stunden; ohne Türkontakt eine Stunde)
- (bluefox) Wärmepumpe: neues Möbelstück „Wärmepumpe (Außengerät)“ unter Außen. Der Lüfter dreht umso schneller, je mehr
  Leistung sie zieht (oder gleichmäßig mit einem Schalter) und läuft langsam aus; meldet der Datenpunkt „Abtauen“, steht
  der Lüfter und Dampf steigt auf
- (bluefox) E-Bike: neues Möbelstück unter Fahrzeuge. Fünf LEDs am Akku zeigen den Ladestand, darüber die Prozent; beim
  Laden steht das Ladegerät mit Kabel daneben und die nächste LED blinkt; mit einem Datenpunkt für die Anwesenheit ist
  das Rad weg, solange es unterwegs ist
- (bluefox) Speicher: neues Möbelstück „Speicher (Warmwasser / Puffer)“. Ein Fenster in der Hülle zeigt die Wasserschichten
  nach Temperatur (blau bis rot) aus den Fühlern oben, Mitte und unten, darüber „🌡 62° · 31°“; solange geheizt wird,
  brennt unten eine Flamme
- (bluefox) Mediaplayer in „Geräte verbinden“: ein Gerät mit den Rollen eines Players (YouTube-Remote, Alexa, Spotify,
  Cast, TV …) erscheint als ein Eintrag „🎵 Name“ unter seinem Gerät und wird mit allen Aktionen verbunden – Play/Pause,
  vor/zurück, Lautstärke, Stumm, Ein/Aus, dazu Titel, Interpret und Cover
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
  parken sie ein oder fahren weg. Mit runder Karosserie und Radkästen, Fenstersäulen, Scheiben mit Himmelsspiegelung,
  Alufelgen (Transporter: Stahlfelgen), die sich beim Fahren drehen, Spiegeln, Türfugen, Lichtern, Nummernschildern und
  einem weichen Schatten; ein eigenes Kennzeichen (vorne und hinten) lässt sich im Editor eingeben
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
- (bluefox) Technik: „Nicht erreichbar“ pro Gerät im Editor (am Gerät unter seinem Datenpunkt): wie im Haus
  eingestellt, wie das Gerät meldet, nach … Minuten ohne Update oder nie; dazu „nur prüfen, solange sein Adapter
  verbunden ist“ für Geräte am Bordnetz wie NMEA, deren Instrumente mit dem Boot abgeschaltet werden. Räume ohne
  Problem zeigen „✓ n OK“; ein Tooltip am Raumschild nennt die Geräte des Raums
- (bluefox) Das Schimmelrisiko lässt sich getrennt von der Luft an offenen Fenstern ausschalten
- (bluefox) Technik: Ist „auch Räume ohne Problem zeigen“ aus, erscheinen nur noch Räume mit einem Problem, ohne „✓ n OK“
- (bluefox) Batterie- und Funkprobleme lassen sich immer am Gerät zeigen, nicht nur in der Ansicht „Technik“; Luken
  und Tanks mit eigenem Sensor bekommen das Schild auch und zählen in „Technik“ mit
- (bluefox) Rauch-, Gas- und Wassersensoren warnen für den Raum, in dem sie platziert sind, auch ohne Raumzuordnung
  (der Regensensor des Hauses nicht, auch wenn er als Wassersensor meldet)
- (bluefox) Pro Gerät im Editor: „Farbe, wenn aktiv“ (3D und Grundriss) und eine Auswahl an Symbolen unter
  „Eigenes Symbol“
- (bluefox) Batterie in „Technik“: zuerst sucht der type-detector, sonst Name und Rolle; im Editor am Gerät lässt
  sich der Batterie-Datenpunkt selbst wählen oder „Keine Batterie“ setzen (gilt für das ganze Gerät)
- (bluefox) Shelly-Bluetooth-Sensoren (`shelly.0.ble.<MAC>`) sind je ein eigenes Gerät und zählen in „Technik“ einzeln
- (bluefox) Das Mausrad zoomt die 3D-Ansicht auch, wenn der Zeiger auf einem Sensor oder Schild steht
- (bluefox) Datenpunkt-Felder der Einstellungen zeigen unter dem Namen die ioBroker-ID des gewählten Datenpunkts
- (bluefox) Russisch: die 3D-Oberfläche, der Rahmen und die Hilfe; Kopfzeile, „Geräte verbinden“, Details, Projekte und
  Meldungen sprechen jetzt Deutsch, Englisch oder Russisch nach der Systemsprache, die Hilfe gibt es in allen drei
- (bluefox) Ein Klick auf Tank, Ruder, Antrieb, Luke oder Positionslicht eines Boots öffnet die Details seines Sensors,
  mit dem Verlauf, wenn ein History-Adapter ihn aufzeichnet
- (bluefox) Darf der Benutzer die Dateien von `home3d.0` nicht schreiben (z. B. auf einer Demo-Seite), läuft die Seite
  nur zum Ansehen: wie im Kiosk, ohne Editor, „Projekte“ und „Geräte verbinden“; `?readonly` erzwingt das
- (bluefox) Die Hinweiszeile des Editors nennt, wie man die Ansicht verschiebt: mit der rechten Maustaste oder zwei Fingern
- (bluefox) Die Details einer Kamera zeigen ihr Bild: ein Standbild wird jede Sekunde neu geholt, ein MJPEG-Stream läuft durch
- (bluefox) Der Sichtbereich einer Kamera beginnt an ihrer Linse und fällt von dort auf den Boden, statt in einer anderen
  Höhe unter ihr auf dem Boden zu liegen
- (bluefox) „Eigenes Symbol“ bietet jetzt gut 200 Symbole in Gruppen an (Licht, Haushaltsgeräte wie Spülmaschine und
  Saugroboter, Klima, Wasser, Strom, Türen und Fenster, Sicherheit, Medien, Garten mit Bewässerung, Fahrzeuge mit
  Fahrrad, Boot, Räume); alle erscheinen sofort, ohne den ganzen Symbolsatz nachzuladen
- (bluefox) Neues Möbel „Lüftungsauslass“ (Schalter & Technik): ein Tellerventil an der Decke oder ein Gitter an der
  Wand, als Zu- oder Abluft; solange sein Lüfter läuft, strömt hellblaue frische Luft heraus bzw. wird graue Luft
  angesaugt – dichter, schneller und weiter mit der Stufe (Lüfter mit Prozent, Stufe, Leistung, m³/h, Drehzahl, Modus)
- (bluefox) Pool freigeschaltet, mit eigenem eingebautem Modul: im Pool-Formular die Datenpunkte (Wassertemperatur,
  Heizung, Filterpumpe, Licht, pH, Chlor/Redox, Salz, Abdeckung; leer gelassen per Name gefunden). Das Wasser leuchtet
  in der Farbe der Poolbeleuchtung, sonst klar blau und grünlich bei schlechtem pH oder Chlor, bewegt sich bei
  laufender Pumpe, flimmert warm beim Heizen, die Abdeckung schließt nach ihrer Stellung; darüber Temperatur, pH und
  Redox, Warnungen bei pH oder Chlor außerhalb des Bereichs. Technikraum und Rohre lassen sich zeichnen: das Wasser
  fließt vom Skimmer über Pumpe, Filter (nach Stellung des 6-Wege-Ventils) und Wärmepumpe oder Bypass zu den
  Einlässen, beim Rückspülen braun zum Abwasser
- (bluefox) Neuer Stil „Hygge (Diorama)“ unter „Wohnlich“: Wände mit senkrechter Holzvertäfelung und Sockelleiste,
  Holzdielen auch aus der Ferne, weiche Verschattung in Ecken und unter Möbeln, warme gedämpfte Farben vor olivgrünem
  Hintergrund
- (bluefox) „Klang & Kino“ und „Bildschirme live“ freigeschaltet: über jedem spielenden Lautsprecher oder Player eine
  Glaskarte mit Cover, Titel, Interpret, Zurück/Play/Pause/Vor und Lautstärke, Schallringe um ihn, Linien zwischen
  gruppierten Playern; ein Fernseher zeigt das Cover bzw. die Farbe seiner App
- (bluefox) Glaskarten mit Steuerung für Saugroboter, Mähroboter und Kaffeemaschine (eingebautes Modul): Zustand
  (saugt, mäht, fährt zur Station, Störung …) seit wann, Akku als Balken, Knöpfe Start/Pause/Zur Station; bei der
  Kaffeemaschine Ein/Aus, Getränke als Chips, Bezüge, Leistung, Wassertank, Bohnen und Entkalken mit Hinweis. Die
  Datenpunkte werden am Gerät im Editor gewählt oder unter demselben ioBroker-Gerät bzw. nach dem Namen gefunden. Der
  Saugroboter fährt jetzt auch mit den Zustandscodes von Xiaomi/Roborock los
- (bluefox) Glaskarte für die Wallbox: Status (lädt, angesteckt, beendet, kein Auto, Störung) seit wann, Ladestand des
  Autos mit Ladeziel, Ladeleistung, Reichweite, in diesem Ladevorgang geladene kWh und „voll um“ (mit der Akkugröße des
  Autos); Laden starten/stoppen, Chips für den Ladestrom (6–16 A) und den Lademodus von evcc (Aus, Sofort, Min+PV, PV).
  Beschreibbare Zahlen- und Text-Datenpunkte lassen sich dafür über `set_value` setzen (Typ und min/max werden geprüft)
- (bluefox) Glaskarte für Heizkörper und Klimaanlage: heizt/kühlt/hält/aus seit wann, Raum- und Solltemperatur,
  Ventilöffnung und Luftfeuchte als Balken, Hinweis bei offenem Fenster; − / + (halbe Grad, im Bereich des
  Datenpunkts), Boost, Ein/Aus und die Betriebsart als Chips (aus den Zustandstexten des Datenpunkts, bei einer
  Klima-Entität Heizen/Kühlen/Auto/Aus). Gezeigt, sobald am Gerät ein Datenpunkt verbunden ist; die übrigen werden unter
  demselben ioBroker-Gerät gefunden (z. B. alles eines Homematic-IP-Thermostats)
- (bluefox) Der Mond mit seiner Phase ist auch über dem Meer um ein Boot zu sehen (das Meer verdeckte ihn, wenn man von
  oben schaut) und bei bedecktem Himmel schwach statt gar nicht
- (bluefox) Saugroboter: Chips „Raum saugen“ auf seiner Glaskarte, einer je Raum seiner Etage; der Knopf wird unter
  dem Roboter nach dem Raumnamen gefunden (z. B. rooms.Küche.roomClean bei mihome-vacuum) oder im Editor je Raum gewählt,
  der Raum, den er gerade saugt, leuchtet
- (bluefox) Boot: Glaskarten für den Anker (Abstand zum Anker gegen den Alarmradius, Kette, Tiefe, Verhältnis
  Kette : Tiefe mit Warnung unter 3 : 1, Ankeralarm) und für die Tanks (ein Balken je Tank mit Füllstand und Litern,
  Warnung bei fast leeren Vorräten oder fast vollem Fäkalientank); je Anker/Tank im Editor abschaltbar
- (bluefox) Heizung/Klima: auch eine elektrische Heizung an einer geschalteten Steckdose (Ein/Aus über die Steckdose,
  „heizt“ nach ihrer Leistung, die Raumtemperatur aus demselben Raum)
- (bluefox) Wind: Glaskarte über der Windanzeige (Windex, Windsack, Fahne) mit dem wahren Wind (auf einem Boot in
  Knoten), Windstärke in Beaufort, woher er kommt, Böen, scheinbarem Wind mit Winkel zum Bug (Bb/Stb) und Luftdruck;
  Warnung ab 6 Bft, „Sturm“ ab 8 Bft. Der scheinbare Wind wird z. B. bei nmea von selbst gefunden
- (bluefox) Kühlschrank/Tiefkühler: Glaskarte mit der Temperatur von Kühlfach und Tiefkühler (auch zwei getrennte
  Thermometer, nach ihren Namen gefunden), Luftfeuchte, Leistung und offener Tür; Warnung über 7 °C bzw. −16 °C,
  „viel zu warm“ über 9 °C bzw. −12 °C
- (bluefox) Player: Ein Tipp auf einen Player zeigt seine Glaskarte mit den Knöpfen 5 Minuten lang auch, wenn er
  nicht spielt (noch ein Tipp blendet sie aus, langes Drücken öffnet wie bisher die Details); mit dem Haken „Steuerung
  immer zeigen“ am Player oder am Möbel steht sie dauerhaft. Die Karte sagt „aus“ oder „bereit“ und hat ⏻ für Player,
  die sich ein- und ausschalten lassen. Zeigt „Anzeige“ die Karten nur beim Überfahren, gilt das auch dort: der Haken
  zeigt die Karte ganz, ein Tipp auf einen Player, der nur seinen Punkt zeigt, öffnet erst die Karte
- (bluefox) Batterie und Landstrom: Glaskarte über einer Hausbatterie mit Ladestand, Laden/Entladen in W,
  Spannung, Strom, Rest-/Gesamtkapazität in Ah, wie lange sie noch reicht bzw. bis sie voll ist, Temperatur und
  dem Landstrom (verbunden, mit welcher Leistung; auf einem Boot sonst das Netz aus den Energie-Einstellungen);
  die Werte werden neben dem Ladestand-Datenpunkt gefunden (z. B. wattcycle), Warnung unter 20 %; „verbunden“ versteht
  auch die Quelle eines AC-Eingangs (Victron `Ac.ActiveIn.Source`: 1 Netz, 2 Generator, 3 Landstrom, 240 nicht verbunden)
- (bluefox) Windanzeiger „Flagge“: Die Flagge ist wählbar – Deutschland, Österreich, Schweiz, Frankreich, Italien,
  Russland, Ukraine und weitere Länder (u. a. Griechenland, Großbritannien, USA, Niederlande, Skandinavien) und die EU,
  jede in ihren eigenen Proportionen (die Schweiz quadratisch); ohne Wahl bleibt die bisherige blau-weiße
- (bluefox) Glaskarten: unter „Anzeige“ drei Modi – „Karten immer“, „Karten beim Zeigen“ (am Gerät nur ein
  Leuchtpunkt, die Karte erscheint unter der Maus, ein Klick oder Tipp auf den Punkt hält sie offen) und „Ohne Karten“;
  ohne Wahl erscheinen die Karten jetzt beim Zeigen statt alle auf einmal
- (bluefox) Glaskarten: Die runden Knöpfe (Player, Geräte) bleiben rund – eine volle Zeile drückte sie zu Ovalen
  und brach die Lautstärke „15 %“ um; jetzt gibt der Regler nach, was nicht passt, kommt in die nächste Zeile
- (bluefox) Glaskarten „beim Zeigen“: Die Leuchtpunkte sitzen auf dem Gerät statt darüber zu schweben und werden
  mit der Entfernung kleiner wie die Karten (höchstens 5 px); ein unsichtbarer Ring um den Punkt fängt die Maus, auch
  bei offener Karte – sie blinkt unter der Maus nicht mehr jede Sekunde

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
