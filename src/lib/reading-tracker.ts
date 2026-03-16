const STORAGE_KEY = 'gu-log-read-articles';

interface ReadStore {
  version: 1;
  slugs: string[];
  lastUpdated: string;
}

function getStore(): ReadStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.version === 1 && Array.isArray(parsed.slugs)) {
        return parsed as ReadStore;
      }
    }
  } catch {
    // ignore
  }
  return { version: 1, slugs: [], lastUpdated: new Date().toISOString() };
}

function saveStore(store: ReadStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore storage errors (private mode / quota)
  }
}

export function markAsRead(slug: string): void {
  const store = getStore();
  if (!store.slugs.includes(slug)) {
    store.slugs.push(slug);
    store.lastUpdated = new Date().toISOString();
    saveStore(store);
  }
}

export function markAsUnread(slug: string): void {
  const store = getStore();
  store.slugs = store.slugs.filter((s) => s !== slug);
  store.lastUpdated = new Date().toISOString();
  saveStore(store);
}

export function isRead(slug: string): boolean {
  return getStore().slugs.includes(slug);
}

export function getReadSlugs(): string[] {
  return [...getStore().slugs];
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
  return { total: store.slugs.length, slugs: [...store.slugs], lastUpdated: store.lastUpdated };
}

export function exportJson(): string {
  return JSON.stringify(getStore(), null, 2);
}

export function importJson(json: string): boolean {
  try {
    const parsed = JSON.parse(json);
    if (parsed.version === 1 && Array.isArray(parsed.slugs)) {
      saveStore(parsed as ReadStore);
      return true;
    }
  } catch {
    // ignore parse errors
  }
  return false;
}
