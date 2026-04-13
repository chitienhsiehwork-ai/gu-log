// ============================================================================
// File: 01-writer-constraints.pseudo.ts
// Topic: Programmatic diff check — Writer 不能動的結構性東西
// Layer: Unit + Contract
// ============================================================================
//
// BACKGROUND (讀這個前先懂)
// ──────────────────────────────────────────────────────────────────────────
// Tribunal v2 的核心觀察之一: LLM 不可靠地遵守 negative constraints ("不要
// 改 X")。越強的 model 越容易自作主張。Opus 在 "微調語氣" 時，可能順手把
// "200ms 降到 120ms" 改成 "快了一倍" — 它覺得這只是潤色，但事實被改了。
//
// 解法 (見 devils-advocate-review.md Level 3):
//   - Structural constraints (URL/heading/frontmatter) → programmatic diff
//   - Semantic constraints (數字 magnitude) → Stage 3 FactCorrector + source
//
// 這份 pseudo code 只管 structural 那一半。這是 "LLM 守不住，我們自己守" 的
// 兜底機制，所以 test 要寫得紮實。
//
//
// ============================================================================
// Test Group A: URL 不能被偷改
// ============================================================================
//
// WHAT: 驗證 writer 跑完後，文章裡所有 URL（markdown link + raw http）都跟
//       跑之前完全一致。
//
// WHY:  URL 是最容易被 writer "順手改" 的東西 — 為了語氣流暢，Opus 可能
//       改掉 "https://example.com/a" 成 "https://example.com/post-a"。
//       這會直接導致 link 404，讀者體驗爆炸。
//
// PROS: - 100% deterministic — set diff 就抓得到
//       - 不需要 LLM，Layer 1 unit test，飛快
//       - 抓到 bug 的成本極低（一個 failing test 就知道哪一行被改）
// CONS: - 只抓到「URL 字串被改」，抓不到「URL 還在但語義錯了」(e.g. 把
//         指向正文的連結挪到結論段 — URL 沒變但 context 錯了)
//       - 需要一個 robust 的 URL extractor（markdown + HTML + MDX 都要能抓）
//
// ALTERNATIVE: 完全信任 writer prompt 說 "不能改 URL"。**不採用** — 這是
//              整個設計的核心教訓。LLM 守不住 negative constraint。

describe('Writer diff check: URLs are immutable', () => {

  it('extracts all URLs from an MDX document', () => {
    // Input: MDX content with [text](url), <a href="url">, raw http://, MDX
    //        import URLs
    // Expect: Set<string> of all URLs, deduped
    //
    // Teaching note: 這個 helper 函數本身值得 unit test，因為後面所有 writer
    //                diff check 都依賴它。Helper 錯了，整個 pipeline 的
    //                protection 就破功。
  });

  it('returns empty diff when writer output has identical URLs', () => {
    // const before = '...[docs](https://a.com)...';
    // const after  = '...[docs](https://a.com)...';
    // expect(diffUrls(before, after)).toEqual({ added: [], removed: [] });
  });

  it('detects removed URL', () => {
    // const before = '...[docs](https://a.com)...';
    // const after  = '...文件在這裡...'; // URL 整個被拔掉
    // expect(diffUrls(before, after).removed).toContain('https://a.com');
  });

  it('detects mutated URL (subtle — same domain, different path)', () => {
    // const before = '...[post](https://gu-log.vercel.app/posts/sp-1)...';
    // const after  = '...[post](https://gu-log.vercel.app/posts/sp-one)...';
    // expect(diffUrls(before, after).removed).toContain('...sp-1');
    // expect(diffUrls(before, after).added).toContain('...sp-one');
    //
    // Teaching note: 這是最容易被忽略的 edge case — LLM 會「規範化」slug
    //                看起來很合理，但會讓整篇文章的 internal link 大規模壞掉。
  });

  it('rejects writer output if URL set changed (structural violation)', () => {
    // const violation = validateWriterOutput(before, after, { rules: ['urls'] });
    // expect(violation.valid).toBe(false);
    // expect(violation.reason).toContain('URL set changed');
    //
    // Teaching note: validateWriterOutput 回傳 structured error，Builder
    //                可以用這個 trigger 「reject this loop, retry or escalate」
    //                的 state transition。見 05-stage-transitions.
  });
});


// ============================================================================
// Test Group B: Heading 順序不能被偷改
// ============================================================================
//
// WHAT: 驗證 writer 跑完後，所有 ## / ### heading 的文字 + 順序完全一致
//       （Stage 2 FreshEyes writer 不能 reorder、Stage 4 Final Vibe 不能改）
//
// WHY:  Reader 記憶點建立在 heading 結構上。如果 FreshEyes writer 為了
//       "readability" 把 heading 順序換了，TOC、reader progress、甚至
//       SEO 都會受影響。更糟的是，reorder 可能無意間改變 narrative 因果順序。
//
// PROS: - Deterministic — heading 是 markdown 語法，好解析
//       - 高 signal — 一旦 heading 順序變了，幾乎都是 bug
// CONS: - Stage 1 Vibe writer 允許改骨架，所以這個 rule 只能套用在
//         Stage 2 / 3 / 4 writer，不能套用在 Stage 1。Builder 要記得
//         根據 stage 載入不同 constraint set。
//
// ALTERNATIVE: 不測 heading，讓 judge 自己抓 regression。**不採用** —
//              judge 是 LLM，會漏掉 subtle 的 reorder。

describe('Writer diff check: Heading order is immutable (Stage 2+)', () => {

  it('extracts heading list with level + text', () => {
    // Input: '## 第一段\n...\n### 子段\n## 第二段'
    // Expect: [
    //   { level: 2, text: '第一段' },
    //   { level: 3, text: '子段' },
    //   { level: 2, text: '第二段' },
    // ]
  });

  it('passes when heading list is byte-identical', () => {
    // ...
  });

  it('fails when a heading is renamed', () => {
    // before: '## 第一段'
    // after:  '## 開頭'
    // expect violation.reason to mention '第一段 → 開頭'
  });

  it('fails when headings are reordered (same set, different order)', () => {
    // before: ['A', 'B', 'C']
    // after:  ['A', 'C', 'B']
    // 這個 case 很細 — set comparison 不夠，要 sequence comparison
  });

  it('fails when a new heading is inserted', () => {
    // Teaching note: "為了 readability 多加一個 summary heading" 聽起來很合理，
    //                但會打亂 TOC 跟 reading progress 的計算。禁止。
  });
});


// ============================================================================
// Test Group C: Frontmatter 欄位不能被偷改
// ============================================================================
//
// WHAT: Writer 不能改 frontmatter（title, ticketId, sourceUrl, tags, etc.）
//
// WHY:  Frontmatter 是 single source of truth for 文章 metadata。Writer 動
//       到會讓 content collection query 找不到文章、internal link 斷掉、
//       translation pair 裂開（同一篇 zh-tw / en 的 ticketId 應該一致，見
//       content-integrity.spec.ts line 184）。
//
// PROS: - Deterministic、簡單、無敵
//       - 用現有的 frontmatter parser (`content-integrity.spec.ts` 已經有)
//         可以 reuse
// CONS: - Stage 3 Librarian 需要能加 `scores` 欄位 → frontmatter 不能
//         「完全 immutable」，要有 allowlist of mutable keys
//
// ALTERNATIVE: 禁止 writer 動 frontmatter，所有 frontmatter 更新走獨立
//              step。**比較保守** — 但這會讓 pipeline 多一個 coupling
//              點，而且 Builder 很可能偷懶把 score 寫在 frontmatter 裡。
//              allowlist 是比較實際的解。

describe('Writer diff check: Frontmatter is immutable except allowlisted keys', () => {

  const IMMUTABLE_KEYS = [
    'title', 'ticketId', 'originalDate', 'source', 'sourceUrl',
    'author', 'lang', 'summary',
  ];

  const MUTABLE_KEYS_BY_STAGE = {
    stage1Vibe:     [], // Stage 1 writer 不動 frontmatter
    stage2FreshEyes:[], // 同上
    stage3FactLib:  ['scores.factCheck', 'scores.librarian'], // Librarian 可加 score
    stage4FinalVibe:['scores.finalVibe'],
  };

  it('allows adding a score object in Stage 3', () => {
    // Given: stage = 'stage3FactLib'
    //   before: frontmatter without scores.factCheck
    //   after:  frontmatter with scores.factCheck = {...}
    // Expect: valid
  });

  it('rejects Stage 4 writer modifying title', () => {
    // before: title: "A"
    // after:  title: "A (revised)"
    // expect: violation
  });

  it('rejects ANY writer modifying ticketId or sourceUrl', () => {
    // 這些是絕對不能動的，不管哪個 stage
  });
});


// ============================================================================
// Test Group D: ClawdNote 內容不能被 non-Stage1 writer 碰 (最危險的 case)
// ============================================================================
//
// WHAT: Stage 2 / 3 / 4 writer 不能修改 <ClawdNote>...</ClawdNote> 內的文字
//
// WHY:  ClawdNote 是 creative scope — 裡面的誇飾比喻、玩笑是 brand voice。
//       Stage 3 FactCorrector 尤其危險：它會覺得 ClawdNote 裡的某個技術
//       比喻「不夠準確」想去修，但那是 creative license 的一部分。
//       我們明確決定 ClawdNote 完全免 fact-check（見 mental model Section 5）。
//
//       這是 "Contract by component" 哲學的 enforcement。
//
// PROS: - 高 signal — 一旦被動到就是 bug
//       - 解析 ClawdNote 範圍很 deterministic (MDX component tag)
// CONS: - 需要 robust 的 MDX parser 找到 <ClawdNote> 範圍（nested components
//         可能會讓 regex 炸掉 — 可能需要真正的 MDX AST）
//       - Stage 1 是允許改 ClawdNote 的（rewrite 全篇），所以 rule 只在
//         Stage 2+ 生效
//
// ALTERNATIVE: 把 ClawdNote 暫時 "遮起來"（替換成 placeholder）跑 writer，
//              跑完再 swap 回來。**更穩** — 根本不讓 writer 看到 ClawdNote
//              內容。但這會讓 writer 看不到上下文，可能傷害 style
//              coherence。Trade-off。

describe('Writer diff check: ClawdNote body is immutable (Stage 2+)', () => {

  it('extracts ClawdNote blocks with their inner text', () => {
    // Input: '...<ClawdNote>梗 1</ClawdNote>...<ClawdNote>梗 2</ClawdNote>...'
    // Expect: ['梗 1', '梗 2']
  });

  it('handles nested components inside ClawdNote', () => {
    // <ClawdNote>用 <Toggle>...</Toggle> 收起來</ClawdNote>
    // 要能 parse nested MDX tags — regex 可能不夠，考慮 mdast
  });

  it('fails if any ClawdNote text content changed between before/after', () => {
    // Teaching note: 不是 set diff，是 position-aware diff。
    //                [梗1, 梗2] → [梗2, 梗1] 也要 fail。
  });

  it('PASSES if only ClawdNote attributes changed (e.g. variant)', () => {
    // 待 decision: attribute 算不算 "ClawdNote body"？
    // 個人建議: attributes 允許改（variant, author），但 children 不准。
  });
});


// ============================================================================
// Test Group E: Validator 整合 API 設計
// ============================================================================
//
// WHAT: 給 Builder 的 API shape 建議 — 統一 validator interface
//
// WHY:  所有 stage writer 跑完都要跑一次 validator，用統一 interface
//       Builder 很好接。

describe('validateWriterOutput API shape', () => {

  it('returns { valid: true } for clean output', () => {
    // const result = validateWriterOutput({
    //   stage: 'stage4FinalVibe',
    //   before: mdxA,
    //   after: mdxB,
    //   rules: ['urls', 'headings', 'frontmatter', 'clawdNote'],
    // });
    // expect(result.valid).toBe(true);
    // expect(result.violations).toEqual([]);
  });

  it('returns structured violations for dirty output', () => {
    // Expect violations to be an array of:
    //   { rule: string, location: string, before: string, after: string }
    // So Builder can format this into:
    //   - Writer retry feedback (tell the LLM what it broke)
    //   - Log line for debugging
    //   - Failure reason for state machine
  });
});
