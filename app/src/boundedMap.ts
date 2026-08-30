/**
 * Insertion-ordered Map with deterministic FIFO eviction.
 *
 * Re-setting a key refreshes it, which keeps retried idempotency keys and
 * presentation resumes newer than inactive session history.
 */
export class BoundedMap<Key, Value> extends Map<Key, Value> {
  constructor(
    private readonly capacity: number,
    entries?: readonly (readonly [Key, Value])[] | null,
  ) {
    super();
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("BoundedMap capacity must be a positive integer.");
    entries?.forEach(([key, value]) => this.set(key, value));
  }

  override set(key: Key, value: Value) {
    if (this.has(key)) this.delete(key);
    super.set(key, value);
    while (this.size > this.capacity) {
      const oldest = this.keys().next();
      if (oldest.done) break;
      this.delete(oldest.value);
    }
    return this;
  }
}
