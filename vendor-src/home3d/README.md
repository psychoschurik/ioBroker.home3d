# Vendored frontend sources

Source: 3D Home 3.1.2, upstream commit c11bd614d38a68d3aec251a940e31a1101b7429b.
The `src/` tree is an unchanged copy of the frontend TypeScript sources at that commit.
License: MIT, see LICENSE. The upstream copyright notice must be retained.

The ioBroker-specific patches are applied by `scripts/build-frontend.mts` during the build.
Runtime fonts, translations and their licenses are tracked under `www/vendor/`.
No additional checkout is required to build this adapter.
