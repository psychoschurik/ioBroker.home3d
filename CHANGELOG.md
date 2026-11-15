# Changelog

## 0.4.0 (2026-11-15)

- Eigenen Adapter-, Browser-, Skript- und Testcode auf TypeScript umgestellt.
- Typisierte Datenmodelle und getrennte Compilerkonfigurationen für Server, Browser und Werkzeuge.
- Automatischer Build vor dem Verpacken; Laufzeiteinstiegspunkt `build/main.js`.
- Grundrissformat, Geräte-IDs und Zugangskonfiguration bleiben kompatibel.

## 0.3.0 (2026-11-15)

- Standalone adapter identity: `iobroker.3d-home`, instance namespace `3d-home.0`.
- Project moved to the `ioBroker.3d-home` repository, with package metadata, installation and migration instructions.
- Keeps the existing ioBroker-themed editor, object-tree selector, 3D viewer and backup format.
- Excludes storage states of both old and new adapter names from device discovery.

## 0.2.0 (2026-11-13)

- ioBroker theme, custom SVG illustrations and local help.
- Object-tree selection with role/room filtering, including editor integration.
- Original developer/shop navigation removed from the application; license notices retained.

## 0.1.0 (2026-11-13)

- Initial ioBroker backend, original editor/viewer, plan storage and device mappings.
