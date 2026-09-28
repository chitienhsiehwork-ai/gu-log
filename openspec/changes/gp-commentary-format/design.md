# Design

## Context

動機見 proposal.md。以下只記錄影響做法的現況（以 `retire-gp-translation-pipeline` 實作完成、rebase 到已 archive #1114 的 main 之後的分支為準）：

- **GP 暫停的三層**：gp-pipeline 在 CLI ingress（`run`、standalone `deploy`、`counter bump`、`write`、`review`、`refine`）與 pipeline 層（`Run`、`Deploy`）以「GP 暫停中」拒絕 GP；下架棘輪 `scripts/check-takedown-ratchet.mjs` 在 `GP_SERIES_PAUSED`（`src/lib/gp-series-pause.mjs`）為真時擋下任何新增的 GP；GP 系列頁與首頁的 GP 區塊顯示改版空狀態，GP-1 不列出。`--prefix` 預設 GP，所以 help、SKILL、README、CONTRIBUTING、CCC playbook、crontab 範例與 gp-pipeline-sop 散著約 8 處「要明確帶系列」的提醒。
- **Pipeline**：GP 沒有流程；MP 走 `fetch → dedup-url → eval → dedup → write → review → refine → credits → ralph → translate → deploy`。pending 檔名在 `ralph` 才決定，`ralph` 一律把工作目錄的 `final.mdx` 複製進 `src/content/posts/`、覆寫那裡的同名檔，再對 posts/ 那份跑會改正文的 post-fixer（GP 跳過）。`scripts/add-kaomoji.mjs` 與 `scripts/inject-related-posts.mjs` 只處理 posts/ 底下同檔名的檔案；`scripts/apply-glossary-links.mjs` 吃任意路徑。Claude provider 的 `--json-schema` 與 structured output 解析已在 2a 以死碼刪除；`internal/terminology` 原地保留、沒有呼叫端。
- **Router**：`scripts/tribunal-model-router.sh` 的寫作角色只剩 `writer`，「寫作步驟 ⇔ Claude」雙向檢查；沒有 aligner 角色。評審的 model SSOT 是 `.claude/agents/*.md` 的 `model:`。
- **Tribunal**：`scripts/tribunal.sh` 對 `gp-*`／`en-gp-*` 強制只評分；Tribunal v2（`src/lib/tribunal-v2/pipeline.ts`）的評審→寫手迴圈、FactCorrector 與第 3 階段的 Librarian 都會寫文章檔，沒有 GP 判斷。
- **來源封鎖**：棘輪與 dedup 都用 `scripts/dedup-gate.mjs` 的 `layer1Match`，它只回第一筆命中；dedup 的 Go 端呼叫沒給系列時預設 GP，`candidate` 寫死 GP。
- **翻譯配對**：CI 以 `scripts/check-translation-pairs.mjs --strict` 要求有英文對應檔，GP 只在 Tribunal 沒過時可以只有繁中。
- **語料**：GP 除了自寫示範文 GP-1（`sourceUrl` 是 `example.com`）以外全是墓碑，所以「有外部來源的 GP 必須帶章」上線當下就成立，不需要補蓋任何舊文。
- **CI**：`validate-posts.mjs` 在 pre-commit 跑變更的文章、CI 跑全站；CI 沒有模型、也沒有第三方原文，所以驗章只能驗指紋與章上的數字。
- **校準**（丟棄式實驗，原型與報告含第三方原文、不進 repo）：10 篇舊譯文在建議參數下全部被擋；3 篇導讀初稿兩篇第一輪就被擋，其中 GP-184 改寫一輪後占比 0.33→0.22、連續段 5→2 通過。短來源（GP-229，317 units）導讀與舊譯文的占比都約 0.95，分不開。原型程式（投影、斷句、算帳、配對與改寫 prompt）由 controller 交給 builder 當起點。

## Goals / Non-Goals

**Goals:**

- GP 以導讀格式恢復收文，所有有外部來源的 GP 都帶可在 CI 驗證的章。
- 判定只由程式從配對算出；模型只做句子配對，看不到門檻。
- 本機、CCC、VM 只要有 Claude CLI 都能跑完整 GP 流程。
- 前 10 篇導讀可以用新 ticket 上線，棘輪不必開授權例外。

**Non-Goals（刻意不做）:**

- MP 的契約、蓋章範圍、短來源規則與舊 MP 的處理（2c）；Lv-guided-reading 的蓋章範圍。
- 墓碑頁加連到新導讀的連結（owner 定稿的設計，等 owner）。
- 章存逐句配對、CI 用配對重算指標、policy 版本接受清單、`stamp --rehash`、publisher 覆寫前比對指紋。
- τ（全篇照原文順序）規則、程式碼行 n-gram、同語言 12-gram、拉丁片段 n-gram、英文重翻迴圈。
- relist 機制（排名腳本、名單快照、授權 JSON、原地部署）。
- `--shroomdog-note` 旗標：ShroomDog 要加親筆看法時手動加進檔案，再跑 `stamp --file`。
- VM 上 gp-pipeline 與 Claude 登入的更新（owner 的操作任務）。

**延後（不影響前 10 篇）:**

- **防護檔的 CI 牆**（來源距離的 policy 與計分程式、aligner 的 prompt 與 pin、棘輪、下架規則檔不准跟文章檔同一個 PR 改）：前 10 篇用不到；而且 policy 升版的 PR 必須同時附上全部 GP 重蓋後的章（CI 的 `validate:posts` 驗全站），牆會把升版卡死；英文門檻本來就要拿前 10 篇再調，會需要升版。2c 再評估，屆時要放行「文章只改 `sourceDistance`」的重蓋。
- 把 `src/pages/posts/[...slug].astro` 裡的 inline `hasExternalSource` 換成共用判斷：會改到 Lv 的來源顯示語意，目前沒有文章受影響。本 change 的外部來源判斷只放在來源距離 lib，給 validator、棘輪與 `stamp` 用。
- 合併 `validate-posts.mjs` 的 `TAKEN_DOWN_INCOMPATIBLE_FIELDS` 與 `take-down-posts.mjs` 的 `INCOMPATIBLE_FIELDS`：這次兩份都只加 `sourceDistance`。
- `scripts/check-pronoun-clarity.mjs` 取消 GP 豁免、`scripts/obsidian-import.mjs` 的 GP role 改成 Author。
- 浮動 `opus` alias 的記錄值（`OPUS_ALIAS_CURRENT` 與 gp-pipeline `models.go` 的顯示 fallback）要不要跟著 5-5。

`gp-pipeline stamp --file` 保留：ShroomDog 手加評論、全站機械式修改之後要靠它重新蓋章。

## Decisions

### 1. 第一個 commit 換 pin

- `.claude/agents/tribunal-writer.md` 與 `.claude/agents/vibe-opus-scorer.md` 的 `model:` 改成 `claude-opus-5-5`；`# PINNED:` 註解改成「owner sign-off 2026-09-27：ShroomDog 把 writer 與 vibe-scorer 一起移到 Opus 5.5，維持 one-taste-loop」，History 補 `→ 5-5 (2026-09-27)`，`[1m]` 變體的警告保留。
- `tools/gp-pipeline/internal/llm/claude.go` 的 `ClaudeOpusPinned` 同步；既有測試已鎖住它跟 tribunal-writer 的 frontmatter 一致，另外補一個測試鎖住 vibe-opus-scorer 的 `model:` 也等於它（2026-07-28「寫手與 vibe 評分同一代」目前沒有測試守）。
- `scripts/detect-model.mjs` 的 `MODEL_MAP` 在 `'claude-opus-5'` **之前**加 `'claude-opus-5-5': 'Opus 5.5'`。現在部分比對會把 5-5 顯示成「Opus 5」，VM 上的 `check-translatedby-model.mjs` 會因此擋 commit。
- 不改：文章裡的 `translatedBy.model`、`scores.*.model` 等歷史紀錄；`.codex/agents/vibe-opus-scorer.toml`（VM 的 vibe judge 是 Codex，同代規則只在 Claude 路徑成立）。
- 在 `docs/shroomdog-editorial-feedback.md` 補 2026-09-27 的 pin 升級條目，格式照 2026-07-28 那條。

### 2. GP 流程：併進 MP 那條路（A 案）

步驟：`fetch → dedup-url → eval → dedup → write → review → refine → post-fixer → source-distance → credits → ralph → translate → en-check → deploy`。

- write／review／refine 的 prompt 各加 GP 導讀分支（開頭交代來源與值得讀的理由、用自己的話講重點、gu-log 看法、結尾帶回原文；不准整段翻譯、照順序、摘要過多；主張照 MP 的 claim closure；不准產生 `ShroomDogNote`）。eval 的「值不值得翻譯」改成「值不值得做導讀」。
- GP 的 write 與 refine 接上 `internal/terminology` 的 canonical 術語 context（2a 交接第 2 項）。
- **章一律在最後一個會改正文的步驟之後算**。GP 的 post-fixer（kaomoji、glossary 連結、延伸閱讀）在 refine 之後、直接對工作目錄的 `final.mdx` 跑：`add-kaomoji.mjs` 與 `inject-related-posts.mjs` 改成接受任意路徑（語料照舊從 posts/ 讀，MP 的呼叫方式不變）。每輪改寫後重跑，然後才配對、蓋章，章寫在 `final.mdx`。
- pending 檔照舊在 `ralph` 才進 posts/：`ralph` 複製的就是已跑完 fixer、已蓋章的 `final.mdx`，GP 在 `ralph` 不再跑 fixer。之後 credits、ralph（寫分數）、translate（產英文檔）與 deploy（配號、改名、寫 frontmatter）都不改正文。Go 測試用 FakeProvider 跑完整條 GP 流程，鎖住「部署出去的繁中檔重算指紋等於章」。
- 改寫直接重跑 refine：把來源距離報告當成第二份 review 放進工作目錄，refine 的 GP 分支看到它就依報告改寫，不另開寫手呼叫。
- `translate` 維持既有規則（Tribunal 過分數才產英文）；產出後接英文逐字檢查（決策 9）。
- 新 step `source-distance` 可以用 `--from-step` 恢復；exit code 19 保留給來源距離沒過（`run` 與 `stamp` 都用）。
- 模型輸出含 `<ShroomDogNote` 時 write／refine 直接失敗。

替代方案是保留 GP 專屬的多角色流程、換成導讀角色（B 案）。不採用：它只能在 `vm-codex` profile 跑，而且翻譯導向的機制（正文凍結、只准局部 patch、順序與完整度審查）跟導讀的目標相反；翻譯流程也已經在 2a 刪掉。

### 3. 程式分工：Node 擁有所有確定性邏輯，Go 只協調

- `scripts/lib/source-distance.mjs` 一處實作：正文投影、原文正規化、斷句、units、兩條規則、英文 n-gram、外部來源判斷、章的序列化與驗證、policy。`scripts/source-distance.mjs` 是 CLI（`segment`／`score`／`ngram`／`stamp`／`verify`，輸出 JSON），給 Go pipeline 呼叫；`validate-posts.mjs` 與棘輪直接 import lib。lib 不 import Astro 專屬模組，hook 用純 Node 跑。
- 解析 MDX 用 `unified`、`remark-parse`、`remark-gfm`、`remark-mdx`（原型就是用這組；只用 `@mdx-js/mdx` 的 parser 解析不了 GFM 表格），列進 devDependencies。
- Go 只做三件事：叫 Node 取斷句、呼叫 aligner、沒過時交給 refine 改寫。這樣 CI（只有 Node）、pre-commit 與 pipeline 用的是同一份計算，不會兩邊各算一份而飄掉。
- 校準原型是起點；搬進 repo 時測試一律用自寫的合成 fixture（`tests/fixtures/source-distance/`），不放第三方原文或已下架的譯文（`post-takedown`）。

### 4. 規則、參數與設計選擇：來源與調法

定義見 `source-distance-stamp` spec。規則①的步數：連續段從一個翻譯型配對開始，它新涵蓋至少 minStep units 時算第 1 步；之後原文往前推進才可能加步（連著幾句講同一句原文不加步數、也不切斷）；一個導讀句對到的原文句先依相鄰關係分群（不分群時「S4＋S103」會讓進度直接跳到尾，maxRun 少算）；實作時同時追多條候選連續段，取最長。

**通過的判法**：第一次配對三條都過之後，才做第二次獨立配對；兩次各自都要過規則①，規則② 用聯集算。規則① 不用聯集，因為聯集會改變壓縮比，maxRun 可能比單次低（導讀 GP-184：單次 5 和 4，聯集 4）。第一次零配對直接 exit 19、不改寫：來源不相關或配對壞掉時，改寫也修不好，只會白燒三輪。第一次有配對但沒過，才進改寫。

| 項目 | 值或做法 | 來源 | 怎麼調 |
|---|---|---|---|
| 連續段上限 | 3 步 | owner | 只有 owner 能改 |
| 原文占比上限 | 30%，分母是原文 | owner | 只有 owner 能改 |
| β（翻譯型的壓縮比） | 0.4 | 校準：0.5 時 GP-259 的部分配對只剩 maxRun 3；0.4 時 10 篇舊譯文每次配對都是 maxRun ≥4 或占比 ≥0.36；0.3 沒多擋譯文，反而讓改寫後的導讀湊到 3 | policy |
| κ（導讀 units ÷ 原文 units） | 1.6 | 校準：舊譯文一對一配對的中位數（完整翻譯 1.54–1.81） | policy |
| κ 依原文的 CJK 比例切換 | CJK 比例 ≥ 0.5 的原文用 1.0 | 未校準初值（可調）：同語言先用等長假設 | policy |
| 容忍間隔 | 1（最多跳過 1 句原文） | 校準：改成 2 差距很小 | policy |
| minStep | 6 units | 校準：擋被切成 3 句的短引文湊出的假連續段 | policy |
| 原文句數上限 | 1500 | 未校準初值（可調）：第一版不做分段配對 | policy |
| fenced code 算文字的門檻 | CJK 字元占 ≥30% | 未校準初值（可調） | policy（投影規則，改了指紋會變） |
| 英文 n-gram | n＝8，比例 ≥0.10 或逐字 ≥30 詞就擋 | 未校準初值（可調），沿用備忘錄 | policy |
| 英文引文豁免上限 | 原文詞數的 5% | 未校準初值（可調） | policy |
| 指紋含 `sourceUrl` | 換來源一定讓章失效 | 設計選擇（可調） | 改 spec |
| 非 GP 不准帶章 | 沒人驗的章等於不實標示 | 設計選擇（可調），2c 會重新決定 | 改 spec |
| 術語 context 只接 GP | MP 不動，避免改到 MP 的寫手 prompt | 設計選擇（可調），2c 會重新決定 | 改 spec |

- 「policy」：數字與投影規則都在 lib 的 policy（`source-distance/v1`）。改任何一項就升版，同一個 PR 用 `stamp --file` 把全部 GP 重新蓋章（CI 的 `validate:posts` 驗全站，舊章會因版本不符失敗）。第一版 GP 少，重蓋的成本可控。
- 「改 spec」：寫在 spec 的行為要開 OpenSpec change 改 delta，再照上面的方式升版重蓋。
- 前 10 篇導讀就是英文門檻與 κ＝1.0 的第一批資料；要調整就照上面的方式開獨立 PR。

### 5. aligner

- 用 Claude，pin `claude-sonnet-5`，寫在新的 `.claude/agents/source-aligner.md`（`model:` 加 `# PINNED:` 註解，說明校準依據）。校準時 21 次 structured output 配對全部合格；Opus 4.6 的一致度跟 Sonnet 自己重跑差不多，但慢 2–3 倍、貴約 2.5 倍。
- **aligner pin ≠ 寫手 pin**（2a 交接第 1 項）：Go 測試讀 `source-aligner.md` 與 `ClaudeOpusPinned`（它又被測試鎖在 tribunal-writer 上）比對，比對前去掉 `[1m]` 這類 context 變體後綴；pipeline 呼叫前也檢查一次，相同就失敗。
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
  rewrites: 1              # 改寫輪數
  alignerCalls: 3          # 這次蓋章的 aligner 呼叫次數
  englishSkipped: verbatim # 只在英文版因逐字檢查略過時出現
  checkedAt: "2026-10-01"
```

英文檔同樣有 `policy`、`verdict`、`subjectSha256`（英文正文投影）、`sourceSha256`、`sourceUnits`、`checkedAt`，`metrics` 換成 `{ ngramContainment, maxVerbatimWords, quotedWords }`，沒有 `aligner`、`rewrites`、`alignerCalls` 與 `englishSkipped`。

- **指紋綁 `sourceUrl`＋正文投影**，不綁其他 frontmatter：Tribunal 寫分數、Fact Checker 修摘要、deploy 配號改名、清掉 `englishSkipped` 都不會讓章失效；換來源一定失效。
- **投影**（2a 交接第 3 項，不沿用已刪的 `gp-body-projection.mjs`）：自己的 MDX AST 走訪，排除 frontmatter、`import`／`export`、圖片、機器插入的區塊（延伸閱讀、失效連結註記，以各腳本插入時的固定形狀辨識，實際形狀以腳本為準：延伸閱讀是固定標題加上一份每項都是 `ticket: 標題` 站內連結的清單），以及「連到站內文章（`/posts/`、`/en/posts/` 與站內絕對網址）、文字剛好就是一個 ticket 編號」的連結——這是 taxonomy 與標籤維護會機械式改寫的形式。投影只看這篇文章自己的內容，不查其他文章的標題、狀態或是否存在：要是查了，被連結的文章一改標題或被刪，這篇沒動章就失效，讓不相干的 PR 紅燈。其他連結一律只取文字，包括文字不只是 ticket 編號的站內連結：不這樣做的話，把轉述包成站內連結就能躲過配對，蓋章後改連結文字章也不會過期。glossary 連結只是把既有的字包成連結，文字不變，不影響指紋。元件取子節點文字；fenced code 依決策 4 的門檻分成文字或程式碼，程式碼不進投影。投影輸出正規化成「一行一句」的純文字再算 hash，不依賴 MDX 套件的序列化格式；固定指紋測試鎖住結果。
- **驗章**（`validate-posts.mjs`，pre-commit 與 CI 同一份；pre-commit 另外對每個 staged 文章檔跑 `source-distance.mjs verify`，content gate 放過的只改術語、連結或後台 frontmatter 的修改也驗）：需要章的文章缺章、policy 版本不等於目前版本、verdict 不是 PASS、指紋不符、指標超過目前門檻，一律失敗；非 GP 文章帶章也失敗。錯誤訊息直接給 `tools/gp-pipeline/gp-pipeline stamp --file <檔名>`。
- **policy 版本只收目前這一版**：改門檻或規則就升版，同一個 PR 重蓋全部 GP（決策 4），換來不用維護接受清單。
- **嘗試次數**：`rewrites` 與 `alignerCalls` 只算這一次蓋章。用 `stamp --file` 或 `--from-step source-distance` 重跑到過為止時，之前幾次沒過的呼叫不會計入（沒過時不寫檔，也沒有跨次的紀錄）。這是已知限制，靠兩次配對各自過規則① 壓低「重跑到過」的機率；完整證據留在各次的工作目錄。
- **下架清掉章**：`validate-posts.mjs` 的 `TAKEN_DOWN_INCOMPATIBLE_FIELDS` 與 `take-down-posts.mjs` 的 `INCOMPATIBLE_FIELDS` 都加 `sourceDistance`（合併兩份清單延後）。
- **不外露**：確認 reader revision 的欄位白名單、JSON API 與 `.md` 匯出都不帶 `sourceDistance`，加一個斷言。
- **通用不變式**：spec 寫「任何會改有章文章正文的路徑都要重新蓋章」；第一版只有 GP 有章，validator 的指紋檢查就是這條的執行者，不另寫各路徑的檢查。

### 7. 原文正規化

- 去掉擷取標頭（`@host — date`、`Source URL:`、`Fetched via:`、`Fetched:`、`Published:`、`Thread: N tweets`、`=== … ===`、`---`、`THREAD n/m`、`⚠️ INCOMPLETE THREAD`）。
- 剪網站外框用寫死的規則，不再像校準時逐篇指定行號：開頭的導覽、日期、作者列與分享鈕類短行，以及文末從固定停止標題（例如 Related、Comments、Share、Subscribe、About the author、Acknowledgements、Citation、Footnotes、Appendix）開始的整段。剪多了只會讓分母變小、判定變嚴，所以規則寧可多剪；校準時沒剪外框的占比會低 13–16%。
- `sourceUnits` 與 `sourceSha256` 記在章上，擷取範圍有變時看得出來。擷取檔一律留在 repo 外（`post-takedown`）。

### 8. 防洗稿

- 改寫輸入只列兩種段落：連續段裡的導讀句（每次配對中達到上限的連續段，去重），以及依聯集配對、轉述量最多、累計到總轉述量四成的段落。不給任何門檻、指標或規則名稱，避免寫手對著數字剛好壓線。
- 改寫指示照校準的改寫 prompt：連續轉述改成一句重點接 gu-log 的看法；依 gu-log 的論點組織；保留條件、語氣強弱與歸屬；不准把原作者的主張寫成 Mogu 的看法、不准新增事實或引文、不准加 `ShroomDogNote`。改寫後不重跑 review，主張有沒有被改歪交給 Tribunal Fact Checker。
- 兩次配對各自過規則①，擋「多配幾次總有一次會過」；改寫輪數與 aligner 呼叫次數記進章，每次配對的原始輸出留在工作目錄。

### 9. 英文版逐字檢查

- 對英文正文投影（非程式碼、非引文）取小寫詞、算 8-gram：`ngramContainment`（英文 8-gram 出現在原文的比例）與 `maxVerbatimWords`（最長連續逐字相同的詞數），門檻見決策 4。
- 標明的引文（blockquote、雙引號內文字）豁免，豁免總詞數有上限，依文件順序超出上限的引文照常計入；豁免量記成 `quotedWords`。
- 位置：`translate` 之後、`deploy` 之前。沒過就移除英文檔、不部署英文版，繁中版照既有規則部署，run report 記錄原因；不做自動重翻。英文檔進 repo 前就擋，Tribunal 的額度也不會白花（繁中照常上線）。要補英文走既有補救路徑（`run --from-step translate --file <繁中檔>`）。原文不是英文時比對自然接近 0，不另設例外。
- **跟翻譯配對檢查的銜接**：英文沒過時，繁中章寫 `englishSkipped: verbatim`。`scripts/check-translation-pairs.mjs` 目前只在 Tribunal 沒過時放行只有繁中的 GP，改成看到這個標記也放行；補上通過檢查的英文版時，pipeline 與 `stamp` 清掉標記（只改 frontmatter，不影響指紋）。
- `translate.tmpl` 的 GP 分支要求不得把轉述還原成原文措辭，只有標明的引文可以逐字。
- 英文檔的 `sourceUrl` 由 `translate` 步驟還原成繁中檔的值（跟 `translatedBy` 一樣不信任模型）：它決定英文版要不要做這個檢查，也進英文章的指紋，模型改了就可能讓檢查被跳過。

### 10. `gp-pipeline stamp --file`

給 Claude Code 等手寫的 GP、ShroomDog 手加 `ShroomDogNote` 之後，或任何人工與機械式修改後重新蓋章：繁中檔跑兩次配對與計分、英文檔跑逐字檢查，通過就寫章、不改正文；沒過或零配對都 exit 19 並印出被標出的段落。原文依 `sourceUrl` 用既有擷取規則抓，或 `--source <capture>` 指定 repo 外的檔案。非 GP 或非外部來源在 ingress 以 exit 1 拒絕。

### 11. 前 10 篇走新 ticket，來源封鎖只給 GP 開「帶章」例外

- 不原地復活舊網址：棘輪「下架不可回復」維持絕對、不需要授權例外；原地復活會接回文章頁的「查看編輯歷史」連結，一鍵回到整篇譯文；網站還沒推廣，舊網址沒什麼外部流量。
- **例外要三個條件都成立**：新文章是 GP、撞到的下架文章全部是 GP（看下架文章的 `ticketId`）、新文章帶有效的章（呼叫同一份驗章邏輯）。只要撞到一篇下架的 MP，就照樣封鎖：付費新聞那批 MP 的來源不會因為改寫成 GP 導讀就回來。例外綁在「新文章是 GP」，2c 讓 MP 也能帶章之後，MP 不會自動繼承這個例外。
- `layer1Match` 改成回傳所有命中（目前只回第一筆），棘輪與 dedup 才判斷得了「全部是 GP」。
- 棘輪：新增的文章、以及改了 `sourceUrl` 的既有文章都要檢查。
- dedup：`dedup-gate.mjs --series GP` 的候選只撞到下架的 GP 時回 WARN（exit 0），訊息說明新 GP 必須帶有效章；撞到任何下架的 MP，或同時撞到公開文章，仍是 BLOCK。gp-pipeline 的 `dedup.Check` 系列改成必填，`candidate` 改成明確傳入系列，不再靠預設值拿到 GP 例外。
- 不做 relist 機制，所以也沒有「授權檔從哪個版本讀」「遞補上限」這類後門要防。

### 12. 下架工具只套用授權日以前發布的文章

`take-down-posts.mjs` 依規則選文時，加上 `translatedDate <= authorization.date` 的條件。#1114 的規則檔（GP 全數下架）是動態條件，不加這條的話，之後任何人重跑都會把新導讀一起下架。

### 13. `--prefix` 改成必填

2a 的簡潔度審查指出，`--prefix` 預設 GP 讓約 8 處文件要提醒「記得明確帶系列」，而且系列不該由預設值決定（跟 2a「不由錯誤訊息替人選系列」同一個道理）。GP 恢復之後，預設 GP 還會讓忘了帶系列的指令直接跑進要花 aligner 額度的導讀流程。所以：有檔案時照 2a 的規則以檔名判斷；沒有檔案時 `run`、`counter`、`write` 的 `--prefix` 必填，沒給就在 ingress exit 1、列出可用系列。那些提醒文字（run／counter help、`tools/gp-pipeline/SKILL.md`、`tools/gp-pipeline/README.md`、`CONTRIBUTING.md`、`playbooks/CCC-playbook.md`、`scripts/crontab-tribunal.example`、`.agents/skills/gp-pipeline-sop/SKILL.md`）一併拿掉。`review`／`refine` 的 `--ticket-id` 不在這次範圍。

### 14. 評審與 Tribunal

- 刪掉 `.claude/agents/`（fact-checker、librarian、fresh-eyes、vibe-opus-scorer、tribunal-writer）、`.codex/agents/` 對應的 toml 與 `scripts/vibe-scoring-standard.md` 裡的 GP 翻譯分支；GP 照 MP 規則評，只留兩個差異：不改寫、`ShroomDogNote` 是 ShroomDog 本人的聲音。引用已下架 GP 的校準範例改成公開文章或純文字描述。`tribunalVersion` 不變：維度沒換，舊 GP 都已下架，不會新舊混算。
- `scripts/tribunal.sh` 對 GP 的 no-rewrite 保留，錯誤訊息改成「GP 正文改了要經 gp-pipeline 重新蓋章」。
- Tribunal v2（2a 交接第 6 項）：`src/lib/tribunal-v2/pipeline.ts` 對 GP 只跑評審，不進評審→寫手迴圈，也不跑 FactCorrector 的改寫與第 3 階段 Librarian 的加連結；補 vitest 斷言這三個角色都沒被呼叫、文章檔不變。

### 15. 解除暫停與讀者看得到的地方

- 刪 CLI ingress 與 pipeline 層的「GP 暫停中」拒絕、棘輪的「擋新 GP」、`src/lib/gp-series-pause.mjs` 與它在首頁與 GP 系列頁的分支。以檔名判斷系列的規則保留。
- GP 列表為空時顯示中性空狀態（不說暫停或改版中），GP-1 仍不列出；deploy smoke test 的 GP 列表檢查改成接受「有文章」或「空狀態」；`tests/post-tombstone.spec.ts` 對 `[data-gp-paused-notice]` 與改版文案的斷言、`tests/spec-ownership.json` 的 reason 一起改。
- 用語預設（owner 可在 preview 否決）：副標「ShroomDog 精選長文翻譯」→「ShroomDog 精選導讀」、英文 `ShroomDog's curated reading guides`；卡片「翻譯自 {source}」→「原文：{source}」、`From {source}` → `Original: {source}`；文章頁來源標籤維持「原文出處」；技術資訊「翻譯 pipeline」「翻譯於」→「導讀 pipeline」「撰寫於」；`contentMode` 的 GP 值改成導讀；About 頁的 GP 一句話改成導讀定義。視覺有改就跑 uiux-auditor。

### 16. GP-273 的自然中文反例（2a 交接第 5 項）

「銜尾蛇」「演算法動態」寫進 `GU-LOG_WRITER_PROMPT.md` 的自然中文段落當反例（照字面直譯術語、讀者看不懂），不做 deterministic 檢查：導讀是 Mogu 用自己的話寫，直譯術語的機率比整篇翻譯低，交給寫作指南與 Tribunal 就夠。

### 17. 2a 交接清單的去處

| 2a design §7 | 本 change 的去處 |
|---|---|
| 1. 把關角色不得與寫手共用 model | 決策 5；`source-distance-stamp`「句子配對 SHALL 由獨立 pin 的 Claude aligner 產生，而且只輸出配對」 |
| 2. 寫手收到 canonical 術語 context | 決策 2；`gp-pipeline-publish-integrity`「GP SHALL 以導讀流程產出並在發布前蓋章」 |
| 3. 正文投影與固定指紋測試 | 決策 6；`source-distance-stamp`「章 SHALL 綁正文投影的指紋，只存會擋人的摘要」 |
| 4. aligner 的路由、工具權限與 structured output | 決策 5 |
| 5. GP-273 的自然中文反例 | 決策 16 |
| 6. Tribunal v2 的 GP 不可改寫防護 | 決策 14；`gp-source-preservation`「GP rebuild prohibition」 |

### 18. Spec delta 的寫法

- 情境整個失效的 requirement 用 REMOVED＋新名稱 ADDED（OpenSpec 的 MODIFIED 不能刪情境）：`editorial-charter` 的 GP 正文、`brand-taxonomy` 的 routes 與讀者標籤、`gp-pipeline-publish-integrity` 的暫停條文。情境名稱還成立的就 MODIFIED。
- `sourceDistance` 欄位定義放在新 capability，不改 `extended-post-frontmatter`（比照 #1114 的 `takenDownAt` 由 `post-takedown` 定義）。
- `brand-taxonomy` 的 delta 照抄含退役品牌字樣的 routes 條文，已在 `quality/brand-taxonomy-residual-allowlist.json` 登記本 change 的 exact exception，archive 時移除；新 routes 條文的退役字樣次數跟舊條文相同，stable spec 的次數不用改。
- archive 順序：`retire-gp-translation-pipeline` → 本 change（#1114 已 archive；已在副本模擬 archive 與 `openspec validate --specs --strict`）。archive 後由 controller 直接改 `editorial-charter` 的 Purpose（還寫著「翻譯忠實邊界」），delta 改不到 Purpose。

## Risks / Trade-offs

- [短來源做不到] 推文這類幾百 units 的來源，導讀與譯文的占比都接近 1，改寫三輪也過不了 → 不在本 change 範圍；這類來源會 exit 19，留給 owner 決定短來源規則（2c 題目）。前 10 篇先跳過 GP-229，GP-270 照跑、過不了一樣留給 owner。
- [濃縮再重排擋不住] 舊 GP-257／259 的占比本來就在 30% 以下，把連續轉述打散就兩條都過；改寫 prompt 的「依論點重排」也正好往這個方向推 → 依 owner 對翻譯的定義這算合格，要讓 owner 知道；在連續段中間插一句「回頭講前文」也能切斷連續段，同樣列為已知限制。
- [配對在門檻邊緣會跳] 同篇重跑 maxRun 差 0–2 → 兩次配對各自過規則①；`alignerCalls` 只記這一次、跨次重跑不計入（決策 6）。
- [內容 PR 順手把門檻調鬆] CI 牆延後，policy 或棘輪可以跟文章在同一個 PR 改 → 靠 PR 審查擋；2c 再評估牆，屆時要放行只改 `sourceDistance` 的重蓋。
- [章大批過期] glossary 禁用詞、kaomoji 等全站機械式改字會改到投影 → 只是 ticket 編號的站內連結文字與機器插入區塊已排除；其餘情況 validator 會擋，照錯誤訊息跑 `stamp --file`。第一版 GP 數量少，成本可控；MP 納入前（2c）要重新評估 `stamp --rehash`。
- [外框規則漏剪] 分母變大、判定變寬 → 停止標題寧可多剪；`sourceUnits` 記在章上可稽核。
- [英文門檻未校準] 誤擋時只會少了英文版，不影響繁中 → 用前 10 篇校準，調整走獨立 PR 升版。
- [`--prefix` 必填是 CLI 契約變動] 沒帶系列的舊指令會在 ingress 失敗 → 錯誤訊息列出可用系列；文件與範例同步改。
- [額度] 每篇多 2–8 次 Sonnet 配對（校準時每次 0.09–0.33 美元），沒過再加 refine 改寫 → 可接受；aligner 失敗依 Claude 錯誤分類停下，不自動重試。
- [VM 還是舊 binary] VM 更新前的 gp-pipeline 產不出章，任何 GP 寫回都會被 CI 擋 → 不會漏放；VM 更新照 #1114 的安排交給 owner。
- [寫手與浮動 alias 的評審同一個 model] 升到 Opus 5.5 後，走 `opus` alias 的評審可能跟寫手同一個 model → 2026-07-25 就記錄過的既有現象，不是本 change 新增。

## Migration Plan

1. 本分支疊在 `retire-gp-translation-pipeline`（PR #1116）上；那個 PR 合併後 rebase 到 main、開 draft PR；第一個 commit 是 pin 升級。
2. 照 tasks 的順序做 atomic commit；每一組讓 Go 測試、vitest 與受影響的 shell 測試保持綠色。
3. merge 前用一個真實網址跑一次 `gp-pipeline run <url> --prefix GP --dry-run`，確認配對、改寫迴圈與蓋章在真的 Claude 上可以跑（額度時機由 controller 決定）。
4. archive（見決策 18）→ 轉 ready → 等 Codex auto-review → auto-merge → production smoke。
5. 上線後的內容任務（另開 PR，不屬於本 change 的 tasks）：依四評審總分把前 10 篇舊 GP（GP-233、273、257、259、270、229、234、184、178、180）改寫成新 ticket 的導讀，先跳過 GP-229；exit 19 的留給 owner；做完回報品質與額度用量，讓 owner 決定要不要繼續。VM 更新由 owner 處理。

Rollback：revert 整個 PR。GP 回到 2a 的暫停狀態；若已經有導讀上線，revert 前要先決定那些文章怎麼處理（revert 後 validator 不再認得章，棘輪也會重新擋新 GP）。
