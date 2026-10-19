import {
  POLICY,
  parseFrontmatter,
  segmentGuide,
  subjectFingerprint,
  writeStamp,
} from '../../scripts/lib/source-distance.mjs';

/**
 * 一份有效的來源距離章（openspec source-distance-stamp）：指紋依文章目前的 `sourceUrl`
 * 與正文投影算，繁中與英文檔各給一組在門檻內的指標。overrides 蓋掉任一欄位。
 */
export function validStamp(content: string, overrides: Record<string, unknown> = {}) {
  const data = parseFrontmatter(content) ?? {};
  const english = data.lang === 'en';
  return {
    policy: POLICY.version,
    verdict: 'PASS',
    subjectSha256: subjectFingerprint(data.sourceUrl, segmentGuide(content)),
    sourceSha256: 'a'.repeat(64),
    sourceUnits: 215,
    metrics: english
      ? { ngramContainment: 0.02, maxVerbatimWords: 9, quotedWords: 7 }
      : { maxRun: 2, sourceRatio: 0.2, alignedSentences: 9 },
    ...(english ? {} : { aligner: 'claude-sonnet-5', rewrites: 0, alignerCalls: 2 }),
    checkedAt: '2026-09-28',
    ...overrides,
  };
}

/** 文章加上一份有效的章。 */
export function withValidStamp(content: string, overrides: Record<string, unknown> = {}) {
  return writeStamp(content, validStamp(content, overrides));
}
