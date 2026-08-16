## Why

gu-log 現行規格把 GP 與 MP 都定義成忠實翻譯，但實際 MP pipeline、部分寫作指引與既有文章早已讓 Mogu 重組來源、建立自己的論點。這個矛盾會迫使好觀點連同不理想的原文文筆一起被保留，也讓 judge 與讀者介面錯把 Mogu 的文章標成來源作者的翻譯。

## What Changes

- 將 GP 定義為「來源作者擁有正文聲音」的忠實翻譯：保留完整 source spine、論點強弱、caveat、敘事人稱與自然結尾；Mogu 的額外評論留在可辨識的 MoguNote。
- 將 MP 定義為「Mogu 擁有正文聲音」的 source-grounded article：Mogu 消化單一主要來源後，可選材、刪減、重排、綜合、反駁或重建論證，不負有完整覆蓋來源或模仿原作者文筆的義務。
- 為 MP 建立 claim-level grounding 邊界：只要正文保留某個來源主張，就必須保留會控制該主張的 speaker、條件、hedge、caveat、證據範圍與信心水準；Mogu 新增的分析不得被錯誤歸因給來源作者，也不得捏造事實、引文、數字、因果或親身經驗。
- 依 reader job 區分 MP 與 Lv：主要承諾是提出 Mogu 自己的文章主張時使用 MP；主要承諾是分步教會讀者理解概念或來源時使用 Lv。SD 仍由 ShroomDog 擁有正文聲音。
- 同步 writer／review／refine prompt、Fact Checker、Librarian、Tribunal Writer、公開系列說明、來源標示與 technical details，讓生成、評審和讀者看到相同定義。
- 沿用現有 MP 的 `write → review → refine → Tribunal rewrite` 路徑與單一 `sourceUrl`；不新增另一套 pipeline、editorial mode、frontmatter schema 或多主要來源機制。
- 既有 MP 文章不做 mass rewrite，也不宣稱曾通過本 change 之後才建立的檢查。新的 MP 與日後有實質正文修改的 MP 必須遵守新 contract。
- 本 change 取代 `add-editorial-spine-rebuild` 中為這個問題提出的通用三模式、固定刪減比例與 judge schema 擴張；保留「可重建死骨架」的編輯自由，但不建立新的 editorial-mode framework。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `editorial-charter`：拆開 GP 的 translation fidelity 與 MP 的 Mogu-authored source grounding、voice ownership、MoguNote 及系列分流 contract。
- `brand-taxonomy`：將 MP 從 translation series 改為 source-grounded writing series，並要求公開標示與 operator-facing 描述符合系列 identity。

## Impact

- 規格與寫作文件：`openspec/specs/`、`CONTRIBUTING.md`、`GU-LOG_WRITER_PROMPT.md`。
- 生成與審稿：`tools/gp-pipeline/` 的 MP prompts／測試，以及 `.claude/agents/`、`.codex/agents/`、`scripts/vibe-scoring-standard.md`。
- 讀者介面：zh-TW／English 首頁、MP 系列頁、文章來源標示與 technical details。
- 不改 ticket prefix、route、counter、content schema、GP source-preservation pipeline 或現行 publish policy。
