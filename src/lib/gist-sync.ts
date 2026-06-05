const GIST_DESCRIPTION = 'gu-log Reading Tracker (auto-synced)';
const GIST_FILENAME = 'gu-log-reading-tracker.json';
const GIST_ID_KEY = 'gu-log-gist-id';

import type { ReadRecord, ReadStoreV2 } from './reading-tracker';

export interface GistReadStoreV1 {
  version: 1;
  slugs: string[];
  lastUpdated: string;
}

export type GistReadStore = GistReadStoreV1 | ReadStoreV2;

export class ReaderSyncApiError extends Error {
  code: string;
  reauthorizeUrl?: string;

  constructor(message: string, code = 'READER_SYNC_FAILED', reauthorizeUrl?: string) {
    super(message);
    this.name = 'ReaderSyncApiError';
    this.code = code;
    this.reauthorizeUrl = reauthorizeUrl;
  }
}

export function getGuLogSessionToken(): string | null {
  return localStorage.getItem('gu-log-jwt');
}

async function apiFetch(apiUrl: string, init?: RequestInit): Promise<Response> {
  const jwt = getGuLogSessionToken();
  if (!jwt) throw new ReaderSyncApiError('請先登入 GitHub', 'SESSION_EXPIRED');
  return fetch(`${apiUrl.replace(/\/$/, '')}/reader-sync`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

async function readerSyncApiError(resp: Response, fallback: string): Promise<ReaderSyncApiError> {
  let detail: unknown;
  try {
    detail = (await resp.json()).detail;
  } catch {
    detail = null;
  }
  if (detail && typeof detail === 'object') {
    const d = detail as { code?: unknown; message?: unknown; reauthorizeUrl?: unknown };
    return new ReaderSyncApiError(
      typeof d.message === 'string' ? d.message : fallback,
      typeof d.code === 'string' ? d.code : 'READER_SYNC_FAILED',
      typeof d.reauthorizeUrl === 'string' ? d.reauthorizeUrl : undefined
    );
  }
  if (resp.status === 401) return new ReaderSyncApiError('登入已過期，請重新登入', 'SESSION_EXPIRED');
  return new ReaderSyncApiError(`${fallback}：HTTP ${resp.status}`);
}

export async function pullFromReaderSyncApi(apiUrl: string): Promise<GistReadStore | null> {
  const resp = await apiFetch(apiUrl);
  if (!resp.ok) throw await readerSyncApiError(resp, '拉取失敗');
  const payload: { store?: GistReadStore } = await resp.json();
  return payload.store ?? null;
}

export async function pushToReaderSyncApi(
  apiUrl: string,
  store: GistReadStore | string[]
): Promise<void> {
  const data = Array.isArray(store)
    ? normalizeForSync({ version: 1, slugs: store, lastUpdated: new Date().toISOString() })
    : normalizeForSync(store);
  data.lastUpdated = new Date().toISOString();
  const resp = await apiFetch(apiUrl, {
    method: 'PUT',
    body: JSON.stringify({ store: data }),
  });
  if (!resp.ok) throw await readerSyncApiError(resp, '推送失敗');
}

/**
 * Legacy fallback: manually pasted GitHub PAT stored in localStorage.
 * Normal signed-in sync should use gu-log backend mediation instead.
 */
export function getGitHubToken(): string | null {
  return localStorage.getItem('gu-log-github-pat');
}

async function ghFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      ...(init?.headers ?? {}),
    },
  });
}

function githubApiError(status: number, fallback: string): Error {
  if (status === 401) return new Error('Token 無效或已過期');
  if (status === 403) return new Error('GitHub API 速率限制，請稍後再試');
  if (status === 404) return new Error('Gist 不存在');
  return new Error(`${fallback}：HTTP ${status}`);
}

function emptyV2Store(): ReadStoreV2 {
  return { version: 2, slugs: [], records: [], lastUpdated: new Date().toISOString() };
}

function normalizeForSync(store: GistReadStore | null | undefined): ReadStoreV2 {
  if (!store) return emptyV2Store();
  if (store.version === 2 && Array.isArray(store.records)) return store;
  const lastUpdated =
    typeof store.lastUpdated === 'string' ? store.lastUpdated : new Date().toISOString();
  const slugs = Array.isArray(store.slugs) ? [...new Set(store.slugs)] : [];
  return {
    version: 2,
    slugs,
    records: slugs.map((slug) => ({
      slug,
      method: 'legacy_import',
      confidence: 'legacy_or_manual',
      readAt: lastUpdated,
      lastReadAt: lastUpdated,
      readRevision: null,
      revisionState: 'unknown',
    })),
    lastUpdated,
  };
}

function recordTime(record: ReadRecord): number {
  const timestamp = Date.parse(record.readAt || record.lastReadAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export async function findOrCreateGist(token: string): Promise<string> {
  // Fast path: cached id
  const cachedId = localStorage.getItem(GIST_ID_KEY);
  if (cachedId) {
    const r = await ghFetch(`https://api.github.com/gists/${cachedId}`, token);
    if (r.ok) return cachedId;
    localStorage.removeItem(GIST_ID_KEY);
  }

  // Search existing gists (up to 100)
  const listResp = await ghFetch('https://api.github.com/gists?per_page=100', token);
  if (!listResp.ok) throw githubApiError(listResp.status, 'GitHub API 錯誤');
  const gists: Array<{ id: string; description: string }> = await listResp.json();
  const existing = gists.find((g) => g.description === GIST_DESCRIPTION);
  if (existing) {
    localStorage.setItem(GIST_ID_KEY, existing.id);
    return existing.id;
  }

  // Create a new private gist
  const createResp = await ghFetch('https://api.github.com/gists', token, {
    method: 'POST',
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      public: false,
      files: {
        [GIST_FILENAME]: {
          content: JSON.stringify(emptyV2Store(), null, 2),
        },
      },
    }),
  });
  if (!createResp.ok) throw githubApiError(createResp.status, '無法建立 Gist');
  const created: { id: string } = await createResp.json();
  localStorage.setItem(GIST_ID_KEY, created.id);
  return created.id;
}

export async function pushToGist(token: string, store: GistReadStore | string[]): Promise<void> {
  const gistId = await findOrCreateGist(token);
  const data = Array.isArray(store)
    ? normalizeForSync({ version: 1, slugs: store, lastUpdated: new Date().toISOString() })
    : normalizeForSync(store);
  data.lastUpdated = new Date().toISOString();
  const resp = await ghFetch(`https://api.github.com/gists/${gistId}`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      files: { [GIST_FILENAME]: { content: JSON.stringify(data, null, 2) } },
    }),
  });
  if (!resp.ok) throw githubApiError(resp.status, '推送失敗');
}

export async function pullFromGist(token: string): Promise<GistReadStore | null> {
  const gistId = await findOrCreateGist(token);
  const resp = await ghFetch(`https://api.github.com/gists/${gistId}`, token);
  if (!resp.ok) throw githubApiError(resp.status, '拉取失敗');
  const gist: { files: Record<string, { content: string }> } = await resp.json();
  const file = gist.files?.[GIST_FILENAME];
  if (!file?.content) return null;
  try {
    const parsed = JSON.parse(file.content);
    if (parsed.version === 1 && Array.isArray(parsed.slugs)) {
      return parsed as GistReadStoreV1;
    }
    if (parsed.version === 2 && Array.isArray(parsed.slugs) && Array.isArray(parsed.records)) {
      return parsed as ReadStoreV2;
    }
  } catch {
    // ignore
  }
  return null;
}

/** Merge per-article records — keep the record with the newest read timestamp. */
export function mergeSync(
  local: GistReadStore | string[],
  remote: GistReadStore | string[]
): ReadStoreV2 {
  const localStore = normalizeForSync(
    Array.isArray(local)
      ? { version: 1, slugs: local, lastUpdated: new Date().toISOString() }
      : local
  );
  const remoteStore = normalizeForSync(
    Array.isArray(remote)
      ? { version: 1, slugs: remote, lastUpdated: new Date().toISOString() }
      : remote
  );
  const bySlug = new Map<string, ReadRecord>();

  for (const record of [...localStore.records, ...remoteStore.records]) {
    const existing = bySlug.get(record.slug);
    if (!existing || recordTime(record) >= recordTime(existing)) {
      bySlug.set(record.slug, { ...record });
    }
  }

  const slugs = [...new Set([...localStore.slugs, ...remoteStore.slugs, ...bySlug.keys()])];
  return {
    version: 2,
    slugs,
    records: slugs
      .map((slug) => bySlug.get(slug))
      .filter((record): record is ReadRecord => Boolean(record)),
    lastUpdated: new Date(
      Math.max(
        Date.parse(localStore.lastUpdated) || 0,
        Date.parse(remoteStore.lastUpdated) || 0,
        Date.now()
      )
    ).toISOString(),
  };
}
