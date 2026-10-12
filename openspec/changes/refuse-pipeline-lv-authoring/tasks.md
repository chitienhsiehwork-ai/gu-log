# Tasks

> 實作 commit 不碰 `openspec/**/specs/**`（唯讀牆）。每一組做完，`tools/gp-pipeline` 的 `go test -count=1 ./...` 都要是綠的。測試只檢查行為與結構化的值（exit code、有沒有建立工作目錄、counter 與目標檔有沒有變、flag 說明裡的系列清單），不比對整句散文。

## 1. Go CLI 擋下 Lv 寫作

- [x] 1.1 新增三樣共用的東西：判斷「pipeline 能撰寫的系列」（GP、MP、SD）、判斷「目標檔是不是 Lv」（檔名系列含 `levelup-`、`en-`，或 frontmatter 的 `ticketId`），以及單一的拒絕錯誤（exit 1；訊息說明 pipeline 不撰寫 Lv、指向 `CONTRIBUTING.md` 的 Lv 寫作流程、列出 Lv 仍可用的步驟）。接到六個入口，位置都在任何副作用之前：
  - `run`：系列與 `--from-step` 一解析完就檢查（系列是 Lv 且起點早於 `translate`，含沒指定起點），排在 yt-dlp preflight 與建立工作目錄之前；
  - `write`：`--prefix` 驗證之後、`MkdirAll` 之前；
  - `review`、`refine`：從 `--ticket-id` 推出系列之後檢查，再讀草稿 frontmatter 的 `ticketId`，是 Lv 也拒絕，兩者都在碰工作目錄與模型之前；
  - `ralph`：依檔名推出系列之後、建立工作目錄之前；
  - `credits`：讀目標檔之後、建立 scratch 工作目錄之前。

  Go 測試涵蓋：
  - `run <url> --prefix Lv`，以及加上 `--dry-run`：exit 1；給一個不存在的工作目錄路徑，它沒有被建出來；counter 檔內容不變；沒有模型呼叫；
  - 沒有 yt-dlp 時，`run <YouTube 網址> --prefix Lv` 是 exit 1，不是 10；
  - `run --file <levelup- 與 lv- 檔>` 沒帶起點，以及起點是 write、refine、ralph：exit 1，檔案不變；
  - `write --prefix Lv`：exit 1，沒有工作目錄，也沒有 `draft-v1.mdx`；
  - `review`／`refine --ticket-id Lv-PENDING`，以及沒帶 `--ticket-id`、但草稿是 `ticketId: Lv-PENDING`：exit 1，草稿不變；
  - `ralph --file`、`credits --file` 指向 Lv 檔：exit 1，fake `tribunal.sh` 沒有被執行，檔案逐位元組不變；
  - `run <url> --prefix SD` 與 `ralph --file <sd- 檔>` 不被這條檢查擋下。

  錯誤訊息的測試只檢查它含 `CONTRIBUTING.md`。既有的 `TestStandaloneRalphInfersSeriesFromFilename` 裡兩個 Lv 案例改成斷言拒絕，其他系列照舊（對應「gp-pipeline SHALL NOT 撰寫或改寫 Lv，也 SHALL NOT 替 Lv 蓋 pipeline 署名」的五個情境，與「拒絕 Lv SHALL 發生在任何副作用之前，並指向 Lv 寫作流程」的兩個情境）
- [x] 1.2 確認 Lv 的非寫作步驟沒有被擋：`run --file <Lv 檔> --from-step translate --dry-run` 與 `translate --file <Lv 檔>` 通過 ingress、`counter bump --prefix Lv` 照常配號、standalone `deploy --active-file <lv-pending 檔>` 通過系列判斷。既有測試已涵蓋的就引用，缺的補上（對應「Lv SHALL 仍可使用 pipeline 的非寫作步驟」的兩個情境）
- [x] 1.3 說明與錯誤訊息都從 1.1 的同一份清單產生，不再列 Lv：
  - `write`、`review`、`refine` 的說明；
  - `write`、`run` 的 `--prefix` 說明；
  - `run`、`candidate`（help 裡的範例指令）與 root help 的可撰寫系列；
  - `run`、`write` 缺 `--prefix` 時列出的可用系列。

  `run --help` 加一句：Lv 檔只能從 `translate` 或 `deploy` 恢復。`counter`、`dedup`、`deploy` 繼續列 Lv。Go 測試：`write` 的 `--prefix` 說明列出 GP、MP、SD 且不含 Lv；`write` 沒帶 `--prefix` 的錯誤訊息不含 Lv；`counter bump` 的 `--prefix` 說明仍含 Lv（對應「寫作指令的說明與錯誤訊息 SHALL NOT 邀請撰寫 Lv」的三個情境）
- [x] 1.4 grep 整個 repo（scripts、`.github/workflows`、`tools/`、`playbooks/`、`docs/`、skills），找出用 Lv 呼叫 `run`、`write`、`review`、`refine`、`credits`、`ralph` 的程式：有就改掉，文件交給第 2 組；在 PR 說明記下 grep 結果

## 2. 文件指向同一條 Lv 流程

- [x] 2.1 `CONTRIBUTING.md`：
  - 〈Workflow〉在 SD 之後新增〈新增入門教學（Lv）〉。內容：依 `editorial-charter` 判斷 `Lv-original` 或 `Lv-guided-reading`；先讀兩三篇近期 Lv 當範本（列檔名）；先寫設計稿（分層、貫穿全篇的比喻、每層測驗、魔王關）；正文交給固定版本寫手（只指向各 runtime playbook，不複製指令或 model ID）；跑確定性檢查；用 `scripts/tribunal.sh` 跑 Tribunal（只指向 `docs/tribunal-runbook.md`，不複製旗標）；通過後用 `gp-pipeline translate --file` 產英文版；配號與發布。
  - 同一節寫〈Lv 常見骨架〉：每一層由上一層留下的問題逼出來，標題用 `Floor N` 或「第 N 層」；一個比喻扛全篇；`LevelUpProgress`；通常每層一題 `LevelUpQuiz`，`explanation` 只能寫純文字；`AnalogyBox`；選用的 `Mermaid`；魔王關把前面串起來；guided-reading 在開頭 cite 來源。明寫這是常見形狀、不是硬性規則。
  - 〈gp-pipeline（自動寫作流程）〉改成 `--prefix <GP|MP|SD>`，加一句 Lv 正文不走 pipeline，但可用 `translate`、`deploy`。
  - 研究流程那條「Go 就依選定的系列走 gp-pipeline」補上：Lv 改走〈新增入門教學（Lv）〉。

  驗證：新小節標題與 1.1 錯誤訊息指向的名稱一致；pre-commit 的 markdown 與 zh-tw 檢查通過
- [ ] 2.2 `tools/gp-pipeline/SKILL.md`：改掉開頭的「GP 導讀、MP、SD、Lv 共用」；寫明 Lv 的撰寫入口（含 `ralph`、`credits`）會 exit 1、Lv 可用的步驟，並指向 `CONTRIBUTING.md` 的 Lv 流程；「跑 tribunal」那一列拿掉 `levelup-`，註明 Lv 改跑 `scripts/tribunal.sh`。驗證：`go test -count=1 ./...` 裡讀 `SKILL.md` 的契約測試照樣綠
- [ ] 2.3 `AGENTS.md` 主題路由表的「來源寫作 pipeline」那一列不再把 Lv 列為 pipeline 寫作系列，改成指向 `CONTRIBUTING.md` 的 Lv 流程。驗證：pre-commit 通過，路由表其他列不變
- [ ] 2.4 其他說 pipeline 能寫 Lv、或叫人用 `gp-pipeline ralph` 評 Lv 的地方：
  - `playbooks/CCC-playbook.md`：Tribunal 首選做法那段補一句，Lv 用 `scripts/tribunal-batch-runner.sh` 或 `scripts/tribunal.sh`；〈建議指令〉的 `--prefix` 改成 `<GP|MP|SD>`；
  - `tools/gp-pipeline/README.md` 開頭；
  - `tools/gp-pipeline/gp-pipeline` wrapper 的註解；
  - `scripts/crontab-tribunal.example`。

  另外 grep `playbooks/`、`docs/`、`.claude/skills/`，看有沒有漏掉的。驗證：`rg -n 'GP\|MP\|SD\|Lv'` 與 `rg -n 'gp-pipeline ralph'` 剩下的結果都不是在描述用 pipeline 寫 Lv 或評 Lv

## 3. 整合驗證

- [ ] 3.1 實際跑編好的 CLI：先記下 `scripts/article-counter.json` 的 hash；`tools/gp-pipeline/gp-pipeline run https://example.com/x --prefix Lv` 與 `tools/gp-pipeline/gp-pipeline write --prefix Lv --source <任一檔>` 各給一個不存在的工作目錄路徑，兩個都 exit 1、訊息含 `CONTRIBUTING.md`；兩個工作目錄都沒被建出來、counter hash 不變、`git status` 乾淨；`write --help` 的 `--prefix` 不列 Lv。把指令與輸出貼進 PR 說明

## Workflow follow-up

- 依 `.agents/openspec-sdlc.md` 走階段 6 雙審（正確性錨 spec scenario、簡潔度錨 over-engineering）。
- 階段 8 archive 並 sync `gp-pipeline-publish-integrity`，同一個 PR 轉 ready，過 Codex auto-review gate 後 merge。
