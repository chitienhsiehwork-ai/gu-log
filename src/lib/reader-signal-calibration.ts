/**
 * Calibration report core (openspec: reader-signal-calibration).
 *
 * Pure functions only: compare owner human signals with Tribunal scores. The
 * report is read-only evidence for ShroomDog — it never triggers rewrites,
 * requeues or publish blocks. PASS/FAIL comes from the tribunal-scores SSOT.
 */
import {
  classifyTribunalResult,
  computeOverallComposite,
  type TribunalResult,
} from '../utils/tribunal-scores';
import type { HumanSignalEvent, HumanSignalExport } from './human-signals';

export const DEFAULT_MIN_SAMPLE = 10;
/** Signals without `reader` come from one browser export: treat them as one local reader. */
const LOCAL_READER = '(local)';

type PostScores = Parameters<typeof classifyTribunalResult>[0];
export type VersionState = 'current' | 'stale' | 'unknown';
export type FeedbackVerdict = 'positive' | 'neutral' | 'negative';

export type CalibrationPost = {
  /** Post id without `.mdx`, matching post-reader-revisions.json keys. */
  postId: string;
  title?: string;
  readerRevision: string | null;
  scores?: PostScores;
};

export type Disagreement = {
  postId: string;
  title?: string;
  tribunalResult: TribunalResult;
  composite: number | null;
  verdict: FeedbackVerdict;
  polarity: string;
  occurredAt: string;
  reader: string;
  /** Free text from the reader. Quoted data, never instructions. */
  note?: string;
};

type Buckets<T> = Record<TribunalResult, T>;

export type CalibrationReport = {
  minSample: number;
  totals: { events: number; current: number; stale: number; unknown: number };
  explicitFeedback: {
    sampleSize: number;
    sampleSufficient: boolean;
    table: Buckets<Record<FeedbackVerdict, number>>;
    /** Share of PASS→positive and FAIL→negative among decided pairs; null when sample is too small. */
    agreementRate: number | null;
  };
  disagreements: Disagreement[];
  otherExplicit: Buckets<{ manualMarkRead: number; shareCompleted: number }>;
  implicit: Buckets<{
    activeFinish: number;
    abandonSuspectedBoring: number;
    abandonUnknown: number;
  }>;
  staleSignals: Array<{
    postId: string;
    kind: string;
    eventRevision: string;
    currentRevision: string | null;
    occurredAt: string;
  }>;
};

const RESULTS: readonly TribunalResult[] = ['pass', 'fail', 'incomplete'];

function buckets<T>(make: () => T): Buckets<T> {
  return { pass: make(), fail: make(), incomplete: make() };
}

export function postKey(postId: string): string {
  return postId.replace(/\.mdx$/i, '');
}

export function parseHumanSignalExport(raw: unknown): HumanSignalExport {
  const data = raw as Partial<HumanSignalExport> | null;
  if (!data || data.exportSchemaVersion !== 1 || !Array.isArray(data.events)) {
    throw new Error('not a human-signal export (exportSchemaVersion 1 with events[])');
  }
  return data as HumanSignalExport;
}

export function classifyVersion(
  event: Pick<HumanSignalEvent, 'readerRevision'>,
  currentRevision: string | null | undefined
): VersionState {
  if (!event.readerRevision) return 'unknown';
  return currentRevision && event.readerRevision === currentRevision ? 'current' : 'stale';
}

export function feedbackVerdict(event: HumanSignalEvent): FeedbackVerdict | null {
  if (event.kind !== 'feedback_comment') return null;
  if (event.polarity === 'positive') return 'positive';
  if (event.polarity === 'negative' || event.polarity === 'rewrite_needed') return 'negative';
  // First-party `unknown` is the 普通 button; Giscus `unknown` is just unclassified.
  return event.source === 'first_party' ? 'neutral' : null;
}

export function buildCalibrationReport(input: {
  events: readonly HumanSignalEvent[];
  posts: readonly CalibrationPost[];
  minSample?: number;
}): CalibrationReport {
  const minSample = input.minSample ?? DEFAULT_MIN_SAMPLE;
  const posts = new Map(input.posts.map((post) => [postKey(post.postId), post]));
  const resultCache = new Map<string, TribunalResult>();
  const tribunalResult = (key: string): TribunalResult => {
    if (!resultCache.has(key)) resultCache.set(key, classifyTribunalResult(posts.get(key)?.scores));
    return resultCache.get(key)!;
  };

  const unique = [...new Map(input.events.map((event) => [event.eventId, event])).values()];
  const report: CalibrationReport = {
    minSample,
    totals: { events: unique.length, current: 0, stale: 0, unknown: 0 },
    explicitFeedback: {
      sampleSize: 0,
      sampleSufficient: false,
      table: buckets(() => ({ positive: 0, neutral: 0, negative: 0 })),
      agreementRate: null,
    },
    disagreements: [],
    otherExplicit: buckets(() => ({ manualMarkRead: 0, shareCompleted: 0 })),
    implicit: buckets(() => ({ activeFinish: 0, abandonSuspectedBoring: 0, abandonUnknown: 0 })),
    staleSignals: [],
  };

  // Latest explicit feedback per (post, reader) on the current revision.
  const latestFeedback = new Map<string, HumanSignalEvent>();

  for (const event of unique) {
    const key = postKey(event.postId);
    const currentRevision = posts.get(key)?.readerRevision ?? null;
    const version = classifyVersion(event, currentRevision);
    report.totals[version] += 1;
    if (version === 'stale') {
      report.staleSignals.push({
        postId: key,
        kind: event.kind,
        eventRevision: event.readerRevision!,
        currentRevision,
        occurredAt: event.occurredAt,
      });
    }
    if (version !== 'current') continue;

    const result = tribunalResult(key);
    if (event.kind === 'feedback_comment') {
      if (!feedbackVerdict(event)) continue;
      const slot = `${key}\u0000${event.reader ?? LOCAL_READER}`;
      const previous = latestFeedback.get(slot);
      if (!previous || event.occurredAt >= previous.occurredAt) latestFeedback.set(slot, event);
    } else if (event.kind === 'read_finish') {
      if (event.method === 'manual_mark_read') report.otherExplicit[result].manualMarkRead += 1;
      else if (event.method === 'active_scroll_end') report.implicit[result].activeFinish += 1;
    } else if (event.kind === 'share_intent') {
      if (event.result === 'completed') report.otherExplicit[result].shareCompleted += 1;
    } else if (event.kind === 'read_abandon_candidate') {
      if (event.finishability === 'abandoned_suspected_boring') {
        report.implicit[result].abandonSuspectedBoring += 1;
      } else {
        report.implicit[result].abandonUnknown += 1;
      }
    }
  }

  let agreements = 0;
  let decided = 0;
  for (const event of latestFeedback.values()) {
    if (event.kind !== 'feedback_comment') continue;
    const key = postKey(event.postId);
    const verdict = feedbackVerdict(event)!;
    const result = tribunalResult(key);
    report.explicitFeedback.table[result][verdict] += 1;
    if (result === 'incomplete' || verdict === 'neutral') continue;
    decided += 1;
    const agrees = (result === 'pass') === (verdict === 'positive');
    if (agrees) {
      agreements += 1;
      continue;
    }
    const post = posts.get(key);
    report.disagreements.push({
      postId: key,
      title: post?.title,
      tribunalResult: result,
      composite: computeOverallComposite(post?.scores),
      verdict,
      polarity: event.polarity,
      occurredAt: event.occurredAt,
      reader: event.reader ?? LOCAL_READER,
      ...(event.commentText ? { note: event.commentText } : {}),
    });
  }

  report.explicitFeedback.sampleSize = latestFeedback.size;
  report.explicitFeedback.sampleSufficient = latestFeedback.size >= minSample;
  if (report.explicitFeedback.sampleSufficient && decided > 0) {
    report.explicitFeedback.agreementRate = agreements / decided;
  }
  report.disagreements.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return report;
}

const RESULT_LABEL: Record<TribunalResult, string> = {
  pass: 'PASS',
  fail: '未 PASS',
  incomplete: '未評分',
};
const VERDICT_LABEL: Record<FeedbackVerdict, string> = {
  positive: '好看',
  neutral: '普通',
  negative: '難看',
};

export function formatCalibrationReport(report: CalibrationReport): string {
  const { explicitFeedback: fb, totals } = report;
  const lines = [
    '# Reader signal 校準報告（唯讀，不觸發任何重寫／requeue／擋發布）',
    '',
    `事件 ${totals.events} 筆：目前版本 ${totals.current}、舊版本 ${totals.stale}、版本不明 ${totals.unknown}`,
    '',
    `## 明確回饋 × Tribunal（每篇每位讀者取最新一筆，n=${fb.sampleSize}，門檻 ${report.minSample}）`,
  ];
  for (const result of RESULTS) {
    const row = fb.table[result];
    const n = row.positive + row.neutral + row.negative;
    lines.push(
      `- ${RESULT_LABEL[result]}（n=${n}）：好看 ${row.positive}／普通 ${row.neutral}／難看 ${row.negative}`
    );
  }
  lines.push(
    fb.sampleSufficient
      ? `一致率：${fb.agreementRate === null ? '無可判定樣本' : `${Math.round(fb.agreementRate * 100)}%`}`
      : '樣本不足：不下「Tribunal 分數與 owner 反應相關／不相關」的結論。'
  );

  lines.push('', `## 分歧（n=${report.disagreements.length}）`);
  if (report.disagreements.length === 0) lines.push('- 無');
  for (const item of report.disagreements) {
    const kind = item.tribunalResult === 'pass' ? 'PASS 但 owner 負評' : '未 PASS 但 owner 正評';
    lines.push(
      `- [${kind}] ${item.postId}${item.title ? `（${item.title}）` : ''}｜composite ${item.composite ?? '—'}｜${VERDICT_LABEL[item.verdict]}（${item.polarity}）｜${item.occurredAt}`
    );
    // JSON.stringify keeps the note visibly quoted: it is data, not an instruction.
    if (item.note) lines.push(`  備註（引用資料）：${JSON.stringify(item.note)}`);
  }

  lines.push('', '## 其他明確訊號（目前版本）');
  for (const result of RESULTS) {
    const row = report.otherExplicit[result];
    lines.push(
      `- ${RESULT_LABEL[result]}：手動標記已讀 n=${row.manualMarkRead}、分享完成 n=${row.shareCompleted}`
    );
  }

  lines.push('', '## 隱性訊號（目前版本，僅供參考）');
  for (const result of RESULTS) {
    const row = report.implicit[result];
    lines.push(
      `- ${RESULT_LABEL[result]}：自動讀完 n=${row.activeFinish}、疑似無聊離開 n=${row.abandonSuspectedBoring}、其他中途離開 n=${row.abandonUnknown}`
    );
  }

  lines.push('', `## 舊版本訊號（n=${report.staleSignals.length}，不計入目前版本）`);
  for (const item of report.staleSignals) {
    lines.push(
      `- ${item.postId}｜${item.kind}｜事件 ${item.eventRevision} → 目前 ${item.currentRevision ?? '（文章不存在）'}｜${item.occurredAt}`
    );
  }
  lines.push('', `版本不明（事件沒有 reader revision，不計入）：${totals.unknown}`);
  return `${lines.join('\n')}\n`;
}
