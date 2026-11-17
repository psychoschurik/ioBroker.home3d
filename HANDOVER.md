# Übergabe ioBroker.home3d

Weiterarbeit an ioBroker.home3d auf einem anderen Rechner. Die Regeln des Projekts stehen in CLAUDE.md; hier steht,
was nicht im Code steht.

## Rechner einrichten

Node 22, das Repository und drei MCP-Server reichen; die Einstellungen von Claude Code ziehen nicht mit.

1. Node.js 22 (laut `.nvmrc`, mindestens 22.19), Git und die GitHub-CLI `gh` installieren.
2. Repository holen (privat, Zugang über GitHub) und prüfen:

    ```bash
    git clone https://github.com/psychoschurik/ioBroker.home3d.git
    cd ioBroker.home3d
    git config user.name GermanBluefox
    npm ci
    npm run build && npm run check && npm run lint && npm test
    ```

3. MCP-Server in Claude Code eintragen (sie liegen in `~/.claude.json` und ziehen nicht mit):

    ```bash
    claude mcp add -s user --transport http iobroker      http://192.168.1.129:8082/mcp/
    claude mcp add -s user --transport http iobroker-docs https://rag.iobroker.net/mcp
    claude mcp add -s user --transport http bee           https://beekeeper.one/mcp
    ```

4. Die Browser-Erweiterung Claude in Chrome installieren: Damit wird die Seite auf vitanova geprüft und der Plan geändert.
5. Beim ersten Start mit `/mcp` bei bee anmelden.

| MCP-Server | Wozu |
| --- | --- |
| iobroker | Adapter mcp auf vitanova, dem ioBroker des Boots; nur im Netz des Boots (192.168.1.x) erreichbar |
| iobroker-docs | Suche in der Doku und im Quelltext von ioBroker |
| bee | Beekeeper, die Flottenverwaltung; Zugang zu iobroker.click |

Die Erinnerungen von Claude Code (`~/.claude/projects/…/memory/`) ziehen ebenfalls nicht mit; ihr Inhalt steht unten.

## Arbeitsweise

- Antworten auf Deutsch.
- Committen und pushen nur, wenn der Benutzer es sagt. Direkt auf main; die Commit-Nachricht ist englisch und endet
  mit der Co-Authored-By-Zeile.
- Jede Änderung bekommt eine Zeile im Changelog unter `### **WORK IN PROGRESS**` in README.md, beginnend mit
  `- (bluefox) `.
- Vor jeder Installation: `npm run build`, `npm run check`, `npm run lint` (formatieren nur mit `eslint --fix`),
  `npm test`.
- `src-www/` bleibt unverändert. Patches am 3D-Frontend sind Funktionen in `tasks.ts` mit
  `replaceRequired(code, alt, neu, label)`, aufgerufen im `load`-Hook. Passt ein Patch nicht mehr, bricht der Build ab,
  und das ist gewollt.
- Neuer Code gehört nach `frontend/vendor-ext/` oder `frontend/`; React nur in `frontend/react/`, geladen mit `import()`.
- Nie alle Zustände laden, keine fremden Hosts (Ausnahme: ein Bild, dessen URL ein zugeordneter Datenpunkt liefert),
  Schreiben nur über `execute()`.
- Python-Heredocs zerstören `\n` und `\` in TS-Strings: lieber das Edit-Werkzeug nehmen oder Strings mit `json.dumps`
  erzeugen.

## Testen auf vitanova

Entwickelt wird am echten System des Boots, denn nur dort sind die Geräte:
`http://192.168.1.129:8082/home3d/index.html` (web.0, ohne Anmeldung, Instanz `home3d.0`).

Eine neue Version installieren:

1. `npm pack --pack-destination <Scratchpad-Ordner>` erzeugt `iobroker.home3d-<Version>.tgz`.
2. `mcp__iobroker__prepare_upload` mit `name` = Dateiname liefert eine Upload-URL.
3. `curl -T <tgz> "<url>"` lädt das Paket hoch.
4. `mcp__iobroker__install_package` mit `upload_id` und `host` = `vitanova` installiert es.
5. Seite im Browser neu laden (Strg+F5).

Der Plan wird nur auf vitanova bearbeitet, nie lokal. Der Benutzer ändert ihn selbst im Editor, darum vorher immer den
aktuellen Stand lesen. Von Hand geht es in der Seite mit `javascript_tool` (Claude in Chrome):

```js
function deep(root, out = []) {
    root.querySelectorAll('*').forEach(e => {
        if (e.hass && e.hass.callWS) out.push(e);
        if (e.shadowRoot) deep(e.shadowRoot, out);
    });
    return out;
}
const hass = deep(document)[0].hass;
const plan = (await hass.callWS({ type: 'home3d/plans/list' })).plans.find(p => /Dufour/.test(p.name)).id;
await hass.callWS({ type: 'home3d/history/snapshot', plan }); // Sicherung, im Editor wiederherstellbar
const { building, revision } = await hass.callWS({ type: 'home3d/building/get', plan });
// … building ändern …
await hass.callWS({ type: 'home3d/building/save', plan, building, base_revision: revision });
```

- Geräte lesen: `home3d/iobroker/mappings/get`; speichern: `home3d/iobroker/mappings/set` mit `mappings`, vorher
  `_meta` aus jedem Eintrag entfernen.
- Die `entity_id` eines Geräts ist `domain.<FNV-Hash des Datenpunkts>`. Sie bleibt gleich, wenn der Datenpunkt
  gewechselt wird (wie „Ändern …“ im Editor).
- Das Panel ist das Element mit `'_mode' in e && 'setMode' in e`; der Editor `fp3d-editor` hat `_floorId`, `_deviceId`
  und `_settingsDialog` (`'house'` öffnet die Hauseinstellungen).

## Was auf vitanova eingestellt ist

Grundriss „Dufour 460 Grand Large“, Plan-ID `32aa1d20-2d21-4a7b-8f28-67081868e790`, mit zwei Etagen: `ud` (Unterdeck,
−1,95 m) und `dk` (Deck, 0 m). Die Geräte sind vor allem `alias.0.*`-Datenpunkte, rund 50 Zuordnungen. Nichts davon
liegt im Git; es steht in `home3d.0/data.json` auf vitanova.

| Was | Wo eingestellt | Datenpunkt / Wert |
| --- | --- | --- |
| Position für den Sonnenstand | Editor → ⚙ → Haus, „Position (für den Sonnenstand)“; data.json `position_id` | `serial-gps.0.gps.position` („Länge;Breite“) |
| Kurs (dreht Sonne, Schatten, Kompassring) | Editor → ⚙ → Haus, „Kurs aus Kompass (Boot)“; `settings.north_entity` | Gerät „Kurs“ = `witmotion.0.angle.zAvg`; `settings.north = 0` |
| Sonnenbogen | „Sonnenbogen auf Höhe von“; `settings.sun_arc_floor` | `ud` (Unterdeck) |
| Akku-Ladestand | Gerät „Batterie Ladestand“ | `wattcycle.0.total.soc_min` (vorher `victron-cerbo.0.battery.278.Soc`) |
| Akku-Leistung | Energie-Einstellungen, „Vorzeichen umkehren“ an | `victron-cerbo.0.system.0.Dc.Battery.Power` |
| Wasserfilter | Schalter im Unterdeck bei x 3,28 / z 6,1 | `alias.0.Kueche.Filter.SET` |
| Fernseher | Media-Player, Lautstärke und Stumm | `volume_set` → `…volume` (scale 100), `volume_mute` → `…muted` |

Der Verlauf in den Gerätedetails kommt aus influxdb und erscheint nur, wenn der Datenpunkt selbst geloggt wird.

## iobroker.click

home3d ist auf iobroker.click noch nicht installiert, weil bee dort keine Werkzeuge zum Installieren freigibt.

- Erreichbar über Beekeeper (bee), Asset `ast_h33oKvnRrkJL` „iobroker.click“. Die KI-Sitzung darf man selbst öffnen
  (`device_open_session`) und schließt sie danach (`device_close_session`).
- bee reicht dort 38 Werkzeuge durch: Zustände, Objekte, Dateien, Logs, Skripte lesen. Paket installieren und Instanz
  anlegen fehlen.
- `device_update_adapter` installiert nur Versionen aus dem Repository oder von npm; home3d steht in keinem von beiden.
- Ein selbst angelegtes Skript als Umweg zum Installieren ist tabu: Es würde die Freigaben des Besitzers umgehen.
- Weg 1: in `bee.0` auf iobroker.click die Werkzeuge zum Installieren freigeben, dann vorgehen wie bei vitanova und die
  Instanz `home3d.0` anlegen.
- Weg 2: die .tgz im Admin unter „Adapter → Installieren aus eigener URL → Datei“ hochladen.
- Die Konfiguration von vitanova (Plan, Geräte, Position) wandert nicht mit; bei Bedarf als Projektdatei exportieren
  und importieren („Projekte“).

## Offene Punkte

- [ ] Veröffentlichen: Release mit `npm run release-minor`; die Einträge unter WORK IN PROGRESS sind gesammelt,
      `common.news` nicht von Hand ändern.
- [ ] Akku-Leistung optional auch vom Wattcycle nehmen (`wattcycle.0.total.power`); vorher das Vorzeichen prüfen, denn
      „Vorzeichen umkehren“ ist für den Victron an.
- [ ] home3d auf iobroker.click installieren (siehe oben).
