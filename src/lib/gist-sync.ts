const GIST_DESCRIPTION = 'gu-log Reading Tracker (auto-synced)';
const GIST_FILENAME = 'gu-log-reading-tracker.json';
const GIST_ID_KEY = 'gu-log-gist-id';

export interface GistReadStore {
  version: 1;
  slugs: string[];
  lastUpdated: string;
}

/** Decode a base64url string (JWT-safe variant). */
function b64urlDecode(s: string): string {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}

/**
 * Try to extract a GitHub token from the stored JWT, falling back to a
 * manually stored PAT.  Returns null if neither is available.
 */
export function getGitHubToken(): string | null {
  const jwt = localStorage.getItem('gu-log-jwt');
  if (jwt) {
    try {
      const parts = jwt.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(b64urlDecode(parts[1]));
        const tok: unknown =
          payload.github_token ?? payload.access_token ?? payload.gh_token ?? payload.token;
        if (tok && typeof tok === 'string' && tok.length > 10) {
          return tok;
        }
      }
    } catch {
      // ignore decode errors
    }
  }
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

function apiError(status: number, fallback: string): Error {
  if (status === 401) return new Error('Token 無效或已過期');
  if (status === 403) return new Error('GitHub API 速率限制，請稍後再試');
  if (status === 404) return new Error('Gist 不存在');
  return new Error(`${fallback}：HTTP ${status}`);
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
  if (!listResp.ok) throw apiError(listResp.status, 'GitHub API 錯誤');
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
          content: JSON.stringify(
            { version: 1, slugs: [], lastUpdated: new Date().toISOString() },
            null,
            2
          ),
        },
      },
    }),
  });
  if (!createResp.ok) throw apiError(createResp.status, '無法建立 Gist');
  const created: { id: string } = await createResp.json();
  localStorage.setItem(GIST_ID_KEY, created.id);
  return created.id;
}

export async function pushToGist(token: string, slugs: string[]): Promise<void> {
  const gistId = await findOrCreateGist(token);
  const data: GistReadStore = { version: 1, slugs, lastUpdated: new Date().toISOString() };
  const resp = await ghFetch(`https://api.github.com/gists/${gistId}`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      files: { [GIST_FILENAME]: { content: JSON.stringify(data, null, 2) } },
    }),
  });
  if (!resp.ok) throw apiError(resp.status, '推送失敗');
}

export async function pullFromGist(token: string): Promise<GistReadStore | null> {
  const gistId = await findOrCreateGist(token);
  const resp = await ghFetch(`https://api.github.com/gists/${gistId}`, token);
  if (!resp.ok) throw apiError(resp.status, '拉取失敗');
  const gist: { files: Record<string, { content: string }> } = await resp.json();
  const file = gist.files?.[GIST_FILENAME];
  if (!file?.content) return null;
  try {
    const parsed = JSON.parse(file.content);
    if (parsed.version === 1 && Array.isArray(parsed.slugs)) {
      return parsed as GistReadStore;
    }
  } catch {
    // ignore
  }
  return null;
}

/** Union merge — never loses data from either side. */
export function mergeSync(localSlugs: string[], remoteSlugs: string[]): string[] {
  return [...new Set([...localSlugs, ...remoteSlugs])];
}
