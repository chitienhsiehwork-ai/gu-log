// ============================================================================
// File: 07-banner-rendering.pseudo.ts
// Topic: Stage0WarnBanner Astro component — 從 frontmatter 渲染
// Layer: Contract / Integration (Astro component test)
// ============================================================================
//
// BACKGROUND
// ──────────────────────────────────────────────────────────────────────────
// Tribunal v2 的 Stage 0 是 "all-warning mode" — 不 reject 文章，但低
// confidence 的文章會在 site 上顯示 banner 邀請讀者 feedback。
//
// Component spec 見 devils-advocate-review.md Appendix C。
// Props:
//   reason: string            // from frontmatter.warnReason
//   judgeModel?: string        // "Opus"
//   overrideComment?: string   // from frontmatter.warnOverrideComment
//
// 要渲染的東西:
//   1. "Clawd 的 AI judge 對這篇沒把握" header
//   2. Reason 引言
//   3. 呼籲 feedback 的文字
//   4. 「跳到留言區」按鈕 (anchor to #comments)
//   5. (Optional) ShroomDog 的 override comment section
//
// 另外還有 Stage 4 degraded banner — 結構類似但內容不同。
//
//
// ============================================================================
// 為什麼這個值得測（但也不值得 over-test）
// ──────────────────────────────────────────────────────────────────────────
// 該測的:
//   - Banner 在 frontmatter.warnedByStage0=true 時有渲染
//   - Banner 在 warnedByStage0=false 時不渲染
//   - Reason text 正確顯示（XSS 防護！）
//   - Override comment 在存在時渲染、不存在時不渲染
//   - WCAG contrast 符合 (gu-log 有 contrast CI，見 CLAUDE.md memory)
//
// 不該測的:
//   - Banner 好不好看 — 主觀，交給 uiux-auditor
//   - Banner 動畫 — 不需要 unit test
//   - Giscus 留言系統本身是否運作 — 那是 3rd party
//
//
// ============================================================================
// Test Group A: Conditional rendering
// ============================================================================
//
// WHAT: Banner 只在特定 frontmatter 條件下出現
//
// WHY:  絕大多數文章不該顯示 banner — 錯顯示會 polluting UI。
//
// PROS: - 非常 deterministic (frontmatter boolean → DOM node present/absent)
//       - 用 Playwright component test 很直接
// CONS: - Astro component testing 在 Playwright 裡要 render 真頁面，稍慢
//         (但 gu-log 已經用這個模式，見 tests/clawd-note.spec.ts)

describe('Stage0WarnBanner: conditional rendering', () => {

  it('renders banner when frontmatter.warnedByStage0 is true', () => {
    // Fixture: create temp mdx post with warnedByStage0=true + warnReason
    // Navigate to /posts/<slug>
    // Expect: banner element visible, reason text present
    //
    // Teaching note: gu-log 現有 test pattern — 用真 mdx fixture + real
    //                page navigation。見 tests/post-page.spec.ts。
  });

  it('does NOT render banner when warnedByStage0 is false (or missing)', () => {
    // Most existing posts 應該不顯示
  });

  it('does NOT render banner when warnedByStage0=true but warnReason is missing', () => {
    // 這理論上 schema validation 就會 reject（見 06-frontmatter）
    // 但 defensive: runtime 也不該 render 空 reason banner
    //
    // Teaching note: "Defense in depth" — schema 擋不住就 runtime 擋。
  });
});


// ============================================================================
// Test Group B: Content rendering + XSS safety
// ============================================================================
//
// WHAT: Reason / overrideComment 文字正確顯示 + HTML 不被 inject
//
// WHY:  Stage 0 judge 是 LLM 輸出的 — 理論上可以是任何 string。如果
//       Builder 直接 render `{reason}` 沒 escape，LLM 回 `<script>alert(1)</script>`
//       就 XSS 了。雖然 Astro 預設會 escape，但 test 把這個 invariant 釘死。
//
// PROS: - Security test，高價值
//       - 抓到未來 Builder 誤用 `set:html` 的 bug
// CONS: 幾乎沒有

describe('Stage0WarnBanner: content + XSS safety', () => {

  it('renders plain text reason correctly', () => {
    // reason: "核心觀點不夠展開"
    // Expect: banner 內 textContent 包含 "核心觀點不夠展開"
  });

  it('escapes HTML special chars in reason (XSS protection)', () => {
    // reason: '<script>alert("pwn")</script>'
    // Expect: rendered as literal text, no script execution
    // Assertion: `page.evaluate('window.wasPwned')` is undefined
    //
    // Teaching note: Astro 預設 escape (用 {} syntax)，但這個 test 把
    //                invariant 釘死，防止未來有人改用 set:html。
  });

  it('renders overrideComment section only when provided', () => {
    // without overrideComment: no "ShroomDog 的說明" section
    // with: section rendered with comment text
  });

  it('linkifies "跳到留言區" button to #comments anchor', () => {
    // Expect: <a href="#comments"> exists in banner
    // Click it: scroll to #comments section (if exists on page)
  });
});


// ============================================================================
// Test Group C: Styling & accessibility
// ============================================================================
//
// WHAT: Solarized 配色 + WCAG AA contrast + 不用紅色
//
// WHY:  CLAUDE.md 明確規定只用 Solarized CSS variables，且 banner
//       不該像 error（所以不用紅）。gu-log memory 有 contrast convention:
//       `/* color: X on Y */` comment pattern enables CI check.
//
// PROS: - 避免 UI 違反 brand
//       - Reuse 既有的 contrast CI
// CONS: - Visual/accessibility test 有時 flaky (font rendering 差異)

describe('Stage0WarnBanner: styling + a11y', () => {

  it('uses Solarized CSS variables (no hardcoded hex)', () => {
    // Read the component source file (Astro component testing hack)
    // Assert: no hex colors outside `/* color: ... on #hex */` comment pattern
    // Assert: style references --solarized-yellow or --solarized-orange for accent
  });

  it('does NOT use red accent (banner is not an error)', () => {
    // Search for --solarized-red or #dc322f / #cb4b16-ish in component
    // Fail if found
    //
    // Teaching note: 這是 explicit design rule from Appendix C
  });

  it('meets WCAG AA contrast ratio on text vs background', () => {
    // 用 existing color-contrast.spec.ts pattern
    // 確認 banner 裡的每一塊文字都過 4.5:1
  });

  it('is responsive on mobile (< 640px viewport)', () => {
    // Render at 375px viewport
    // Expect: banner no horizontal overflow
    //
    // Teaching note: 用 Playwright viewport, 已有類似 test
    //                (header-mobile-layout.spec.ts)
  });
});


// ============================================================================
// Test Group D: Stage 4 degraded banner (variant)
// ============================================================================
//
// WHAT: Stage 4 fail 的 banner — 內容不同、結構類似
//
// WHY:  Mental model 說 Stage 4 fail 時 "banner 顯示退化維度"，格式
//       `"Final Vibe: persona 9→7"`。這個是 Stage 0 banner 的 variant。
//       可以複用 Stage0WarnBanner 或寫新 component，看 Builder 決定。
//
// Teaching note: 這是 Q7 MCQ — 見 chat。
//                Option A: 同一個 component, variant prop
//                Option B: 兩個獨立 component

describe('Stage 4 degraded banner', () => {

  it('renders when frontmatter.stage4FinalVibeScores.degraded=true', () => {
    // ...
  });

  it('formats degraded dims as "dim stage1→stage4"', () => {
    // Input: degradedDims=[{dim:'persona', before:9, after:7}]
    // Expect: banner text includes "persona 9→7"
  });

  it('renders alongside Stage 0 banner if both conditions true', () => {
    // 罕見但可能的 case — 一篇文章既被 Stage 0 warn 又 Stage 4 degrade
    // Order: Stage 0 banner 在上（gate 先發生），Stage 4 banner 在下
    // 或兩個合併？
    //
    // Teaching note: 可能延後決定，現在先寫 TODO
  });
});


// ============================================================================
// Test Group E: E2E skeleton (延後)
// ============================================================================

describe.skip('Banner E2E: real publish path (deferred)', () => {
  it('banner appears after real tribunal pipeline runs a low-confidence article', () => {
    // 需要真的跑 pipeline — integration test，等 Builder 完成
  });
});
