# gp-pipeline

gu-log GP 翻譯／MP source-grounded writing 流程的 Go CLI。唯一受支援的執行入口是自編譯 wrapper：

```bash
tools/gp-pipeline/gp-pipeline --help
```

## Canonical contract

| Series | 品牌 | Ticket | Filename slug |
|---|---|---|---|
| GP | Gu-log Picks（忠實翻譯） | `GP-N`／`GP-PENDING` | `gp-`／`gp-pending-` |
| MP | Mogu Picks（Mogu 依來源寫作） | `MP-N`／`MP-PENDING` | `mp-`／`mp-pending-` |
| SD | 原創文章 | `SD-N`／`SD-PENDING` | `sd-`／`sd-pending-` |
| Lv | 入門教學 | `Lv-N`／`Lv-PENDING` | `lv-`／`lv-pending-` |

非 canonical prefix、舊檔名 slug、舊 tool path 與 shell wrapper 都已退役。CLI 會針對非 canonical prefix 回傳可採取行動的錯誤，不提供 compatibility alias。

## Why Go

Pipeline 包含 source validation、LLM routing、dedup、可恢復 state、counter locking 與 deploy transaction。Go 實作把這些契約放進可單元測試的 package，並讓所有入口共用同一份行為。

wrapper 只負責在 source 較新時編譯 `cmd/gp-pipeline` 到 gitignored `bin/gp-pipeline`，然後 `exec`。repo 不追蹤平台特定 binary。

## VM model routing

`scripts/detect-env.sh --runtime codex --identity` 回報 `vm-codex` 時，wrapper
才啟用同名 runtime profile；其他 Codex、Claude Code Cloud 與 legacy caller
維持原本 provider chain。VM profile 會先確認 Codex 與官方 Grok Build CLI
都相容且已登入，缺任一個就 fail closed。

所有常換的 model、effort、quota threshold 與 unknown policy 都只定義在
`config/llm-pipeline.json`；README 不複製易過期的數值。Router 依該檔選擇
reviewer、writer 與 Vibe Scorer，而且不會在低額度時靜默改用其他 writer。
CodexBar 尚未提供可靠 Grok Build quota 前，自動 Grok probe 保持關閉，
不猜百分比。

## Quick start

```bash
# 完整 GP 流程
tools/gp-pipeline/gp-pipeline run '<url>' --prefix GP

# Mogu Picks
tools/gp-pipeline/gp-pipeline run '<url>' --prefix MP

# Rehearsal：停在 deploy 前
tools/gp-pipeline/gp-pipeline run '<url>' --prefix GP --dry-run

# 僅預審一支 YouTube 影片；不進入寫作或發布
tools/gp-pipeline/gp-pipeline candidate '<youtube-url>'

# 環境檢查
tools/gp-pipeline/gp-pipeline doctor

# Counter read-only
tools/gp-pipeline/gp-pipeline counter next --prefix GP
```

MP 沿用現有非 GP 的 `write → review → refine → Tribunal rewrite` 路徑。Mogu 可貼近來源翻譯／改寫、保留覆蓋與順序，也可選材或從頭重建；沒有最低改寫幅度，兩種距離共用同一個 MP contract，不新增子模式或 pipeline。close-form MP 不取得 GP fidelity 承諾；每個保留的 source claim 仍必須保留 controlling caveat 與正確歸因。MoguNote 可寫實際發生的 editorial／tool interaction 或明顯奇幻 persona，但不得挪用來源作者經歷或杜撰看似真實的人類履歷。

逐步操作與 side-effect 邊界見 [`SKILL.md`](SKILL.md)；flags 以 `<subcommand> --help` 為準。

## Architecture

```text
gp-pipeline                 self-compiling wrapper
cmd/gp-pipeline/            Cobra CLI and ingress validation
internal/config/            repo paths and dependency discovery
internal/counter/           canonical prefix/ticket validation + flock
internal/source/            source fetch and completeness validation
internal/candidate/         YouTube-only review manifest + safe workdir boundary
internal/dedup/             dedup gate adapter
internal/llm/               provider dispatch and attribution
internal/prompts/           embedded prompt templates
internal/pipeline/          resumable orchestration state machine
internal/deploy/            pending validation, allocation, rename, build, git
internal/observability/     run status
internal/ralph/             tribunal adapter
internal/runner/            external command boundary
```

重要 invariant：

- prefix 與 ticket ID 在 CLI ingress 與 package boundary 都會驗證。
- 正式 ticket 只在 deploy transaction 配置；草稿使用 `<PREFIX>-PENDING`。
- pending filename／frontmatter 驗證在 counter bump 前完成，避免失敗時消耗號碼。
- `scripts/article-counter.json` 的 key 必須恰為 `GP`、`MP`、`SD`、`Lv`。
- deploy 使用 `pnpm run build`，且不會假設英文 companion 一定存在。
- provider 實際 model／harness 由執行結果寫入 credits，不靠呼叫端猜測。
- `candidate` 只接受單一 YouTube 影片，只在 repo 外工作目錄產生
  `candidate-manifest.json`、原始 VTT、保留時間戳的逐字稿與來源 evidence。
- `candidate` 不會呼叫 LLM、建立 MDX、配置 ticket、修改 Git／counter，或執行
  Eval、Write、Review、Refine、Credits、Ralph、Translate、Deploy。
- `writeEligible: true` 只表示來源完整性與 video-ID dedup 允許人工考慮；
  核准後仍須另跑 canonical `gp-pipeline run <youtube-url>`。
- YouTube 擷取需要 `yt-dlp`。`candidate` 與正式 `run` 缺少它時都會封閉失敗，
  不會退回 generic HTML；`doctor` 會把這項能力列為 optional，不影響非 YouTube 流程。

## Development

需求：Go 1.24.7+、Node.js、pnpm、git。部分 pipeline steps 另需 repo playbook 指定的 LLM CLI。

```bash
cd tools/gp-pipeline
go fmt ./...
go test ./...
go build -o bin/gp-pipeline ./cmd/gp-pipeline
```

若 sandbox 不允許使用使用者的 Go build cache，可只把 cache 指到暫存目錄：

```bash
GOCACHE=/tmp/gu-log-go-cache go test ./...
```

不要以 `--skip-validate`、`--skip-build` 或 hook-bypass 取代正式驗證。

## Source of truth

- CLI 行為：`cmd/gp-pipeline` 與 `internal/**` tests。
- Taxonomy／migration contract：main specs（`openspec/specs/brand-taxonomy/` 等）；歷史決策見 `openspec/changes/archive/2026-07-17-rebrand-mogu-gp-mp-taxonomy/`。
- 內容與發布規則：repo 的 `AGENTS.md`、`CONTRIBUTING.md` 與對應 playbook。
- 本 README 是操作導覽；若與 code／spec 不同，以 code／spec 為準並修正本檔。
