// ============================================================================
// File: 04-fact-corrector.pseudo.ts
// Topic: FactCorrector standing checklist + source URL fetch + scope exclusion
// Layer: Contract (mock LLM, verify we construct the right prompt + handle response)
// ============================================================================
//
// BACKGROUND
// ──────────────────────────────────────────────────────────────────────────
// FactCorrector 是 tribunal v2 最複雜的 component — 它 proactively 修事實，
// 不是 reactive 等 judge feedback。這個設計的核心是 "worker-first" —
// 第一輪就直接動手修，靠 standing checklist + source URL 作為 guidance 避
// 免盲改（見 mental model Level 2）。
//
// 關鍵 invariants (要測的東西):
//   1. Prompt 必須包含完整 standing checklist (7 條)
//   2. Prompt 必須包含 source URL fetch 結果
//   3. Scope 必須排除 ClawdNote (creative scope 保護)
//   4. ShroomDogNote 的 hedge words (我想/應該/大概) 必須保留
//   5. Output 必須 parse 成 FactCorrectorOutput schema
//
//
// ============================================================================
// 大哉問: Mock 要切在哪一層？
// ============================================================================
//
// 這是整份 spec 最重要的 trade-off，CEO 要決定（見 chat Q1）。
//
// A) Mock LLM response (JSON fixture)
//    - 快、穩定、可控
//    - 離真實 LLM 行為遠，無法抓 prompt drift
//    - 適合 test response parsing + downstream logic
//
// B) Mock HTTP adapter (fetch-level, e.g. MSW or nock)
//    - 更接近真實，可以 inspect prompt body
//    - 需要 capture real response format
//    - 適合 test prompt construction
//
// C) 不 mock，真的打 Opus
//    - 最真實
//    - 慢、貴、非 deterministic
//    - 不適合 TDD，但偶爾可以跑 smoke test
//
// Recommendation:
//   - Test Group A (prompt construction): B (mock HTTP, inspect prompt body)
//   - Test Group B (scope exclusion): A or unit-level (純 string logic)
//   - Test Group C (response parsing): A (JSON fixture)
//   - Test Group D (source URL fetch): B (mock HTTP for both Claude API + source site)
//
// 不同 test 用不同 mock layer 是 OK 的。一致性不如清晰度重要。
//
//
// ============================================================================
// Test Group A: Prompt 必須包含 standing checklist
// ============================================================================
//
// WHAT: 驗證 FactCorrector 丟給 Opus 的 prompt body 包含 7 條 checklist
//
// WHY:  Standing checklist 是 "worker-first without going blind" 的核心。
//       如果 Builder 某次 refactor 不小心把 checklist 從 prompt 移除了，
//       FactCorrector 就變成盲修。這個 regression 沒 test 抓不到。
//
// PROS: - 抓到 prompt drift — 很高價值
//       - 不需要跑真 LLM，contract test 層就夠
// CONS: - 是「我們問了 LLM 什麼」，不是「LLM 真的照做」
//         （後者只能靠 eval dataset，現階段測不到）
//
// ALTERNATIVE: 只靠 code review 抓 prompt 改動。**不夠** — checklist
//              有 7 條，哪一條被刪 review 可能看漏。test 更可靠。

describe('FactCorrector: prompt construction', () => {

  const STANDING_CHECKLIST_KEYWORDS = [
    '數字',           // Item 1: 數字/百分比 → 跟 source 比對
    '技術名詞拼寫',   // Item 2
    '時間',           // Item 3: 時間/日期/人名/公司名
    '技術宣稱',       // Item 4
    'ClawdNote',      // Item 5: SKIP ClawdNote
    '我想',           // Item 6: hedge words 保留
    '不確定',         // Item 7: flag, don't change
  ];

  it('includes all 7 checklist items in the system prompt', () => {
    // 1. Mock HTTP layer
    // 2. Call runFactCorrector(article) — internally builds prompt + calls LLM
    // 3. Assert mocked HTTP body contains all STANDING_CHECKLIST_KEYWORDS
    //
    // Teaching note: 這是 contract test 的典型寫法 — 不跑 LLM，只檢查
    //                我們傳給 LLM 的 prompt 是對的。
  });

  it('includes the source URL fetch result in the prompt', () => {
    // Given: mock HTTP returns '<html>...original article text...</html>'
    // When: FactCorrector builds prompt
    // Expect: prompt body includes the fetched source text (可能 truncated)
    //
    // Teaching note: 如果 fetch 失敗會怎樣？見 Test Group D。
  });

  it('truncates fetched source if too long (>N chars)', () => {
    // Source 可能是 20k+ chars 的長文，塞進 prompt 會爆 context。
    // 應該 truncate 到 first N chars + "..." + last M chars，or
    // 用 summarization pre-pass。
    //
    // Teaching note: 這是 Q3 MCQ — truncation strategy。
  });

  it('includes article body but NOT ClawdNote', () => {
    // Input: article with <ClawdNote>梗</ClawdNote>
    // Expect: prompt 包含 article body，但 ClawdNote 的內文不在 prompt 裡
    //         （可以用 placeholder 占位 "[ClawdNote: skipped]"）
    //
    // Teaching note: 這是 "Contract by component" 的 prompt-level enforcement。
    //                見 Test Group B。
  });
});


// ============================================================================
// Test Group B: Scope exclusion — ClawdNote 完全不進 FactCorrector
// ============================================================================
//
// WHAT: 驗證 ClawdNote 內容從來不會被 FactCorrector 碰到
//
// WHY:  ClawdNote 是 creative scope — 裡面的誇飾 analogy 不能被 fact check
//       掉（見 mental model Section 5）。這個保護有兩層:
//         1. Prompt 層: 不把 ClawdNote 餵給 LLM
//         2. Diff 層: 跑完後如果發現 ClawdNote 被改了，flag violation
//
// PROS: - Deterministic scope split — 可以用 pure function 測
//       - 防止 silent creative voice erosion
// CONS: - ClawdNote 有 nested MDX 時 parser 要夠 robust

describe('FactCorrector: scope exclusion', () => {

  it('stripClawdNotes() replaces ClawdNote blocks with placeholder', () => {
    // Input:  '第一段\n<ClawdNote>吐槽</ClawdNote>\n第二段'
    // Expect: '第一段\n[CLAWD_NOTE_PLACEHOLDER_0]\n第二段'
    //
    // Teaching note: Placeholder 方案 vs 完全刪除 —
    //                placeholder 保留段落結構 (LLM 知道 "這裡有個 ClawdNote")
    //                刪除會讓上下文變奇怪。Placeholder 比較穩。
  });

  it('restoreClawdNotes() puts them back after LLM processing', () => {
    // Round-trip: strip → feed to LLM → restore
    // 最終 output 的 ClawdNote 應該跟原版 byte-identical
  });

  it('handles multiple ClawdNote blocks with unique placeholders', () => {
    // placeholder_0, placeholder_1, ... 不會混淆
  });

  it('handles ClawdNote with nested Toggle/code/MDX components', () => {
    // Edge case: <ClawdNote>見 <Toggle>code</Toggle></ClawdNote>
    // parser 要能識別正確的 closing tag
  });

  it('ShroomDogNote is NOT stripped (不同於 ClawdNote)', () => {
    // ShroomDogNote 要 fact-check，只是 hedge words 要保留
    //
    // Teaching note: Mental model Section 5 把 ClawdNote 和 ShroomDogNote
    //                明確分開處理。這個 test 把 "為什麼它們不一樣" 釘死。
  });
});


// ============================================================================
// Test Group C: Response parsing + output schema
// ============================================================================
//
// WHAT: LLM 回傳 JSON 後的 parsing + schema validation
//
// WHY:  LLM 輸出 JSON 不可靠（見 03-judge-schemas）。FactCorrector output
//       schema 尤其複雜（陣列 of changes, flagged, source_urls）。
//
// PROS: - Layer 1 unit，完全 fixture-based
//       - 可以測 edge case (LLM 回了壞 JSON、漏欄位、空陣列)
// CONS: - 不保證 LLM 真的會按 schema 產

describe('FactCorrector: response parsing', () => {

  it('parses happy-path response with changes_made and empty flagged', () => {
    // Fixture: 'happy-path.json'
    // Expect: valid FactCorrectorOutput, changes.length > 0
  });

  it('handles LLM response wrapped in markdown code fence', () => {
    // LLM 常 return '```json\n{...}\n```' instead of raw JSON
    // Parser 要先 strip fence
    //
    // Teaching note: 這是常見 LLM pitfall — 不處理會 JSON.parse throw。
  });

  it('retries on invalid JSON (schema fail)', () => {
    // If LLM returns invalid JSON or schema-invalid object:
    //   - retry up to N times with "correct your output" feedback
    //   - after N, escalate to pipeline failure
    //
    // Teaching note: 這個 retry 不算 tribunal pipeline 的 max_loops —
    //                是 parse-level retry。Builder 要分清楚兩種 retry。
  });

  it('ShroomDogNote hedge words preserved in changes_made.after', () => {
    // Input article has ShroomDogNote with "我想這個應該是..."
    // FactCorrector 不能把它改成肯定句 "這個是..."
    //
    // 這個 test 問題是 — 你要怎麼 assert？
    //
    // Option A: Mock LLM 回應 + inspect changes_made
    //           → 只測 "我們 parse 到 LLM 的改動"，不是 "LLM 真的守規則"
    // Option B: Post-process validation — check if any change in ShroomDogNote
    //           removed hedge words → if so, flag violation
    //
    // Recommendation: Option B. Post-process check 更可靠。
  });
});


// ============================================================================
// Test Group D: Source URL fetch — 失敗怎麼辦？
// ============================================================================
//
// WHAT: FactCorrector fetch source URL 的 error handling
//
// WHY:  Source URL 可能 404、timeout、paywall、JS-heavy SPA。如果 fetch
//       失敗，FactCorrector 要怎麼做？有三個 option:
//         A) Fail loud — 整個 stage 3 FAIL，escalate to NEEDS_REVIEW
//         B) Degrade gracefully — 沒 source URL 也能跑，但 flag 更保守
//         C) Skip FactCorrector 整個 stage，只跑 Librarian
//
// PROS: - 強制 Builder 想清楚 error path
// CONS: - 真實網路 fetch 測不了 → 只能 mock

describe('FactCorrector: source URL fetch error handling', () => {

  it('fetches source URL from frontmatter before calling LLM', () => {
    // Happy path: sourceUrl fetched, content passed to prompt
  });

  it('handles 404 source URL — degrade to no-source mode', () => {
    // Expected behavior: log warning, proceed with empty source context,
    //                    add metadata flag "source_unavailable: true" to output
    //
    // Teaching note: 這是 Q4 MCQ — 見 chat。
  });

  it('handles timeout (>10s) by falling back to no-source mode', () => {
    // 同上，但 timeout 要明確（不能無限 wait）
  });

  it('handles rate limit (429) with exponential backoff retry', () => {
    // 通常 source site 不會 rate limit，但 arxiv / github API 會
  });

  it('stores fetched source URLs in output for audit', () => {
    // output.source_urls_fetched = ['https://example.com/post']
    // 這樣下游 debug 時知道 FactCorrector 到底 fetch 了什麼
  });
});


// ============================================================================
// Test Group E: Integration skeleton (延後實作)
// ============================================================================
//
// 等 Builder 跑完第一篇真文章再寫。現在只留 skeleton 當 TODO。

describe.skip('FactCorrector: real LLM integration (Layer 3, deferred)', () => {
  it('corrects a known-wrong article against a labeled dataset', () => {
    // Needs eval dataset — see handoff note in README
  });
});
