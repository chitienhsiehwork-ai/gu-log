# Proposal

## Why

整篇翻譯的 GP 依 #1114（`translation-takedown-tombstone`）全數下架、翻譯流程也由 `retire-gp-translation-pipeline` 退役之後，GP 一直處在「暫停中」。owner 已經拍板 GP 的新樣子：ShroomDog 精選導讀，由 Mogu 用自己的話講重點、加上 gu-log 的看法，再帶讀者回原文；「照原文順序一句對一句」才算翻譯，沒過檢查就擋、自動改寫最多三輪，檢查結果要蓋章並綁內容指紋。校準實驗（10 篇舊譯文全部被擋、導讀初稿改寫一輪就過）確認這套檢查在長來源上可行，現在可以把 GP 重新打開。

## What Changes

- **第一個 commit 換 pin**：寫手與 vibe-opus-scorer 一起從 `claude-opus-4-6` 改成 `claude-opus-5-5`（owner 2026-09-27 拍板，維持「寫手與 vibe 評分同一代」）；`scripts/detect-model.mjs` 把 5-5 顯示成 Opus 5.5。歷史評分紀錄不改。
- **GP 改成導讀**：`editorial-charter` 重新定義 GP 的系列身份、正文契約、分流規則與 MOBA 語氣；GP 照 MP 的評分規則評，只保留「不改寫」與 `ShroomDogNote` 兩個差異。
- **GP 流程（A 案）**：GP 走 MP 的 `write → review → refine`（導讀契約的 prompt 分支），接著確定性 post-fixer → **source-distance**（配對＋計分＋蓋章，沒過回 refine 改寫，最多三輪，還不過 exit 19）→ credits → 只評分的 ralph → translate → **英文逐字檢查** → deploy。寫手接上 glossary 術語 context；任何有 Claude CLI 的環境都能跑。
- **新 capability `source-distance-stamp`**：Claude aligner 只配句子、程式算帳；規則①（照順序一句對一句，翻譯型配對用壓縮比判定）、規則②（原文占比 > 30% 就擋，分母是原文）、零配對直接 exit 19；兩次獨立配對各自過規則①、規則② 用聯集；參數用校準值（β 0.4、κ 1.6、容忍間隔 1、minStep 6），未校準的初值與設計選擇在 design 標明來源與調法。
- **章**：frontmatter `sourceDistance` 只存 policy 版本、verdict、內容指紋、原文指紋與 units、會擋人的指標、aligner model、日期、改寫輪數與這次的 aligner 呼叫次數，不存配對明細；validate-posts 在 pre-commit 與 CI 驗章（繁中、英文都驗）；寫進「任何會改有章文章正文的路徑都要重新蓋章」的通用不變式，第一版只對 GP 強制；下架時清掉章。
- **aligner**：pin 寫在新的 `.claude/agents/source-aligner.md`（`claude-sonnet-5`），router 與 pipeline 都讀它；測試與 pipeline 都鎖住「aligner pin ≠ 寫手 pin」（`retire-gp-translation-pipeline` 交接的不變式）。
- **防洗稿**：改寫 prompt 只標段落、不給門檻數字；aligner 規定轉述來源內容就要配，不管用誰的口吻；站內連結只有文字是目標文 ticket 或標題時才不進投影；改寫輪數與 aligner 呼叫次數記進章。
- **英文版**：非引文的逐字 n-gram 檢查，標明的引文豁免但有上限；沒過就不部署英文版、不重翻，繁中的章記下「英文因逐字檢查略過」，CI 的翻譯配對檢查看到就放行。
- **手寫路徑**：新增 `gp-pipeline stamp --file`。
- **前 10 篇走新 ticket**：棘輪與 dedup 的「來源已封鎖」開一個只給 GP 的例外，三個條件都要成立：新文章是 GP、撞到的下架文章全部是 GP、帶有效章；撞到任何一篇下架的 MP 照樣封鎖。比對改成找出所有命中，封鎖檢查擴大到改了 `sourceUrl` 的既有文章；不做 relist 機制。
- **下架工具**：依規則選文只選授權日當天以前發布的文章。
- **BREAKING：`--prefix` 改成必填**：沒有檔案可以判斷系列時，`run`、`counter`、`write` 一定要指定系列，不再預設 GP；散在 help、SKILL、README、CONTRIBUTING、CCC playbook 等處「要明確帶系列」的提醒一併拿掉。dedup 的系列也改成必填。
- **Tribunal**：刪掉評審檔與 `scripts/vibe-scoring-standard.md` 的 GP 翻譯分支；Tribunal v2（`pnpm tribunal:run`）補上 GP 只評分的防護，寫手、FactCorrector 與第 3 階段的 Librarian 都不碰 GP。
- **解除 GP 暫停**：移除 `retire-gp-translation-pipeline` 的 ingress 拒絕與 #1114 的「擋新 GP」驗證、`GP_SERIES_PAUSED` 旗標；讀者看得到的 GP 用語改成導讀。
- **不在範圍內**：MP 的契約與蓋章（2c）、短來源規則（等 owner）、墓碑連到新導讀的連結（等 owner）。防護檔的 CI 牆延後，理由見 design。

## Capabilities

### New Capabilities

- `source-distance-stamp`：來源距離章的範圍、內容指紋、原文正規化與斷句、Claude aligner、兩條規則與零配對、自動改寫迴圈、英文逐字檢查（含略過英文版的標記），以及 `stamp` 指令。

### Modified Capabilities

- `editorial-charter`：GP 的系列身份、分流、MOBA 語氣、Lv-guided-reading 的比較改成導讀；「GP 整篇翻譯要先取得同意」拿掉暫停條款，改成以章把關並定義 GP 列表；REMOVED「GP body MUST be faithful translation」，ADDED「GP body MUST be a Mogu-written reading guide」。
- `brand-taxonomy`：GP 的 canonical 定義改成導讀；routes 與讀者標籤兩條因情境失效而 REMOVED 後以新名稱 ADDED（拿掉暫停列表情境、GP 改用導讀標籤）。
- `post-takedown`：下架清掉章；棘輪與 dedup 的來源封鎖加上只給 GP 的「帶有效章」例外（撞到的下架文章必須全是 GP），比對找出所有命中，並擴大到改了 `sourceUrl` 的既有文章；批次規則只選授權日以前發布的文章。
- `claude-prose-writing-runtime`：寫作步驟加上 GP 的 write 與 refine，註明 aligner 不是寫作步驟。
- `gp-pipeline-publish-integrity`：REMOVED GP 暫停期間的 ingress 拒絕；ADDED 以檔名或明確 `--prefix` 決定系列（從暫停條文搬出，拿掉 GP 預設值）與 GP 導讀流程（章在最後一個會改正文的步驟之後算）。
- `gp-source-preservation`：「GP rebuild prohibition」補上 Tribunal v2（含 Librarian）與蓋章的理由。

## Impact

- 程式：`tools/gp-pipeline/`（CLI、pipeline 步驟、Claude provider 的 structured output、prompt、router）、`scripts/lib/`（新的來源距離模組）、`scripts/validate-posts.mjs`、`scripts/check-takedown-ratchet.mjs`、`scripts/check-translation-pairs.mjs`、`scripts/dedup-gate.mjs`、`scripts/take-down-posts.mjs`、`scripts/add-kaomoji.mjs`、`scripts/inject-related-posts.mjs`、`scripts/tribunal.sh`、`src/lib/tribunal-v2/`、`src/content.config.ts`、`scripts/detect-model.mjs`、`scripts/tribunal-model-router.sh`。
- 相依套件：`unified`、`remark-parse`、`remark-gfm`、`remark-mdx` 列進 devDependencies。
- 評審與寫作文件：`.claude/agents/`、`.codex/agents/`、`scripts/vibe-scoring-standard.md`、`GU-LOG_WRITER_PROMPT.md`、`CONTRIBUTING.md`、gp-pipeline SKILL／README、`AGENTS.md` 路由表、CCC playbook、Tribunal runbook。
- CI：不新增 job；翻譯配對檢查認得「英文因逐字檢查略過」的標記。
- 讀者可見：GP 系列頁與首頁的 GP 區塊回到一般列表（沒有導讀時顯示中性空狀態）；GP 相關標籤、About 頁、文章技術資訊改成導讀用語。
- 額度：每篇 GP 多 2–8 次 Sonnet 配對，沒過時再加 refine 改寫；校準時 25 次呼叫約 6.2 美元牌價。
- 相依：疊在 `retire-gp-translation-pipeline` 上；archive 順序是 `translation-takedown-tombstone` → `retire-gp-translation-pipeline` → 本 change。前 10 篇導讀是本 change 上線後的內容任務。
