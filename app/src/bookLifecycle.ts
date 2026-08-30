import type { DocumentState } from "./types";

export const BOOK_LIBRARY_STORAGE_KEY = "apertale.library.v4";

// Keep the lock name used by previously deployed clients. An already-open old
// tab and the current bundle must serialize the same publication lifecycle.
const LIFECYCLE_LOCK_PREFIX = "apertale:publication:";
export const BOOK_LIBRARY_MUTATION_LOCK_NAME = "apertale:book-library-mutation";

export function bookLifecycleLockName(documentId: string) {
  return `${LIFECYCLE_LOCK_PREFIX}${documentId}`;
}

export function bookLifecycleLockManager() {
  return globalThis.navigator?.locks ?? null;
}

export function storedLibraryDocumentMatches(documentState: DocumentState) {
  try {
    const raw = localStorage.getItem(BOOK_LIBRARY_STORAGE_KEY);
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return false;
    const documents = (parsed as { documents?: unknown }).documents;
    if (!Array.isArray(documents)) return false;
    const stored = documents.find((document) => (
      document
      && typeof document === "object"
      && (document as { id?: unknown }).id === documentState.id
    ));
    return Boolean(stored) && JSON.stringify(stored) === JSON.stringify(documentState);
  } catch {
    return false;
  }
}
