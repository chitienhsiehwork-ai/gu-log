# Proposal

## Why

#1114（`translation-takedown-tombstone`）把整篇翻譯的 GP 全數下架、GP 暫停收新文之後，gp-pipeline 的 GP 整篇翻譯流程只剩壞處：pipeline 本身完全不知道 GP 已暫停，任何人跑 `gp-pipeline run <url>`（`--prefix` 預設就是 GP）都會照樣燒完翻譯、來源審查、自然中文評審、bounded correction、commentary 整條流程的額度，到 commit 才被下架棘輪擋下。這段程式跟之後的導讀新格式（`gp-commentary-format`）零耦合，先單獨刪乾淨，導讀的 diff 與 spec delta 就只剩新東西；之後就算 revert 導讀，翻譯流程也不會跟著復活。

刪除之前要先補保護：CI 與 git hook 目前完全沒跑 gp-pipeline 的 Go 測試，這次要刪的 Go 程式沒有任何 merge gate 把關。

## What Changes

- **先接 CI**：`tools/gp-pipeline` 的 `go test ./...` 成為 PR Fast Gate 的一個 leaf，列進 `ci-passed.needs`；確認刪除前這組測試是綠的，才開始刪。
- **GP 暫停中**：gp-pipeline 會為 GP 產生新正文或配置 GP 號碼的入口（`run`，含未指定 `--prefix` 時的預設值；standalone `deploy`；`write`／`review`／`refine`）一律在 ingress 以「GP 暫停中」錯誤結束，exit code 1，發生在建立工作目錄、抓來源、provider preflight、模型呼叫與任何 counter／git 異動之前。`run --file` 與 standalone `deploy --active-file` 改以檔名的系列判斷是不是 GP，明確的 `--prefix` 跟檔名對不上就在 ingress 失敗；這順手修掉 MP 檔沒帶 `--prefix` 時會被當成 GP 跑的舊問題，也讓 MP 的補救指令不會誤收「GP 暫停中」。**BREAKING**：沒帶 `--prefix` 也沒帶檔案的 `gp-pipeline run <url>` 不再能跑。
- **刪除 GP 整篇翻譯流程**（範圍以 code 為準，完整清單見 design.md）：`source-translate`、`source-preservation`（來源審查、自然中文評審、bounded correction 迴圈與 publish manifest）、`enrich`（commentary 候選與正文投影守門）、GP 角色 provenance 的 credits 分支、deploy 前的 manifest 驗證、GP role profile（`gp_profile.go`）、`internal/preservation/` 整個 package、五個翻譯專用 prompt、`--legacy-shadow` 與 GP 專用的 `--from-step` 名稱。**BREAKING**：這些 flag 與 step 名稱移除。
- **Runtime 設定與 model router**：`config/llm-pipeline.json` 與 `scripts/tribunal-model-router.sh` 拿掉 `translator`、`sourceReviewer`、`corrector`、`commentary` 四個只有 GP 翻譯流程在用的角色；`vibeScorer` 仍是 VM 上 Tribunal Vibe 評審的路由，只拿掉它身上 GP 專用的 prompt／output contract 欄位。
- **只為翻譯流程存在的 script**：刪除 `scripts/gp-body-projection.mjs` 與其測試；`scripts/check-jingjing.mjs` 移除只給 GP bounded corrector 用的 `--format=json` 模式，文字模式行為不變。
- **保留**：還會用到的小 helper（`WriteJSON`、`DecodeStrict`、`SHA256`、`Provenance`、attempt 編號）搬到獨立的小 package；`internal/terminology` 原地保留，留給導讀 change 接到寫手；Tribunal 與 gp-pipeline `ralph` 對 GP 只評分、不改寫正文的邊界保留。
- **Spec**：`gp-source-preservation` 的翻譯流程 requirement 全數 REMOVED，改成一條「GP 整篇翻譯流程 SHALL 維持退役」紀錄，並保留改寫成不依賴翻譯流程的「GP 只評分、不改寫」邊界；其他 capability 同步拿掉指向已刪步驟的文字。「把關角色不得與寫手共用 model」這條不變式會在導讀 change 以 aligner 形式寫回，design.md 有註明。
- **文件同步**：gp-pipeline SKILL／README、CONTRIBUTING、Tribunal runbook、CCC playbook、`AGENTS.md` 路由表與相關 skill 改成「GP 暫停中，導讀格式另案」。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `gp-source-preservation`：REMOVED 所有 GP 整篇翻譯流程的 requirement；ADDED「GP 整篇翻譯流程 SHALL 維持退役」；MODIFIED「GP rebuild prohibition」成為不依賴翻譯流程的「Tribunal 與通用 editorial mode 對 GP 只評分」邊界。
- `gp-pipeline-publish-integrity`：ADDED GP 暫停期間的 ingress 拒絕（exit code 1、無副作用、有檔案時以檔名系列判斷）；ADDED gp-pipeline Go 測試是 `ci-passed` 的必要 leaf；MODIFIED「standalone deploy 缺檔名槽位」的情境範例從 GP pending 檔改成 MP pending 檔（GP 在 ingress 就被拒絕，原範例會拿不到「指名缺少 flag」的錯誤）。
- `claude-prose-writing-runtime`：寫作步驟與評審清單拿掉已刪的 GP translator、corrector、commentary、source reviewer 與 natural-zh vibe gate；「只回傳 JSON 的寫作步驟不給工具」的最小權限條文改成不點名已刪步驟的通用說法。
- `editorial-charter`：emoji requirement 不再把 GP automated lane 的邊界指向 `gp-source-preservation`，改在本條直接寫明 GP lane 不提供 glyph 保留例外，並接住原本放在 GP spec 的「英文 sidecar 不復原來源 emoji」情境。

## Impact

- 程式：`tools/gp-pipeline/`（`cmd/gp-pipeline/`、`internal/pipeline/`、`internal/preservation/`、`internal/llm/`、`internal/prompts/`、`internal/observability/`，新增一個小 helper package）；`config/llm-pipeline.json`；`scripts/tribunal-model-router.sh`、`scripts/check-jingjing.mjs`、`scripts/gp-body-projection.mjs`。規模：整檔刪除約 23 個檔案、約 3,500 行，另有約 25 個檔案局部刪改；實際數字以 apply 的 diffstat 為準。
- 測試：Go 測試跟著刪改；`scripts/tests/test-tribunal-model-router.sh`；`tests/gp-body-projection.test.ts` 刪除；新增 CI workflow 結構測試。
- CI：`.github/workflows/ci.yml` 新增 Go 測試 leaf 並列進 `ci-passed.needs`。
- 文件：`tools/gp-pipeline/SKILL.md`、`tools/gp-pipeline/README.md`、`CONTRIBUTING.md`、`docs/tribunal-runbook.md`、`playbooks/CCC-playbook.md`、`AGENTS.md`、`.agents/skills/gp-pipeline-sop/`、x-source-fetch skill 兩份。
- 讀者可見：沒有。網站、文章、GP 暫停空狀態都不動。
- 相依：本 change 疊在 #1114 上（`translation-takedown-tombstone` 必須先 merge 並 archive；`gp-source-preservation` 的 REMOVED 標題以 #1114 改名後的名稱為準）。VM 上的舊 gp-pipeline 在 VM 更新前仍是舊版，這段期間照 #1114 的安排由 CI 棘輪擋下任何 GP 寫回。
