// ============================================================================
// File: 06-frontmatter.pseudo.ts
// Topic: Frontmatter schema 擴充 (Zod schema in src/content/config.ts)
// Layer: Unit (schema validation)
// ============================================================================
//
// BACKGROUND
// ──────────────────────────────────────────────────────────────────────────
// `src/content/config.ts` 是 Astro content collection 的 SSOT schema。
// Tribunal v2 要加幾個欄位:
//
//   warnedByStage0: boolean (default false)
//   warnReason: string (optional — reader_friendly_reason from Stage 0 judge)
//   warnOverrideComment: string (optional — ShroomDog 的手動說明)
//   stage4FinalVibeScores: { ... } (optional — Stage 4 degraded report)
//
// 這些欄位的約束不只是 schema 層面，還有語義約束 (e.g. warnReason 只在
// warnedByStage0 為 true 時 required)。
//
//
// ============================================================================
// 為什麼 frontmatter schema 非測不可
// ──────────────────────────────────────────────────────────────────────────
// `src/content/config.ts` 壞了 → `pnpm run build` 失敗 → Vercel deploy
// 失敗 → whole site 爆掉。這是 "upstream of everything" 的 code。
//
// 測它的成本極低（純 schema），回報極高。
//
// 現有 tests (content-integrity.spec.ts) 已經在測一些 frontmatter 約束，
// 但沒 cover 新欄位。這份 pseudo code 只測新加的部分。
//
//
// ============================================================================
// Test Group A: New optional fields accept valid data
// ============================================================================

describe('Frontmatter schema: warnedByStage0 + warnReason', () => {

  it('accepts post without warnedByStage0 (defaults to false)', () => {
    // Existing posts 沒這個欄位 — backward compat
    // Expect: parsed.warnedByStage0 === false
  });

  it('accepts post with warnedByStage0=true and warnReason', () => {
    // frontmatter:
    //   warnedByStage0: true
    //   warnReason: "核心觀點不夠展開"
    // Expect: parses ok
  });

  it('rejects post with warnedByStage0=true but NO warnReason', () => {
    // Conditional required: if warned, must have reason
    //
    // Teaching note: Zod refine() 可以做跨欄位 conditional。
    //                .refine((data) => !data.warnedByStage0 || !!data.warnReason,
    //                        { message: 'warnReason required when warnedByStage0=true' })
  });

  it('rejects warnReason > 150 chars (banner layout limit)', () => {
    // Banner UI 最多 1-2 行，太長會爆版
    // Schema 層 enforce 比 runtime truncate 更好（早 fail）
    //
    // Teaching note: 這個 limit 的選擇是 Q5 MCQ — 見 chat。
  });

  it('warnOverrideComment is optional and not tied to warnedByStage0', () => {
    // ShroomDog 可以在任何時候加 override comment — 即使沒 warn
    // （雖然通常不會，但 schema 層不該阻擋）
  });
});


// ============================================================================
// Test Group B: stage4FinalVibeScores 結構
// ============================================================================

describe('Frontmatter schema: stage4FinalVibeScores', () => {

  it('is optional (most posts won\'t have it)', () => {
    // 只有 Stage 4 FAIL + publish with warning 的文章才會有
  });

  it('accepts full score object with stage1 reference', () => {
    // {
    //   persona: { stage1: 9, stage4: 7 },
    //   clawdNote: { stage1: 8, stage4: 8 },
    //   ...
    //   degraded: true,
    //   degradedDims: ['persona'],
    // }
  });

  it('rejects scores outside 0-10 integer range', () => {
    // 跟 existing `scores` 欄位一致 (config.ts line 49)
  });

  it('requires `degradedDims` to be non-empty if `degraded=true`', () => {
    // Conditional — 確保 UI banner 有東西可顯示
  });
});


// ============================================================================
// Test Group C: Integration with existing content-integrity tests
// ============================================================================
//
// WHAT: 確保新欄位不破壞現有 test
//
// WHY:  Existing `tests/content-integrity.spec.ts` 裡有 ticketId PK、
//       translation pair ticketId match 等 test。新欄位不能讓這些 regress。
//
// PROS: - 低成本的 safety net
// CONS: - 幾乎不會 fail（除非 Builder 改了 ticketId 邏輯）

describe('Frontmatter new fields: backward compat', () => {

  it('existing translation pair tests still pass with new fields', () => {
    // zh-tw post 有 warnedByStage0=true
    // en post 有 warnedByStage0=true
    // ticketId 必須仍然 match
    //
    // Teaching note: 這個 test 可能只是 existing test re-run，不需要新 logic
  });

  it('warnedByStage0 is independent between zh-tw and en versions', () => {
    // Stage 0 只跑 zh-tw (mental model Section 6)
    // en 版 warnedByStage0 應該 copy from zh-tw (translation pair sync)
    //
    // 或者: en 版根本不該有這個 flag，只 inherit UI banner from zh-tw?
    //
    // Teaching note: 這是 Q6 MCQ — 見 chat。
  });
});


// ============================================================================
// 不測的東西
// ============================================================================
//
// - warnReason 的文字好不好 — 主觀
// - warnReason 是否真的反映 judge 意圖 — 需要 eval
// - Banner 渲染結果 (那個在 07-banner-rendering)
