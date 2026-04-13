/** In-memory LRU cache for Arrow IPC chunk buffers */
export class ChunkCache {
  private cache = new Map<string, Uint8Array>();
  private currentSize = 0;

  constructor(private maxSizeBytes: number = 256 * 1024 * 1024) {}

  get(key: string): Uint8Array | undefined {
    const buf = this.cache.get(key);
    if (!buf) return undefined;

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, buf);
    return buf;
  }

  set(key: string, value: Uint8Array): void {
    // If already cached, remove old entry first
    const existing = this.cache.get(key);
    if (existing) {
      this.currentSize -= existing.byteLength;
      this.cache.delete(key);
    }

    // Evict LRU entries until we have room
    while (this.currentSize + value.byteLength > this.maxSizeBytes && this.cache.size > 0) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      const oldBuf = this.cache.get(oldest)!;
      this.currentSize -= oldBuf.byteLength;
      this.cache.delete(oldest);
    }

    this.cache.set(key, value);
    this.currentSize += value.byteLength;
  }

  /** Evict all entries matching a prefix (e.g., "/{entityId}/") */
  evictByPrefix(prefix: string): number {
    let evicted = 0;
    for (const [key, buf] of this.cache) {
      if (key.startsWith(prefix)) {
        this.currentSize -= buf.byteLength;
        this.cache.delete(key);
        evicted++;
      }
    }
    return evicted;
  }

  get size() {
    return this.cache.size;
  }

  get sizeBytes() {
    return this.currentSize;
  }
}
