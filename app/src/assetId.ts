const LOCAL_ASSET_PATTERN = /^asset:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Browser-local asset ids are UUID-backed capabilities, never arbitrary URLs. */
export function isStoredAssetId(value: string) {
  return LOCAL_ASSET_PATTERN.test(value);
}
