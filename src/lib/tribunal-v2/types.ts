/**
 * Tribunal v2 — Judge Output Type Definitions
 *
 * Copied from `.score-loop/specs/devils-advocate-review.md` Appendix A.
 * These interfaces define the structured output of each judge/worker agent
 * in the tribunal pipeline.
 *
 * Pipeline: Stage 0 → Stage 1 → Stage 2 → Stage 3 → Stage 4 → Stage 5
 */

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

/**
 * Base interface shared by all judge outputs.
 * Improvements and critical_issues are only populated when pass === false
 * (省 token on PASS).
 */
export interface BaseJudgeOutput {
  pass: boolean;
  scores: Record<string, number>; // integer 0–10
  composite: number; // integer 0–10

  // Only populated when pass === false
  improvements?: Record<string, string>; // per-dimension specific feedback
  critical_issues?: string[]; // 1–3 root causes

  // Metadata for prompt tuning
  judge_model: string; // e.g. "claude-opus-4-6"
  judge_version: string; // semver of judge prompt, e.g. "1.0.0"
  timestamp: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Stage 0: Worthiness Gate
// ---------------------------------------------------------------------------

/**
 * Stage 0 Worthiness judge output.
 * All WARN mode — pass is always true, but warnedByStage0 may be set.
 * Dual reasoning: internal_reason for debug/tuning, reader_friendly_reason for UI banner.
 */
// LUXURY_TOKEN: Opus judge — worthiness requires understanding "核心觀點值不值得展開" (downgrade path: Sonnet)
export interface WorthinessJudgeOutput extends BaseJudgeOutput {
  scores: {
    coreInsight: number; // 核心觀點價值
    expandability: number; // 展開成長文的潛力
    audienceRelevance: number; // 對 gu-log 目標讀者的價值
  };

  // Stage 0 specific: WARN signal for orchestrator
  warned: boolean; // true when composite < 7 or any dim < 5 — orchestrator sets frontmatter

  // Dual reasoning output — Stage 0 specific
  internal_reason: string; // 完整技術分析，for debug/tuning
  reader_friendly_reason: string; // 一行中文，給 banner 顯示用（150 char cap）
}

// ---------------------------------------------------------------------------
// Stage 1 / Stage 4: Vibe
// ---------------------------------------------------------------------------

/**
 * Stage 1 Vibe judge output.
 * Pass bar: composite >= 8 AND 至少一維 >= 9 AND 沒有任何維 < 8
 * Max loops: 3
 */
export interface VibeJudgeOutput extends BaseJudgeOutput {
  scores: {
    persona: number;
    clawdNote: number;
    vibe: number;
    clarity: number;
    narrative: number;
  };
}

/**
 * Stage 4 Final Vibe judge output.
 * Relative pass bar: each dimension must not drop more than 1 point from Stage 1.
 * On fail: does NOT block publish — records degradation in frontmatter for UI banner.
 * Max loops: 2
 */
export interface FinalVibeJudgeOutput extends VibeJudgeOutput {
  stage_1_scores: VibeJudgeOutput['scores']; // reference for comparison
  degraded_dimensions: string[]; // 退步 > 1 分的維度
  is_degraded: boolean; // any dim dropped > 1 point?
}

// ---------------------------------------------------------------------------
// Stage 2: Fresh Eyes
// ---------------------------------------------------------------------------

/**
 * Stage 2 Fresh Eyes judge output.
 * Persona: 3-month engineer — tests readability for non-expert readers.
 * Pass bar: composite >= 8
 * Max loops: 2
 */
// LUXURY_TOKEN: Opus judge — Haiku/Sonnet 判斷力不足，Opus 執行 persona 更穩定 (downgrade path: Sonnet + confidence threshold)
export interface FreshEyesJudgeOutput extends BaseJudgeOutput {
  scores: {
    readability: number;
    firstImpression: number;
  };
}

// ---------------------------------------------------------------------------
// Stage 3: FactLib (Combined Judge + Workers)
// ---------------------------------------------------------------------------

/**
 * Stage 3 FactLib combined judge output.
 * fact_pass and library_pass are independent — neither can compensate the other.
 * overall pass = fact_pass AND library_pass
 * Max loops: 2
 */
// LUXURY_TOKEN: Opus combined judge — will affect fact accuracy if downgraded (lowest priority downgrade: Sonnet)
export interface FactLibJudgeOutput extends BaseJudgeOutput {
  scores: {
    factAccuracy: number; // 事實正確性
    sourceFidelity: number; // 對 source 的忠實度
    linkCoverage: number; // 站內/glossary 連結覆蓋
    linkRelevance: number; // 連結是否真的相關
  };

  // Independent pass bars — composite cannot compensate
  fact_pass: boolean;
  library_pass: boolean;
  // overall `pass` = fact_pass AND library_pass
}

/**
 * Stage 3 FactCorrector worker output.
 * Worker-first: proactively fixes facts before judge evaluates.
 * Uses standing checklist + source URL fetch for guidance.
 * Scope: body + ShroomDogNote ONLY — ClawdNote is excluded (creative scope).
 */
// LUXURY_TOKEN: Opus FactCorrector worker — has source URL for verification (downgrade path: Sonnet)
export interface FactCorrectorOutput {
  changes_made: Array<{
    location: string; // e.g. "paragraph 3, sentence 2"
    before: string;
    after: string;
    reason: string; // e.g. "source 原文是 42%，原版寫 40%"
    source_verified: boolean; // 是否用 source URL 對照過
  }>;

  flagged_but_not_changed: Array<{
    location: string;
    concern: string;
    reason_not_changed: string; // e.g. "不確定原意，交給 judge"
  }>;

  source_urls_fetched: string[]; // 實際 fetch 過的 URL list
  scope_violations_detected: string[]; // if ClawdNote was touched, log here
}

/**
 * Stage 3 Librarian worker output.
 * Runs after FactCorrector (causal dependency — needs corrected text).
 * Adds glossary links + cross-references. Does NOT modify text/facts.
 */
// LUXURY_TOKEN: Opus Librarian worker — lowest downgrade risk, Haiku is fine (downgrade path: Haiku)
export interface LibrarianOutput {
  glossary_links_added: Array<{
    term: string;
    target: string; // glossary entry path
    location: string;
  }>;

  cross_references_added: Array<{
    text: string;
    target: string; // internal post slug
    location: string;
  }>;
}

// ---------------------------------------------------------------------------
// Pass Bar Constants
// ---------------------------------------------------------------------------

/**
 * Hard numeric pass thresholds for each stage.
 * Stage 4 uses a relative bar — see MAX_REGRESSION.
 */
export const PASS_BARS = {
  STAGE_1_COMPOSITE: 8,
  STAGE_1_MIN_DIMENSION: 8,
  STAGE_1_HIGHLIGHT: 9, // at least one dim >= 9 (要有亮點)
  STAGE_2_COMPOSITE: 8,
  STAGE_3_FACT_COMPOSITE: 8, // floor(avg(factAccuracy, sourceFidelity)) >= 8
  STAGE_3_LIBRARY_COMPOSITE: 8, // floor(avg(linkCoverage, linkRelevance)) >= 8
  STAGE_4_MAX_REGRESSION: 1, // relative: no dim drops > 1 from Stage 1
} as const;

/**
 * Maximum rewrite loops per stage.
 * Stage 0 is a pure gate — no rewrite loops.
 */
export const MAX_LOOPS = {
  STAGE_0: 0,
  STAGE_1: 3,
  STAGE_2: 2,
  STAGE_3: 2,
  STAGE_4: 2,
} as const;
