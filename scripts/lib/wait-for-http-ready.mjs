/**
 * Poll an HTTP endpoint until it returns a successful response.
 *
 * @param {string} url
 * @param {{
 *   timeoutMs?: number,
 *   pollIntervalMs?: number,
 *   fetchImpl?: typeof fetch,
 * }} options
 * @returns {Promise<boolean>}
 */
export async function waitForHttpReady(
  url,
  { timeoutMs = 30_000, pollIntervalMs = 500, fetchImpl = globalThis.fetch } = {}
) {
  const controller = new AbortController();
  const deadlineAt = Date.now() + timeoutMs;
  const timedOut = Symbol('http-readiness-timeout');
  let timeoutId;
  const deadline = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve(timedOut);
    }, timeoutMs);
  });

  try {
    while (Date.now() < deadlineAt) {
      const request = Promise.resolve()
        .then(() => fetchImpl(url, { signal: controller.signal }))
        .then(
          (response) => ({ response }),
          (error) => ({ error })
        );
      const result = await Promise.race([request, deadline]);

      if (result === timedOut || Date.now() >= deadlineAt) return false;
      if (result.response?.ok) return true;

      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) return false;
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remainingMs)));
    }
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}
