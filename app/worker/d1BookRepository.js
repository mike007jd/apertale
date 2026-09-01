import { LIVING_BOOK_SCHEMA_STATEMENTS } from "./bookShareSchema.js";

const schemaPromises = new WeakMap();

function changes(result) {
  return Number(result?.meta?.changes ?? 0);
}

export class D1BookRepository {
  constructor(db) {
    this.db = db;
  }

  async ensureSchema() {
    let pending = schemaPromises.get(this.db);
    if (!pending) {
      pending = this.db.batch(LIVING_BOOK_SCHEMA_STATEMENTS.map((statement) => this.db.prepare(statement)));
      schemaPromises.set(this.db, pending);
      pending.catch(() => schemaPromises.delete(this.db));
    }
    await pending;
  }

  async createBook({
    id,
    manageTokenHash,
    now,
    maxSiteBooks = Number.MAX_SAFE_INTEGER,
    maxBooksPerWindow = Number.MAX_SAFE_INTEGER,
    windowStart = "",
  }) {
    await this.ensureSchema();
    const result = await this.db.prepare(`INSERT INTO living_books (
      id, manage_token_hash, status, created_at, updated_at
    ) SELECT ?, ?, 'draft', ?, ?
      WHERE NOT EXISTS (
          SELECT 1 FROM living_book_deleted_ids WHERE book_id = ?
        )
        AND (SELECT COUNT(*) FROM living_books) < ?
        AND (
          SELECT COUNT(*) FROM living_book_creation_events
          WHERE created_at >= ?
        ) < ?
    ON CONFLICT(id) DO NOTHING`).bind(
      id,
      manageTokenHash,
      now,
      now,
      id,
      maxSiteBooks,
      windowStart,
      maxBooksPerWindow,
    ).run();
    if (changes(result) > 0) return "created";
    const existing = await this.findBook(id);
    if (existing) return existing.manage_token_hash === manageTokenHash ? "existing" : "conflict";
    const deleted = await this.findDeletedBook(id);
    if (deleted) return deleted.manage_token_hash === manageTokenHash ? "deleted" : "conflict";
    if (await this.countBooks() >= maxSiteBooks) return "site_limit";
    if (await this.countBooksCreatedSince(windowStart) >= maxBooksPerWindow) return "rate_limit";
    return "conflict";
  }

  async findBook(id) {
    await this.ensureSchema();
    return this.db.prepare(`SELECT id, manage_token_hash, status
      FROM living_books
      WHERE id = ?`).bind(id).first();
  }

  async findManagedBook(id, manageTokenHash) {
    await this.ensureSchema();
    return this.db.prepare(`SELECT id, status, title, revision, share_token_hash,
        publish_attempt_token_hash, asset_cleanup_pending, revoked_at
      FROM living_books
      WHERE id = ? AND manage_token_hash = ?`).bind(id, manageTokenHash).first();
  }

  async findDeletedBook(id) {
    await this.ensureSchema();
    return this.db.prepare(`SELECT manage_token_hash, deleted_at
      FROM living_book_deleted_ids
      WHERE book_id = ?`).bind(id).first();
  }

  async claimPublishAttempt({ id, manageTokenHash, shareTokenHash, now }) {
    await this.ensureSchema();
    const result = await this.db.prepare(`UPDATE living_books SET
      publish_attempt_token_hash = ?,
      updated_at = ?
    WHERE id = ?
      AND manage_token_hash = ?
      AND status = 'draft'
      AND asset_cleanup_pending = 0
      AND NOT EXISTS (
        SELECT 1 FROM living_book_retired_share_tokens
        WHERE share_token_hash = ?
      )
      AND (
        publish_attempt_token_hash = ?
        OR publish_attempt_token_hash IS NULL
        OR EXISTS (
          SELECT 1 FROM living_book_retired_share_tokens
          WHERE share_token_hash = living_books.publish_attempt_token_hash
        )
      )`).bind(
      shareTokenHash,
      now,
      id,
      manageTokenHash,
      shareTokenHash,
      shareTokenHash,
    ).run();
    return changes(result) === 1;
  }

  async isRetiredShareToken(shareTokenHash) {
    await this.ensureSchema();
    const row = await this.db.prepare(`SELECT 1 AS retired
      FROM living_book_retired_share_tokens
      WHERE share_token_hash = ?`).bind(shareTokenHash).first();
    return row?.retired === 1;
  }

  async isRetiredShareTokenForBook(shareTokenHash, bookId) {
    await this.ensureSchema();
    const row = await this.db.prepare(`SELECT 1 AS retired
      FROM living_book_retired_share_tokens
      WHERE share_token_hash = ? AND book_id = ?`).bind(shareTokenHash, bookId).first();
    return row?.retired === 1;
  }

  async insertAsset({
    bookId,
    manageTokenHash,
    assetId,
    objectKey,
    contentType,
    byteSize,
    now,
    maxAssets = Number.MAX_SAFE_INTEGER,
  }) {
    await this.ensureSchema();
    const result = await this.db.prepare(`INSERT OR IGNORE INTO living_book_assets (
      book_id, asset_id, object_key, content_type, byte_size, created_at
    ) SELECT ?, ?, ?, ?, ?, ?
      FROM living_books
      WHERE id = ?
        AND manage_token_hash = ?
        AND status = 'draft'
        AND asset_cleanup_pending = 0
        AND (
          SELECT COUNT(*) FROM living_book_assets
          WHERE book_id = ?
        ) < ?`).bind(
      bookId,
      assetId,
      objectKey,
      contentType,
      byteSize,
      now,
      bookId,
      manageTokenHash,
      bookId,
      maxAssets,
    ).run();
    return changes(result) === 1;
  }

  async listAssetIds(bookId) {
    await this.ensureSchema();
    const result = await this.db.prepare(`SELECT asset_id
      FROM living_book_assets
      WHERE book_id = ?`).bind(bookId).all();
    return result.results.map((row) => row.asset_id);
  }

  async countBooks() {
    await this.ensureSchema();
    const row = await this.db.prepare(`SELECT COUNT(*) AS count FROM living_books`).first();
    return Number(row?.count ?? 0);
  }

  async countBooksCreatedSince(isoTimestamp) {
    await this.ensureSchema();
    const row = await this.db.prepare(`SELECT COUNT(*) AS count
      FROM living_book_creation_events
      WHERE created_at >= ?`).bind(isoTimestamp).first();
    return Number(row?.count ?? 0);
  }

  async publishBook({ id, manageTokenHash, shareTokenHash, title, revision, manifestJson, now }) {
    await this.ensureSchema();
    const result = await this.db.prepare(`UPDATE living_books SET
      share_token_hash = ?,
      publish_attempt_token_hash = NULL,
      status = 'published',
      title = ?,
      revision = ?,
      manifest_json = ?,
      published_at = ?,
      revoked_at = NULL,
      updated_at = ?
    WHERE id = ?
      AND manage_token_hash = ?
      AND status = 'draft'
      AND asset_cleanup_pending = 0
      AND publish_attempt_token_hash = ?
      AND NOT EXISTS (
        SELECT 1 FROM living_book_retired_share_tokens
        WHERE share_token_hash = ?
      )`).bind(
      shareTokenHash,
      title,
      revision,
      manifestJson,
      now,
      now,
      id,
      manageTokenHash,
      shareTokenHash,
      shareTokenHash,
    ).run();
    if (changes(result) === 1) return revision;
    if (!Number.isSafeInteger(revision) || typeof shareTokenHash !== "string") return false;
    const existing = await this.db.prepare(`SELECT revision
      FROM living_books
      WHERE id = ?
        AND manage_token_hash = ?
        AND status = 'published'
        AND share_token_hash = ?`).bind(id, manageTokenHash, shareTokenHash).first();
    return Number.isSafeInteger(existing?.revision) ? existing.revision : false;
  }

  async findPublishedBook(shareTokenHash) {
    await this.ensureSchema();
    return this.db.prepare(`SELECT id, title, revision, manifest_json, published_at
      FROM living_books
      WHERE share_token_hash = ? AND status = 'published'`).bind(shareTokenHash).first();
  }

  async findPublishedAsset(shareTokenHash, assetId) {
    await this.ensureSchema();
    return this.db.prepare(`SELECT asset.object_key, asset.content_type, asset.byte_size, book.manifest_json
      FROM living_book_assets AS asset
      INNER JOIN living_books AS book ON book.id = asset.book_id
      WHERE book.share_token_hash = ?
        AND book.status = 'published'
        AND asset.asset_id = ?`).bind(shareTokenHash, assetId).first();
  }

  async revokeBook({ id, manageTokenHash, shareTokenHash, now }) {
    await this.ensureSchema();
    const result = await this.db.prepare(`UPDATE living_books SET
      publish_attempt_token_hash = NULL,
      status = 'revoked',
      asset_cleanup_pending = 1,
      revoked_at = ?,
      updated_at = ?
    WHERE id = ?
      AND manage_token_hash = ?
      AND share_token_hash = ?
      AND (
        status = 'published'
        OR (status = 'revoked' AND asset_cleanup_pending = 1)
      )`).bind(
      now,
      now,
      id,
      manageTokenHash,
      shareTokenHash,
    ).run();
    return changes(result) > 0;
  }

  async completeRevocation({ id, manageTokenHash, shareTokenHash, now }) {
    await this.ensureSchema();
    await this.db.prepare(`DELETE FROM living_book_assets
      WHERE book_id = ?
        AND EXISTS (
          SELECT 1 FROM living_books
          WHERE id = ?
            AND manage_token_hash = ?
            AND share_token_hash = ?
            AND status = 'revoked'
            AND asset_cleanup_pending = 1
        )`).bind(id, id, manageTokenHash, shareTokenHash).run();
    const result = await this.db.prepare(`UPDATE living_books SET
      asset_cleanup_pending = 0,
      updated_at = ?
    WHERE id = ?
      AND manage_token_hash = ?
      AND share_token_hash = ?
      AND status = 'revoked'
      AND asset_cleanup_pending = 1`).bind(now, id, manageTokenHash, shareTokenHash).run();
    if (changes(result) === 1) return true;
    const existing = await this.findManagedBook(id, manageTokenHash);
    return existing?.status === "revoked"
      && existing.share_token_hash === shareTokenHash
      && Number(existing.asset_cleanup_pending) === 0;
  }

  async markDeleting({ id, manageTokenHash, now }) {
    await this.ensureSchema();
    const result = await this.db.prepare(`UPDATE living_books SET
      share_token_hash = NULL,
      publish_attempt_token_hash = NULL,
      status = 'deleting',
      updated_at = ?
    WHERE id = ?
      AND manage_token_hash = ?
      AND status IN ('draft', 'published', 'revoked', 'deleting')`).bind(now, id, manageTokenHash).run();
    return changes(result) > 0;
  }

  async listAssetsForRevocation({ id, manageTokenHash, shareTokenHash }) {
    await this.ensureSchema();
    const result = await this.db.prepare(`SELECT asset.asset_id, asset.object_key, asset.content_type, asset.byte_size
      FROM living_book_assets AS asset
      INNER JOIN living_books AS book ON book.id = asset.book_id
      WHERE book.id = ?
        AND book.manage_token_hash = ?
        AND book.share_token_hash = ?
        AND book.status = 'revoked'
        AND book.asset_cleanup_pending = 1`).bind(id, manageTokenHash, shareTokenHash).all();
    return result.results;
  }

  async listAssetsForDeletion({ id, manageTokenHash }) {
    await this.ensureSchema();
    const result = await this.db.prepare(`SELECT asset.asset_id, asset.object_key, asset.content_type, asset.byte_size
      FROM living_book_assets AS asset
      INNER JOIN living_books AS book ON book.id = asset.book_id
      WHERE book.id = ?
        AND book.manage_token_hash = ?
        AND book.status = 'deleting'`).bind(id, manageTokenHash).all();
    return result.results;
  }

  async deleteBook({ id, manageTokenHash }) {
    await this.ensureSchema();
    await this.db.prepare(`DELETE FROM living_book_assets
      WHERE book_id = ?
        AND EXISTS (
          SELECT 1 FROM living_books
          WHERE id = ? AND manage_token_hash = ? AND status = 'deleting'
        )`).bind(id, id, manageTokenHash).run();
    const result = await this.db.prepare(`DELETE FROM living_books
      WHERE id = ? AND manage_token_hash = ? AND status = 'deleting'`).bind(id, manageTokenHash).run();
    return changes(result) > 0;
  }
}
