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

  async createBook({ id, manageTokenHash, now }) {
    await this.ensureSchema();
    const result = await this.db.prepare(`INSERT INTO living_books (
      id, manage_token_hash, status, created_at, updated_at
    ) VALUES (?, ?, 'draft', ?, ?)
    ON CONFLICT(id) DO NOTHING`).bind(id, manageTokenHash, now, now).run();
    if (changes(result) === 1) return "created";
    const existing = await this.findBook(id);
    return existing?.manage_token_hash === manageTokenHash ? "existing" : "conflict";
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
        publish_attempt_token_hash, revoked_at
      FROM living_books
      WHERE id = ? AND manage_token_hash = ?`).bind(id, manageTokenHash).first();
  }

  async claimPublishAttempt({ id, manageTokenHash, shareTokenHash, now }) {
    await this.ensureSchema();
    const result = await this.db.prepare(`UPDATE living_books SET
      publish_attempt_token_hash = ?,
      updated_at = ?
    WHERE id = ?
      AND manage_token_hash = ?
      AND status IN ('draft', 'revoked')
      AND NOT EXISTS (
        SELECT 1 FROM living_book_retired_share_tokens
        WHERE share_token_hash = ?
      )
      AND (
        publish_attempt_token_hash = ?
        OR (
          publish_attempt_token_hash IS NULL
          AND (
            status = 'draft'
            OR share_token_hash IS NULL
            OR share_token_hash <> ?
          )
        )
      )`).bind(
      shareTokenHash,
      now,
      id,
      manageTokenHash,
      shareTokenHash,
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

  async insertAsset({ bookId, assetId, objectKey, contentType, byteSize, now }) {
    await this.ensureSchema();
    await this.db.prepare(`INSERT INTO living_book_assets (
      book_id, asset_id, object_key, content_type, byte_size, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`).bind(
      bookId,
      assetId,
      objectKey,
      contentType,
      byteSize,
      now,
    ).run();
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
      FROM living_books
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
      AND status IN ('draft', 'revoked')
      AND publish_attempt_token_hash = ?`).bind(
      shareTokenHash,
      title,
      revision,
      manifestJson,
      now,
      now,
      id,
      manageTokenHash,
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

  async revokeBook({ id, manageTokenHash, now }) {
    await this.ensureSchema();
    const result = await this.db.prepare(`UPDATE living_books SET
      publish_attempt_token_hash = NULL,
      status = 'revoked',
      revoked_at = ?,
      updated_at = ?
    WHERE id = ? AND manage_token_hash = ? AND status IN ('published', 'revoked')`).bind(
      now,
      now,
      id,
      manageTokenHash,
    ).run();
    return changes(result) === 1;
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
    return changes(result) === 1;
  }

  async listAssets(bookId) {
    await this.ensureSchema();
    const result = await this.db.prepare(`SELECT asset_id, object_key, content_type, byte_size
      FROM living_book_assets
      WHERE book_id = ?`).bind(bookId).all();
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
    return changes(result) === 1;
  }
}
