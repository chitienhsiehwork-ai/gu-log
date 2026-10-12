# Proposal

## Why

Lv-18 是第一篇用 `gp-pipeline run <url> --prefix Lv` 寫出來的 Lv，結果完全沒有 Lv 的樣子：沒有分層、沒有測驗、沒有魔王關，讀起來像一篇掛 Lv 編號的 MP，四位評審卻照樣讓它通過。ShroomDog 看完說「看起來怪」，最後整篇改用「先寫設計稿、再交給固定版本的寫手」重寫才修好（PR #1135）。

病根不是少一段 prompt：pipeline 的 write／review／refine 對 Lv 走的是 SD 共用的舊翻譯契約（要求 cover 整篇來源、refine 只准 import MoguNote），跟 `editorial-charter` 對 `Lv-guided-reading` 的定義直接衝突；Lv 的版型也從來沒有寫成文字，只活在既有文章裡。現有 18 篇 Lv 只有 Lv-18 是 pipeline 寫的，其餘 17 篇手寫，版型全都對。可是 `SKILL.md` 寫「四個系列共用」、`--help` 也列出 `--prefix Lv`，等於邀請下一個 agent 照做，下次「把這則推文寫成 Lv」幾乎一定重演。

授權來源：ShroomDog 於 2026-10-12 在 chat 選了方案 A（pipeline 在寫稿入口擋下 Lv，改走設計稿＋固定版本寫手，並把 Lv 版型寫進寫作規範），沒有選擇連 SD 一起擋。

## What Changes

- `gp-pipeline` 不再撰寫 Lv 正文：會跑到 write、review 或 refine 的指令遇到 Lv 時，在 ingress 以 exit 1 失敗，不建立工作目錄、不抓來源、不呼叫模型、不動 `scripts/article-counter.json`。範圍是 `run`（`--prefix Lv`，或 `--file` 是 Lv 檔且起點在 refine 以前）、`write --prefix Lv`、`review`／`refine --ticket-id Lv-*`。錯誤訊息指向 `CONTRIBUTING.md` 的 Lv 寫作流程，並列出 Lv 仍可用的步驟。
- Lv 仍可使用 pipeline 的非寫作步驟：`counter`、`fetch`、`eval`、`dedup`、`ralph --file`、`translate --file`、`deploy --active-file`，以及 `run --file <Lv 檔> --from-step ralph|translate|deploy`。Lv-18 的英文版就是這樣用 `translate` 產生的。
- `write`、`review`、`refine`、`run`、`candidate` 與 root 的 help text 不再宣稱可以寫 Lv；`counter`、`dedup`、`deploy` 等非寫作指令照舊接受 Lv。
- `CONTRIBUTING.md` 新增「新增入門教學（Lv）」流程：依 charter 選 mode、拿近期 Lv 當範本、先寫設計稿、prose 交給固定版本寫手、跑確定性檢查與 Tribunal、通過後用 `gp-pipeline translate` 產英文版。同一節描述 Lv 的常見骨架（分層、`LevelUpProgress`、每層一題 `LevelUpQuiz`、`AnalogyBox`、選用的 `Mermaid`、魔王關）。這是寫作指引，不是硬性格式規則：既有 17 篇本身就不完全一致，charter 也允許 Lv 自由安排結構。
- `tools/gp-pipeline/SKILL.md`、`CONTRIBUTING.md` 的 gp-pipeline 小節與 `AGENTS.md` 路由表改掉「四個系列共用」的說法。
- SD 行為不變：SD 仍走同一條 write／review／refine 路徑。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `gp-pipeline-publish-integrity`：新增「gp-pipeline SHALL NOT 撰寫 Lv 正文」要求，定義哪些指令在 ingress 拒絕 Lv、拒絕時不得產生的副作用、錯誤訊息要指向哪裡，以及 Lv 仍可使用的非寫作步驟與 help text 的誠實要求。

## Impact

- Go CLI：`tools/gp-pipeline/cmd/gp-pipeline/` 的 `run.go`、`write.go`、`review.go`、`refine.go`、`candidate.go`、`main.go`（help text 與 ingress 檢查），以及對應的行為測試。
- 文件：`CONTRIBUTING.md`（新增 Lv 流程與骨架、改 gp-pipeline 小節）、`tools/gp-pipeline/SKILL.md`、`AGENTS.md` 路由表一列。
- 不受影響：`editorial-charter`（Lv 的編輯身份不變）、四位評審與 Tribunal、`validate-posts.mjs`、prompt 模板內容、SD 流程、既有 Lv 文章。
