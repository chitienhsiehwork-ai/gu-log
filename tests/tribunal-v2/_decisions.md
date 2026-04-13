# Tribunal v2 TDD — CEO Decisions Log

> 這份文件記錄 CEO 在 TDD 規劃階段對 Test Writer 提出的 MCQ 做的決策。
> Test Writer 填空白，CEO 答完後更新此檔。Builder 實作時以此為準。

---

## 使用說明

每個 Q 對應 Test Writer 在 chat 裡提的 MCQ。答案鎖定後這份文件變成 impl 的
額外 constraint，Builder 要照著做。

決策 format:
- **Answer**: A / B / C / D
- **Reason**: 為什麼這樣選
- **Impl Notes**: Builder 要注意什麼

---

## Q1: FactCorrector mock layer 怎麼切？

**Context**: `04-fact-corrector.pseudo.ts` Test Group A

**Options**:
- A) Mock LLM response (JSON fixture)
- B) Mock HTTP adapter (fetch level)
- C) Real Opus integration

**Answer**: **B + A 混搭** — CTO decided (2026-04-11)
**Reason**: B (mock HTTP) for prompt construction tests — 可以 inspect prompt body, 確保 checklist 有塞進去。A (mock JSON fixture) for response parsing tests — 快、穩定、deterministic。不同 test 用不同 mock layer 比追求一致性更有意義。
**Impl Notes**: Builder 寫 prompt construction test 時用 MSW / nock 之類 mock fetch；response parsing test 用 JSON fixture files in `tests/tribunal-v2/fixtures/`。

---

## Q2: BaseJudgeOutput schema 在 PASS 時塞了 improvements 要怎麼辦？

**Context**: `03-judge-schemas.pseudo.ts` Test Group A, last test

**Options**:
- A) Hard-fail (schema reject)
- B) Warning log + strip the unused fields
- C) Silent accept

**Answer**: **B (warn + strip)** — CTO decided (2026-04-11)
**Reason**: Hard-fail 對 LLM 太兇 — LLM 偶爾會在 PASS 時也塞 improvements（多嘴而已，不影響正確性）。Silent accept 又讓 schema 沒意義。warn + strip 兩全其美：log 下來方便 debug，但不 block pipeline。
**Impl Notes**: Builder 用 Zod `.transform()` strip extras + `console.warn()` log。不要用 `.passthrough()`（那會 silent accept）。

---

## Q3: FactCorrector 的 source URL truncation 策略？

**Context**: `04-fact-corrector.pseudo.ts` Test Group A

**Options**:
- A) First N chars + "..." + last M chars
- B) Summarization pre-pass (用另一個 LLM call 壓縮)
- C) Full context — 讓 Opus 吃 200k tokens
- D) Chunked scan (分段掃，各段 fact check)

**Answer**: **A (first N + last M)** for now — CTO decided (2026-04-11)
**Reason**: 初期 source 多是推文（短），simple truncation 夠用。不需要 pre-pass LLM call 或 chunked scan 的複雜度。
**Impl Notes**: 建議 N=8000 chars front, M=2000 chars tail（合計 ~10k chars ≈ 2.5k tokens）。未來 source 是 paper 或長文時，考慮升級到 D (chunked scan) — 屆時 re-open 這個 decision。

---

## Q4: Source URL fetch 失敗怎麼辦？

**Context**: `04-fact-corrector.pseudo.ts` Test Group D

**Options**:
- A) Fail loud → Stage 3 FAIL → retry → NEEDS_REVIEW
- B) Degrade gracefully → 沒 source context 跑 LLM, flag more 保守
- C) Skip FactCorrector, 只跑 Librarian
- D) Block publish — 沒 source URL 不准發

**Answer**: **B (degrade gracefully)** — CTO decided (2026-04-11)
**Reason**: Gu-log 的 source 很多是推文 (X/Twitter)，fetch 失敗率不低（rate limit, 需登入, 暫時掛了）。Fail-loud 和 block-publish 都會卡死 pipeline。沒 source 也能跑，只是 FactCorrector 要更保守（多 flag、少自動修）。
**Impl Notes**: FactCorrector output 加 `source_unavailable: true` flag。Combined Judge 看到這個 flag 時要降低 factAccuracy 的信心。Log warning 給 heartbeat monitor。

---

## Q5: warnReason 的 length cap？

**Context**: `06-frontmatter.pseudo.ts` Test Group A

**Options**:
- A) 100 chars (harsh, 1 line mobile)
- B) 150 chars (2 lines mobile)
- C) 250 chars (paragraph-sized)
- D) No cap, let UI CSS truncate

**Answer**: **B (150 chars)** — CTO decided (2026-04-11)
**Reason**: Mobile 2 行剛好，不會爆版。100 太短（judge 很難一行講清楚 reason），250 太長（banner 變段落）。
**Impl Notes**: Zod schema: `z.string().max(150)`。Judge prompt 要明確指示 "reader_friendly_reason 不超過 150 字"。超過時 response parsing 要 truncate + warn（不 hard-fail，跟 Q2 一致）。

---

## Q6: Stage 0 warn 在 en 翻譯版本的處理？

**Context**: `06-frontmatter.pseudo.ts` Test Group C

**Options**:
- A) en 版 copy warnedByStage0 + warnReason from zh-tw (auto sync)
- B) en 版 不標 warn (只 zh-tw 有 banner)
- C) en 版 有自己的 Stage 0 judge 跑一次
- D) en 版 warn 但顯示英文 reason (需要額外翻譯)

**Answer**: **A (copy from zh-tw)** — CTO decided (2026-04-11)
**Reason**: Stage 0 只跑 zh-tw（mental model Section 6），en 版翻譯後 inherit 同樣的 warn flag。Reason 保持中文是可接受的 trade-off — zh-tw 版先發，en 版讀者通常知道這是翻譯。
**Impl Notes**: Stage 5 Translation 時自動 copy `warnedByStage0` + `warnReason` from zh-tw frontmatter 到 en frontmatter。Banner component 讀 frontmatter 即可，不用管 lang。

---

## Q7: Stage 0 banner vs Stage 4 degraded banner 同個 component 還是兩個？

**Context**: `07-banner-rendering.pseudo.ts` Test Group D

**Options**:
- A) 一個 component 用 variant prop (`<WarnBanner variant="stage0"/>`)
- B) 兩個獨立 component (`Stage0WarnBanner` + `Stage4DegradedBanner`)

**Answer**: **B (兩個獨立 component)** — CTO decided (2026-04-11)
**Reason**: Stage 0 (judge 沒把握) 和 Stage 4 (維度退化) 語意不同，共用 component 只會讓 prop 變醜。兩個獨立 component 各自清楚，維護也不會互相影響。
**Impl Notes**: `Stage0WarnBanner.astro` + `Stage4DegradedBanner.astro`，各自獨立 props。共用 styling 可以抽到 CSS class / Astro partial，但 component 本身分開。

---

## Q8: Commit message 用 Unicode arrow `→` 還是 ASCII `->`?

**Context**: `08-git-commit-format.pseudo.ts` Test Group A

**Options**:
- A) `→` (U+2192) — 跟中文 commit 比較合拍
- B) `->` (ASCII) — terminal 相容性好

**Answer**: **A (`→` U+2192)** — CTO decided (2026-04-11)
**Reason**: 2026 了，modern terminal 全部 UTF-8 safe。中文 commit message 已經不 care ASCII compat。`→` 比 `->` 視覺更清楚（特別是跟分數數字混在一起時）。
**Impl Notes**: `formatStageSummary()` 用 `→` (U+2192)。`parseStageSummary()` 也要用 `→` match（不要 fallback 到 `->`，保持 format 唯一）。

---

## Q9: Tribunal branch naming 要不要加日期 prefix？

**Context**: `08-git-commit-format.pseudo.ts` Test Group C

**Options**:
- A) `tribunal/cp-280-slug` (簡潔)
- B) `tribunal/2026-04-11-cp-280-slug` (時間序清楚)
- C) `tribunal/cp-280-slug-r1` (retry suffix 明確)

**Answer**: **B (日期 prefix)** — CTO decided (2026-04-11)
**Reason**: `tribunal/2026-04-11-cp-280-slug` — 文章多了以後 `git branch` 按時間排會很方便。Retry 時 force-push 到同個 branch（保留一個 canonical source of truth），不用 `-r1` suffix。
**Impl Notes**: Branch format: `tribunal/YYYY-MM-DD-<ticketId-lowercase>-<slug>`。Builder 寫 `generateBranchName()` helper。同一篇文章 re-run 直接 force-push，不另開 branch。

---

## Q10: LUXURY_TOKEN grep pattern 要多嚴格？

**Context**: `09-luxury-token-audit.pseudo.ts` Test Group B

**Options**:
- A) Loose: `LUXURY_TOKEN` 任何地方 (markdown mention 也算)
- B) Medium: `LUXURY_TOKEN:` (colon 後面要有內容)
- C) Strict: `(//|#|<!--)\s*LUXURY_TOKEN:` (只認 inline comment)

**Answer**: **C (strict comment-only grep)** — CTO decided (2026-04-11)
**Reason**: `(//|#|<!--)\s*LUXURY_TOKEN:` 只認 code 裡的 inline comment。這樣 audit script 不會把 spec、markdown、這份 _decisions.md 裡的 mention 算進去。只抓 Builder 實際標記的位置。
**Impl Notes**: 更新 `scripts/luxury-token-audit.sh` 的 grep pattern 從 `LUXURY_TOKEN:` 改成 `(//|#|<!--)\s*LUXURY_TOKEN:`。對應 test 也用同樣 pattern。

---

## 附錄: CEO 想 review 的 topic

CEO 可以在這裡加上想跟 Test Writer 討論的 topic:
- [ ]
- [ ]
- [ ]
