-- Creation-rate evidence must outlive book deletion. Otherwise an anonymous
-- caller can create and delete in a loop to reset the rolling-window limit.
CREATE TABLE IF NOT EXISTS living_book_creation_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS living_book_creation_events_created_at
ON living_book_creation_events (created_at);

-- Preserve the current window when upgrading an existing binding. The NOT
-- EXISTS guard also makes this safe if the fresh-binding bootstrap ran first.
INSERT INTO living_book_creation_events (book_id, created_at)
SELECT book.id, book.created_at
FROM living_books AS book
WHERE NOT EXISTS (
  SELECT 1
  FROM living_book_creation_events AS event
  WHERE event.book_id = book.id AND event.created_at = book.created_at
);

CREATE TRIGGER IF NOT EXISTS record_living_book_creation
AFTER INSERT ON living_books
BEGIN
  INSERT INTO living_book_creation_events (book_id, created_at)
  VALUES (NEW.id, NEW.created_at);
END;

PRAGMA optimize;
