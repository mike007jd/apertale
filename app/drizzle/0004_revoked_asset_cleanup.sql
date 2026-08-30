-- A revoked server generation is terminal. Its remote asset copies are
-- deleted before the row itself is removed; republishing always creates a
-- fresh generation id and capability.
ALTER TABLE living_books
ADD COLUMN asset_cleanup_pending INTEGER NOT NULL DEFAULT 0
CHECK (asset_cleanup_pending IN (0, 1));

-- Older bundles revoked links without deleting their uploaded rows. Mark those
-- generations for cleanup so a rolling deployment cannot reuse their 50-slot
-- asset set as if it belonged to the next publication.
UPDATE living_books
SET asset_cleanup_pending = 1
WHERE status = 'revoked'
  AND EXISTS (
    SELECT 1
    FROM living_book_assets AS asset
    WHERE asset.book_id = living_books.id
  );

-- Server-side book ids are generation ids, not reusable names. Retaining a
-- tombstone prevents a delayed create request from resurrecting a draft after
-- its delete request has already completed.
CREATE TABLE IF NOT EXISTS living_book_deleted_ids (
  book_id TEXT PRIMARY KEY,
  manage_token_hash TEXT NOT NULL,
  deleted_at TEXT NOT NULL
);

-- Database triggers keep the invariant intact while old Worker isolates finish
-- requests after this migration and before the new bundle serves every request.
CREATE TRIGGER IF NOT EXISTS mark_living_book_revocation_cleanup
AFTER UPDATE OF status ON living_books
WHEN OLD.status = 'published' AND NEW.status = 'revoked'
BEGIN
  UPDATE living_books
  SET asset_cleanup_pending = 1
  WHERE id = NEW.id;
END;

-- These guards are database-owned so isolates running the previous Worker
-- bundle cannot reopen or add assets to a revoked generation during rollout.
CREATE TRIGGER IF NOT EXISTS prevent_revoked_living_book_publish_claim
BEFORE UPDATE OF publish_attempt_token_hash ON living_books
WHEN OLD.status = 'revoked' AND NEW.publish_attempt_token_hash IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'revoked generation is terminal');
END;

CREATE TRIGGER IF NOT EXISTS prevent_revoked_living_book_republish
BEFORE UPDATE OF status ON living_books
WHEN OLD.status = 'revoked' AND NEW.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'revoked generation is terminal');
END;

CREATE TRIGGER IF NOT EXISTS prevent_non_draft_living_book_asset_insert
BEFORE INSERT ON living_book_assets
WHEN NOT EXISTS (
  SELECT 1
  FROM living_books
  WHERE id = NEW.book_id AND status = 'draft'
)
BEGIN
  SELECT RAISE(ABORT, 'only a draft generation accepts assets');
END;

CREATE TRIGGER IF NOT EXISTS prevent_deleted_living_book_recreation
BEFORE INSERT ON living_books
WHEN EXISTS (
  SELECT 1
  FROM living_book_deleted_ids
  WHERE book_id = NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'deleted generation id is terminal');
END;

CREATE TRIGGER IF NOT EXISTS tombstone_deleted_living_book
BEFORE DELETE ON living_books
WHEN OLD.status = 'deleting'
BEGIN
  INSERT OR IGNORE INTO living_book_deleted_ids (
    book_id, manage_token_hash, deleted_at
  ) VALUES (
    OLD.id, OLD.manage_token_hash, OLD.updated_at
  );
END;

PRAGMA optimize;
