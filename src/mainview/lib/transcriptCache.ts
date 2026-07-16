/**
 * Transcript cache backed by IndexedDB.
 * Matches Swift's TranscriptCache (dual-layer: in-memory + disk).
 */

import type { TranscriptionResult } from "./cloudTranscription";

const DB_NAME = "filmidi-transcripts";
const DB_VERSION = 1;
const STORE_NAME = "transcripts";
const MEMORY_CACHE_MAX = 20;

let dbInstance: IDBDatabase | null = null;
const memoryCache = new Map<string, TranscriptionResult>();

async function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => {
      dbInstance = req.result;
      resolve(dbInstance);
    };
    req.onerror = () => reject(req.error);
  });
}

function cacheKey(url: string, lang?: string, startSec?: number, endSec?: number): string {
  const parts = [url];
  if (lang) parts.push(lang);
  if (startSec !== undefined) parts.push(`s${startSec}`);
  if (endSec !== undefined) parts.push(`e${endSec}`);
  return parts.join("|");
}

export async function getCachedTranscript(
  url: string,
  lang?: string,
  startSec?: number,
  endSec?: number
): Promise<TranscriptionResult | null> {
  const key = cacheKey(url, lang, startSec, endSec);

  // Check memory cache
  const mem = memoryCache.get(key);
  if (mem) return mem;

  // Check IndexedDB
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => {
        const result = req.result as TranscriptionResult | undefined;
        if (result) {
          // Populate memory cache
          memoryCache.set(key, result);
          if (memoryCache.size > MEMORY_CACHE_MAX) {
            const firstKey = memoryCache.keys().next().value;
            if (firstKey) memoryCache.delete(firstKey);
          }
        }
        resolve(result ?? null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setCachedTranscript(
  url: string,
  result: TranscriptionResult,
  lang?: string,
  startSec?: number,
  endSec?: number
): Promise<void> {
  const key = cacheKey(url, lang, startSec, endSec);

  // Memory cache
  memoryCache.set(key, result);
  if (memoryCache.size > MEMORY_CACHE_MAX) {
    const firstKey = memoryCache.keys().next().value;
    if (firstKey) memoryCache.delete(firstKey);
  }

  // IndexedDB
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(result, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve(); // best effort
    });
  } catch {
    // best effort
  }
}
