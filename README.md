![Logo](admin/home3d.svg)

# ioBroker.home3d

3D floor plan editor and live visualization for ioBroker. The interface runs entirely in the **web adapter**, like
vis-2: no server of its own, no port of its own, no access key of its own.

## Usage

After the installation:

|                                                  | Address                                            |
|--------------------------------------------------|----------------------------------------------------|
| Interface (3D view and editor)                   | `http://<server>:8082/home3d/index.html`           |
| Kiosk (wall tablet, without the bars at the top) | `http://<server>:8082/home3d/index.html?kiosk`     |
| Only the 3D card (as an iframe in vis)           | `http://<server>:8082/home3d/index.html?view=card` |
| Another project (see below)                      | `http://<server>:8082/home3d/index.html?project=<id>` |

The first two addresses are also linked in the **Instances** tab. The instance has no settings.

**Projects**: like vis-2, there can be several projects (a house and a boat, say), each with its own floor plans,
pictures, 3D models, restore points, devices and settings. In the editor, **Projects** opens, creates, renames,
duplicates, deletes, exports and imports them. `?project=<id>` combines with the other parameters
(`?kiosk&project=boat`, `?view=card&project=boat`); without it, the default project opens.

1. **Connect devices** opens the ioBroker object tree. Select datapoints and apply them.
2. In the **Editor**, create floors, rooms, doors and furniture and assign them to the ioBroker rooms
   (`enum.rooms.*`).
3. In the **3D view**, open rooms and control devices.

### How the data flows

- **Login and permissions** come from the web adapter. If authentication is enabled there, you log in on the login
  page of web.
- **Values** are subscribed with `subscribeState`, and only for the datapoints assigned to devices. Changes arrive
  at once as a push, not by polling.
- **Objects** are read only for the assigned datapoints. The complete object tree is loaded only when the dialog
  "Connect devices" is opened, and values there only for the visible rows.
- **Switching** writes with `ack: false` directly over the socket. Type, range (`min`/`max`) and write permission are
  checked first.
- **Saving**: floor plans, restore points, images and device assignments are stored as files in the ioBroker file
  storage of the instance `home3d.0`, each project in its folder `home3d.0/<id>/` (the default project in
  `home3d.0/default/`):
  - `data.json`: floor plans, assignments, order
  - `history/<plan>.json`: up to 30 restore points per floor plan
  - `images/<image>.<png|jpg|webp|gif>`: background images
  - `models/<model>.<glb|gltf|obj|stl>`: own 3D models
  - exported files (floor plans, projects) go to `home3d.0/exports/`
- Several browsers at the same time: changes to `data.json` are reported to all open pages with `subscribeFiles`.
  Saving over an outdated state is refused with "Saved elsewhere in the meantime".

### Permissions

The logged-in user needs read permission on the objects and states of the assigned datapoints, write permission on
the states to switch them, and write permission on files to save floor plans.

## Changelog

<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->
### **WORK IN PROGRESS**

- (bluefox) Mehrere Projekte wie in vis-2 (z. B. Haus und Boot), jedes mit eigenen Grundrissen, Bildern, 3D-Modellen, Geräten und Einstellungen: im Editor unter „Projekte“ öffnen, anlegen, umbenennen, duplizieren, löschen, als Datei exportieren und als neues Projekt importieren; geöffnet über `index.html?project=<id>` (auch mit `?kiosk` und `?view=card`); die Dateien jedes Projekts liegen in `home3d.0/<id>/`, die des Standardprojekts in `home3d.0/default/`

### 0.5.0 (2026-11-25)

- (bluefox) Leuchten: „Gerätetyp“ und „Datenpunkte des Geräts“ (Schalter, Dimmer, Farbe, Weißton) jetzt auch direkt bei der Leuchte unter „Licht oder Schalter“, nicht nur beim platzierten Gerät
- (bluefox) Verlaufsdiagramm im Detail-Dialog: Der Tooltip bleibt am Rand innerhalb des Diagramms, es erscheint keine Scrollleiste mehr
- (bluefox) Neues Möbel „Wandbild“ (Holzrahmen oder digitaler Bilderrahmen) unter Deko: ein bestimmtes Bild („Immer (ohne Gerät)“) oder ein Album des Adapters Screensaver als Diashow; Bildschirme (auch der Fernseher, Regel „off“) zeigen ebenfalls ein Album oder ein Bild aus einem Datenpunkt (URL, Pfad oder Base64)

## License

MIT License. The 3D frontend comes from an MIT-licensed project by Mastershort and was adapted for ioBroker, see
[NOTICE](NOTICE) and [LICENSE](LICENSE).

Copyright (c) 2026 Denis Haev <dogafox@gmail.com>

Copyright (c) 2026 Mastershort
