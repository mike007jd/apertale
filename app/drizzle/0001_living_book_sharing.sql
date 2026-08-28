CREATE TABLE IF NOT EXISTS living_books (
  id TEXT PRIMARY KEY,
  manage_token_hash TEXT NOT NULL,
  share_token_hash TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'revoked', 'deleting')),
  title TEXT,
  manifest_json TEXT,
  revision INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS living_book_assets (
  book_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (book_id, asset_id),
  FOREIGN KEY (book_id) REFERENCES living_books(id) ON DELETE CASCADE
);

PRAGMA optimize;
