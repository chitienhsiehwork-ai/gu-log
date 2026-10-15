const SIGNAL_STORAGE_KEY = 'gu-log-human-signals';
/** Window event fired after an event is stored, so the sync layer can debounce a send. */
export const HUMAN_SIGNAL_RECORDED_EVENT = 'gu-log:human-signal-recorded';

export type HumanSignalKind =
  'read_finish' | 'read_abandon_candidate' | 'share_intent' | 'feedback_comment';
export type GuLogLang = 'zh-tw' | 'en';
export type ReaderTrustTier = 'owner_trusted' | 'owner_approved' | 'guest_reference' | 'unknown';
export type SignalSyncStatus = 'local_only' | 'synced' | 'sync_failed';
export type SignalTransport = 'local_storage' | 'gu_log_api';

export type ArticleVersionSnapshot = {
  postId: string;
  ticketId?: string;
  lang: GuLogLang;
  pathname: string;
  postVersion: number | string;
  contentVersion?: number | string;
  /** Reader-facing content hash from post-reader-revisions.json (metadata excluded). */
  readerRevision?: string | null;
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
  readerRevision?: string;
  occurredAt: string;
  reader?: string;
  readerTrustTier: ReaderTrustTier;
  transport: SignalTransport;
  syncStatus: SignalSyncStatus;
};

export type ReadFinishMethod = 'active_scroll_end' | 'manual_mark_read' | 'legacy_import';
export type FinishabilityState =
  'finished' | 'manually_marked_read' | 'abandoned_suspected_boring' | 'abandoned_unknown';
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
  activeReadMs: number;
  maxScrollPercent: number;
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

export type CommentPolarity = 'unknown' | 'positive' | 'negative' | 'rewrite_needed';

/** Longest note a reader may attach to feedback, in characters (code points). */
export const FEEDBACK_NOTE_MAX_LENGTH = 280;

function truncateNote(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const chars = Array.from(text);
  return chars.length > FEEDBACK_NOTE_MAX_LENGTH
    ? chars.slice(0, FEEDBACK_NOTE_MAX_LENGTH).join('')
    : text;
}

export type FeedbackCommentEvent = BaseHumanSignalEvent & {
  kind: 'feedback_comment';
  source: 'giscus' | 'first_party';
  commentId?: string;
  commentText?: string;
  polarity: CommentPolarity;
};

export type HumanSignalEvent =
  ReadFinishEvent | ReadAbandonCandidateEvent | ShareIntentEvent | FeedbackCommentEvent;

export type HumanSignalTrustInput = {
  reader?: string;
  ownerReader?: string;
  ownerApproved?: boolean;
};

export type HumanSignalPacketQuery = {
  postId: string;
  pathname: string;
  postVersion: number | string;
};

export type HumanSignalTribunalPacketSignal = Readonly<
  Pick<
    HumanSignalEvent,
    | 'eventId'
    | 'kind'
    | 'postId'
    | 'ticketId'
    | 'lang'
    | 'pathname'
    | 'postVersion'
    | 'contentVersion'
    | 'readerRevision'
    | 'occurredAt'
    | 'reader'
    | 'readerTrustTier'
    | 'syncStatus'
  > & {
    automationAuthoritative: boolean;
    finishability?: FinishabilityState;
    confidence?: SignalConfidence;
    method?: ReadFinishMethod;
    activeReadMs?: number;
    maxScrollPercent?: number;
    target?: ShareTarget;
    result?: ShareResult;
    reactionStrength?: ShareReactionStrength;
    polarity?: SharePolarity | CommentPolarity;
    source?: FeedbackCommentEvent['source'];
    commentId?: string;
    commentText?: string;
  }
>;

export type HumanSignalTribunalPacket = Readonly<{
  packetSchemaVersion: 1;
  postId: string;
  pathname: string;
  postVersion: number;
  signals: ReadonlyArray<HumanSignalTribunalPacketSignal>;
  automationAuthoritativeSignalCount: number;
  recommendedAutomation: 'none';
}>;

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
  const readerRevision =
    typeof snapshot.readerRevision === 'string' && snapshot.readerRevision.trim()
      ? snapshot.readerRevision.trim()
      : undefined;
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
    ...(readerRevision ? { readerRevision } : {}),
  };
}

export function classifyHumanSignalTrustTier(input: HumanSignalTrustInput = {}): ReaderTrustTier {
  if (input.ownerApproved) {
    return 'owner_approved';
  }
  if (input.reader && input.ownerReader && input.reader === input.ownerReader) {
    return 'owner_trusted';
  }
  if (input.reader) {
    return 'guest_reference';
  }
  return 'unknown';
}

export function isAutomationAuthoritativeTrustTier(tier: ReaderTrustTier): boolean {
  return tier === 'owner_trusted' || tier === 'owner_approved';
}

export function promoteHumanSignalTrustTier<T extends HumanSignalEvent>(
  event: T,
  readerTrustTier: ReaderTrustTier,
  reader?: string
): T {
  return {
    ...event,
    reader: reader ?? event.reader,
    readerTrustTier,
  };
}

function matchesPacketQuery(event: HumanSignalEvent, query: HumanSignalPacketQuery): boolean {
  return (
    event.postId === query.postId &&
    event.pathname === query.pathname &&
    event.postVersion === toPositiveInteger(query.postVersion)
  );
}

function toTribunalPacketSignal(event: HumanSignalEvent): HumanSignalTribunalPacketSignal {
  const signal: HumanSignalTribunalPacketSignal = {
    eventId: event.eventId,
    kind: event.kind,
    postId: event.postId,
    ticketId: event.ticketId,
    lang: event.lang,
    pathname: event.pathname,
    postVersion: event.postVersion,
    contentVersion: event.contentVersion,
    readerRevision: event.readerRevision,
    occurredAt: event.occurredAt,
    reader: event.reader,
    readerTrustTier: event.readerTrustTier,
    syncStatus: event.syncStatus,
    automationAuthoritative: isAutomationAuthoritativeTrustTier(event.readerTrustTier),
    ...(event.kind === 'read_finish'
      ? {
          method: event.method,
          finishability: event.finishability,
          confidence: event.confidence,
          activeReadMs: event.activeReadMs,
          maxScrollPercent: event.maxScrollPercent,
        }
      : {}),
    ...(event.kind === 'read_abandon_candidate'
      ? {
          finishability: event.finishability,
          confidence: event.confidence,
          activeReadMs: event.activeReadMs,
          maxScrollPercent: event.maxScrollPercent,
        }
      : {}),
    ...(event.kind === 'share_intent'
      ? {
          target: event.target,
          result: event.result,
          reactionStrength: event.reactionStrength,
          polarity: event.polarity,
        }
      : {}),
    ...(event.kind === 'feedback_comment'
      ? {
          source: event.source,
          commentId: event.commentId,
          commentText: event.commentText,
          polarity: event.polarity,
        }
      : {}),
  };

  return Object.freeze(signal);
}

export function buildHumanSignalTribunalPacket(
  query: HumanSignalPacketQuery,
  events: readonly HumanSignalEvent[]
): HumanSignalTribunalPacket {
  const postVersion = toPositiveInteger(query.postVersion);
  const signals = Object.freeze(
    events.filter((event) => matchesPacketQuery(event, query)).map(toTribunalPacketSignal)
  );

  return Object.freeze({
    packetSchemaVersion: 1,
    postId: query.postId,
    pathname: query.pathname,
    postVersion,
    signals,
    automationAuthoritativeSignalCount: signals.filter((signal) => signal.automationAuthoritative)
      .length,
    recommendedAutomation: 'none',
  });
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

function announceRecorded(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(HUMAN_SIGNAL_RECORDED_EVENT));
  }
}

export function getHumanSignalEvents(): HumanSignalEvent[] {
  return [...getStore().events];
}

/** File format shared by the Reading Tracker export and the backend export endpoint. */
export type HumanSignalExport = {
  exportSchemaVersion: 1;
  exportedAt: string;
  events: HumanSignalEvent[];
};

export function buildHumanSignalExport(): HumanSignalExport {
  return { exportSchemaVersion: 1, exportedAt: nowIso(), events: getHumanSignalEvents() };
}

type EventUpsertOptions = {
  dedupeKey?: (event: HumanSignalEvent) => string;
};

function articleVersionKey(event: HumanSignalEvent): string {
  return [
    event.kind,
    event.postId,
    event.postVersion,
    event.contentVersion ?? '',
    event.readerRevision ?? '',
    event.pathname,
    event.reader ?? '',
  ].join('|');
}

/** Events still waiting to be sent. `sync_failed` means the backend rejected it: never resend. */
export function getPendingHumanSignalEvents(): HumanSignalEvent[] {
  return getStore().events.filter((event) => event.syncStatus === 'local_only');
}

/**
 * Apply a backend sync response in one write: accepted → synced via the API,
 * rejected → sync_failed. Events in neither list stay pending.
 */
export function applyHumanSignalSyncResult(result: {
  accepted?: readonly string[];
  rejected?: readonly string[];
}): number {
  const accepted = new Set(result.accepted ?? []);
  const rejected = new Set(result.rejected ?? []);
  const store = getStore();
  let changed = 0;
  for (const event of store.events) {
    if (accepted.has(event.eventId)) {
      event.syncStatus = 'synced';
      event.transport = 'gu_log_api';
      changed += 1;
    } else if (rejected.has(event.eventId)) {
      event.syncStatus = 'sync_failed';
      changed += 1;
    }
  }
  if (changed > 0) {
    store.lastUpdated = nowIso();
    saveStore(store);
  }
  return changed;
}

export function markHumanSignalEventSynced(eventId: string): boolean {
  return applyHumanSignalSyncResult({ accepted: [eventId] }) > 0;
}

export function markHumanSignalEventFailed(eventId: string): boolean {
  return applyHumanSignalSyncResult({ rejected: [eventId] }) > 0;
}

export function appendHumanSignalEvent(
  event: HumanSignalEvent,
  options: EventUpsertOptions = {}
): HumanSignalEvent {
  const store = getStore();
  if (options.dedupeKey) {
    const incomingKey = options.dedupeKey(event);
    let existingIndex = -1;
    for (let index = 0; index < store.events.length; index += 1) {
      if (options.dedupeKey(store.events[index]) === incomingKey) {
        existingIndex = index;
        break;
      }
    }
    if (existingIndex >= 0) {
      const upserted = {
        ...event,
        eventId: store.events[existingIndex].eventId,
      } as HumanSignalEvent;
      store.events[existingIndex] = upserted;
      store.lastUpdated = nowIso();
      saveStore(store);
      announceRecorded();
      return upserted;
    }
  }
  store.events.push(event);
  store.lastUpdated = nowIso();
  saveStore(store);
  announceRecorded();
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
    activeReadMs: number;
    maxScrollPercent: number;
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
  return appendHumanSignalEvent(event, {
    dedupeKey: articleVersionKey,
  }) as ReadAbandonCandidateEvent;
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

export function recordFeedbackComment(
  snapshot: ArticleVersionSnapshot,
  comment: {
    source: FeedbackCommentEvent['source'];
    commentId?: string;
    commentText?: string;
    polarity?: CommentPolarity;
  }
): FeedbackCommentEvent {
  const event: FeedbackCommentEvent = {
    ...baseEvent('feedback_comment', snapshot),
    kind: 'feedback_comment',
    source: comment.source,
    commentId: comment.commentId,
    commentText: truncateNote(comment.commentText),
    polarity: comment.polarity || 'unknown',
  };
  return appendHumanSignalEvent(event) as FeedbackCommentEvent;
}
