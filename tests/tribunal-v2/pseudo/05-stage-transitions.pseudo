// ============================================================================
// File: 05-stage-transitions.pseudo.ts
// Topic: Pipeline state machine — PASS/FAIL/retry/max-loops/NEEDS_REVIEW
// Layer: Unit (state machine is pure function)
// ============================================================================
//
// BACKGROUND
// ──────────────────────────────────────────────────────────────────────────
// Tribunal v2 pipeline 是個 state machine。每個 stage 有三種可能結果:
//   1. PASS → 進下一個 stage
//   2. FAIL but retries left → loop 回 writer，再跑 judge
//   3. FAIL and max loops reached → escalate (details depend on stage)
//
// Max loops per stage:
//   Stage 0: 0 (pure gate，no retry)
//   Stage 1: 3
//   Stage 2: 2
//   Stage 3: 2
//   Stage 4: 2
//
// Cross-run retry cap: 同一篇文章 full pipeline 失敗 3 次 → `NEEDS_REVIEW`
//
// Stage 4 特別 — fail 但不擋 publish:
//   Stage 4 max loops reached → 還是 squash merge，只是 banner 顯示 warning
//
//
// 為什麼這個值得寫 test?
// ──────────────────────────────────────────────────────────────────────────
// State machine 寫壞的後果:
//   - 永遠 loop → 燒死 quota
//   - 跳過 stage → 沒檢查就 publish
//   - 把 NEEDS_REVIEW 當 fail 永久 stuck → 整個 pipeline 卡死
//
// 這些都是 "看不到的 bug" — production 會悄悄壞，quota 會默默消失，直到
// 某天發現某篇文章跑了 10 小時才 publish。Unit test 是你唯一的防線。
//
//
// ============================================================================
// Test Group A: Single-stage loop logic
// ============================================================================
//
// WHAT: `runStageLoop(stage, article, maxLoops)` 的所有 outcome
//
// WHY:  每個 stage 的 loop 結構一樣，但 edge case 不一樣。寫一個 generic
//       state machine tester，然後 parameterize 每個 stage。
//
// PROS: - 純函數（給定 mock judge response，output 可預測）
//       - Parameterize 後所有 stage 共用 test 邏輯，維護成本低
// CONS: - Mock judge 寫起來有點煩（要 simulate "先 fail N 輪，第 N+1 輪 pass"）

describe('Stage loop state machine', () => {

  it('passes immediately on first judge PASS', () => {
    // Mock judge returns: { pass: true } on first call
    // Expect: loops=1, status='PASS', writer never called
  });

  it('retries writer then re-judges on FAIL', () => {
    // Mock judge returns: FAIL, PASS (second call)
    // Expect: loops=2, status='PASS', writer called once (between judges)
    //
    // Teaching note: 順序很重要 — judge first, then writer-on-fail, then judge again
  });

  it('stops at max loops with FAIL status', () => {
    // Mock judge: always FAIL
    // maxLoops: 2
    // Expect: loops=2, status='FAIL', writer called 2 times
    //
    // Teaching note: 注意是 "called 2 times"，不是 3 times。
    //                第一輪 judge (fail) → writer 1 → judge (fail) → writer 2 →
    //                judge (fail) → STOP at max. Writer 被 call N 次，judge N+1 次。
    //                這個 off-by-one 超常寫錯。
  });

  it('Stage 0 has max_loops=0 (pure gate, no retry)', () => {
    // Mock judge: WARN (not reject, but low confidence)
    // Expect: loops=1, status='PASS_WITH_WARNING'
    //         writer never called (stage 0 has no writer)
  });

  it('Stage 4 FAIL → status="PUBLISHED_WITH_DEGRADATION" not "FAILED"', () => {
    // 這是 Stage 4 獨有的語義 — fail 但 pipeline 不擋
    // 特別測出來，避免未來 Builder 誤用 generic FAIL path
  });

  it('invokes writer diff check after each writer call', () => {
    // Between writer call and next judge:
    //   writer returns new article → validateWriterOutput() →
    //   if violation → reject this loop, log, use previous version
    //
    // Teaching note: 見 01-writer-constraints Test Group E。
    //                state machine 要 integration with diff check。
  });
});


// ============================================================================
// Test Group B: Full pipeline sequencing
// ============================================================================
//
// WHAT: Stage 之間的連接 — 一個 fail 了下一個還該跑嗎？
//
// WHY:  Pipeline 的 "向前不 rollback" 哲學是明確的 (mental model Level 8)
//       但細節值得釘死。

describe('Full pipeline sequencing', () => {

  it('Stage 0 WARN does NOT block Stage 1', () => {
    // Stage 0 永遠 all-WARNING，後面照跑
    // 只是 frontmatter 多 warnedByStage0 flag
  });

  it('Stage 1 FAIL (max loops) → pipeline STOPS (don\'t run Stage 2)', () => {
    // Stage 1 是 hard gate — vibe 不過不跑後面
    //
    // Teaching note: 為什麼 Stage 1 是 hard gate 但 Stage 4 不是？
    //                Stage 1 fail = 文章根本不值得 polish；
    //                Stage 4 fail = 文章好過但最後退化，還是值得發 + warn。
  });

  it('Stage 3 FAIL (max loops) → pipeline STOPS', () => {
    // 事實錯誤不能 publish — 這是 gu-log 的底線
  });

  it('Stage 4 FAIL (max loops) → pipeline CONTINUES to squash merge', () => {
    // 但 commit message 記錄 degraded, banner 顯示 warning
  });

  it('each stage receives the article modified by the previous stage', () => {
    // Stage 1 writer 改的版本 → Stage 2 看到的
    // Stage 3 改的版本 → Stage 4 看到的
    //
    // Teaching note: "pipeline 永遠往前走" 意味著每個 stage 的 input 是
    //                前一 stage 的 output，不是原始文章。
  });
});


// ============================================================================
// Test Group C: Cross-run retry cap
// ============================================================================
//
// WHAT: 同一篇文章連 3 次 full pipeline fail → `NEEDS_REVIEW`
//
// WHY:  防止 "某篇文章永遠 fail 於 Stage 3" 的無限燒 token。這是 quota
//       safety 的關鍵。
//
// PROS: - 防止 infinite loop 燒錢
//       - 強制人肉介入 stuck 文章
// CONS: - 需要 persistence layer (progress JSON) 記錄 retry count

describe('Cross-run retry cap', () => {

  it('tracks retry count per article across pipeline runs', () => {
    // Mock progress state:
    //   { 'article-foo': { retries: 2, lastStatus: 'FAIL' } }
    // Run pipeline → retries becomes 3 → next run should mark NEEDS_REVIEW
  });

  it('marks article NEEDS_REVIEW on 3rd full failure', () => {
    // Expect: article status = 'NEEDS_REVIEW'
    //         next pipeline run SKIPS this article
  });

  it('resets retry count when pipeline PASSes', () => {
    // Once a run passes, retry count resets (otherwise permanent penalty)
  });

  it('NEEDS_REVIEW article is skipped in next pipeline run', () => {
    // Skip logic: don't load into queue, log reason
  });

  it('human can manually reset NEEDS_REVIEW to pending', () => {
    // 操作層面 — CEO 讀 site / commit message 後決定 reset
    // 這是 "human-in-the-loop via UI" 的一部分
    //
    // Teaching note: 這個 test 可能只驗 CLI command / JSON manipulation,
    //                不是 full integration.
  });
});


// ============================================================================
// Test Group D: Quota gate (headroom-based pacing)
// ============================================================================
//
// WHAT: `shouldProceed(quotaInfo)` 根據 headroom 決定 GO/SLEEP
//
// WHY:  Mental model Section "Quota Pacing":
//         headroom = min(5hr_remaining - 20%, weekly_remaining - 3%)
//         headroom > 0 → GO
//         headroom <= 0 → SLEEP
//
// PROS: - 純函數 — 給 quota dict 回 enum
// CONS: - quota API shape 還沒 final，可能要改 (defer slightly?)

describe('Quota pacing gate', () => {

  it('returns GO when both windows have headroom', () => {
    // 5hr: 80% remaining (after -20% buffer → 60%)
    // weekly: 50% remaining (after -3% buffer → 47%)
    // both > 0 → GO
  });

  it('returns SLEEP when 5hr window is exhausted', () => {
    // 5hr: 10% remaining (-20% = -10% → <=0)
    // → SLEEP even if weekly has headroom
  });

  it('returns SLEEP when weekly window is exhausted', () => {
    // weekly: 2% remaining (-3% = -1% → <=0)
    // → SLEEP even if 5hr is fine
  });

  it('never burns the last 20% of 5hr or 3% of weekly (safety buffer)', () => {
    // 邊界值測試 — 正好在 buffer 邊緣要 SLEEP
  });
});


// ============================================================================
// 不測的東西（重要！）
// ============================================================================
//
// Teaching note: 這些看起來「應該測」但其實**不該測**:
//
// - Judge 給分是否合理 (calibration) — 需要 ground truth
// - Writer 修的內容是否真的更好 — 主觀
// - Pipeline 實際跑完的總 token 花費 — 要 production metrics
// - Stage 之間 pass rate 統計 — 要 production data
// - Banner 會不會影響 reader behavior — 要 A/B test
//
// 這些是「觀察」不是「斷言」。用 dashboards + metrics，不是 unit test。
