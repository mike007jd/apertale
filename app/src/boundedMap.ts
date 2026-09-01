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
    // set() grows the map by at most one entry, so one eviction restores the bound.
    if (this.size > this.capacity) this.delete(this.keys().next().value as Key);
    return this;
  }
}
