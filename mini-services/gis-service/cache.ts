// cache.ts — in-memory TTL cache with LRU-ish eviction + hit/miss counters.
//
// One cache per API family, surfaced on /health:
//   geocode  /search /reverse /api ....... TTL 24h (gazetteer data is static)
//   route    /route/v1/driving ........... TTL 1h
//   table    /table/v1/driving ........... TTL 1h
//   tiles    /data/zimbabwe/{z}/{x}/{y} .. TTL null (forever), bounded to 5000
//                                          entries, oldest evicted.

export interface CacheStats {
  size: number;
  max: number;
  ttlMs: number | null;
  hits: number;
  misses: number;
  evictions: number;
}

interface Entry<V> {
  value: V;
  exp: number; // Infinity when the cache has no TTL
}

const REGISTRY = new Map<string, TTLCache<unknown, unknown>>();

export class TTLCache<K, V> {
  private map = new Map<K, Entry<V>>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(
    public readonly name: string,
    public readonly ttlMs: number | null,
    public readonly max: number,
  ) {
    REGISTRY.set(name, this as unknown as TTLCache<unknown, unknown>);
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (this.ttlMs !== null && Date.now() > entry.exp) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    // LRU refresh: re-insert so recently used keys move to the "new" end.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    const exp = this.ttlMs === null ? Infinity : Date.now() + this.ttlMs;
    // Reset TTL on overwrite, refresh recency.
    this.map.delete(key);
    this.map.set(key, { value, exp });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
      this.evictions++;
    }
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  stats(): CacheStats {
    return {
      size: this.map.size,
      max: this.max,
      ttlMs: this.ttlMs,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }
}

/** Stats for every named cache, for /health. */
export function allCacheStats(): Record<string, CacheStats> {
  const out: Record<string, CacheStats> = {};
  for (const [name, cache] of REGISTRY) out[name] = cache.stats();
  return out;
}

// Named singletons used across the service.
export const geocodeCache = new TTLCache<string, unknown>("geocode", 24 * 60 * 60 * 1000, 1000);
export const routeCache = new TTLCache<string, unknown>("route", 60 * 60 * 1000, 500);
export const tableCache = new TTLCache<string, unknown>("table", 60 * 60 * 1000, 200);
export const tileCache = new TTLCache<string, Uint8Array>("tiles", null, 5000);
