import { recordLegacyImportedRead } from './human-signals';

const STORAGE_KEY = 'gu-log-read-articles';

type ReadMethod = 'manual_mark_read' | 'legacy_import' | 'active_scroll_end';
type ReadConfidence = 'legacy_or_manual' | 'active_finish';

interface ReadRecord {
  slug: string;
  method: ReadMethod;
  confidence: ReadConfidence;
  lastReadAt: string;
}

interface ReadStoreV1 {
  version: 1;
  slugs: string[];
  lastUpdated: string;
}

interface ReadStoreV2 {
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

function migrateV1(v1: ReadStoreV1): ReadStoreV2 {
  const slugs = uniqueSlugs(v1.slugs);
  const importedAt = typeof v1.lastUpdated === 'string' ? v1.lastUpdated : nowIso();
  const records = slugs.map((slug) => ({
    slug,
    method: 'legacy_import' as const,
    confidence: 'legacy_or_manual' as const,
    lastReadAt: importedAt,
  }));

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

function normalizeV2(parsed: Partial<ReadStoreV2>): ReadStoreV2 {
  const slugs = uniqueSlugs(parsed.slugs);
  const records = Array.isArray(parsed.records)
    ? parsed.records.filter(
        (record): record is ReadRecord =>
          typeof record === 'object' &&
          record !== null &&
          typeof record.slug === 'string' &&
          typeof record.method === 'string' &&
          typeof record.confidence === 'string' &&
          typeof record.lastReadAt === 'string'
      )
    : slugs.map((slug) => ({
        slug,
        method: 'legacy_import' as const,
        confidence: 'legacy_or_manual' as const,
        lastReadAt: typeof parsed.lastUpdated === 'string' ? parsed.lastUpdated : nowIso(),
      }));

  return {
    version: 2,
    slugs,
    records,
    lastUpdated: typeof parsed.lastUpdated === 'string' ? parsed.lastUpdated : nowIso(),
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

function upsertReadRecord(store: ReadStore, slug: string, method: ReadMethod): void {
  const lastReadAt = nowIso();
  const confidence: ReadConfidence =
    method === 'active_scroll_end' ? 'active_finish' : 'legacy_or_manual';
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
    existing.lastReadAt = lastReadAt;
  } else {
    store.records.push({ slug, method, confidence, lastReadAt });
  }
}

export function markAsRead(slug: string, method: ReadMethod = 'manual_mark_read'): void {
  const store = getStore();
  if (store.slugs.indexOf(slug) === -1) {
    store.slugs.push(slug);
  }
  upsertReadRecord(store, slug, method);
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

export function getReadRecords(): ReadRecord[] {
  return getStore().records.map((record) => ({ ...record }));
}

export function toggleRead(slug: string): boolean {
  if (isRead(slug)) {
    markAsUnread(slug);
    return false;
  } else {
    markAsRead(slug);
    return true;
  }
}

export function getStats() {
  const store = getStore();
  return {
    version: store.version,
    total: store.slugs.length,
    slugs: [...store.slugs],
    records: getReadRecords(),
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
