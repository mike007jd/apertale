// Fresh-binding bootstrap mirrors the latest schema. Existing bindings evolve
// through the numbered migrations in drizzle; never rewrite an applied migration.
export const LIVING_BOOK_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS living_books (
    id TEXT PRIMARY KEY,
    manage_token_hash TEXT NOT NULL,
    share_token_hash TEXT UNIQUE,
    publish_attempt_token_hash TEXT,
    status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'revoked', 'deleting')),
    asset_cleanup_pending INTEGER NOT NULL DEFAULT 0 CHECK (asset_cleanup_pending IN (0, 1)),
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
  // No foreign key by design: creation-rate evidence must survive deletion.
  `CREATE TABLE IF NOT EXISTS living_book_creation_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  // A server book id is a single-use generation. This tombstone makes delayed
  // create requests harmless after deletion and outlives the deleted row.
  `CREATE TABLE IF NOT EXISTS living_book_deleted_ids (
    book_id TEXT PRIMARY KEY,
    manage_token_hash TEXT NOT NULL,
    deleted_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS living_book_creation_events_created_at
    ON living_book_creation_events (created_at)`,
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
  `CREATE TRIGGER IF NOT EXISTS mark_living_book_revocation_cleanup
    AFTER UPDATE OF status ON living_books
    WHEN OLD.status = 'published' AND NEW.status = 'revoked'
    BEGIN
      UPDATE living_books
      SET asset_cleanup_pending = 1
      WHERE id = NEW.id;
    END`,
  // Database-owned rollout guards keep previous Worker isolates from reopening
  // or adding assets to a revoked generation after this schema is installed.
  `CREATE TRIGGER IF NOT EXISTS prevent_revoked_living_book_publish_claim
    BEFORE UPDATE OF publish_attempt_token_hash ON living_books
    WHEN OLD.status = 'revoked' AND NEW.publish_attempt_token_hash IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'revoked generation is terminal');
    END`,
  `CREATE TRIGGER IF NOT EXISTS prevent_revoked_living_book_republish
    BEFORE UPDATE OF status ON living_books
    WHEN OLD.status = 'revoked' AND NEW.status = 'published'
    BEGIN
      SELECT RAISE(ABORT, 'revoked generation is terminal');
    END`,
  `CREATE TRIGGER IF NOT EXISTS prevent_non_draft_living_book_asset_insert
    BEFORE INSERT ON living_book_assets
    WHEN NOT EXISTS (
      SELECT 1
      FROM living_books
      WHERE id = NEW.book_id AND status = 'draft'
    )
    BEGIN
      SELECT RAISE(ABORT, 'only a draft generation accepts assets');
    END`,
  `CREATE TRIGGER IF NOT EXISTS prevent_deleted_living_book_recreation
    BEFORE INSERT ON living_books
    WHEN EXISTS (
      SELECT 1
      FROM living_book_deleted_ids
      WHERE book_id = NEW.id
    )
    BEGIN
      SELECT RAISE(ABORT, 'deleted generation id is terminal');
    END`,
  `CREATE TRIGGER IF NOT EXISTS tombstone_deleted_living_book
    BEFORE DELETE ON living_books
    WHEN OLD.status = 'deleting'
    BEGIN
      INSERT OR IGNORE INTO living_book_deleted_ids (
        book_id, manage_token_hash, deleted_at
      ) VALUES (
        OLD.id, OLD.manage_token_hash, OLD.updated_at
      );
    END`,
  `CREATE TRIGGER IF NOT EXISTS record_living_book_creation
    AFTER INSERT ON living_books
    BEGIN
      INSERT INTO living_book_creation_events (book_id, created_at)
      VALUES (NEW.id, NEW.created_at);
    END`,
];
