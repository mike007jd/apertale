# Asset provenance

## Runtime artwork

Files under `app/public/assets/generated/` were generated specifically for this Apertale prototype during its product-design sessions. They are original project outputs rather than downloaded stock art or copied third-party illustrations:

- `day-background.png` and `night-background.png` — Day/Night desk environments;
- `city-spread.png` and `river-home-spread.png` — cut-paper city story spreads;
- `moon-garden-spread.png` — night garden story spread;
- `bird-cutout.png` and `fox-cutout.png` — transparent interactive cutouts.

The release keeps the original PNGs because the target Codex in-app browser rejected otherwise valid WebP encodes during a real runtime probe. Compatibility takes precedence over a smaller package; runtime references remain local and no remote image host is involved.

The Colosseum, Great Pyramid, and volcano are repository-owned procedural Three.js geometry authored in `app/src/models/`; they do not bundle third-party 3D models or textures.

The two JPEGs under `app/public/assets/covers/` are optimized captures of the repository's own live Colosseum and volcano scenes. They replace the earlier CSS-gradient library placeholders; no third-party cover art is bundled.

## Design references

The Day and Night reference images under `docs/assets/` were supplied by the user as visual direction for this project. They remain documentation-only inputs; duplicate copies were removed from `app/public/` so they are not shipped in the runtime bundle.

## UI and fonts

- Interface icons come from `@phosphor-icons/react`, distributed under the MIT License.
- The font stack uses locally available system fonts; no font binary is redistributed.

## User imports

User-imported PNG, JPEG, and WebP files remain in that user's browser IndexedDB. Apertale does not upload or relicense them, and they are not part of the repository or production bundle.
