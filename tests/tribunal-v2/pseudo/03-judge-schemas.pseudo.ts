// ============================================================================
// File: 03-judge-schemas.pseudo.ts
// Topic: Judge output JSON schema validation (Zod / TypeScript types)
// Layer: Unit (schema validation is pure function)
// ============================================================================
//
// BACKGROUND
// ──────────────────────────────────────────────────────────────────────────
// 每個 tribunal judge (Stage 0/1/2/3/4) 都會輸出一個 JSON，用來:
//   1. 決定 pass/fail
//   2. 給下一個 stage writer 當 feedback
//   3. 最終寫進 commit message & frontmatter
//   4. 餵給 banner UI
//
// Schemas 在 `.score-loop/specs/devils-advocate-review.md` Appendix A 有
// TypeScript interface 的版本。Builder 要把它轉成 Zod schema 塞進 runtime
// validation。
//
// Base schema (所有 judge 共用):
//   interface BaseJudgeOutput {
//     pass: boolean;
//     scores: Record<string, number>;  // integer 0-10
//     composite: number;                // integer 0-10
//     improvements?: Record<string, string>;  // only when pass=false
//     critical_issues?: string[];             // 1-3 root causes, only on fail
//     judge_model: string;
//     judge_version: string;
//     timestamp: string;
//   }
//
// 每個 stage 再 extend 加自己的 scores shape。
//
//
// ============================================================================
// Test Group A: BaseJudgeOutput schema
// ============================================================================
//
// WHAT: 驗證 base schema 的 required fields / type constraints
//
// WHY:  LLM 輸出 JSON 是**不可靠的**。Opus 會漏欄位、寫錯 type (string
//       vs number)、or 直接沒把 JSON 包好。schema validation 是第一道防
//       線，壞 JSON 進來就立刻爆，不要污染 downstream。
//
//       這是 "parse, don't validate" 原則的延伸 — 我們用 schema 把
//       unknown JSON 轉成 typed TS object，後面 code 可以完全信任 shape。
//
// PROS: - Layer 1 unit test、no LLM、飛快
//       - 一旦寫好，未來 prompt 改動時可以快速抓到 LLM 輸出 shape drift
// CONS: - 不保證 LLM 會產出符合 schema 的 JSON — 那要靠 prompt + retry
//         logic（也該測，見 04 Test Group C）
//
// ALTERNATIVE: 用 runtime property access (`result.scores?.persona`) 而
//              不用 schema。**脆** — 一個 typo 或 null 欄位就 runtime crash。
//              Zod schema 在 parse 當下就 reject，比較安全。

describe('BaseJudgeOutput schema validation', () => {

  it('accepts a minimal valid output (PASS case, no improvements)', () => {
    // Input:
    //   { pass: true, scores: { persona: 9 }, composite: 9,
    //     judge_model: 'claude-opus-4-6', judge_version: '1.0.0',
    //     timestamp: '2026-04-11T10:00:00Z' }
    // Expect: parsed ok
  });

  it('rejects missing `pass` field', () => {
    // Teaching note: pass 是 downstream state machine 的 trigger，
    //                沒有它整個 pipeline 不知道要做什麼。必 required。
  });

  it('rejects non-boolean `pass` (e.g. LLM output "true" as string)', () => {
    // Input: pass: "true"
    // Expect: validation fails
    //
    // Teaching note: LLM 會不小心把 JSON 的 boolean 寫成 string。Zod
    //                的 z.boolean() 不做 coercion，會 reject。
    //                **不要** 用 z.coerce.boolean() — 那會把 "false" 字串
    //                轉成 true (因為 non-empty string)，超危險。
  });

  it('rejects non-integer score (e.g. 8.5)', () => {
    // Input: composite: 8.5
    // Expect: fail, because scoring system is integer-only
    //
    // Teaching note: z.number().int() 是 Zod 的 integer guard。
  });

  it('rejects out-of-range score (e.g. 11 or -1)', () => {
    // z.number().int().min(0).max(10)
  });

  it('requires improvements AND critical_issues when pass=false', () => {
    // conditional schema:
    //   if (pass === false) {
    //     improvements is required (non-empty)
    //     critical_issues is required (length 1-3)
    //   }
    //
    // Teaching note: Zod refine() 或 discriminated union 可以做 conditional。
    //                這是 mental model 裡 "FAIL 時產 improvements，PASS 時
    //                省略" 的 schema-level enforcement。
  });

  it('forbids improvements when pass=true (省 token)', () => {
    // 如果 LLM 在 PASS 時還是塞了 improvements，schema 要 reject？
    // 或是只要 warning，不 hard-fail？
    //
    // Teaching note: 這是 Q2 MCQ — 見 chat。
  });
});


// ============================================================================
// Test Group B: WorthinessJudgeOutput (Stage 0)
// ============================================================================
//
// WHAT: Stage 0 的 dual reason 欄位 (`internal_reason`, `reader_friendly_reason`)
//
// WHY:  Stage 0 特別 — 不只是 pass/fail，還要給 banner 用的 reader-friendly
//       reason。這個 reason 會直接 render 在網站上給讀者看，必須:
//         - 非空 (不然 banner 是空的)
//         - 不包含 markdown escape 問題 (" " ' 等)
//         - 合理長度 (太長會爆 banner layout)
//
// PROS: - 抓 LLM 輸出錯的高機率 case
// CONS: - length cap 很主觀，可能要調

describe('WorthinessJudgeOutput (Stage 0) schema', () => {

  it('has 3 required dims: coreInsight, expandability, audienceRelevance', () => {
    // Exact dim names matter — downstream pass bar + banner 都 hardcode 這些
  });

  it('requires non-empty `internal_reason` (for debug/tuning)', () => {
    // min length 20 chars? 不要允許 "ok" 這種 useless reason
  });

  it('requires non-empty `reader_friendly_reason` (for banner)', () => {
    // Max length: 建議 100 chars (mobile banner 1-2 行就滿了)
    //
    // Teaching note: 這是 LLM 最容易出錯的地方 — 它會寫很長的分析，
    //                當作 reader_friendly。要 enforce length cap，超過
    //                就要 writer retry（不是 pipeline fail）。
  });

  it('distinguishes warn from pass (warn 也是 "pass=true" 但有 warnedByStage0 flag)', () => {
    // All-WARNING mode: pass 永遠是 true (Stage 0 不會 reject 任何文章)
    // 但 low-confidence 的文章會有額外 flag
    //
    // Teaching note: 這個 semantic 很 subtle — Stage 0 的 pass
    //                意思是 "過 gate、進 pipeline"，不是 "judge 滿意"。
    //                見 mental model Level 7。
  });
});


// ============================================================================
// Test Group C: FactLibJudgeOutput (Stage 3) — 獨立 pass bar
// ============================================================================
//
// WHAT: Stage 3 有 `fact_pass` 和 `library_pass` 兩個 boolean，總
//       `pass` 要 AND 起來。Schema 要 enforce 這個約束。
//
// WHY:  "Link coverage 高不能補償 fact accuracy 低" 是核心設計哲學。
//       如果 schema 只看 overall pass，這個哲學被繞過。
//
// PROS: - 直接編碼 design decision 成 runtime guarantee
// CONS: - 需要 schema-level refinement (Zod refine())

describe('FactLibJudgeOutput (Stage 3) schema', () => {

  it('has 4 scores: factAccuracy, sourceFidelity, linkCoverage, linkRelevance', () => {
    // ...
  });

  it('has both `fact_pass` and `library_pass` booleans', () => {
    // ...
  });

  it('rejects pass=true when fact_pass=false', () => {
    // Input: pass=true, fact_pass=false, library_pass=true
    // Expect: schema validation fails (pass 必須 = fact_pass && library_pass)
    //
    // Teaching note: Zod refine() 可以跨欄位檢查。這把 "不能用 lib 補償
    //                fact" 的規則變成 structural invariant。
  });

  it('accepts pass=false when either sub-pass is false', () => {
    // fact_pass=false, library_pass=true → pass=false ✓
    // fact_pass=true, library_pass=false → pass=false ✓
    // fact_pass=false, library_pass=false → pass=false ✓
  });
});


// ============================================================================
// Test Group D: FinalVibeJudgeOutput (Stage 4) — relative pass bar context
// ============================================================================
//
// WHAT: Stage 4 output 必須帶 `stage_1_scores` (reference) + `degraded_dimensions`
//       + `is_degraded` flag
//
// WHY:  Stage 4 的 pass 是相對的，downstream (banner, frontmatter) 需要
//       知道「跟什麼比」才能正確 render 訊息。
//
// PROS: - 確保 audit trail 存在 — 未來 debug 時可以看到 "Stage 1 時是 9 分，
//         Stage 4 掉到 7"
// CONS: - Schema 多一個 required field，LLM 可能漏

describe('FinalVibeJudgeOutput (Stage 4) schema', () => {

  it('requires stage_1_scores for comparison', () => {
    // 這個欄位不是 LLM 輸出的 — 是 pipeline 在 call judge 時注入的 reference。
    //
    // Teaching note: 所以 schema validation 可能要分兩階段:
    //                1. LLM 輸出 VibeJudgeOutput (沒有 stage_1_scores)
    //                2. Pipeline wrapper 加上 stage_1_scores 變成 FinalVibeJudgeOutput
    //                這是 "parse LLM output 之後 enrich" 的 pattern。
  });

  it('derives is_degraded + degraded_dimensions from comparison', () => {
    // 這些欄位應該是 computed，不是 LLM 輸出
    // 用 isStage4Degraded() helper（見 02-pass-bar）算出來
  });
});


// ============================================================================
// Test Group E: FactCorrector / Librarian Worker output
// ============================================================================
//
// WHAT: Worker (非 judge) 的輸出也要 schema
//
// WHY:  FactCorrector 輸出 `changes_made` + `flagged_but_not_changed`
//       陣列，Combined Judge 要讀。Librarian 輸出 `glossary_links_added`
//       + `cross_references_added`。這些 shape 錯了，下游 judge 讀不到。
//
// PROS: - 跟 judge schema 同樣理由
// CONS: - Worker output 比較 verbose，schema 會比較大

describe('FactCorrectorOutput schema', () => {

  it('accepts empty changes_made (no changes needed)', () => {
    // 文章已經很乾淨，FactCorrector 啥都沒改 — 這是合法的
  });

  it('each change entry has: location, before, after, reason, source_verified', () => {
    // ...
  });

  it('rejects change with before === after (non-change)', () => {
    // Teaching note: LLM 可能 hallucinate 空 change。schema 擋掉。
  });

  it('scope_violations_detected is non-empty if ClawdNote was modified', () => {
    // 這是 safety check — 如果 worker 不小心動到 ClawdNote，要 surface 出來
    // 給 judge 看。Judge 再決定要不要 fail 這輪。
    //
    // Teaching note: 見 04-fact-corrector Test Group B。
  });
});

describe('LibrarianOutput schema', () => {

  it('both glossary_links_added and cross_references_added can be empty', () => {
    // 沒加連結是合法的
  });

  it('each entry has: term/text, target, location', () => {
    // target 要是有效的 internal path (/posts/..., /glossary/...)
    // 這個檢查用 Zod pattern — 但「path 真的存在」要 integration test
  });
});
