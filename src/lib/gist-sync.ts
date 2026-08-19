const GIST_DESCRIPTION = 'gu-log Reading Tracker (auto-synced)';
const GIST_FILENAME = 'gu-log-reading-tracker.json';
const GIST_ID_KEY = 'gu-log-gist-id';

import { importReadStore, parseReadStore } from './reading-tracker';
import type { ReadRecord, ReadStoreV1, ReadStoreV2 } from './reading-tracker';

export type GistReadStore = ReadStoreV1 | ReadStoreV2;
export const READER_SYNC_TIMEOUT_MS = 15_000;

function safeReauthorizeUrl(value: unknown, apiUrl: string): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const apiBase = new URL(apiUrl);
    if (apiBase.protocol !== 'https:' && apiBase.protocol !== 'http:') return undefined;
    if (apiBase.username || apiBase.password) return undefined;

    const candidate = new URL(value, `${apiBase.origin}/`);
    if (candidate.origin !== apiBase.origin) return undefined;
    if (candidate.pathname !== '/auth/github') return undefined;
    if (candidate.username || candidate.password) return undefined;
    return candidate.href;
  } catch {
    return undefined;
  }
}

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

function invalidPayloadError(): ReaderSyncApiError {
  return new ReaderSyncApiError('同步資料格式不正確', 'READER_SYNC_INVALID_PAYLOAD');
}

function timeoutError(): ReaderSyncApiError {
  return new ReaderSyncApiError('同步逾時，請檢查網路後重試', 'READER_SYNC_TIMEOUT');
}

async function withReaderSyncDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  let deadlineError: ReaderSyncApiError | undefined;
  let timeoutId: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      deadlineError = timeoutError();
      reject(deadlineError);
      // Abort the underlying fetch after settling the deadline promise so the
      // caller always receives the typed timeout instead of a raw AbortError.
      controller.abort();
    }, READER_SYNC_TIMEOUT_MS);
  });

  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } catch (error) {
    if (deadlineError) throw deadlineError;
    throw error;
  } finally {
    clearTimeout(timeoutId!);
  }
}

export function getGuLogSessionToken(): string | null {
  return localStorage.getItem('gu-log-jwt');
}

async function apiFetch(
  apiUrl: string,
  signal: AbortSignal,
  init?: RequestInit
): Promise<Response> {
  const jwt = getGuLogSessionToken();
  if (!jwt) throw new ReaderSyncApiError('請先登入 GitHub', 'SESSION_EXPIRED');
  return fetch(`${apiUrl.replace(/\/$/, '')}/reader-sync`, {
    ...init,
    signal,
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

async function readerSyncApiError(
  resp: Response,
  fallback: string,
  apiUrl: string
): Promise<ReaderSyncApiError> {
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
      safeReauthorizeUrl(d.reauthorizeUrl, apiUrl)
    );
  }
  if (resp.status === 401)
    return new ReaderSyncApiError('登入已過期，請重新登入', 'SESSION_EXPIRED');
  return new ReaderSyncApiError(`${fallback}：HTTP ${resp.status}`);
}

export async function pullFromReaderSyncApi(apiUrl: string): Promise<GistReadStore | null> {
  return withReaderSyncDeadline(async (signal) => {
    const resp = await apiFetch(apiUrl, signal);
    if (!resp.ok) throw await readerSyncApiError(resp, '拉取失敗', apiUrl);
    let payload: unknown;
    try {
      payload = await resp.json();
    } catch {
      throw invalidPayloadError();
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw invalidPayloadError();
    }
    if (!Object.hasOwn(payload, 'store')) throw invalidPayloadError();
    const store = (payload as { store?: unknown }).store;
    if (store === null) return null;
    const parsed = parseReadStore(store);
    if (!parsed) throw invalidPayloadError();
    return parsed;
  });
}

export function importSyncStore(store: unknown): void {
  if (!importReadStore(store)) throw invalidPayloadError();
}

export async function pushToReaderSyncApi(
  apiUrl: string,
  store: GistReadStore | string[]
): Promise<void> {
  return withReaderSyncDeadline(async (signal) => {
    const data = Array.isArray(store)
      ? normalizeForSync({ version: 1, slugs: store, lastUpdated: new Date().toISOString() })
      : normalizeForSync(store);
    data.lastUpdated = new Date().toISOString();
    const resp = await apiFetch(apiUrl, signal, {
      method: 'PUT',
      body: JSON.stringify({ store: data }),
    });
    if (!resp.ok) throw await readerSyncApiError(resp, '推送失敗', apiUrl);
  });
}

/**
 * Legacy fallback: manually pasted GitHub PAT stored in localStorage.
 * Normal signed-in sync should use gu-log backend mediation instead.
 */
export function getGitHubToken(): string | null {
  return localStorage.getItem('gu-log-github-pat');
}

async function ghFetch(
  url: string,
  token: string,
  signal: AbortSignal,
  init?: RequestInit
): Promise<Response> {
  return fetch(url, {
    ...init,
    signal,
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

async function findOrCreateGistWithSignal(token: string, signal: AbortSignal): Promise<string> {
  // Fast path: cached id
  const cachedId = localStorage.getItem(GIST_ID_KEY);
  if (cachedId) {
    const r = await ghFetch(`https://api.github.com/gists/${cachedId}`, token, signal);
    if (r.ok) return cachedId;
    localStorage.removeItem(GIST_ID_KEY);
  }

  // Search existing gists (up to 100)
  const listResp = await ghFetch('https://api.github.com/gists?per_page=100', token, signal);
  if (!listResp.ok) throw githubApiError(listResp.status, 'GitHub API 錯誤');
  const gists: Array<{ id: string; description: string }> = await listResp.json();
  const existing = gists.find((g) => g.description === GIST_DESCRIPTION);
  if (existing) {
    localStorage.setItem(GIST_ID_KEY, existing.id);
    return existing.id;
  }

  // Create a new private gist
  const createResp = await ghFetch('https://api.github.com/gists', token, signal, {
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

export async function findOrCreateGist(token: string): Promise<string> {
  return withReaderSyncDeadline((signal) => findOrCreateGistWithSignal(token, signal));
}

export async function pushToGist(token: string, store: GistReadStore | string[]): Promise<void> {
  return withReaderSyncDeadline(async (signal) => {
    const gistId = await findOrCreateGistWithSignal(token, signal);
    const data = Array.isArray(store)
      ? normalizeForSync({ version: 1, slugs: store, lastUpdated: new Date().toISOString() })
      : normalizeForSync(store);
    data.lastUpdated = new Date().toISOString();
    const resp = await ghFetch(`https://api.github.com/gists/${gistId}`, token, signal, {
      method: 'PATCH',
      body: JSON.stringify({
        files: { [GIST_FILENAME]: { content: JSON.stringify(data, null, 2) } },
      }),
    });
    if (!resp.ok) throw githubApiError(resp.status, '推送失敗');
  });
}

export async function pullFromGist(token: string): Promise<GistReadStore | null> {
  return withReaderSyncDeadline(async (signal) => {
    const gistId = await findOrCreateGistWithSignal(token, signal);
    const resp = await ghFetch(`https://api.github.com/gists/${gistId}`, token, signal);
    if (!resp.ok) throw githubApiError(resp.status, '拉取失敗');
    let gist: unknown;
    try {
      gist = await resp.json();
    } catch {
      throw invalidPayloadError();
    }
    if (!gist || typeof gist !== 'object' || Array.isArray(gist)) throw invalidPayloadError();
    const files = (gist as { files?: unknown }).files;
    if (!files || typeof files !== 'object' || Array.isArray(files)) throw invalidPayloadError();
    if (!Object.hasOwn(files, GIST_FILENAME)) return null;
    const file = (files as Record<string, unknown>)[GIST_FILENAME];
    if (!file || typeof file !== 'object' || Array.isArray(file)) throw invalidPayloadError();
    if (!Object.hasOwn(file, 'content')) throw invalidPayloadError();
    const content = (file as { content?: unknown }).content;
    if (typeof content !== 'string') throw invalidPayloadError();
    try {
      const parsed = parseReadStore(JSON.parse(content));
      if (parsed) return parsed;
    } catch {
      // handled below
    }
    throw invalidPayloadError();
  });
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
