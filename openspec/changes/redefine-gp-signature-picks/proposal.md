## Why

GP 和 MP 的分法一直講不清楚。名字（Gu-log Picks／Mogu Picks）聽起來在講「誰挑的」，實際上兩邊都是 ShroomDog 挑來源、Mogu 寫；真正的差別藏在「寫法」：GP 是導讀，要過來源距離章（重講原文不超過 30%），MP 是 Mogu 自己的文章、沒有距離限制。結果 agent 評估來源時常推薦 GP，寫完才卡在距離章（2026-10-28 Felix〈Hunger beats tenure〉就是這樣，最後改成 MP）。

ShroomDog 2026-10-28 在 chat 決定新的分法：**MP 是日常的部落格文章，GP 是 ShroomDog 親自指定、能代表 gu-log 品質的招牌文章**。差別從「寫法」改成「格」。名字 Gu-log Picks 保留（英文讀起來就是 Editor's Picks），代碼與網址不變。

## What Changes

- **系列定義**：GP = ShroomDog 親自指定的招牌文章；MP = 日常文章，所有有來源的新文章預設寫成 MP。GP 的寫作與 grounding 規則跟 MP 相同，差別只在「ShroomDog 指定」加上「升格時要有 Tribunal PASS」。升格不改變內容契約：GP 就是遵守 MP 契約的文章；沒有作者同意的整篇翻譯不能公開，這條適用所有系列。SD、Lv 不變。
- **誰能決定 GP**：只有 ShroomDog 明確說「這篇是 GP」才算。agent 不得自行選 GP 或在評估時推薦 GP，最多說一句「可能夠格當招牌」。GP 一律由 MP 升格，而且只能透過新增的 `scripts/reclassify-post.mjs`：還沒上線就指定的，把 `MP-PENDING` 改成 `GP-PENDING`（兩種語言的檔名與 ticket 一起改，不配號、不寫轉址）；已上線的配新 GP 號、舊網址轉址（`brand-taxonomy` 的改系列機制）。這次清理和之後的升格共用這支 script。`gp-pipeline` 寫作指令拒絕 `--prefix GP`。
- **GP 門檻**：升格成 GP 前必須有 Tribunal PASS，兩條升格路徑都由 `reclassify-post.mjs` 把關。PASS 是升格門檻，不是持續條件：升格後重評沒過不擋 commit，沒過 publish bar 的 GP 照既有規則不上首頁。
- **BREAKING：退役來源距離章**：GP 不再是導讀，`source-distance-stamp` 整個退役——aligner、`gp-pipeline stamp`、距離 policy、`validate-posts` 驗章、英文逐字檢查、pipeline 的 GP 導讀寫作流程、frontmatter `sourceDistance` 欄位一併移除。
- **Tribunal 對 GP 仍只評分不改寫**：理由從「改了正文章會失效」改成「GP 的正文是 ShroomDog 認可過的」。沒改過的未過關 GP 不重評照舊。
- **舊文章清理**：還在線上的 4 篇導讀（GP-276～279 共 6 個檔，GP-276、277 只有繁中）改成 MP，配新 MP 號，舊網址 308 轉到新網址，站內連結改成新網址；MP 一定要中英成對，所以改完再用 `gp-pipeline translate` 替原 GP-276、277 補英文版，最後共 8 個檔。270 篇下架墓碑與 GP-1 示範文留在 GP，當歷史紀錄。
- **下架來源**：「帶有效章的 GP 可以重寫下架來源」這個例外跟著章一起消失；新文章的來源跟任何下架文章相同，一律擋。改系列（遷移清單有記、`sourceUrl` 沒變）不算新文章，替改系列的文章補上缺少的語言版本也不算。
- **`ShroomDogNote`**：自動寫作一律不產生 `ShroomDogNote`，gp-pipeline 原本只對 GP 的擋下改成不分系列；評審在任何系列都把 `ShroomDogNote` 當成 ShroomDog 本人的話。
- **中英成對**：GP 跟 MP 一樣兩種語言都要，`check-translation-pairs` 拿掉 GP 依 Tribunal 結果決定要不要英文版的分支。
- **讀者看得到的文案**：GP／MP 列表頁與首頁副標、about 頁、counter description 改成新定義；GP 文章頁的來源標示從「原文出處」／`Original source` 改成跟 MP 相同的「來源材料」／`Source material`，技術資訊不再顯示「導讀 pipeline」；首頁在沒有任何可列的 GP 時不顯示 GP 區，GP 列表頁的空狀態改成「還沒有招牌文章」。徽章只有系列名稱，不用改。
- **agent 指示**：AGENTS.md〈URL intake〉、CONTRIBUTING、GU-LOG_WRITER_PROMPT、gp-pipeline SKILL 改成「預設 MP、GP 只聽 ShroomDog」。

## Capabilities

### New Capabilities

- `gp-signature-picks`：GP 的定義與內容契約、只有 ShroomDog 能指定、一律由 MP 升格且升格要 Tribunal PASS、`scripts/reclassify-post.mjs`（已上線與上線前兩條路、拒絕條件）、GP 列表與首頁空狀態、gp-pipeline 寫作指令拒絕 GP。GP 規則集中在這裡，原本會塞進 `editorial-charter`、`brand-taxonomy`、`gp-pipeline-publish-integrity` 的新要求都放這裡。

### Modified Capabilities

- `editorial-charter`：GP／MP 一句話身份、MP body 與系列分流改寫；移除 GP 導讀相關要求（GP 規則改由 `gp-signature-picks` 承接）；整篇翻譯要作者同意改成適用所有系列；自動化不產生 `ShroomDogNote`、評審把它當 ShroomDog 本人的話。
- `brand-taxonomy`：GP／MP 的定義文字與讀者看到的系列標示；改系列配新號的規則也適用於 MP→GP 升格與這次 GP→MP 清理（指令本身在 `gp-signature-picks`）。
- `gp-source-preservation`：Tribunal 只評分不改寫的理由改成 ShroomDog 認可；拿掉跟距離章綁在一起的部分。
- `gp-pipeline-publish-integrity`：移除導讀流程與發布前蓋章的要求；擋下 `ShroomDogNote` 改成不分系列；Lv 的 help 情境同步拿掉 GP（寫作指令拒絕 GP 寫在 `gp-signature-picks`）。
- `post-takedown`：移除「帶章 GP」的下架來源例外與 `sourceDistance` 欄位；改系列與替它補語言版本不算新文章。
- `tribunal-score-persistence`：GP 分數寫入那條拿掉來源距離章，寫明升格後的 GP 不要求每一關都 PASS。
- `tribunal-focal-source-evidence`：FactChecker 用同一套規則評 GP 與 MP，不再以完整覆蓋、順序或原作者語氣評 GP。
- `claude-prose-writing-runtime`：拿掉 GP 導讀改寫與 aligner 的句子。

檢查過不用改：`dedup-policy`（帶章 GP 的例外其實寫在 `post-takedown`）、`publish-bar-visibility`（升格後沒過 PASS 的 GP 照既有 below-bar 規則處理）、`extended-post-frontmatter`、`codex-exec-writing-runtime`。

### Removed Capabilities

- `source-distance-stamp`：整個退役。

## Impact

- 程式：`scripts/lib/source-distance.mjs`、`scripts/source-distance.mjs`、`scripts/validate-posts.mjs`、`scripts/check-translation-pairs.mjs`、`scripts/dedup-gate.mjs`、`scripts/check-takedown-ratchet.mjs`、`scripts/hooks/pre-commit`、`scripts/tribunal.sh`、`scripts/tribunal-model-router.sh`、`config/llm-pipeline.json`、新增 `scripts/reclassify-post.mjs`、`src/content.config.ts`、`src/lib/gp-listing.mjs`、`src/pages/index.astro`（含 en）、GP 列表頁、文章頁與 `src/components/ArticleTechnicalDetails.astro`、about 頁、`tools/gp-pipeline/`（GP 拒絕、stamp、aligner、run 流程、`ShroomDogNote` 檢查）、`.claude/agents/source-aligner.md` 與評審的 agent 設定。
- 內容：GP-276～279 改系列共 6 個檔，再替其中兩篇補 2 個英文檔；`quality/brand-taxonomy-post-migration.json` 新增轉址項目；`scripts/article-counter.json`。
- 文件：AGENTS.md、CONTRIBUTING.md、GU-LOG_WRITER_PROMPT.md、`tools/gp-pipeline/SKILL.md`、README、playbook 與 skills。
- 測試：距離章相關測試移除；新增改系列與升格 PASS 把關、所有系列擋 `ShroomDogNote`、棘輪改系列例外、首頁空 GP 區的測試。
