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

**Answer**: _待 CEO 決策_
**Reason**:
**Impl Notes**:

---

## Q2: BaseJudgeOutput schema 在 PASS 時塞了 improvements 要怎麼辦？

**Context**: `03-judge-schemas.pseudo.ts` Test Group A, last test

**Options**:
- A) Hard-fail (schema reject)
- B) Warning log + strip the unused fields
- C) Silent accept

**Answer**: _待 CEO 決策_
**Reason**:
**Impl Notes**:

---

## Q3: FactCorrector 的 source URL truncation 策略？

**Context**: `04-fact-corrector.pseudo.ts` Test Group A

**Options**:
- A) First N chars + "..." + last M chars
- B) Summarization pre-pass (用另一個 LLM call 壓縮)
- C) Full context — 讓 Opus 吃 200k tokens
- D) Chunked scan (分段掃，各段 fact check)

**Answer**: _待 CEO 決策_
**Reason**:
**Impl Notes**:

---

## Q4: Source URL fetch 失敗怎麼辦？

**Context**: `04-fact-corrector.pseudo.ts` Test Group D

**Options**:
- A) Fail loud → Stage 3 FAIL → retry → NEEDS_REVIEW
- B) Degrade gracefully → 沒 source context 跑 LLM, flag more 保守
- C) Skip FactCorrector, 只跑 Librarian
- D) Block publish — 沒 source URL 不准發

**Answer**: _待 CEO 決策_
**Reason**:
**Impl Notes**:

---

## Q5: warnReason 的 length cap？

**Context**: `06-frontmatter.pseudo.ts` Test Group A

**Options**:
- A) 100 chars (harsh, 1 line mobile)
- B) 150 chars (2 lines mobile)
- C) 250 chars (paragraph-sized)
- D) No cap, let UI CSS truncate

**Answer**: _待 CEO 決策_
**Reason**:
**Impl Notes**:

---

## Q6: Stage 0 warn 在 en 翻譯版本的處理？

**Context**: `06-frontmatter.pseudo.ts` Test Group C

**Options**:
- A) en 版 copy warnedByStage0 + warnReason from zh-tw (auto sync)
- B) en 版 不標 warn (只 zh-tw 有 banner)
- C) en 版 有自己的 Stage 0 judge 跑一次
- D) en 版 warn 但顯示英文 reason (需要額外翻譯)

**Answer**: _待 CEO 決策_
**Reason**:
**Impl Notes**:

---

## Q7: Stage 0 banner vs Stage 4 degraded banner 同個 component 還是兩個？

**Context**: `07-banner-rendering.pseudo.ts` Test Group D

**Options**:
- A) 一個 component 用 variant prop (`<WarnBanner variant="stage0"/>`)
- B) 兩個獨立 component (`Stage0WarnBanner` + `Stage4DegradedBanner`)

**Answer**: _待 CEO 決策_
**Reason**:
**Impl Notes**:

---

## Q8: Commit message 用 Unicode arrow `→` 還是 ASCII `->`?

**Context**: `08-git-commit-format.pseudo.ts` Test Group A

**Options**:
- A) `→` (U+2192) — 跟中文 commit 比較合拍
- B) `->` (ASCII) — terminal 相容性好

**Answer**: _待 CEO 決策_
**Reason**:
**Impl Notes**:

---

## Q9: Tribunal branch naming 要不要加日期 prefix？

**Context**: `08-git-commit-format.pseudo.ts` Test Group C

**Options**:
- A) `tribunal/cp-280-slug` (簡潔)
- B) `tribunal/2026-04-11-cp-280-slug` (時間序清楚)
- C) `tribunal/cp-280-slug-r1` (retry suffix 明確)

**Answer**: _待 CEO 決策_
**Reason**:
**Impl Notes**:

---

## Q10: LUXURY_TOKEN grep pattern 要多嚴格？

**Context**: `09-luxury-token-audit.pseudo.ts` Test Group B

**Options**:
- A) Loose: `LUXURY_TOKEN` 任何地方 (markdown mention 也算)
- B) Medium: `LUXURY_TOKEN:` (colon 後面要有內容)
- C) Strict: `(//|#|<!--)\s*LUXURY_TOKEN:` (只認 inline comment)

**Answer**: _待 CEO 決策_
**Reason**:
**Impl Notes**:

---

## 附錄: CEO 想 review 的 topic

CEO 可以在這裡加上想跟 Test Writer 討論的 topic:
- [ ]
- [ ]
- [ ]
