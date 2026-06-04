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

interface ReadStoreV1 {
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

function nowIso(): string {
  return new Date().toISOString();
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

  for (const slug of slugs) {
    recordLegacyImportedRead(slug, importedAt);
  }

  return {
    version: 2,
    slugs,
    records,
    lastUpdated: importedAt,
  };
}

function emptyStore(): ReadStoreV2 {
  return { version: 2, slugs: [], records: [], lastUpdated: nowIso() };
}

function normalizeRecord(raw: unknown, fallbackReadAt: string): ReadRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Partial<ReadRecord>;
  if (typeof record.slug !== 'string' || record.slug.length === 0) return null;
  const method: ReadMethod =
    record.method === 'active_scroll_end' || record.method === 'manual_mark_read'
      ? record.method
      : 'legacy_import';
  const confidence: ReadConfidence =
    record.confidence === 'active_finish' ? 'active_finish' : 'legacy_or_manual';
  const readAt =
    typeof record.readAt === 'string'
      ? record.readAt
      : typeof record.lastReadAt === 'string'
        ? record.lastReadAt
        : fallbackReadAt;
  const readRevision = typeof record.readRevision === 'string' ? record.readRevision : null;
  const state: RevisionState =
    record.revisionState === 'current' || record.revisionState === 'stale'
      ? record.revisionState
      : revisionState(readRevision);
  return {
    slug: record.slug,
    method,
    confidence,
    readAt,
    lastReadAt: readAt,
    readRevision,
    revisionState: state,
  };
}

function normalizeV2(parsed: Partial<ReadStoreV2>): ReadStoreV2 {
  const fallbackReadAt = typeof parsed.lastUpdated === 'string' ? parsed.lastUpdated : nowIso();
  const slugs = uniqueSlugs(parsed.slugs);
  const records = Array.isArray(parsed.records)
    ? parsed.records
        .map((record) => normalizeRecord(record, fallbackReadAt))
        .filter((record): record is ReadRecord => Boolean(record))
    : slugs.map((slug) =>
        makeRecord(slug, fallbackReadAt, 'legacy_import', 'legacy_or_manual', null)
      );

  for (const record of records) {
    if (!slugs.includes(record.slug)) slugs.push(record.slug);
  }

  return {
    version: 2,
    slugs,
    records,
    lastUpdated: fallbackReadAt,
  };
}

function getStore(): ReadStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.version === 2 && Array.isArray(parsed.slugs)) {
        return normalizeV2(parsed as Partial<ReadStoreV2>);
      }
      if (parsed.version === 1 && Array.isArray(parsed.slugs)) {
        const migrated = migrateV1(parsed as ReadStoreV1);
        saveStore(migrated);
        return migrated;
      }
    }
  } catch {
    // ignore
  }
  return emptyStore();
}

function saveStore(store: ReadStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore storage errors (private mode / quota)
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

export function markAsRead(
  slug: string,
  method: ReadMethod = 'manual_mark_read',
  currentRevision?: string | null
): void {
  const store = getStore();
  if (store.slugs.indexOf(slug) === -1) {
    store.slugs.push(slug);
  }
  upsertReadRecord(store, slug, method, currentRevision);
  store.lastUpdated = nowIso();
  saveStore(store);
}

export function markAsUnread(slug: string): void {
  const store = getStore();
  store.slugs = store.slugs.filter((s) => s !== slug);
  store.records = store.records.filter((record) => record.slug !== slug);
  store.lastUpdated = nowIso();
  saveStore(store);
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
  return getReadRecords(currentRevisions).reduce<Record<string, ReadRecord>>((acc, record) => {
    acc[record.slug] = record;
    return acc;
  }, {});
}

export function getReadState(
  slug: string,
  currentRevision?: string | null
): RevisionState | 'unread' {
  const record = getReadRecordMap({ [slug]: currentRevision ?? null })[slug];
  if (!record) return 'unread';
  return record.revisionState;
}

export function toggleRead(slug: string, currentRevision?: string | null): boolean {
  if (isRead(slug)) {
    markAsUnread(slug);
    return false;
  } else {
    markAsRead(slug, 'manual_mark_read', currentRevision);
    return true;
  }
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

export function importJson(json: string): boolean {
  try {
    const parsed = JSON.parse(json);
    if (parsed.version === 2 && Array.isArray(parsed.slugs)) {
      saveStore(normalizeV2(parsed as Partial<ReadStoreV2>));
      return true;
    }
    if (parsed.version === 1 && Array.isArray(parsed.slugs)) {
      saveStore(migrateV1(parsed as ReadStoreV1));
      return true;
    }
  } catch {
    // ignore parse errors
  }
  return false;
}
