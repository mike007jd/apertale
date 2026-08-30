// Fresh-binding bootstrap mirrors the latest schema. Existing bindings evolve
// through the numbered migrations in drizzle; never rewrite an applied migration.
export const LIVING_BOOK_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS living_books (
    id TEXT PRIMARY KEY,
    manage_token_hash TEXT NOT NULL,
    share_token_hash TEXT UNIQUE,
    publish_attempt_token_hash TEXT,
    status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'revoked', 'deleting')),
    title TEXT,
    manifest_json TEXT,
    revision INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT,
    revoked_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS living_book_assets (
    book_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    content_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size > 0),
    created_at TEXT NOT NULL,
    PRIMARY KEY (book_id, asset_id),
    FOREIGN KEY (book_id) REFERENCES living_books(id) ON DELETE CASCADE
  )`,
  // No foreign key by design: a token tombstone must outlive book deletion.
  `CREATE TABLE IF NOT EXISTS living_book_retired_share_tokens (
    share_token_hash TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    retired_at TEXT NOT NULL
  )`,
  `CREATE TRIGGER IF NOT EXISTS retire_living_book_share_token
    AFTER UPDATE OF status ON living_books
    WHEN OLD.status = 'published'
      AND NEW.status IN ('revoked', 'deleting')
      AND OLD.share_token_hash IS NOT NULL
    BEGIN
      INSERT OR IGNORE INTO living_book_retired_share_tokens (
        share_token_hash, book_id, retired_at
      ) VALUES (
        OLD.share_token_hash, OLD.id, NEW.updated_at
      );
    END`,
];
