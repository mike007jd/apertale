ALTER TABLE living_books ADD COLUMN publish_attempt_token_hash TEXT;

-- No foreign key by design: a token tombstone must outlive book deletion.
CREATE TABLE IF NOT EXISTS living_book_retired_share_tokens (
  share_token_hash TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  retired_at TEXT NOT NULL
);

INSERT OR IGNORE INTO living_book_retired_share_tokens (
  share_token_hash, book_id, retired_at
)
SELECT share_token_hash, id, COALESCE(revoked_at, updated_at)
FROM living_books
WHERE status = 'revoked' AND share_token_hash IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS retire_living_book_share_token
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
END;

PRAGMA optimize;
