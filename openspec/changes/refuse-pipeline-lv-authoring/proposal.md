# Proposal

## Why

Lv-18 是第一篇用 `gp-pipeline run <url> --prefix Lv` 寫出來的 Lv，結果完全沒有 Lv 的樣子：沒有分層、沒有測驗、沒有魔王關，讀起來像一篇掛 Lv 編號的 MP，四位評審卻照樣讓它通過。ShroomDog 看完說「看起來怪」，最後整篇改用「先寫設計稿、再交給固定版本的寫手」重寫才修好（PR #1135）。

病根不是少一段 prompt：pipeline 的 write／review／refine 對 Lv 走的是 SD 共用的舊翻譯契約（要求 cover 整篇來源、refine 只准 import MoguNote），跟 `editorial-charter` 對 `Lv-guided-reading` 的定義直接衝突；Lv 的版型也從來沒有寫成文字，只活在既有文章裡。現有 18 篇 Lv 只有 Lv-18 是 pipeline 寫的，其餘 17 篇都是手寫：細節不完全一致（例如 Lv-08、Lv-09 沒有魔王關），但每篇都有分層、進度條與測驗。可是 `SKILL.md` 寫「四個系列共用」、`--help` 也列出 `--prefix Lv`，等於邀請下一個 agent 照做，下次「把這則推文寫成 Lv」幾乎一定重演。

pipeline 的 `ralph` 也有同樣的問題。它遇到 GP 以外的系列，會先跑會改正文的 post-fixer、允許 Tribunal 寫手改寫，最後把 `translatedBy.pipeline` 蓋成 pipeline 寫的署名；`credits` 也會蓋同一種署名。手寫 Lv 的評審其實是直接跑 `scripts/tribunal.sh`（Lv-18 就是這樣跑的，背景 Tribunal daemon 也是），這支程式不碰署名。

授權來源：ShroomDog 於 2026-10-12 在 chat 選了方案 A（pipeline 在寫稿入口擋下 Lv，改走設計稿＋固定版本寫手，並把 Lv 版型寫進寫作規範），沒有選擇連 SD 一起擋。

## What Changes

- `gp-pipeline` 不再撰寫、改寫 Lv，也不替 Lv 蓋 pipeline 署名。下列入口遇到 Lv 時，在 ingress 以 exit 1 失敗：
  - `run`：`--prefix Lv`，或 `--file` 是 Lv 檔，而且起點早於 `translate`（沒指定起點也算，加 `--dry-run` 也一樣）；
  - `write --prefix Lv`；
  - `review`、`refine`：`--ticket-id` 是 Lv ticket，或草稿 frontmatter 的 `ticketId` 是 Lv ticket（`--ticket-id` 沒帶時預設是 `GP-PENDING`，只看參數的話，Lv 草稿會默默套用 GP 的規則）；
  - `credits`、`ralph`：目標檔是 Lv。

  拒絕發生在建立工作目錄、檢查外部工具（例如 yt-dlp）、抓來源、呼叫模型、改動 `scripts/article-counter.json` 與寫入任何檔案之前。錯誤訊息指向 `CONTRIBUTING.md` 的 Lv 寫作流程，並列出 Lv 仍可用的步驟。
- Lv 仍可使用 pipeline 的非寫作步驟：`counter`、`fetch`、`eval`、`dedup`、`translate --file`、standalone `deploy --active-file`，以及 `run --file <Lv 檔> --from-step translate|deploy`。Lv-18 的英文版就是用 `translate` 產生的；`translate` 保留原文的署名，只記下翻譯用的模型。
- `write`、`review`、`refine`、`run`、`candidate` 與 root 的 help text，以及 `run`、`write` 缺 `--prefix` 時列出的系列，不再把 Lv 當成可以撰寫的系列；`run --help` 說明 Lv 檔只能從 `translate` 或 `deploy` 恢復。`counter`、`dedup`、`deploy` 照舊接受 Lv。
- `CONTRIBUTING.md` 新增「新增入門教學（Lv）」流程：依 charter 選 mode、拿近期 Lv 當範本、先寫設計稿、正文交給固定版本寫手、跑確定性檢查、用 `scripts/tribunal.sh` 跑 Tribunal、通過後用 `gp-pipeline translate` 產英文版。同一節描述 Lv 的常見骨架（分層、`LevelUpProgress`、每層一題 `LevelUpQuiz`、`AnalogyBox`、選用的 `Mermaid`、魔王關）。這是寫作指引，不是硬性格式規則：既有 17 篇本身就不完全一致，charter 也允許 Lv 自由安排結構。
- 說 pipeline 能寫 Lv、或叫人用 `gp-pipeline ralph` 評 Lv 的文件一起改：`tools/gp-pipeline/SKILL.md`、`tools/gp-pipeline/README.md`、wrapper 註解、`CONTRIBUTING.md` 的 gp-pipeline 小節與研究流程、`AGENTS.md` 路由表、`playbooks/CCC-playbook.md`（Tribunal 的首選做法與 pipeline 指令範例）、`scripts/crontab-tribunal.example`。
- SD 行為不變：SD 仍走同一條 write／review／refine／ralph 路徑。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `gp-pipeline-publish-integrity`：新增「gp-pipeline 不撰寫、不改寫 Lv，也不替 Lv 蓋 pipeline 署名」的要求，定義哪些指令在 ingress 拒絕 Lv、拒絕前不得產生的副作用、錯誤訊息要指向哪裡，以及 Lv 仍可使用的非寫作步驟與說明文字的誠實要求。

## Impact

- Go CLI：`tools/gp-pipeline/cmd/gp-pipeline/` 的 `run.go`、`write.go`、`review.go`、`refine.go`、`credits.go`、`ralph.go`、`candidate.go`、`main.go`（ingress 檢查與 help text），以及對應的行為測試；既有斷言 Lv 可以跑 standalone `ralph` 的測試改成斷言拒絕。
- 文件：見上方 What Changes 的清單。
- 不受影響：`editorial-charter`（Lv 的編輯身份不變）、四位評審與 `scripts/tribunal.sh`（含背景 daemon）、`validate-posts.mjs`、prompt 模板內容、SD 流程、既有 Lv 文章。
