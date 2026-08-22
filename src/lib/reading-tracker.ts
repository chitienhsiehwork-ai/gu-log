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

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isValidSlugList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((slug) => typeof slug === 'string' && slug.length > 0);
}

function parseReadRecord(value: unknown): ReadRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<ReadRecord>;
  const hasSharedFields =
    typeof record.slug === 'string' &&
    record.slug.length > 0 &&
    (record.method === 'manual_mark_read' ||
      record.method === 'legacy_import' ||
      record.method === 'active_scroll_end') &&
    (record.confidence === 'legacy_or_manual' || record.confidence === 'active_finish') &&
    isValidTimestamp(record.lastReadAt);
  if (!hasSharedFields) return null;

  if (
    isValidTimestamp(record.readAt) &&
    record.readAt === record.lastReadAt &&
    (record.readRevision === null || typeof record.readRevision === 'string') &&
    (record.revisionState === 'current' ||
      record.revisionState === 'stale' ||
      record.revisionState === 'unknown')
  ) {
    return {
      slug: record.slug!,
      method: record.method!,
      confidence: record.confidence!,
      readAt: record.readAt,
      lastReadAt: record.lastReadAt!,
      readRevision: record.readRevision,
      revisionState: record.revisionState,
    };
  }

  const legacy = value as {
    readAt?: unknown;
    readRevision?: unknown;
    revisionState?: unknown;
  };
  if (
    legacy.readAt === undefined &&
    legacy.readRevision === undefined &&
    legacy.revisionState === undefined
  ) {
    return {
      slug: record.slug!,
      method: record.method!,
      confidence: record.confidence!,
      readAt: record.lastReadAt!,
      lastReadAt: record.lastReadAt!,
      readRevision: null,
      revisionState: 'unknown',
    };
  }
  return null;
}

export function parseReadStore(value: unknown): ReadStoreV1 | ReadStoreV2 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const store = value as {
    version?: unknown;
    slugs?: unknown;
    records?: unknown;
    lastUpdated?: unknown;
  };
  if (!isValidSlugList(store.slugs) || !isValidTimestamp(store.lastUpdated)) return null;
  const slugs = store.slugs;
  if (new Set(slugs).size !== slugs.length) return null;
  if (store.version === 1) {
    return { version: 1, slugs: [...slugs], lastUpdated: store.lastUpdated };
  }
  if (store.version === 2 && Array.isArray(store.records)) {
    const records: ReadRecord[] = [];
    for (const record of store.records) {
      const parsed = parseReadRecord(record);
      if (!parsed) return null;
      records.push(parsed);
    }
    const recordSlugs = records.map((record) => record.slug);
    const recordSlugSet = new Set(recordSlugs);
    if (
      recordSlugSet.size !== recordSlugs.length ||
      recordSlugSet.size !== slugs.length ||
      slugs.some((slug) => !recordSlugSet.has(slug))
    ) {
      return null;
    }
    return {
      version: 2,
      slugs: [...slugs],
      records,
      lastUpdated: store.lastUpdated,
    };
  }
  return null;
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

function migrateV1(v1: ReadStoreV1): ReadStoreV2 {
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
