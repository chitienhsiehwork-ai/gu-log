/**
 * Send pending human-signal events to the gu-log backend (openspec:
 * owner-reader-feedback). Until the backend deploys `/human-signals`, every
 * attempt fails quietly and events stay local-only: reading, marking read and
 * sharing are never affected.
 */
import { getGuLogSessionToken, withDeadline } from './gist-sync';
import {
  HUMAN_SIGNAL_RECORDED_EVENT,
  applyHumanSignalSyncResult,
  getPendingHumanSignalEvents,
} from './human-signals';
import { buildPublicApiEndpoint } from './public-api-url';

export const HUMAN_SIGNAL_SYNC_BATCH_SIZE = 50;
export const HUMAN_SIGNAL_SYNC_TIMEOUT_MS = 5_000;
const RECORD_DEBOUNCE_MS = 2_000;

export type HumanSignalSyncOutcome =
  | { status: 'signed_out' }
  | { status: 'idle' }
  | { status: 'unavailable' }
  | { status: 'synced'; accepted: number; rejected: number };

function idsFromResponse(payload: unknown) {
  const body = (payload ?? {}) as { accepted?: unknown; rejected?: unknown };
  const ids = (list: unknown[]) => list.filter((id): id is string => typeof id === 'string');
  return {
    accepted: Array.isArray(body.accepted) ? ids(body.accepted) : [],
    rejected: Array.isArray(body.rejected)
      ? ids(body.rejected.map((item) => (item as { eventId?: unknown } | null)?.eventId))
      : [],
  };
}

/** Send one batch of pending events. Never throws. */
export async function syncHumanSignalBatch(apiUrl: string): Promise<HumanSignalSyncOutcome> {
  const jwt = getGuLogSessionToken();
  if (!jwt) return { status: 'signed_out' };
  const batch = getPendingHumanSignalEvents().slice(0, HUMAN_SIGNAL_SYNC_BATCH_SIZE);
  if (batch.length === 0) return { status: 'idle' };

  try {
    const endpoint = buildPublicApiEndpoint(apiUrl, '/human-signals');
    const payload = await withDeadline(
      HUMAN_SIGNAL_SYNC_TIMEOUT_MS,
      async (signal) => {
        const resp = await fetch(endpoint, {
          method: 'POST',
          keepalive: true,
          signal,
          headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ events: batch }),
        });
        if (!resp.ok) return null;
        return (await resp.json()) as unknown;
      },
      () => new Error('human-signal sync timed out')
    );
    if (payload === null) return { status: 'unavailable' };
    const { accepted, rejected } = idsFromResponse(payload);
    applyHumanSignalSyncResult({ accepted, rejected });
    return { status: 'synced', accepted: accepted.length, rejected: rejected.length };
  } catch {
    return { status: 'unavailable' };
  }
}

/** Keep sending batches while the backend makes progress. Never throws. */
export async function syncPendingHumanSignals(apiUrl: string): Promise<HumanSignalSyncOutcome> {
  for (;;) {
    const outcome = await syncHumanSignalBatch(apiUrl);
    if (outcome.status !== 'synced' || outcome.accepted + outcome.rejected === 0) return outcome;
  }
}

/**
 * Article-page wiring: sync on load, shortly after each recorded event, and one
 * batch on pagehide. Does nothing for signed-out readers.
 */
export function initHumanSignalSync(apiUrl: string): void {
  if (!getGuLogSessionToken()) return;
  let inFlight: Promise<unknown> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const syncAll = () => {
    if (inFlight) return;
    inFlight = syncPendingHumanSignals(apiUrl).finally(() => {
      inFlight = null;
    });
  };

  window.addEventListener(HUMAN_SIGNAL_RECORDED_EVENT, () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(syncAll, RECORD_DEBOUNCE_MS);
  });

  const start = () => {
    // Registered after every component script has run, so pagehide recorders
    // (e.g. abandon candidates) store their event before this batch is read.
    window.addEventListener('pagehide', () => {
      void syncHumanSignalBatch(apiUrl);
    });
    syncAll();
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
