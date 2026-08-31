const BUNDLED_SHELF_COVER_PREVIEWS: Readonly<Record<string, string>> = {
  "/assets/covers/apertale-field-guide-v2.png": "/assets/covers/shelf/apertale-field-guide-v2.webp",
  "/assets/covers/atlas-of-living-wonders-v2.png": "/assets/covers/shelf/atlas-of-living-wonders-v2.webp",
  "/assets/covers/how-the-world-works-v2.png": "/assets/covers/shelf/how-the-world-works-v2.webp",
  "/assets/covers/your-story-made-alive-v2.png": "/assets/covers/shelf/your-story-made-alive-v2.webp",
  "/assets/covers/the-lantern-garden-v2.png": "/assets/covers/shelf/the-lantern-garden-v2.webp",
};

/** Returns a shelf-sized bundled derivative without changing the source asset identity. */
export function bundledShelfCoverPreviewUrl(assetId: string) {
  return BUNDLED_SHELF_COVER_PREVIEWS[assetId] ?? assetId;
}
