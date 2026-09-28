# Design

## Context

動機見 proposal.md。以下只記錄影響做法的現況（以 `retire-gp-translation-pipeline` 實作完成後的分支為準）：

- **GP 暫停的三層**：gp-pipeline 在 CLI ingress（`run`、standalone `deploy`、`counter bump`、`write`、`review`、`refine`）與 pipeline 層（`Run`、`Deploy`）以「GP 暫停中」拒絕 GP；下架棘輪 `scripts/check-takedown-ratchet.mjs` 在 `GP_SERIES_PAUSED`（`src/lib/gp-series-pause.mjs`）為真時擋下任何新增的 GP；GP 系列頁與首頁的 GP 區塊顯示改版空狀態，GP-1 不列出。
- **Pipeline**：GP 沒有流程；MP 走 `fetch → dedup-url → eval → dedup → write → review → refine → credits → ralph → translate → deploy`。會改正文的 post-fixer（kaomoji、glossary 連結、延伸閱讀）在 `ralph` 裡跑，GP 一律跳過（只評分）。Claude provider 的 `--json-schema` 與 structured output 解析已在 2a 以死碼刪除；`internal/terminology` 原地保留、沒有呼叫端。
- **Router**：`scripts/tribunal-model-router.sh` 的寫作角色只剩 `writer`，「寫作步驟 ⇔ Claude」雙向檢查；沒有 aligner 角色。評審的 model SSOT 是 `.claude/agents/*.md` 的 `model:`。
- **Tribunal**：`scripts/tribunal.sh` 對 `gp-*`／`en-gp-*` 強制只評分；Tribunal v2（`src/lib/tribunal-v2/pipeline.ts`）的評審→寫手迴圈與 FactCorrector 沒有 GP 判斷。
- **語料**：GP 除了自寫示範文 GP-1（`sourceUrl` 是 `example.com`）以外全是墓碑，所以「有外部來源的 GP 必須帶章」上線當下就成立，不需要補蓋任何舊文。
- **CI**：`validate-posts.mjs` 在 pre-commit 跑變更的文章、CI 跑全站；CI 沒有模型、也沒有第三方原文，所以驗章只能驗指紋與章上的數字。
- **校準**（丟棄式實驗，原型與報告含第三方原文、不進 repo）：10 篇舊譯文在建議參數下全部被擋；3 篇導讀初稿兩篇第一輪就被擋，其中 GP-184 改寫一輪後占比 0.33→0.22、連續段 5→2 通過。短來源（GP-229，317 units）導讀與舊譯文的占比都約 0.95，分不開。原型程式（投影、斷句、算帳、配對與改寫 prompt）由 controller 交給 builder 當起點。

## Goals / Non-Goals

**Goals:**

- GP 以導讀格式恢復收文，所有有外部來源的 GP 都帶可在 CI 驗證的章。
- 判定只由程式從配對算出；模型只做句子配對，看不到門檻。
- 本機、CCC、VM 只要有 Claude CLI 都能跑完整 GP 流程。
- 前 10 篇導讀可以用新 ticket 上線，棘輪不必開授權例外。

**Non-Goals:**

- MP 的契約、蓋章範圍、短來源規則與舊 MP 的處理（2c）；Lv-guided-reading 的蓋章範圍。
- 墓碑頁加連到新導讀的連結（owner 定稿的設計，等 owner）。
- 章存逐句配對、CI 用配對重算指標、policy 版本接受清單、`stamp --rehash`、publisher 覆寫前比對指紋。
- τ（全篇照原文順序）規則、程式碼行 n-gram、同語言 12-gram、拉丁片段 n-gram、英文重翻迴圈。
- relist 機制（排名腳本、名單快照、授權 JSON、原地部署）。
- `--shroomdog-note` 旗標：ShroomDog 要加親筆看法時手動加進檔案，再跑 `stamp --file`。
- VM 上 gp-pipeline 與 Claude 登入的更新（owner 的操作任務）。

## Decisions

### 1. 第一個 commit 換 pin

- `.claude/agents/tribunal-writer.md` 與 `.claude/agents/vibe-opus-scorer.md` 的 `model:` 改成 `claude-opus-5-5`；`# PINNED:` 註解改成「owner sign-off 2026-09-27：ShroomDog 把 writer 與 vibe-scorer 一起移到 Opus 5.5，維持 one-taste-loop」，History 補 `→ 5-5 (2026-09-27)`，`[1m]` 變體的警告保留。
- `tools/gp-pipeline/internal/llm/claude.go` 的 `ClaudeOpusPinned` 同步；既有測試已鎖住它跟 tribunal-writer 的 frontmatter 一致，另外補一個測試鎖住 vibe-opus-scorer 的 `model:` 也等於它（2026-07-28「寫手與 vibe 評分同一代」目前沒有測試守）。
- `scripts/detect-model.mjs` 的 `MODEL_MAP` 在 `'claude-opus-5'` **之前**加 `'claude-opus-5-5': 'Opus 5.5'`。現在部分比對會把 5-5 顯示成「Opus 5」，VM 上的 `check-translatedby-model.mjs` 會因此擋 commit。
- 浮動 `opus` alias 的記錄值（`OPUS_ALIAS_CURRENT` 與 gp-pipeline `models.go` 的顯示 fallback）另開一個 commit：apply 時實測 alias 解析到哪個 model，是 5-5 才改。
- 不改：文章裡的 `translatedBy.model`、`scores.*.model` 等歷史紀錄；`.codex/agents/vibe-opus-scorer.toml`（VM 的 vibe judge 是 Codex，同代規則只在 Claude 路徑成立）。
- 在 `docs/shroomdog-editorial-feedback.md` 補 2026-09-27 的 pin 升級條目，格式照 2026-07-28 那條。

### 2. GP 流程：併進 MP 那條路（A 案）

步驟：`fetch → dedup-url → eval → dedup → write → review → refine → post-fixer → source-distance → credits → ralph → translate → en-check → deploy`。

- write／review／refine 的 prompt 各加 GP 導讀分支（開頭交代來源與值得讀的理由、用自己的話講重點、gu-log 看法、結尾帶回原文；不准整段翻譯、照順序、摘要過多；主張照 MP 的 claim closure；不准產生 `ShroomDogNote`）。eval 的「值不值得翻譯」改成「值不值得做導讀」。
- GP 的 write 與 refine 接上 `internal/terminology` 的 canonical 術語 context（2a 交接第 2 項）。MP 不動，留給 2c。
- 會改正文的 post-fixer（kaomoji、glossary 連結）對 GP 移到 refine 之後、蓋章之前，每輪改寫後重跑；延伸閱讀雖然不進投影，也一起在這裡跑，讓部署的檔案跟 MP 一樣完整。`ralph` 對 GP 維持只評分、跳過 post-fixer。
- 改寫直接重跑 refine：把來源距離報告當成第二份 review 放進工作目錄，refine 的 GP 分支看到它就依報告改寫，不另開寫手呼叫。
- `translate` 維持既有規則（Tribunal 過分數才產英文）；產出後接英文逐字檢查（決策 9）。
- 新 step `source-distance` 可以用 `--from-step` 恢復；exit code 19 保留給來源距離沒過（`run` 與 `stamp` 都用）。
- 模型輸出含 `<ShroomDogNote` 時 write／refine 直接失敗。

替代方案是保留 GP 專屬的多角色流程、換成導讀角色（B 案）。不採用：它只能在 `vm-codex` profile 跑，而且翻譯導向的機制（正文凍結、只准局部 patch、順序與完整度審查）跟導讀的目標相反；翻譯流程也已經在 2a 刪掉。

### 3. 程式分工：Node 擁有所有確定性邏輯，Go 只協調

- `scripts/lib/source-distance.mjs` 一處實作：正文投影、原文正規化、斷句、units、兩條規則、英文 n-gram、章的序列化與驗證、policy。`scripts/source-distance.mjs` 是 CLI（`segment`／`score`／`ngram`／`stamp`／`verify`，輸出 JSON），給 Go pipeline 呼叫；`validate-posts.mjs` 直接 import lib。lib 不 import Astro 專屬模組，hook 用純 Node 跑。
- Go 只做三件事：叫 Node 取斷句、呼叫 aligner、沒過時交給 refine 改寫。這樣 CI（只有 Node）、pre-commit 與 pipeline 用的是同一份計算，不會兩邊各算一份而飄掉。
- 校準原型是起點；搬進 repo 時測試一律用自寫的合成 fixture（`tests/fixtures/source-distance/`），不放第三方原文或已下架的譯文（`post-takedown`）。

### 4. 規則與參數

定義見 `source-distance-stamp` spec；數字集中在 lib 的 policy（`source-distance/v1`）：

| 參數 | 值 | 來源與理由 |
|---|---|---|
| 連續段上限 | 3 步 | owner 定 |
| 原文占比上限 | 30%（分母是原文） | owner 定 |
| β（翻譯型的壓縮比） | 0.4 | β 0.5 時 GP-259 的部分配對只剩 maxRun 3、沒有餘裕；0.4 時 10 篇舊譯文每次配對都是 maxRun ≥4 或占比 ≥0.36（GP-270 是 3 與 0.75）；0.3 沒多擋任何譯文，反而讓改寫後的導讀湊到 3 |
| κ（導讀 units ÷ 原文 units 的換算） | 拉丁文字為主的原文 1.6；CJK 為主的原文 1.0 | 1.6 來自舊譯文一對一配對的中位數（完整翻譯 1.54–1.81）；同語言的 1.0 沒有校準，先用等長假設。以原文的 CJK 比例 ≥ 0.5 判斷 |
| 容忍間隔 | 1（最多跳過 1 句原文） | 改成 2 時差距很小，照備忘錄用 1 |
| minStep | 6 units | 擋斷句雜訊：被切成 3 句的短引文會湊出假的連續段 |
| 原文句數上限 | 1500 | 第一版不做分段配對，超過就直接失敗並說明 |

連續段的三個細節照校準修正：原文往前推進才算一步（連著幾句講同一句原文不加步數、也不切斷）；每步至少新涵蓋 minStep units；一個導讀句對到的原文句先依相鄰關係分群（不分群時「S4＋S103」會讓進度直接跳到尾，maxRun 少算）。實作時同時追多條候選連續段，取最長。

**通過的判法**：第一次配對全部通過後，再做一次獨立配對；兩次各自都要過規則①，規則② 與零配對用聯集算。規則① 不用聯集，因為聯集會改變壓縮比，maxRun 可能比單次低（導讀 GP-184：單次 5 和 4，聯集 4）。第一次沒過就不做第二次，直接進改寫。

### 5. aligner

- 用 Claude，pin `claude-sonnet-5`，寫在新的 `.claude/agents/source-aligner.md`（`model:` 加 `# PINNED:` 註解，說明校準依據）。校準時 21 次 structured output 配對全部合格；Opus 4.6 的一致度跟 Sonnet 自己重跑差不多，但慢 2–3 倍、貴約 2.5 倍。
- **aligner pin ≠ 寫手 pin**（2a 交接第 1 項）：Go 測試讀 `source-aligner.md` 與 `ClaudeOpusPinned`（它又被測試鎖在 tribunal-writer 上）比對；pipeline 呼叫前也檢查一次，相同就失敗。
- Go 端執行時從 agent 檔讀 pin（單一 SSOT，不另設 Go 常數）；router 加 `aligner` 角色（provider 固定 Claude、model 讀 agent 檔，設定檔不存副本），「Claude ⇔ 寫作步驟或 aligner」。
- 呼叫方式（2a 交接第 4 項）：從 2a 合併前的 git 歷史取回 Claude provider 的 `--json-schema` 與 structured output 解析；不給任何工具；沿用 Claude 呼叫的隔離（不載入主機設定、權限規則、MCP，不帶 API key 類環境變數）與錯誤分類。
- prompt 從校準的配對 prompt 起步：只配對、不評分、沒有門檻；原文與導讀是資料；「轉述來源內容就要配，不管用誰的口吻」；只有 gu-log 新增的評論、推論、例子、背景與只提到同主題的句子不配。輸出 `{"alignments":[{"c":"C1","s":["S3"]}]}`，程式驗證每個 C 剛好一次、ID 都存在。

### 6. 章

```yaml
sourceDistance:            # 繁中檔
  policy: source-distance/v1
  verdict: PASS
  subjectSha256: "<sha256(sourceUrl 原字串 + 正文投影)>"
  sourceSha256: "<正規化原文的 sha256>"
  sourceUnits: 2284
  metrics: { maxRun: 2, sourceRatio: 0.22, alignedSentences: 39 }
  aligner: claude-sonnet-5
  rewrites: 1
  checkedAt: "2026-10-01"
```

英文檔同樣有 `policy`、`verdict`、`subjectSha256`（英文正文投影）、`sourceSha256`、`sourceUnits`、`checkedAt`，`metrics` 換成 `{ ngramContainment, maxVerbatimWords, quotedWords }`，沒有 `aligner` 與 `rewrites`。

- **指紋綁 `sourceUrl`＋正文投影**，不綁其他 frontmatter：Tribunal 寫分數、Fact Checker 修摘要、deploy 配號改名都不會讓章失效；換來源一定失效。
- **投影**（2a 交接第 3 項，不沿用已刪的 `gp-body-projection.mjs`）：自己的 MDX AST 走訪，排除 frontmatter、`import`／`export`、圖片、機器插入的區塊（延伸閱讀、失效連結註記，以各腳本插入時的固定標記辨識，實際標記以腳本為準）、以及連到站內文章（`/posts/`、`/en/posts/` 與站內絕對網址）的連結文字——它們會被 taxonomy 與標籤維護機械式改寫。其他連結只取文字（glossary 連結只是把既有的字包成連結，文字不變，所以不影響指紋）。元件取子節點文字；fenced code 中 CJK 占 ≥30% 的當文字（例如翻成中文的 prompt），其餘是程式碼、不進投影。投影輸出正規化成「一行一句」的純文字再算 hash，不依賴 MDX 套件的序列化格式；固定指紋測試鎖住結果。
- **驗章**（`validate-posts.mjs`，pre-commit 與 CI 同一份）：需要章的文章缺章、policy 版本不等於目前版本、verdict 不是 PASS、指紋不符、指標超過目前門檻，一律失敗；非 GP 文章帶章也失敗（第一版只有 GP 會被驗，沒人驗的章等於不實標示）。錯誤訊息直接給 `tools/gp-pipeline/gp-pipeline stamp --file <檔名>`。
- **policy 版本只收目前這一版**：改門檻或規則就升版，全部 GP 重新蓋章。第一版只有少量 GP，重新配對的成本可以接受，換來不用維護接受清單。
- **下架清掉章**：`validate-posts.mjs` 的 `TAKEN_DOWN_INCOMPATIBLE_FIELDS` 與 `take-down-posts.mjs` 的 `INCOMPATIBLE_FIELDS` 目前是兩份清單，順手收斂成一份再加 `sourceDistance`。
- **不外露**：確認 reader revision 的欄位白名單、JSON API 與 `.md` 匯出都不帶 `sourceDistance`，加一個斷言。
- **通用不變式**：spec 寫「任何會改有章文章正文的路徑都要重新蓋章」；第一版只有 GP 有章，validator 的指紋檢查就是這條的執行者，不另寫各路徑的檢查。

### 7. 原文正規化

- 去掉擷取標頭（`@host — date`、`Source URL:`、`Fetched via:`、`Fetched:`、`Published:`、`Thread: N tweets`、`=== … ===`、`---`、`THREAD n/m`、`⚠️ INCOMPLETE THREAD`）。
- 剪網站外框用寫死的規則，不再像校準時逐篇指定行號：開頭的導覽、日期、作者列與分享鈕類短行，以及文末從固定停止標題（例如 Related、Comments、Share、Subscribe、About the author、Acknowledgements、Citation、Footnotes、Appendix）開始的整段。剪多了只會讓分母變小、判定變嚴，所以規則寧可多剪；校準時沒剪外框的占比會低 13–16%。
- `sourceUnits` 與 `sourceSha256` 記在章上，擷取範圍有變時看得出來。擷取檔一律留在 repo 外（`post-takedown`）。

### 8. 防洗稿

- 改寫輸入只列兩種段落：連續段裡的導讀句（每次配對中達到上限的連續段，去重），以及依聯集配對、轉述量最多、累計到總轉述量四成的段落。不給任何門檻、指標或規則名稱，避免寫手對著數字剛好壓線。
- 改寫指示照校準的改寫 prompt：連續轉述改成一句重點接 gu-log 的看法；依 gu-log 的論點組織；保留條件、語氣強弱與歸屬；不准把原作者的主張寫成 Mogu 的看法、不准新增事實或引文、不准加 `ShroomDogNote`。改寫後不重跑 review，主張有沒有被改歪交給 Tribunal Fact Checker。
- 兩次配對各自過規則①，擋「多配幾次總有一次會過」；改寫輪數記進章，每次配對的原始輸出留在工作目錄。

### 9. 英文版逐字檢查

- 對英文正文投影（非程式碼、非引文）取小寫詞、算 8-gram：`ngramContainment`（英文 8-gram 出現在原文的比例）與 `maxVerbatimWords`（最長連續逐字相同的詞數）。初值沿用備忘錄：比例 ≥ 0.10 或逐字 ≥ 30 詞就不通過。
- 標明的引文（blockquote、雙引號內文字）豁免，豁免總詞數上限初值是原文詞數的 5%，依文件順序超出上限的引文照常計入；豁免量記成 `quotedWords`。
- 這三個數字都還沒校準，前 10 篇導讀就是第一批資料；要調整就在獨立 PR 升 policy 版本（CI 牆會擋內容 PR 順手調）。
- 位置：`translate` 之後、`deploy` 之前。沒過就移除英文檔、不部署英文版，繁中版照既有規則部署，run report 記錄原因；不做自動重翻。要補英文走既有補救路徑（`run --from-step translate --file <繁中檔>`）。原文不是英文時比對自然接近 0，不另設例外。
- `translate.tmpl` 的 GP 分支要求不得把轉述還原成原文措辭，只有標明的引文可以逐字。

### 10. `gp-pipeline stamp --file`

給 Claude Code 等手寫的 GP、ShroomDog 手加 `ShroomDogNote` 之後，或任何人工修改後重新蓋章：繁中檔跑兩次配對與計分、英文檔跑逐字檢查，通過就寫章、不改正文；沒過 exit 19 並印出被標出的段落。原文依 `sourceUrl` 用既有擷取規則抓，或 `--source <capture>` 指定 repo 外的檔案。非 GP 或非外部來源在 ingress 以 exit 1 拒絕。

### 11. 前 10 篇走新 ticket，棘輪與 dedup 開「帶章」例外

- 不原地復活舊網址：棘輪「下架不可回復」維持絕對、不需要授權例外；原地復活會接回文章頁的「查看編輯歷史」連結，一鍵回到整篇譯文；網站還沒推廣，舊網址沒什麼外部流量。
- 棘輪的來源封鎖：新增的文章、以及改了 `sourceUrl` 的既有文章，來源跟下架文章相同時失敗，除非這個檔案帶有效的章（呼叫同一份驗章邏輯）。第一版只有 GP 能帶章，所以 MP 等其他系列仍然被封鎖。
- dedup：`dedup-gate.mjs --series GP` 的候選只撞到下架文章時回 WARN（exit 0），訊息說明新 GP 必須帶有效章；同時撞到公開文章仍是 BLOCK。pipeline 的 dedup 步驟本來就傳 `--series`。
- 不做 relist 機制，所以也沒有「授權檔從哪個版本讀」「遞補上限」這類後門要防。

### 12. 下架工具只套用授權日以前發布的文章

`take-down-posts.mjs` 依規則選文時，加上 `translatedDate <= authorization.date` 的條件。#1114 的規則檔（GP 全數下架）是動態條件，不加這條的話，archive 後任何人重跑都會把新導讀一起下架。

### 13. CI 牆

- 新增 `scripts/check-guard-wall.mjs` 與一個 PR Fast Gate leaf（列進 `ci-passed.needs`）：比較 PR 的 base 與 head，同時改到防護檔與 `src/content/posts/**` 就失敗，訊息說明要拆成兩個 PR。
- 防護檔清單只寫在這支程式裡：來源距離的 lib 與 CLI（含 policy）、`.claude/agents/source-aligner.md` 與 aligner 的 prompt、`scripts/check-takedown-ratchet.mjs`、各批下架的規則檔（`**/takedown-list.json`）、這支程式本身。
- 不涵蓋 `validate-posts.mjs` 整支與 workflow 檔：前者很多內容 PR 都會碰，後者要防的是刻意繞過，不是這道牆的目標（它防的是內容 PR 順手把門檻調鬆）。

### 14. 評審與 Tribunal

- 刪掉 `.claude/agents/`（fact-checker、librarian、fresh-eyes、vibe-opus-scorer、tribunal-writer）、`.codex/agents/` 對應的 toml 與 `scripts/vibe-scoring-standard.md` 裡的 GP 翻譯分支；GP 照 MP 規則評，只留兩個差異：不改寫、`ShroomDogNote` 是 ShroomDog 本人的聲音。引用已下架 GP 的校準範例改成公開文章或純文字描述。`tribunalVersion` 不變：維度沒換，舊 GP 都已下架，不會新舊混算。
- `scripts/tribunal.sh` 對 GP 的 no-rewrite 保留，錯誤訊息改成「GP 正文改了要經 gp-pipeline 重新蓋章」。
- Tribunal v2（2a 交接第 6 項）：`src/lib/tribunal-v2/pipeline.ts` 對 GP 只跑評審，不進評審→寫手迴圈，也不跑 FactCorrector 的改寫；補 vitest。
- `scripts/check-pronoun-clarity.mjs` 不再豁免 GP（導讀是 Mogu 的聲音）；`scripts/obsidian-import.mjs` 的 GP role 從 Translator 改成 Author。

### 15. 解除暫停與讀者看得到的地方

- 刪 CLI ingress 與 pipeline 層的「GP 暫停中」拒絕、棘輪的「擋新 GP」、`src/lib/gp-series-pause.mjs` 與它在首頁與 GP 系列頁的分支。以檔名判斷系列的規則保留。
- GP 列表為空時顯示中性空狀態（不說暫停或改版中），GP-1 仍不列出；deploy smoke test 的 GP 列表檢查改成接受「有文章」或「空狀態」。
- 用語預設（owner 可在 preview 否決）：副標「ShroomDog 精選長文翻譯」→「ShroomDog 精選導讀」、英文 `ShroomDog's curated reading guides`；卡片「翻譯自 {source}」→「原文：{source}」、`From {source}` → `Original: {source}`；文章頁來源標籤維持「原文出處」；技術資訊「翻譯 pipeline」「翻譯於」→「導讀 pipeline」「撰寫於」；`contentMode` 的 GP 值改成導讀；About 頁的 GP 一句話改成導讀定義。視覺有改就跑 uiux-auditor。

### 16. GP-273 的自然中文反例（2a 交接第 5 項）

「銜尾蛇」「演算法動態」寫進 `GU-LOG_WRITER_PROMPT.md` 的自然中文段落當反例（照字面直譯術語、讀者看不懂），不做 deterministic 檢查：導讀是 Mogu 用自己的話寫，直譯術語的機率比整篇翻譯低，交給寫作指南與 Tribunal 就夠。

### 17. 2a 交接清單的去處

| 2a design §7 | 本 change 的去處 |
|---|---|
| 1. 把關角色不得與寫手共用 model | 決策 5；`source-distance-stamp`「句子配對 SHALL 由獨立 pin 的 Claude aligner 產生」 |
| 2. 寫手收到 canonical 術語 context | 決策 2；`gp-pipeline-publish-integrity`「GP SHALL 以導讀流程產出並在發布前蓋章」 |
| 3. 正文投影與固定指紋測試 | 決策 6；`source-distance-stamp`「章 SHALL 綁正文投影的指紋」 |
| 4. aligner 的路由、工具權限與 structured output | 決策 5 |
| 5. GP-273 的自然中文反例 | 決策 16 |
| 6. Tribunal v2 的 GP 不可改寫防護 | 決策 14；`gp-source-preservation`「GP rebuild prohibition」 |

### 18. Spec delta 的寫法

- 情境整個失效的 requirement 用 REMOVED＋新名稱 ADDED（OpenSpec 的 MODIFIED 不能刪情境）：`editorial-charter` 的 GP 正文、`brand-taxonomy` 的 routes 與讀者標籤、`gp-pipeline-publish-integrity` 的暫停條文。情境名稱還成立的就 MODIFIED。
- `sourceDistance` 欄位定義放在新 capability，不改 `extended-post-frontmatter`（比照 #1114 的 `takenDownAt` 由 `post-takedown` 定義）。
- `brand-taxonomy` 的 delta 照抄含退役品牌字樣的 routes 條文，已在 `quality/brand-taxonomy-residual-allowlist.json` 登記本 change 的 exact exception，archive 時移除並重算 stable spec 的次數。
- archive 順序：`translation-takedown-tombstone` → `retire-gp-translation-pipeline` → 本 change（已在副本模擬三次 archive 與 `openspec validate --specs --strict`）。archive 後由 controller 直接改 `editorial-charter` 的 Purpose（還寫著「翻譯忠實邊界」），delta 改不到 Purpose。

## Risks / Trade-offs

- [短來源做不到] 推文這類幾百 units 的來源，導讀與譯文的占比都接近 1，改寫三輪也過不了 → 不在本 change 範圍；這類來源會 exit 19，留給 owner 決定短來源規則（2c 題目）。前 10 篇先跳過 GP-229，GP-270 照跑、過不了一樣留給 owner。
- [濃縮再重排擋不住] 舊 GP-257／259 的占比本來就在 30% 以下，把連續轉述打散就兩條都過；改寫 prompt 的「依論點重排」也正好往這個方向推 → 依 owner 對翻譯的定義這算合格，要讓 owner 知道；在連續段中間插一句「回頭講前文」也能切斷連續段，同樣列為已知限制。
- [配對在門檻邊緣會跳] 同篇重跑 maxRun 差 0–2 → 兩次配對各自過規則①，記錄改寫輪數。
- [章大批過期] glossary 禁用詞、kaomoji 等全站機械式改字會改到投影 → 站內文章連結文字與機器插入區塊已排除；其餘情況 validator 會擋，照錯誤訊息跑 `stamp --file`。第一版 GP 數量少，成本可控；MP 納入前（2c）要重新評估 `stamp --rehash`。
- [外框規則漏剪] 分母變大、判定變寬 → 停止標題寧可多剪；`sourceUnits` 記在章上可稽核。
- [英文門檻未校準] 誤擋時只會少了英文版，不影響繁中 → 用前 10 篇校準，調整走獨立 PR。
- [額度] 每篇多 2–8 次 Sonnet 配對（校準時每次 0.09–0.33 美元），沒過再加 refine 改寫 → 可接受；aligner 失敗依 Claude 錯誤分類停下，不自動重試。
- [付費媒體來源] 帶章例外沒有區分來源網域，#1114 下架的付費新聞 MP，其來源之後可以用 GP 導讀重新寫 → 照定案實作；是否維持付費新聞絕對封鎖，列給 owner。
- [VM 還是舊 binary] VM 更新前的 gp-pipeline 產不出章，任何 GP 寫回都會被 CI 擋 → 不會漏放；VM 更新照 #1114 的安排交給 owner。
- [寫手與浮動 alias 的評審同一個 model] 升到 Opus 5.5 後，走 `opus` alias 的評審可能跟寫手同一個 model → 2026-07-25 就記錄過的既有現象，不是本 change 新增。

## Migration Plan

1. 等 `retire-gp-translation-pipeline` 合併後，把本分支 rebase 到 main、開 draft PR；第一個 commit 是 pin 升級。
2. 照 tasks 的順序做 atomic commit；每一組讓 Go 測試、vitest 與受影響的 shell 測試保持綠色。
3. merge 前用一個真實網址跑一次 `gp-pipeline run <url> --prefix GP --dry-run`，確認配對、改寫迴圈與蓋章在真的 Claude 上可以跑（額度時機由 controller 決定）。
4. archive（見決策 18）→ 轉 ready → 等 Codex auto-review → auto-merge → production smoke。
5. 上線後的內容任務（另開 PR，不屬於本 change 的 tasks）：依四評審總分把前 10 篇舊 GP（GP-233、273、257、259、270、229、234、184、178、180）改寫成新 ticket 的導讀，先跳過 GP-229；exit 19 的留給 owner；做完回報品質與額度用量，讓 owner 決定要不要繼續。VM 更新由 owner 處理。

Rollback：revert 整個 PR。GP 回到 2a 的暫停狀態；若已經有導讀上線，revert 前要先決定那些文章怎麼處理（revert 後 validator 不再認得章，棘輪也會重新擋新 GP）。
