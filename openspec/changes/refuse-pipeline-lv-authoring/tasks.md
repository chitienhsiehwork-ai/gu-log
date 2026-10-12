# Tasks

> 實作 commit 不碰 `openspec/**/specs/**`（唯讀牆）。每一組做完，`tools/gp-pipeline` 的 `go test -count=1 ./...` 都要是綠的。測試只檢查行為與結構化的值（exit code、有沒有建立工作目錄、counter 有沒有變、flag 說明裡的系列清單），不比對整句散文。

## 1. Go CLI 擋下 Lv 寫作

- [ ] 1.1 新增單一判斷「pipeline 能撰寫的系列」（GP、MP、SD）與單一拒絕錯誤（exit 1，訊息說明 pipeline 不撰寫 Lv、指向 `CONTRIBUTING.md` 的 Lv 寫作流程、列出 Lv 仍可用的步驟），接到四個入口：`run` 在系列解析與 `--from-step` 解析之後、建立工作目錄之前（系列是 Lv 且起點在 refine 之前或與 refine 相同，含沒指定起點）；`write` 在讀 `--source` 之前；`review`、`refine` 在從 ticket 推出系列之後、碰工作目錄與模型之前。Go 測試涵蓋：`run <url> --prefix Lv`（exit 1、沒有工作目錄、counter 不變、沒有模型呼叫）、`run --file <levelup- 與 lv- 檔>` 沒帶起點以及起點為 write／review／refine（exit 1）、`write --prefix Lv`（exit 1、沒有 `draft-v1.mdx`）、`review`／`refine --ticket-id Lv-PENDING`（exit 1）、`run <url> --prefix SD` 不被這條檢查擋下。錯誤訊息測試只檢查它含 `CONTRIBUTING.md`（對應「gp-pipeline SHALL NOT 撰寫 Lv 正文」的五個情境）
- [ ] 1.2 確認 Lv 的非寫作步驟沒有被擋：`run --file <Lv 檔> --from-step translate --dry-run` 通過 ingress、`counter bump --prefix Lv` 照常配號、`ralph` 依 `levelup-` 檔名推出 Lv。既有測試已涵蓋的就引用，缺的補上（對應「Lv SHALL 仍可使用 pipeline 的非寫作步驟」的兩個情境）
- [ ] 1.3 help text：`write`、`review`、`refine` 的說明，以及 `write`、`run`、`candidate` 的 `--prefix` 說明與 root help 的可撰寫系列，都從 1.1 的同一份清單產生，不再列 Lv；`counter`、`dedup`、`deploy` 繼續列 Lv。Go 測試讀 cobra flag 的說明字串：`write` 的 `--prefix` 列出 GP、MP、SD 且不含 Lv，`counter bump` 的 `--prefix` 仍含 Lv（對應「寫作指令的 help text SHALL NOT 邀請撰寫 Lv」的兩個情境）
- [ ] 1.4 grep 整個 repo（scripts、`.github/workflows`、`tools/`、`playbooks/`、`docs/`、skills）找出用 `--prefix Lv` 或 Lv ticket 呼叫 `run`、`write`、`review`、`refine` 的地方：程式呼叫點要改掉，文件裡的範例交給第 2 組；在 PR 說明記下 grep 結果

## 2. 文件指向同一條 Lv 流程

- [ ] 2.1 `CONTRIBUTING.md` 的〈Workflow〉在 SD 之後新增〈新增入門教學（Lv）〉。內容涵蓋：依 `editorial-charter` 判斷 `Lv-original` 或 `Lv-guided-reading`；先讀兩三篇近期 Lv 當範本（列檔名）；先寫設計稿（分層、貫穿全篇的比喻、每層測驗、魔王關）；prose 交給固定版本寫手（只指向各 runtime playbook，不複製指令或 model ID）；跑確定性檢查與 Tribunal；通過後用 `gp-pipeline translate --file` 產英文版；配號與發布。同一節寫〈Lv 常見骨架〉：
  - 每一層由上一層留下的問題逼出來，標題用 `Floor N` 或「第 N 層」；
  - 一個比喻扛全篇；
  - `LevelUpProgress`；
  - 通常每層一題 `LevelUpQuiz`，`explanation` 只能寫純文字；
  - `AnalogyBox`；
  - 選用的 `Mermaid`；
  - 魔王關把前面串起來；
  - guided-reading 在開頭 cite 來源。

  明寫這是常見形狀、不是硬性規則。〈gp-pipeline（自動寫作流程）〉改成 `--prefix <GP|MP|SD>`，並加一句 Lv 正文不走 pipeline、但可用 `ralph`／`translate`／`deploy`。驗證：新小節標題與 1.1 錯誤訊息指向的名稱一致；pre-commit 的 markdown 與 zh-tw 檢查通過
- [ ] 2.2 `tools/gp-pipeline/SKILL.md` 改掉「GP 導讀、MP、SD、Lv 共用」與「四個系列共用」，寫明 Lv 撰寫入口會 exit 1、Lv 可用的步驟，並指向 `CONTRIBUTING.md` 的 Lv 流程。驗證：`go test -count=1 ./...` 裡讀 `SKILL.md` 的契約測試照樣綠
- [ ] 2.3 `AGENTS.md` 主題路由表的「來源寫作 pipeline」那一列不再把 Lv 列為 pipeline 寫作系列，改成指向 `CONTRIBUTING.md` 的 Lv 流程。驗證：pre-commit 通過，路由表其他列不變

## 3. 整合驗證

- [ ] 3.1 實際跑編好的 CLI：`tools/gp-pipeline/gp-pipeline run https://example.com/x --prefix Lv` 與 `tools/gp-pipeline/gp-pipeline write --prefix Lv --source <任一檔>` 都 exit 1、訊息含 `CONTRIBUTING.md`、沒有留下工作目錄、`git status` 乾淨；`tools/gp-pipeline/gp-pipeline write --help` 的 `--prefix` 不列 Lv。把指令與輸出貼進 PR 說明

## Workflow follow-up

- 依 `.agents/openspec-sdlc.md` 走階段 6 雙審（正確性錨 spec scenario、簡潔度錨 over-engineering）。
- 階段 8 archive 並 sync `gp-pipeline-publish-integrity`，同一個 PR 轉 ready，過 Codex auto-review gate 後 merge。
