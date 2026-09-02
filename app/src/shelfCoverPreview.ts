/** Returns a shelf-sized bundled derivative without changing the source asset identity. */
export function bundledShelfCoverPreviewUrl(assetId: string) {
  return assetId.replace(/^\/assets\/covers\/([^/]+)\.png$/, "/assets/covers/shelf/$1.webp");
}
