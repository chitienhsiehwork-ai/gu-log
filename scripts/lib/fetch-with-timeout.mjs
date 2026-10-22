import { Buffer } from 'node:buffer';

class FetchTimeoutError extends Error {}

/**
 * Fetch a URL and read its whole body under one deadline per attempt.
 *
 * Only timeouts are retried: the npm bulk advisory endpoint occasionally
 * leaves a connection hanging, and a fresh connection usually answers within
 * seconds. Every other failure (network error, malformed body) is thrown as-is
 * so callers stay fail-closed.
 *
 * @param {string} url
 * @param {RequestInit} init
 * @param {{ label: string, timeoutMs: number, fetchImpl?: typeof fetch, attempts?: number }} options
 * @returns {Promise<{ response: Response, wire: Buffer }>}
 */
export async function fetchBytesWithTimeout(
  url,
  init,
  { label, timeoutMs, fetchImpl = globalThis.fetch, attempts = 2 }
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`${label} timeout must be a positive integer`);
  }

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetchOnce(url, init, label, fetchImpl, timeoutMs);
    } catch (error) {
      if (!(error instanceof FetchTimeoutError) || attempt >= attempts) throw error;
      console.warn(`${error.message}; retrying (attempt ${attempt + 1}/${attempts})`);
    }
  }
}

async function fetchOnce(url, init, label, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timeoutError = new FetchTimeoutError(`${label} timed out after ${timeoutMs}ms`);
  const timedOut = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(timeoutError), { once: true });
  });
  const timeout = setTimeout(() => {
    controller.abort(timeoutError);
  }, timeoutMs);

  try {
    const response = await Promise.race([
      fetchImpl(url, { ...init, signal: controller.signal }),
      timedOut,
    ]);
    const body = await Promise.race([response.arrayBuffer(), timedOut]);
    return { response, wire: Buffer.from(body) };
  } catch (error) {
    if (controller.signal.aborted) {
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
