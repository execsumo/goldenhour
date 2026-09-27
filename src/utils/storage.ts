import localforage from 'localforage';
import { BackendType, GenerationRecord, HistoryEntry } from '../types';
import { base64ToBlob } from './blob';

/**
 * Generation storage.
 *
 * Layout (all in one localforage store):
 *
 *   __index          string[]      record ids, newest first
 *   __migrated       boolean       the legacy `nanoBanana` import ran
 *   __schemaVersion  number        2 = payloads split out as Blobs
 *   ${id}            HistoryEntry  slim metadata, no Blobs anywhere in it
 *   img:${id}        Blob          the original
 *   up:${id}         Blob          the upscaled copy, if any
 *   ref:${id}        Blob          the reference image, if any
 *
 * Payloads live under their own keys for two reasons. Reading the history no
 * longer streams every full-size image through IndexedDB just to build a list of
 * thumbnails; and localforage only detects a Blob when it is the *whole* stored
 * value, so a Blob nested inside a record object would not survive the round
 * trip. `toRecordMeta` asserts on that second point rather than trusting it.
 */

const store = localforage.createInstance({
  name: 'goldenHour',
  storeName: 'generations',
});

const legacyStore = localforage.createInstance({
  name: 'nanoBanana',
  storeName: 'generations',
});

const INDEX_KEY = '__index';
const MIGRATED_KEY = '__migrated';
const SCHEMA_VERSION_KEY = '__schemaVersion';
const CURRENT_SCHEMA_VERSION = 2;

const imgKey = (id: string) => `img:${id}`;
const upKey = (id: string) => `up:${id}`;
const refKey = (id: string) => `ref:${id}`;

/** The pre-v2 on-disk shape. Only the migration ever sees one. */
interface V1Record {
  id?: string;
  timestamp?: string;
  settings?: Record<string, any>;
  imageBase64?: unknown;
  thumbnailBase64?: unknown;
  quickUpscaledImageBase64?: unknown;
  backend?: BackendType;
  upscaleMechanism?: string;
}

// ─── Internal Index ──────────────────────────────────────────────────────────

/**
 * The id index, importing the legacy `nanoBanana` store at most once.
 *
 * The import used to be gated on the index being missing *or empty*, which meant
 * an empty history re-triggered it on every save and delete — and since
 * `clearAllGenerations()` wipes the index, "Clear history" un-did itself by
 * dragging the entire legacy store back through IndexedDB one record at a time.
 * A dedicated flag makes the import genuinely one-shot.
 */
async function getIndex(): Promise<string[]> {
  const index = (await store.getItem<string[]>(INDEX_KEY)) || [];

  if (await store.getItem<boolean>(MIGRATED_KEY)) return index;

  // No flag yet. If records are already here, the import ran before the flag
  // existed — record that and leave the legacy store alone.
  if (index.length > 0) {
    await store.setItem(MIGRATED_KEY, true);
    return index;
  }

  const legacyIndex = await legacyStore.getItem<string[]>(INDEX_KEY);
  if (legacyIndex && legacyIndex.length > 0) {
    for (const id of legacyIndex) {
      const item = await legacyStore.getItem<V1Record>(id);
      if (item) {
        await store.setItem(id, item);
      }
    }
    await store.setItem(INDEX_KEY, legacyIndex);
    await store.setItem(MIGRATED_KEY, true);
    return legacyIndex;
  }

  await store.setItem(MIGRATED_KEY, true);
  return index;
}

async function setIndex(index: string[]): Promise<void> {
  await store.setItem(INDEX_KEY, index);
}

// ─── Record ⇄ Metadata ───────────────────────────────────────────────────────

/**
 * A Blob that reaches the metadata record is a silent corruption: localforage
 * only runs its blob handling for a top-level value, and it would re-fatten the
 * very read this layout exists to keep small. Cheap to check — the metadata
 * object holds no payloads, so this walks a handful of scalars.
 */
function assertNoBlobs(value: unknown, path = 'record'): void {
  if (value instanceof Blob) {
    throw new Error(
      `Refusing to persist a Blob at ${path}: image payloads belong under their own key, not inside the metadata record.`
    );
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoBlobs(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertNoBlobs(v, `${path}.${k}`);
  }
}

/** Build the persisted metadata for a freshly generated record. */
function toRecordMeta(record: GenerationRecord): HistoryEntry {
  const { referenceImage, ...settings } = record.settings;
  const meta: HistoryEntry = {
    id: record.id,
    timestamp: record.timestamp,
    settings: { ...settings, hasReferenceImage: !!referenceImage },
    thumbnailDataUrl: record.thumbnailDataUrl,
    hasUpscaled: !!record.upscaled,
    backend: record.backend,
    upscaleMechanism: record.upscaleMechanism,
  };
  assertNoBlobs(meta);
  return meta;
}

/** Build v2 metadata from a v1 record during migration. */
function v1ToMeta(id: string, raw: V1Record, hasUpscaled: boolean, hasReference: boolean): HistoryEntry {
  const { referenceImageBase64, ...settings } = raw.settings ?? {};
  void referenceImageBase64;
  const meta: HistoryEntry = {
    id,
    timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : new Date(0).toISOString(),
    settings: { ...settings, hasReferenceImage: hasReference } as HistoryEntry['settings'],
    // Existing thumbnails keep their 256px JPEG encoding. Re-encoding them here
    // would turn a string-only pass into a hundred image round-trips that can
    // themselves fail; only new generations get the smaller WebP.
    thumbnailDataUrl:
      typeof raw.thumbnailBase64 === 'string' && raw.thumbnailBase64
        ? `data:image/jpeg;base64,${raw.thumbnailBase64}`
        : '',
    hasUpscaled,
    backend: raw.backend,
    upscaleMechanism: raw.upscaleMechanism,
  };
  assertNoBlobs(meta);
  return meta;
}

// ─── Migration ───────────────────────────────────────────────────────────────

export type MigrationResult =
  | { status: 'not-needed' }
  | { status: 'completed'; converted: number; dropped: number }
  | { status: 'aborted'; converted: number; reason: string };

export function describeStorageError(e: unknown): string {
  const name = (e as any)?.name;
  if (name === 'QuotaExceededError') return 'not enough disk space';
  return (e as any)?.message || name || String(e);
}

let persistenceRequest: Promise<void> | null = null;

function requestPersistentStorage(): Promise<void> {
  if (!persistenceRequest) {
    persistenceRequest = (async () => {
      if (typeof navigator === 'undefined' || !navigator.storage?.persisted || !navigator.storage.persist) return;
      try {
        if (!(await navigator.storage.persisted())) await navigator.storage.persist();
      } catch {
        // Persistence is best effort; history remains usable if the browser declines it.
      }
    })();
  }
  return persistenceRequest;
}

/**
 * v1 → v2: pull every base64 payload out of its record and store it as a Blob.
 *
 * Per record the commit write to `${id}` comes last and is what removes the
 * legacy payloads, so an interrupted run leaves either an untouched v1 record
 * (redone next boot — the blob writes are idempotent overwrites of identical
 * bytes) or a finished v2 one. There is no half-record state.
 *
 * Two failure kinds, and the call site is the discriminator rather than the
 * error type: a throw while *decoding* means that record's data is unreadable,
 * so it is dropped and the pass continues; a throw from a *storage* call is
 * environmental (out of disk, aborted transaction) and aborts the whole run
 * without stamping the version, so it retries on the next launch.
 */
async function migrateToBlobs(
  index: string[],
  onProgress?: (done: number, total: number) => void
): Promise<MigrationResult> {
  if (index.length === 0) {
    await store.setItem(SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION);
    return { status: 'completed', converted: 0, dropped: 0 };
  }

  const dropped: string[] = [];
  let converted = 0;

  for (let i = 0; i < index.length; i++) {
    const id = index[i];
    onProgress?.(i, index.length);

    let raw: V1Record | null;
    try {
      raw = await store.getItem<V1Record>(id);
    } catch (e) {
      return { status: 'aborted', converted, reason: describeStorageError(e) };
    }

    if (!raw || typeof raw !== 'object') {
      dropped.push(id);
      continue;
    }
    // Already converted: a resumed run walks past everything it finished.
    if (!('imageBase64' in raw)) continue;

    let image: Blob;
    try {
      if (typeof raw.imageBase64 !== 'string' || !raw.imageBase64) {
        throw new Error('record has no image payload');
      }
      image = await base64ToBlob(raw.imageBase64, 'image/png');
    } catch {
      dropped.push(id);
      continue;
    }

    // A bad *optional* payload costs only that payload, not the record.
    let upscaled: Blob | undefined;
    try {
      if (typeof raw.quickUpscaledImageBase64 === 'string' && raw.quickUpscaledImageBase64) {
        upscaled = await base64ToBlob(raw.quickUpscaledImageBase64, 'image/png');
      }
    } catch {
      upscaled = undefined;
    }

    let reference: Blob | undefined;
    try {
      const refB64 = raw.settings?.referenceImageBase64;
      if (typeof refB64 === 'string' && refB64) {
        reference = await base64ToBlob(refB64, 'image/png');
      }
    } catch {
      reference = undefined;
    }

    try {
      await store.setItem(imgKey(id), image);
      if (upscaled) await store.setItem(upKey(id), upscaled);
      if (reference) await store.setItem(refKey(id), reference);

      // Confirm the storage layer actually took the Blob before dropping the
      // only other copy of these bytes.
      const check = await store.getItem<Blob>(imgKey(id));
      if (!(check instanceof Blob) || check.size !== image.size) {
        return { status: 'aborted', converted, reason: 'stored image failed verification' };
      }

      await store.setItem(id, v1ToMeta(id, raw, !!upscaled, !!reference));
    } catch (e) {
      return { status: 'aborted', converted, reason: describeStorageError(e) };
    }

    converted++;
    // Yield so the progress banner can actually paint.
    await new Promise((r) => setTimeout(r, 0));
  }

  onProgress?.(index.length, index.length);

  if (dropped.length > 0) {
    await setIndex(index.filter((id) => !dropped.includes(id)));
    for (const id of dropped) {
      try {
        await store.removeItem(id);
      } catch {
        /* the index no longer points at it; a stray key is harmless */
      }
    }
  }

  await store.setItem(SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION);
  return { status: 'completed', converted, dropped: dropped.length };
}

let initPromise: Promise<MigrationResult> | null = null;

async function runInit(onProgress?: (done: number, total: number) => void): Promise<MigrationResult> {
  // Ask once per page load so browsers are less likely to evict generated history.
  await requestPersistentStorage();

  // The legacy nanoBanana import has to go first: it copies v1-shaped records
  // into this store, and those need converting too.
  const index = await getIndex();
  const version = (await store.getItem<number>(SCHEMA_VERSION_KEY)) ?? 1;
  if (version >= CURRENT_SCHEMA_VERSION) return { status: 'not-needed' };
  return migrateToBlobs(index, onProgress);
}

/**
 * Run the one-shot migrations. Memoized, and every other export awaits it, so a
 * Generate click during startup cannot race the conversion.
 */
export function initStorage(
  onProgress?: (done: number, total: number) => void
): Promise<MigrationResult> {
  if (!initPromise) initPromise = runInit(onProgress);
  return initPromise;
}

async function ready(): Promise<void> {
  if (!initPromise) initPromise = runInit();
  await initPromise;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function saveGeneration(record: GenerationRecord): Promise<HistoryEntry> {
  await ready();
  const meta = toRecordMeta(record);

  await store.setItem(imgKey(record.id), record.image);
  if (record.upscaled) await store.setItem(upKey(record.id), record.upscaled);
  if (record.settings.referenceImage) {
    await store.setItem(refKey(record.id), record.settings.referenceImage);
  }
  await store.setItem(record.id, meta);

  const index = await getIndex();
  index.unshift(record.id); // newest first
  await setIndex(index);

  return meta;
}

/** Attach an upscaled copy to an existing record and return the updated row. */
export async function setUpscaled(
  id: string,
  blob: Blob,
  mechanism: string,
  scale: number
): Promise<HistoryEntry | null> {
  await ready();
  const meta = await store.getItem<HistoryEntry>(id);
  if (!meta) return null;

  await store.setItem(upKey(id), blob);
  const next: HistoryEntry = { ...meta, hasUpscaled: true, upscaleMechanism: mechanism, upscaleScale: scale };
  await store.setItem(id, next);
  return next;
}

export async function getGenerationMeta(id: string): Promise<HistoryEntry | null> {
  await ready();
  return store.getItem<HistoryEntry>(id);
}

export async function getImageBlob(id: string): Promise<Blob | null> {
  await ready();
  return store.getItem<Blob>(imgKey(id));
}

export async function getUpscaledBlob(id: string): Promise<Blob | null> {
  await ready();
  return store.getItem<Blob>(upKey(id));
}

export async function getReferenceBlob(id: string): Promise<Blob | null> {
  await ready();
  return store.getItem<Blob>(refKey(id));
}

/**
 * Load the whole history.
 *
 * Reads only the metadata keys, so no image bytes are touched. Kept index-driven
 * rather than using `store.iterate()`, which would walk and deserialize every
 * payload key too and undo the entire point of the split.
 */
export async function getAllHistoryEntries(): Promise<HistoryEntry[]> {
  await ready();
  const index = await getIndex();
  const entries: HistoryEntry[] = [];
  const CHUNK = 16;

  for (let i = 0; i < index.length; i += CHUNK) {
    const metas = await Promise.all(
      index.slice(i, i + CHUNK).map((id) => store.getItem<HistoryEntry>(id))
    );
    for (const meta of metas) if (meta) entries.push(meta);
  }

  return entries;
}

export async function deleteGeneration(id: string): Promise<void> {
  await ready();
  // Index first. A crash part-way then leaves orphan payload keys, which
  // `sweepOrphanBlobs` reclaims — far better than an index entry pointing at a
  // record that is already gone.
  const index = await getIndex();
  await setIndex(index.filter((i) => i !== id));
  await store.removeItem(id);
  await store.removeItem(imgKey(id));
  await store.removeItem(upKey(id));
  await store.removeItem(refKey(id));
}

export async function clearAllGenerations(): Promise<void> {
  await ready();
  await store.clear();
  // clear() drops both flags. Without this the next save or delete would treat
  // the empty store as un-migrated and re-import the legacy data, and the
  // migration would run again over nothing.
  await store.setItem(MIGRATED_KEY, true);
  await store.setItem(SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION);
}

/**
 * Drop payload keys whose record is gone — the storage-level equivalent of a
 * leaked object URL. Cheap: `keys()` returns strings, deserializing nothing.
 */
export async function sweepOrphanBlobs(): Promise<number> {
  await ready();
  const live = new Set(await getIndex());
  const keys = await store.keys();
  let removed = 0;

  for (const key of keys) {
    const sep = key.indexOf(':');
    if (sep === -1) continue;
    const prefix = key.slice(0, sep);
    if (prefix !== 'img' && prefix !== 'up' && prefix !== 'ref') continue;
    if (live.has(key.slice(sep + 1))) continue;
    await store.removeItem(key);
    removed++;
  }

  return removed;
}
