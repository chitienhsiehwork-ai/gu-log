/**
 * Send pending human-signal events to the gu-log backend (openspec:
 * owner-reader-feedback). Until the backend deploys `/human-signals`, every
 * attempt fails quietly and events stay local-only: reading, marking read and
 * sharing are never affected.
 */
import { getGuLogSessionToken, withDeadline } from './gist-sync';
import {
  applyHumanSignalSyncResult,
  getPendingHumanSignalEvents,
  type HumanSignalEvent,
} from './human-signals';
import { buildPublicApiEndpoint } from './public-api-url';

export const HUMAN_SIGNAL_SYNC_BATCH_SIZE = 50;
export const HUMAN_SIGNAL_SYNC_TIMEOUT_MS = 5_000;

export type HumanSignalSyncOutcome =
  | { status: 'signed_out' }
  | { status: 'idle' }
  | { status: 'unavailable' }
  | { status: 'synced'; accepted: number; rejected: number };

function idsFromResponse(payload: unknown, batch: readonly HumanSignalEvent[]) {
  const sent = new Set(batch.map((event) => event.eventId));
  const body = (payload && typeof payload === 'object' ? payload : {}) as {
    accepted?: unknown;
    rejected?: unknown;
  };
  const accepted = Array.isArray(body.accepted)
    ? body.accepted.filter((id): id is string => typeof id === 'string' && sent.has(id))
    : [];
  const rejected = Array.isArray(body.rejected)
    ? body.rejected
        .map((item) => (item && typeof item === 'object' ? (item as { eventId?: unknown }) : {}))
        .map((item) => item.eventId)
        .filter((id): id is string => typeof id === 'string' && sent.has(id))
    : [];
  return { accepted, rejected };
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
    const { accepted, rejected } = idsFromResponse(payload, batch);
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
