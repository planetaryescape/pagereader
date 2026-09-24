import { createStore, del, get, set } from "idb-keyval";

export interface AudioCacheKey {
  url: string;
  contentHash: string;
  voice: string;
  speed: number;
  modelVersion: string;
}

export interface CachedAudioEntry {
  id: string;
  key: AudioCacheKey;
  sizeBytes: number;
  durationSec: number;
  chunkDurations: number[];
  createdAt: number;
  lastAccessAt: number;
  storage: "opfs" | "idb";
}

export interface AudioCacheStats {
  totalEntries: number;
  totalBytes: number;
  budgetBytes: number;
}

export interface CacheGetResult {
  audioData: ArrayBuffer;
  entry: CachedAudioEntry;
}

const DB_NAME = "pagereader-cache";
const META_STORE = createStore(DB_NAME, "meta");
const BLOB_STORE = createStore(DB_NAME, "blob");
const INDEX_KEY = "pagereader:index";
const OPFS_DIR_NAME = "pagereader-audio";

let opfsDirectoryPromise: Promise<FileSystemDirectoryHandle | null> | null = null;
let queue: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function getBudgetBytes(budgetMb: number): number {
  const normalized = Number.isFinite(budgetMb) && budgetMb > 0 ? budgetMb : 250;
  return Math.floor(normalized * 1024 * 1024);
}

export function serializeAudioCacheKey(key: AudioCacheKey): string {
  return [key.url, key.contentHash, key.voice, key.speed.toFixed(2), key.modelVersion].join("|");
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getIndex(): Promise<Record<string, CachedAudioEntry>> {
  const index = await get<Record<string, CachedAudioEntry>>(INDEX_KEY, META_STORE);
  return index || {};
}

async function saveIndex(index: Record<string, CachedAudioEntry>): Promise<void> {
  await set(INDEX_KEY, index, META_STORE);
}

function blobKey(id: string): string {
  return `audio:${id}`;
}

function toArrayBuffer(data: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

async function getOpfsDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (opfsDirectoryPromise) return opfsDirectoryPromise;

  opfsDirectoryPromise = (async () => {
    const storageApi = (globalThis.navigator as Navigator & {
      storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
    }).storage;

    if (!storageApi?.getDirectory) return null;

    try {
      const root = await storageApi.getDirectory();
      return await root.getDirectoryHandle(OPFS_DIR_NAME, { create: true });
    } catch {
      return null;
    }
  })();

  return opfsDirectoryPromise;
}

async function writeOpfs(id: string, buffer: ArrayBuffer): Promise<boolean> {
  const directory = await getOpfsDirectory();
  if (!directory) return false;

  try {
    const handle = await directory.getFileHandle(`${id}.wav`, { create: true });
    const writable = await handle.createWritable();
    await writable.write(buffer);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

async function readOpfs(id: string): Promise<ArrayBuffer | null> {
  const directory = await getOpfsDirectory();
  if (!directory) return null;

  try {
    const handle = await directory.getFileHandle(`${id}.wav`);
    const file = await handle.getFile();
    return file.arrayBuffer();
  } catch {
    return null;
  }
}

async function removeOpfs(id: string): Promise<void> {
  const directory = await getOpfsDirectory();
  if (!directory) return;

  try {
    await directory.removeEntry(`${id}.wav`);
  } catch {
    // Ignore missing files.
  }
}

async function writeIdb(id: string, buffer: ArrayBuffer): Promise<void> {
  await set(blobKey(id), new Uint8Array(buffer), BLOB_STORE);
}

async function readIdb(id: string): Promise<ArrayBuffer | null> {
  const value = await get<Uint8Array | ArrayBuffer>(blobKey(id), BLOB_STORE);
  if (!value) return null;
  return toArrayBuffer(value);
}

async function removeIdb(id: string): Promise<void> {
  await del(blobKey(id), BLOB_STORE);
}

async function readEntryAudio(entry: CachedAudioEntry): Promise<ArrayBuffer | null> {
  if (entry.storage === "opfs") {
    const data = await readOpfs(entry.id);
    if (data) return data;
  }
  return readIdb(entry.id);
}

async function removeEntryAudio(entry: CachedAudioEntry): Promise<void> {
  if (entry.storage === "opfs") {
    await removeOpfs(entry.id);
  }
  await removeIdb(entry.id);
}

async function evictToBudget(
  index: Record<string, CachedAudioEntry>,
  budgetBytes: number
): Promise<void> {
  const entries = Object.entries(index);
  let total = entries.reduce((sum, [, entry]) => sum + entry.sizeBytes, 0);

  if (total <= budgetBytes) return;

  const sorted = entries.sort((a, b) => a[1].lastAccessAt - b[1].lastAccessAt);
  for (const [serializedKey, entry] of sorted) {
    await removeEntryAudio(entry);
    delete index[serializedKey];
    total -= entry.sizeBytes;
    if (total <= budgetBytes) break;
  }
}

export async function getCachedAudio(key: AudioCacheKey): Promise<CacheGetResult | null> {
  return withLock(async () => {
    const index = await getIndex();
    const serialized = serializeAudioCacheKey(key);
    const entry = index[serialized];

    if (!entry) return null;

    const audioData = await readEntryAudio(entry);
    if (!audioData) {
      delete index[serialized];
      await saveIndex(index);
      return null;
    }

    entry.lastAccessAt = Date.now();
    index[serialized] = entry;
    await saveIndex(index);

    return { audioData, entry };
  });
}

export async function putCachedAudio(params: {
  key: AudioCacheKey;
  audioData: ArrayBuffer;
  durationSec: number;
  chunkDurations: number[];
  budgetMb: number;
}): Promise<CachedAudioEntry> {
  return withLock(async () => {
    const { key, audioData, durationSec, chunkDurations, budgetMb } = params;
    const serialized = serializeAudioCacheKey(key);
    const index = await getIndex();
    const existing = index[serialized];
    const id = existing?.id || (await sha256Hex(serialized));
    const now = Date.now();
    const sizeBytes = audioData.byteLength;

    const wroteOpfs = await writeOpfs(id, audioData);
    if (!wroteOpfs) {
      await writeIdb(id, audioData);
    }

    if (existing && existing.storage !== (wroteOpfs ? "opfs" : "idb")) {
      await removeEntryAudio(existing);
    }

    const entry: CachedAudioEntry = {
      id,
      key,
      sizeBytes,
      durationSec,
      chunkDurations,
      createdAt: existing?.createdAt || now,
      lastAccessAt: now,
      storage: wroteOpfs ? "opfs" : "idb",
    };

    index[serialized] = entry;
    await evictToBudget(index, getBudgetBytes(budgetMb));
    await saveIndex(index);

    return entry;
  });
}

export async function clearAudioCache(): Promise<void> {
  return withLock(async () => {
    const index = await getIndex();
    for (const entry of Object.values(index)) {
      await removeEntryAudio(entry);
    }
    await saveIndex({});
  });
}

export async function getAudioCacheStats(budgetMb: number): Promise<AudioCacheStats> {
  return withLock(async () => {
    const index = await getIndex();
    const entries = Object.values(index);
    const totalBytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);

    return {
      totalEntries: entries.length,
      totalBytes,
      budgetBytes: getBudgetBytes(budgetMb),
    };
  });
}
