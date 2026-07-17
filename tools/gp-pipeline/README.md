# gp-pipeline

gu-log GP／MP 文章流程的 Go CLI。唯一受支援的執行入口是自編譯 wrapper：

```bash
tools/gp-pipeline/gp-pipeline --help
```

## Canonical contract

| Series | 品牌 | Ticket | Filename slug |
|---|---|---|---|
| GP | Gu-log Picks | `GP-N`／`GP-PENDING` | `gp-`／`gp-pending-` |
| MP | Mogu Picks | `MP-N`／`MP-PENDING` | `mp-`／`mp-pending-` |
| SD | 原創文章 | `SD-N`／`SD-PENDING` | `sd-`／`sd-pending-` |
| Lv | 入門教學 | `Lv-N`／`Lv-PENDING` | `lv-`／`lv-pending-` |

非 canonical prefix、舊檔名 slug、舊 tool path 與 shell wrapper 都已退役。CLI 會針對非 canonical prefix 回傳可採取行動的錯誤，不提供 compatibility alias。

## Why Go

Pipeline 包含 source validation、LLM routing、dedup、可恢復 state、counter locking 與 deploy transaction。Go 實作把這些契約放進可單元測試的 package，並讓所有入口共用同一份行為。

wrapper 只負責在 source 較新時編譯 `cmd/gp-pipeline` 到 gitignored `bin/gp-pipeline`，然後 `exec`。repo 不追蹤平台特定 binary。

## Quick start

```bash
# 完整 GP 流程
tools/gp-pipeline/gp-pipeline run '<url>' --prefix GP

# Mogu Picks
tools/gp-pipeline/gp-pipeline run '<url>' --prefix MP

# Rehearsal：停在 deploy 前
tools/gp-pipeline/gp-pipeline run '<url>' --prefix GP --dry-run

# 環境檢查
tools/gp-pipeline/gp-pipeline doctor

# Counter read-only
tools/gp-pipeline/gp-pipeline counter next --prefix GP
```

逐步操作與 side-effect 邊界見 [`SKILL.md`](SKILL.md)；flags 以 `<subcommand> --help` 為準。

## Architecture

```text
gp-pipeline                 self-compiling wrapper
cmd/gp-pipeline/            Cobra CLI and ingress validation
internal/config/            repo paths and dependency discovery
internal/counter/           canonical prefix/ticket validation + flock
internal/source/            source fetch and completeness validation
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
