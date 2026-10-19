import { recordLegacyImportedRead } from './human-signals';

const STORAGE_KEY = 'gu-log-read-articles';

export type ReadMethod = 'manual_mark_read' | 'legacy_import' | 'active_scroll_end';
export type ReadConfidence = 'legacy_or_manual' | 'active_finish';
export type RevisionState = 'current' | 'stale' | 'unknown';

export interface ReadRecord {
  slug: string;
  method: ReadMethod;
  confidence: ReadConfidence;
  readAt: string;
  lastReadAt: string;
  readRevision: string | null;
  revisionState: RevisionState;
}

export interface ReadStoreV1 {
  version: 1;
  slugs: string[];
  lastUpdated: string;
}

export interface ReadStoreV2 {
  version: 2;
  slugs: string[];
  records: ReadRecord[];
  lastUpdated: string;
}

type ReadStore = ReadStoreV2;
type ReadStateUpdate = readonly [
  slug: string,
  read?: boolean,
  currentRevision?: string | null,
  method?: ReadMethod,
];

function nowIso(): string {
  return new Date().toISOString();
}

const READ_METHODS: readonly string[] = ['manual_mark_read', 'legacy_import', 'active_scroll_end'];
const REVISION_STATES: readonly string[] = ['current', 'stale', 'unknown'];

function timestampOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : fallback;
}

// Lenient on purpose: one odd record must not cost the reader their whole read history.
function parseReadRecord(value: unknown, fallbackTime: string): ReadRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.slug !== 'string' || !record.slug) return null;
  const method = READ_METHODS.includes(record.method as string)
    ? (record.method as ReadMethod)
    : 'legacy_import';
  const lastReadAt = timestampOr(record.lastReadAt, timestampOr(record.readAt, fallbackTime));
  const readRevision = typeof record.readRevision === 'string' ? record.readRevision : null;
  return {
    slug: record.slug,
    method,
    confidence: method === 'active_scroll_end' ? 'active_finish' : 'legacy_or_manual',
    readAt: timestampOr(record.readAt, lastReadAt),
    lastReadAt,
    readRevision,
    revisionState:
      readRevision && REVISION_STATES.includes(record.revisionState as string)
        ? (record.revisionState as RevisionState)
        : 'unknown',
  };
}

export function parseReadStore(value: unknown): ReadStoreV1 | ReadStoreV2 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const store = value as {
    version?: unknown;
    slugs?: unknown;
    records?: unknown;
    lastUpdated?: unknown;
  };
  const lastUpdated = timestampOr(store.lastUpdated, nowIso());
  if (store.version === 1 && Array.isArray(store.slugs)) {
    return { version: 1, slugs: uniqueSlugs(store.slugs), lastUpdated };
  }
  if (store.version !== 2 || !Array.isArray(store.records)) return null;

  const records = new Map<string, ReadRecord>();
  for (const raw of store.records) {
    const record = parseReadRecord(raw, lastUpdated);
    if (record) records.set(record.slug, record);
  }
  for (const slug of uniqueSlugs(store.slugs)) {
    if (!records.has(slug)) {
      records.set(slug, makeRecord(slug, lastUpdated, 'legacy_import', 'legacy_or_manual', null));
    }
  }
  return { version: 2, slugs: [...records.keys()], records: [...records.values()], lastUpdated };
}

function uniqueSlugs(slugs: unknown): string[] {
  if (!Array.isArray(slugs)) return [];
  const unique: string[] = [];
  for (const slug of slugs) {
    if (typeof slug === 'string' && slug.length > 0 && unique.indexOf(slug) === -1) {
      unique.push(slug);
    }
  }
  return unique;
}

function revisionState(
  readRevision: string | null,
  currentRevision?: string | null
): RevisionState {
  if (!readRevision || !currentRevision) return 'unknown';
  return readRevision === currentRevision ? 'current' : 'stale';
}

function makeRecord(
  slug: string,
  readAt: string,
  method: ReadMethod,
  confidence: ReadConfidence,
  readRevision: string | null,
  currentRevision?: string | null
): ReadRecord {
  return {
    slug,
    method,
    confidence,
    readAt,
    lastReadAt: readAt,
    readRevision,
    revisionState: revisionState(readRevision, currentRevision),
  };
}

export function migrateV1(v1: ReadStoreV1): ReadStoreV2 {
  const slugs = uniqueSlugs(v1.slugs);
  const importedAt = typeof v1.lastUpdated === 'string' ? v1.lastUpdated : nowIso();
  const records = slugs.map((slug) =>
    makeRecord(slug, importedAt, 'legacy_import', 'legacy_or_manual', null)
  );

  return {
    version: 2,
    slugs,
    records,
    lastUpdated: importedAt,
  };
}

function recordV1Migration(store: ReadStoreV2): void {
  for (const slug of store.slugs) {
    recordLegacyImportedRead(slug, store.lastUpdated);
  }
}

function emptyStore(): ReadStoreV2 {
  return { version: 2, slugs: [], records: [], lastUpdated: nowIso() };
}

function loadStore(): ReadStore | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }

  if (!raw) {
    return emptyStore();
  }

  try {
    const parsed = parseReadStore(JSON.parse(raw));
    if (parsed?.version === 2) {
      return parsed;
    }
    if (parsed?.version === 1) {
      const migrated = migrateV1(parsed);
      if (saveStore(migrated)) recordV1Migration(migrated);
      return migrated;
    }
  } catch {
    // Corrupt data is still writable storage; mutations may replace it.
  }
  return emptyStore();
}

function getStore(): ReadStore {
  return loadStore() ?? emptyStore();
}

function saveStore(store: ReadStore): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    // Surface private-mode, permission, and quota failures to mutation callers.
    return false;
  }
}

function upsertReadRecord(
  store: ReadStore,
  slug: string,
  method: ReadMethod,
  currentRevision?: string | null
): void {
  const readAt = nowIso();
  const confidence: ReadConfidence =
    method === 'active_scroll_end' ? 'active_finish' : 'legacy_or_manual';
  const readRevision = currentRevision || null;
  let existing: ReadRecord | undefined;
  for (const record of store.records) {
    if (record.slug === slug) {
      existing = record;
      break;
    }
  }
  if (existing) {
    existing.method = method;
    existing.confidence = confidence;
    existing.readAt = readAt;
    existing.lastReadAt = readAt;
    existing.readRevision = readRevision;
    existing.revisionState = revisionState(readRevision, currentRevision);
  } else {
    store.records.push(makeRecord(slug, readAt, method, confidence, readRevision, currentRevision));
  }
}

function markStoreAsRead(
  store: ReadStore,
  slug: string,
  method: ReadMethod,
  currentRevision?: string | null
): void {
  if (store.slugs.indexOf(slug) === -1) {
    store.slugs.push(slug);
  }
  upsertReadRecord(store, slug, method, currentRevision);
  store.lastUpdated = nowIso();
}

function markStoreAsUnread(store: ReadStore, slug: string): void {
  store.slugs = store.slugs.filter((s) => s !== slug);
  store.records = store.records.filter((record) => record.slug !== slug);
  store.lastUpdated = nowIso();
}

export function markAsRead(
  slug: string,
  method: ReadMethod = 'manual_mark_read',
  currentRevision?: string | null
): boolean {
  return setReadStates([[slug, true, currentRevision, method]]) !== null;
}

export function markAsUnread(slug: string): boolean {
  return setReadStates([[slug, false]]) !== null;
}

export function setReadStates(updates: readonly ReadStateUpdate[]): boolean | null {
  const store = loadStore();
  if (!store) return null;
  let read = true;
  for (const [slug, requestedRead, currentRevision, method = 'manual_mark_read'] of updates) {
    read = requestedRead ?? !store.slugs.includes(slug);
    if (read) {
      markStoreAsRead(store, slug, method, currentRevision);
    } else {
      markStoreAsUnread(store, slug);
    }
  }
  return saveStore(store) ? read : null;
}

export function isRead(slug: string): boolean {
  return getStore().slugs.indexOf(slug) !== -1;
}

export function getReadSlugs(): string[] {
  return [...getStore().slugs];
}

export function getReadRecords(currentRevisions?: Record<string, string | null>): ReadRecord[] {
  return getStore().records.map((record) => ({
    ...record,
    revisionState: currentRevisions
      ? revisionState(record.readRevision, currentRevisions[record.slug])
      : record.revisionState,
  }));
}

export function getReadRecordMap(
  currentRevisions?: Record<string, string | null>
): Record<string, ReadRecord> {
  const records = Object.create(null) as Record<string, ReadRecord>;
  for (const record of getReadRecords(currentRevisions)) {
    records[record.slug] = record;
  }
  return records;
}

export function getReadState(
  slug: string,
  currentRevision?: string | null
): RevisionState | 'unread' {
  const record = getReadRecordMap({ [slug]: currentRevision ?? null })[slug];
  if (!record) return 'unread';
  return record.revisionState;
}

export function toggleRead(slug: string, currentRevision?: string | null): boolean | null {
  return setReadStates([[slug, undefined, currentRevision]]);
}

export function getStats(currentRevisions?: Record<string, string | null>) {
  const store = getStore();
  const records = getReadRecords(currentRevisions);
  const current = records.filter((record) => record.revisionState === 'current').length;
  const stale = records.filter((record) => record.revisionState === 'stale').length;
  const unknown = records.filter((record) => record.revisionState === 'unknown').length;
  return {
    version: store.version,
    total: store.slugs.length,
    current,
    stale,
    unknown,
    slugs: [...store.slugs],
    records,
    lastUpdated: store.lastUpdated,
  };
}

export function exportJson(): string {
  return JSON.stringify(getStore(), null, 2);
}

export function importReadStore(value: unknown): boolean {
  const parsed = parseReadStore(value);
  if (parsed?.version === 2) {
    return saveStore(parsed);
  }
  if (parsed?.version === 1) {
    const migrated = migrateV1(parsed);
    if (!saveStore(migrated)) return false;
    recordV1Migration(migrated);
    return true;
  }
  return false;
}

export function importJson(json: string): boolean {
  try {
    return importReadStore(JSON.parse(json));
  } catch {
    // ignore parse errors
  }
  return false;
}
