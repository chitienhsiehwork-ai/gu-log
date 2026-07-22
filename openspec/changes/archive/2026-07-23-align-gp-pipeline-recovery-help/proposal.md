## Why

`gp-pipeline` 的 agent-facing skill 把「既有正式文章的恢復發布」指向 standalone `deploy`，但這個 subcommand 實際上只接受 fresh PENDING article，還會配置新流水號。照文件操作不只會失敗，未來若 guardrail 漂移還可能重新配號。另一方面，`deploy --help` 把 counter bump 寫在 validator 前面，與 fail-closed 實作相反，也沒有把 fresh allocation 所需的三個檔名 flag 和 testing-only flag 邊界講清楚。

## What Changes

- 把既有正式文章缺英文 sidecar 的恢復路徑改成 `run --from-step translate --file <existing>.mdx`。
- 把既有正式雙語文章的發布恢復路徑改成 `run --from-step deploy --file <existing>.mdx`，不重新配置流水號。
- 將 standalone `deploy` 定位為 fresh PENDING allocation，完整列出 `--date-stamp`、`--author-slug`、`--title-slug` 必填契約。
- 修正 `deploy --help` 的 gate／mutation 順序、`--dry-run` 語意與 testing-only flag 說明。
- Skill 只描述 side effects；批准與品質門檻指回 `AGENTS.md` 與 identity detection 選出的 runtime playbook，不複製 policy。
- 新增小型 help／skill contract test，防止 recovery routing 與 required flags 再次 drift。

## Capabilities

### New Capabilities

（無。）

### Modified Capabilities

- `gp-pipeline-publish-integrity`: 增加既有正式文章與 fresh PENDING article 的恢復路徑契約，並要求 CLI help 與 agent-facing skill 忠實反映實作。

## Impact

- `tools/gp-pipeline/SKILL.md`
- `tools/gp-pipeline/cmd/gp-pipeline/deploy.go`
- `tools/gp-pipeline/cmd/gp-pipeline/*_test.go`
- `openspec/specs/gp-pipeline-publish-integrity/spec.md`（archive 前 sync）
