const SIGNAL_STORAGE_KEY = 'gu-log-human-signals';

export type HumanSignalKind =
  | 'read_finish'
  | 'read_abandon_candidate'
  | 'share_intent'
  | 'feedback_comment';
export type GuLogLang = 'zh-tw' | 'en';
export type ReaderTrustTier = 'owner_trusted' | 'guest_reference' | 'unknown';
export type SignalSyncStatus = 'local_only' | 'synced' | 'sync_failed';
export type SignalTransport = 'local_storage';

export type ArticleVersionSnapshot = {
  postId: string;
  ticketId?: string;
  lang: GuLogLang;
  pathname: string;
  postVersion: number | string;
  contentVersion?: number | string;
};

type BaseHumanSignalEvent = {
  eventSchemaVersion: 1;
  eventId: string;
  kind: HumanSignalKind;
  postId: string;
  ticketId?: string;
  lang: GuLogLang;
  pathname: string;
  postVersion: number;
  contentVersion?: number;
  occurredAt: string;
  reader?: string;
  readerTrustTier: ReaderTrustTier;
  transport: SignalTransport;
  syncStatus: SignalSyncStatus;
};

export type ReadFinishMethod = 'active_scroll_end' | 'manual_mark_read' | 'legacy_import';
export type FinishabilityState =
  | 'finished'
  | 'manually_marked_read'
  | 'abandoned_suspected_boring'
  | 'abandoned_unknown';
export type SignalConfidence = 'active_finish' | 'legacy_or_manual' | 'low';

export type ReadFinishEvent = BaseHumanSignalEvent & {
  kind: 'read_finish';
  method: ReadFinishMethod;
  finishability: FinishabilityState;
  confidence: SignalConfidence;
  activeReadMs?: number;
  maxScrollPercent?: number;
};

export type ReadAbandonCandidateEvent = BaseHumanSignalEvent & {
  kind: 'read_abandon_candidate';
  finishability: Extract<FinishabilityState, 'abandoned_suspected_boring' | 'abandoned_unknown'>;
  confidence: Extract<SignalConfidence, 'low'>;
  activeReadMs?: number;
  maxScrollPercent?: number;
};

export type ShareTarget = 'native' | 'x' | 'facebook' | 'line' | 'copy_link';
export type ShareResult = 'attempted' | 'completed' | 'cancelled' | 'failed';
export type ShareReactionStrength = 'strong';
export type SharePolarity = 'unknown' | 'positive' | 'useful' | 'ridicule' | 'negative';

export type ShareIntentEvent = BaseHumanSignalEvent & {
  kind: 'share_intent';
  target: ShareTarget;
  result: ShareResult;
  resultConfidence: 'attempted' | 'completed' | 'cancelled' | 'failed';
  reactionStrength: ShareReactionStrength;
  polarity: SharePolarity;
};

export type HumanSignalEvent = ReadFinishEvent | ReadAbandonCandidateEvent | ShareIntentEvent;

type HumanSignalStore = {
  version: 1;
  events: HumanSignalEvent[];
  lastUpdated: string;
};

function toPositiveInteger(value: number | string): number {
  const parsed = typeof value === 'number' ? value : parseInt(value, 10);
  return isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeEventId(kind: HumanSignalKind): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `hs_${kind}_${Date.now().toString(36)}_${random}`;
}

function normalizeSnapshot(snapshot: ArticleVersionSnapshot) {
  return {
    postId: snapshot.postId,
    ticketId: snapshot.ticketId,
    lang: snapshot.lang,
    pathname: snapshot.pathname,
    postVersion: toPositiveInteger(snapshot.postVersion),
    contentVersion:
      snapshot.contentVersion === undefined
        ? undefined
        : toPositiveInteger(snapshot.contentVersion),
  };
}

function getStore(): HumanSignalStore {
  try {
    const raw = localStorage.getItem(SIGNAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<HumanSignalStore>;
      if (parsed.version === 1 && Array.isArray(parsed.events)) {
        return {
          version: 1,
          events: parsed.events as HumanSignalEvent[],
          lastUpdated: typeof parsed.lastUpdated === 'string' ? parsed.lastUpdated : nowIso(),
        };
      }
    }
  } catch {
    // Treat corrupted local state as empty; this store is advisory until synced.
  }
  return { version: 1, events: [], lastUpdated: nowIso() };
}

function saveStore(store: HumanSignalStore): void {
  try {
    localStorage.setItem(SIGNAL_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Browser storage can fail in private mode or quota pressure. Ignore locally.
  }
}

export function getHumanSignalEvents(): HumanSignalEvent[] {
  return [...getStore().events];
}

export function appendHumanSignalEvent(event: HumanSignalEvent): HumanSignalEvent {
  const store = getStore();
  store.events.push(event);
  store.lastUpdated = nowIso();
  saveStore(store);
  return event;
}

function baseEvent(kind: HumanSignalKind, snapshot: ArticleVersionSnapshot): BaseHumanSignalEvent {
  return {
    eventSchemaVersion: 1,
    eventId: makeEventId(kind),
    kind,
    ...normalizeSnapshot(snapshot),
    occurredAt: nowIso(),
    readerTrustTier: 'unknown',
    transport: 'local_storage',
    syncStatus: 'local_only',
  };
}

export function recordReadFinish(
  snapshot: ArticleVersionSnapshot,
  metrics: {
    method: ReadFinishMethod;
    activeReadMs?: number;
    maxScrollPercent?: number;
  }
): ReadFinishEvent {
  const event: ReadFinishEvent = {
    ...baseEvent('read_finish', snapshot),
    kind: 'read_finish',
    method: metrics.method,
    finishability: metrics.method === 'active_scroll_end' ? 'finished' : 'manually_marked_read',
    confidence: metrics.method === 'active_scroll_end' ? 'active_finish' : 'legacy_or_manual',
    activeReadMs: metrics.activeReadMs,
    maxScrollPercent: metrics.maxScrollPercent,
  };
  return appendHumanSignalEvent(event) as ReadFinishEvent;
}

export function recordManualMarkRead(snapshot: ArticleVersionSnapshot): ReadFinishEvent {
  return recordReadFinish(snapshot, { method: 'manual_mark_read' });
}

export function recordLegacyImportedRead(slug: string, importedAt?: string): ReadFinishEvent {
  const event: ReadFinishEvent = {
    eventSchemaVersion: 1,
    eventId: makeEventId('read_finish'),
    kind: 'read_finish',
    postId: slug,
    lang: 'zh-tw',
    pathname: `/posts/${slug}/`,
    postVersion: 1,
    occurredAt: importedAt || nowIso(),
    readerTrustTier: 'unknown',
    transport: 'local_storage',
    syncStatus: 'local_only',
    method: 'legacy_import',
    finishability: 'manually_marked_read',
    confidence: 'legacy_or_manual',
  };
  return appendHumanSignalEvent(event) as ReadFinishEvent;
}

export function recordReadAbandonCandidate(
  snapshot: ArticleVersionSnapshot,
  metrics: {
    activeReadMs?: number;
    maxScrollPercent?: number;
    finishability?: Extract<FinishabilityState, 'abandoned_suspected_boring' | 'abandoned_unknown'>;
  }
): ReadAbandonCandidateEvent {
  const event: ReadAbandonCandidateEvent = {
    ...baseEvent('read_abandon_candidate', snapshot),
    kind: 'read_abandon_candidate',
    finishability: metrics.finishability || 'abandoned_unknown',
    confidence: 'low',
    activeReadMs: metrics.activeReadMs,
    maxScrollPercent: metrics.maxScrollPercent,
  };
  return appendHumanSignalEvent(event) as ReadAbandonCandidateEvent;
}

export function recordShareIntent(
  snapshot: ArticleVersionSnapshot,
  share: { target: ShareTarget; result: ShareResult }
): ShareIntentEvent {
  const event: ShareIntentEvent = {
    ...baseEvent('share_intent', snapshot),
    kind: 'share_intent',
    target: share.target,
    result: share.result,
    resultConfidence: share.result,
    reactionStrength: 'strong',
    polarity: 'unknown',
  };
  return appendHumanSignalEvent(event) as ShareIntentEvent;
}
