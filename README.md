# ioBroker 3D Home

Eigenständiger ioBroker-Adapter **`iobroker.3d-home`**, Instanz **`3d-home.0`**. Auf Basis des 3D Home-3D-Frontends (3.1.2), mit angepasster Oberfläche und eigenem Node.js-Backend. Community-Portierung, keine offizielle Veröffentlichung von Mastershort.

**Stand: 0.4.0, experimentell.** Der umbenannte Adapter wird lokal als installierbares Paket gebaut und getestet. Die vorherige Version 0.2.0 läuft unter dem separaten Namen `home3d` auf dem bestehenden ioBroker-Host. Die Umbenennung migriert keine laufende Instanz automatisch.

## Adapterprojekt

- Paket: `iobroker.3d-home`
- Instanz: `3d-home.0` (weitere Instanzen mit eigenem Port möglich)
- TypeScript-Einstiegspunkt: `src/main.ts`; kompiliert nach `build/main.js`, einschließlich Compact-Mode-Unterstützung
- Admin-Konfiguration: `admin/jsonConfig.json`
- Oberfläche und fertige Browser-Bundles: `www/`
- Projekt: [psychoschurik/ioBroker.3d-home](https://github.com/psychoschurik/ioBroker.3d-home)
- Lokaler Entwicklungsordner: `E:\iobroker\ioBroker.3d-home`

## Wechsel von home3d

`3d-home` ist ein **anderer Adaptername**, kein direktes Update von `home3d`. Die vorhandene Serverinstallation bleibt unverändert, bis der neue Adapter ausdrücklich eingerichtet wird.

Vor einem Wechsel den JSON-Inhalt von `home3d.0.storage` sichern. Er enthält Grundrisse, Bilder, Snapshots und Gerätezuordnungen. Nach dem Anlegen der neuen, noch gestoppten Instanz kann dieser Inhalt unverändert in `3d-home.0.storage` übernommen werden. Das reine Grundriss-Backup aus der Oberfläche ersetzt diese vollständige Sicherung nicht, da es keine ioBroker-Gerätezuordnungen enthält.

Port und denselben bekannten Zugangsschlüssel in der neuen Instanz einstellen. Verschlüsselte `native.accessToken`-Werte nicht von Hand bearbeiten. Bei identischem Port zuerst die alte Instanz stoppen, dann die neue starten; beide Server können denselben Port nicht gleichzeitig belegen. Vorhandene Demo-Datenpunkte und logische Geräte-IDs bleiben gültig. Das interne Frontend-Protokoll behält aus Kompatibilitätsgründen die alten `home3d/...`-Bezeichner bei.

## TypeScript-Entwicklung (0.4.0)

Der eigene Programmcode wird in TypeScript gepflegt:

- `src/`: Adapter, HTTP-Server, Speicherung und Gerätezuordnung.
- `frontend/`: Browser-Anbindung, Geräteauswahl und Objektbaum.
- `scripts/`: Build, Import der Fremdbibliotheken und Demo-Werkzeuge.
- `test/`: Funktionstests mit Node Test Runner und tsx.

`npm run check` prüft alle eigenen TypeScript-Dateien mit strenger Typprüfung. Protokollfelder des erweiterbaren Grundrissformats bleiben bewusst dynamisch; Planstruktur, Speicher, Geräteaktionen und ioBroker-Zugriff sind typisiert.

`npm run build` kompiliert den Adapter nach `build/` und die Browser-Anbindung nach `www/`. Diese JavaScript-Ausgaben nicht von Hand bearbeiten. `npm pack` prüft und baut automatisch vor dem Verpacken. Auf dem ioBroker-Host werden nur Node.js und die Laufzeitabhängigkeiten benötigt, kein TypeScript-Compiler. HTML, CSS, SVG und JSON bleiben in ihren jeweiligen Formaten.

Die bereits gebauten Fremdbibliotheken in `www/vendor/` werden weiter ausgeliefert. Die vollständigen TypeScript-Quellen dieser Bundles sind unter `vendor-src/home3d/src` enthalten. `npm run build:frontend` baut diese Bundles neu.

Demo-Werkzeuge: `npm run demo:house` erstellt die Hausdatei, `npm run demo:preview` startet deren Vorschau auf Port 8098. `npm run start:demo` startet die persistente lokale Demo auf Port 8097.

## Neu in 0.2.0

- ioBroker-orientiertes blau-graues Design, kompaktere Bedienelemente und eigene SVG-Grafiken für Haus, Anmeldung und Objektbaum.
- Entwickler-, Community- und Shoplinks aus dem ausgelieferten Frontend entfernt. Die Hilfe liegt lokal unter `/help.html`. Lizenz- und Herkunftsnachweise bleiben in Paketdateien erhalten.
- Geräteauswahl über einen Objektbaum nach dem ioBroker-Prinzip: Adapter → Instanz → Gerät/Kanal → Datenpunkt. Suche nach ID/Name, Filter für Rolle und Raum, Anzeige von Typ und Wert. Es handelt sich um eine eigene Implementierung, nicht die unveränderte Admin-Komponente.
- Derselbe Dialog ersetzt die bisherigen Suchlisten für Sensoren und Geräte im Editor. Bereits verbundene Geräte bleiben erhalten; zusätzliche Geräte lassen sich ohne JSON auswählen.
- Kein Ändern vorhandener Grundrisse, IDs, Ports oder Zugangsschlüssel durch dieses Update.

Für spätere Updates desselben Adapternamens das neue Paket installieren, `iobroker upload 3d-home` und `iobroker restart 3d-home.0` ausführen; die vorhandene Instanz nicht löschen oder erneut anlegen. Danach die Browserseite vollständig neu laden.

## Enthalten

- Originaler 2D-Grundrisseditor und Three.js-3D-Ansicht einschließlich Möbeln, Etagen, Dach-/Außenflächen und Darstellungsstilen.
- Mehrere Grundrisse: erstellen, kopieren, umbenennen, sortieren, in den Papierkorb legen und wiederherstellen.
- Speicherung in `3d-home.0.storage`, Revisionsprüfung gegen konkurrierende Änderungen, bis zu 30 manuelle Wiederherstellungspunkte je Grundriss.
- Import/Export des ursprünglichen Grundrissformats und Bildspeicher. Der Adapter speichert unbekannte Modellfelder unverändert.
- ioBroker-Räume über `enum.rooms.*`; Gerätesuche und auswählbare Zuordnungen. Keine automatische Freigabe aller Datenpunkte.
- Laufende Zustandsübernahme vom Adapter; Browser aktualisiert ausgewählte Geräte alle zwei Sekunden.
- Explizite, typ- und bereichsgeprüfte Schreibaktionen mit `ack: false`. Schalter werden automatisch vorgeschlagen. Komplexe Geräte werden über Attribute und Aktionen zugeordnet.
- Eigene passwortgeschützte Oberfläche, Tablet-/Kartenansicht und Einbettung per iframe.

## Noch offen

- Reale ioBroker-Installation, Upgrade-Verhalten und Tests mit den konkreten Geräteadaptern.
- Vollständiger Geräteassistent für Dimmer/RGB, Beschattung, Heizung, Medien und Kameras; derzeit erfolgt die erweiterte Zuordnung als JSON.
- Home-Assistant-spezifische Sprachpipelines, Ortung, Recorder-/Statistikabfragen und Zeitreise.
- Shop-Anbindung, signierte Möbel-/Pro-Pakete, Erweiterungsmodule und deren Lizenzprüfung. Diese werden nicht freigeschaltet oder durch leere Erfolgsantworten simuliert. Einzelne nicht unterstützte Optionen sind noch sichtbar und verweisen auf die lokale Hilfe.
- Automatisches Löschen des Papierkorbs nach 30 Tagen und automatische Sicherungspunkte. Der Papierkorb bleibt hier bis auf Weiteres erhalten.
- Eigene Benutzerrollen/ACL-Abbildung: Der Zugangsschlüssel gibt Zugriff auf Editor und alle explizit zugeordneten Aktionen.
- Home-Assistant-spezifische Karten-/Kamera-Dialoge sowie vollständige Material-Icons. `ha-icon` hat derzeit lokale Ersatzsymbole.

## Lokal ausprobieren

Node.js 22 oder neuer:

```powershell
npm ci
npm run check
npm run build
npm test
npm run start:demo
```

`http://127.0.0.1:8097` öffnen. Demo-Schlüssel: `home3d-demo-local`.
Die Demo bindet nur an localhost, verwendet ausschließlich simulierte Geräte und speichert in `.demo-data/data.json`. `HOME3D_DEMO_TOKEN` überschreibt den Demo-Schlüssel. Der echte Adapter hat keinen Standardschlüssel und startet erst nach dessen Konfiguration.

## ioBroker-Installation

Das Paket `iobroker.3d-home-0.4.0.tgz` auf den ioBroker-Host kopieren. Im ioBroker-Verzeichnis:

```sh
npm install /absoluter/pfad/iobroker.3d-home-0.4.0.tgz
iobroker upload 3d-home
iobroker add 3d-home
```

Dann in Admin die zunächst deaktivierte Instanz konfigurieren: Port (Standard 8097), Bind-Adresse und einen individuellen Zugangsschlüssel mit mindestens 16 Zeichen. Speichern und die Instanz aktivieren. Anschließend `http://IOBROKER-IP:8097` öffnen. Das Paket benötigt beim Installieren Zugriff auf npm für `@iobroker/adapter-core`.

Der integrierte Server verwendet HTTP. Für Zugriff außerhalb eines vertrauenswürdigen Heimnetzes einen HTTPS-Reverse-Proxy verwenden; den Port nicht direkt im Internet freigeben. In einer HTTPS-VIS-Seite muss auch das iframe über HTTPS erreichbar sein. Sitzungen laufen nach 24 Stunden ab und werden bei Neustart verworfen.

Unter **Geräte verbinden** den Objektbaum aufklappen oder suchen, die gewünschten Datenpunkte markieren und **Übernehmen** drücken. Rollen- und Raumfilter grenzen die Liste ein. Dann Räume im Editor ihren ioBroker-Räumen zuordnen und Geräte platzieren. Unter **Verbundene Geräte** lassen sich Zuordnungen entfernen; **Abbrechen** verwirft Änderungen.

## VIS-2 / Tablet

Ein HTML-/iframe-Widget auf diese URL setzen:

```html
<iframe src="http://IOBROKER-IP:8097/?view=card"
        style="width:100%;height:100%;border:0" allowfullscreen></iframe>
```

Optional `&plan=PLAN_ID` und `&template=VORLAGEN_ID`. Einbettung und Anmeldung sollten denselben Hostnamen wie VIS verwenden, damit SameSite-Cookies funktionieren. Es ist eine Einbettung der eigenen Oberfläche, kein natives VIS-2-Widgetpaket.

## Erweiterte Zuordnung

`entity_id` ist eine stabile logische ID für den Editor, kein Home-Assistant-Server. `state` bezeichnet den echten ioBroker-Datenpunkt. IDs beim Bearbeiten beibehalten, damit vorhandene Platzierungen erhalten bleiben.

Dimmer mit boolean Ein/Aus und Helligkeit 0–100:

```json
[
  {
    "entity_id": "light.wohnzimmer",
    "name": "Wohnzimmer Decke",
    "area_id": "enum.rooms.wohnzimmer",
    "state": "alias.0.Wohnzimmer.Licht.STATE",
    "attributes": {
      "brightness": { "id": "alias.0.Wohnzimmer.Licht.LEVEL", "scale": 2.55 },
      "supported_color_modes": ["brightness"],
      "color_mode": "brightness"
    },
    "actions": {
      "turn_on": [
        { "id": "alias.0.Wohnzimmer.Licht.STATE", "value": true },
        { "id": "alias.0.Wohnzimmer.Licht.LEVEL", "field": "brightness", "scale": 0.39215686274509803, "optional": true }
      ],
      "turn_off": [{ "id": "alias.0.Wohnzimmer.Licht.STATE", "value": false }],
      "toggle": [{ "id": "alias.0.Wohnzimmer.Licht.STATE", "toggle": true }]
    }
  }
]
```

Für Rollläden werden `attributes.current_position` (0 = geschlossen, 100 = offen), `supported_features` und Aktionen `open_cover`, `close_cover`, `stop_cover`, `set_cover_position` mit `field: "position"` benötigt. ioBroker-Level und Laufrichtung müssen zum konkreten Gerät passen. `scale` und `offset` rechnen numerische Werte um, `map` übersetzt diskrete Werte, etwa `{"0":"closed","100":"open"}`. Fehlende Aktionen melden einen Fehler und schreiben nichts.

Thermostate verwenden beispielsweise `attributes.temperature`, `current_temperature`, `hvac_modes` und `set_temperature` mit `field: "temperature"`. Mediaplayer verwenden die tatsächlich angebotenen Aktionen, etwa `media_play`, `media_pause`, `volume_set` mit `field: "volume_level"`. Diese Zuordnungen sind gerätespezifisch und noch nicht live validiert.

Bei Gruppen werden sämtliche Parameter vor dem ersten Schreibzugriff validiert. Ein Fehler des Zieladapters während mehrerer Schreibvorgänge kann dennoch zu teilweise ausgeführten Befehlen führen; physische Gerätebefehle sind nicht transaktional.

## Entwicklung und Nachweise

```sh
npm run check
npm test
npm pack
```

14 Tests prüfen Speicherung und Gerätebefehle, HTTP-Authentifizierung/Origin-Prüfung sowie Objektbaum-Hierarchie, kombinierte Filter, vollständige Suchergebnisse, maskierte Geheimnisvorschauen und das Entfernen der ursprünglichen Entwicklerlinks. Browserprüfung: Anmeldung, Editor/3D, Rollenfilter und Übernahme eines Temperatursensors aus dem neuen Objektbaum in die Raumkonfiguration.

Alle Build-Eingaben liegen im Repository: eigener TypeScript-Code, fixierte Fremdquellen unter `vendor-src/home3d/src`, Browser-Assets und `package-lock.json`. Herkunft und Commit stehen in `NOTICE` und `lib/upstream.json`. Es ist kein zusätzlicher Checkout nötig. Git, Node.js ab 22, npm und `tar` für den Pakettest werden benötigt.

Vollständiger Build aus einem frischen Checkout:

```sh
git clone https://github.com/psychoschurik/ioBroker.3d-home.git
cd ioBroker.3d-home
npm ci
npm run check
npm run build:all
npm test
npm run test:package
```

`npm run build:all` baut die 3D-Bundles und den Adapter. `npm run test:package` erstellt das installierbare TGZ und prüft den kompilierten Server aus dem entpackten Paket. `npm pack` führt ebenfalls Typprüfung und vollständigen Build aus. npm lädt Abhängigkeiten anhand der Lockdatei; `node_modules`, lokale Hausdaten, Caches und erzeugte Pakete gehören nicht ins Git-Repository.

GitHub Actions führt die Prüfungen unter Node.js 22 und 24 aus und stellt das TGZ als Build-Artefakt bereit. Für die Demo-Haus-Vorschau zuerst `npm run demo:house`, dann `npm run demo:preview` ausführen.

Lizenz: MIT; der Copyright-Vermerk von Mastershort bleibt erhalten. Schriftlizenzen liegen neben den Schriftdateien. Gekaufte Erweiterungspakete sind nicht enthalten.


