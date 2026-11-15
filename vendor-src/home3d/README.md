# Vendored frontend sources

Upstream version 3.1.2 by Mastershort, commit c11bd614d38a68d3aec251a940e31a1101b7429b.
The `src/` tree is a copy of the frontend TypeScript sources at that commit; only names were changed.
License: MIT, see LICENSE. The upstream copyright notice must be retained.

The ioBroker-specific patches are applied by `tasks.ts` during the build (`npm run build-vendor`).
Runtime fonts, translations and their licenses are tracked under `www/vendor/`.
