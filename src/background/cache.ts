import type { CacheEntry } from '../shared/messages';
import { CACHE_MAX_ENTRIES, CACHE_TTL_MS } from '../shared/settings';

export class LruCache<T> {
  private memory = new Map<string, CacheEntry<T>>();
  private prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  async get(key: string): Promise<T | undefined> {
    const mem = this.memory.get(key);
    if (mem) {
      if (Date.now() < mem.expiresAt) return mem.value;
      this.memory.delete(key);
    }

    const storageKey = `${this.prefix}:${key}`;
    const result = await chrome.storage.local.get(storageKey);
    const entry = result[storageKey] as CacheEntry<T> | undefined;
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      await chrome.storage.local.remove(storageKey);
      return undefined;
    }
    this.memory.set(key, entry);
    return entry.value;
  }

  async set(key: string, value: T): Promise<void> {
    const entry: CacheEntry<T> = {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    this.evictIfNeeded();
    this.memory.set(key, entry);
    const storageKey = `${this.prefix}:${key}`;
    await chrome.storage.local.set({ [storageKey]: entry });
  }

  private evictIfNeeded(): void {
    if (this.memory.size < CACHE_MAX_ENTRIES) return;
    const firstKey = this.memory.keys().next().value;
    if (firstKey) this.memory.delete(firstKey);
  }
}

export class RateLimiter {
  private timestamps: number[] = [];
  private maxPerSec: number;

  constructor(maxPerSec: number) {
    this.maxPerSec = maxPerSec;
  }

  canProceed(): boolean {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < 1000);
    if (this.timestamps.length >= this.maxPerSec) return false;
    this.timestamps.push(now);
    return true;
  }
}
