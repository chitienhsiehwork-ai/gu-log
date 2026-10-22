## Why

`codex-tribunal-runtime` 是 Tribunal 評審 provider／model 路由的正本，但兩個 legacy wrapper 的情境跟實際做法不一致（#1164 第 2 節 P1）：

- `tribunal-all-claude.sh` 的情境寫死「使用 Codex/GPT-5.5 runtime」。實際上 model 由第一條 requirement 決定：VM 看 `config/llm-pipeline.json` 的 profile、非 VM 的 Codex 看 `.codex/agents/*.toml`、沒有 Codex 時走 Claude 備援。VM 的 reviewer 早就不是 GPT-5.5，spec 自己就留了一份會過期的 model 快照。
- `vibe-scorer.sh` 的情境寫它執行 `tribunal.sh --only-stage vibe`，實際上一直是 `--score-only --only-stage vibe`：wrapper 只評分，不改寫、不寫 frontmatter、不 commit。照 spec 實作會讓舊 caller 意外觸發改寫。

另外 Tier-0、README、CONTRIBUTING、runbook 都把 `.claude/agents/*.md` 的 `model:` frontmatter 當成 judge model 的 SSOT，但那欄只管 Claude 路徑。這些文件改成指向本 spec，本 spec 也就不能再寫具體 model ID。

## What Changes

- Legacy wrapper 情境拿掉寫死的 GPT-5.5，改成「跟 canonical command 用同一套 provider／model 路由，wrapper 不自行指定」。
- VibeScorer wrapper 的要求補上只評分、不改動檔案，情境改成實際執行的 `--score-only --only-stage vibe`。
- 文件指標（AGENTS.md、README、CONTRIBUTING、runbook、CCC playbook、`vibe-opus-scorer.md` 的 PIN 註解）在同一個 PR 另外的 commit 處理，不在這個 delta 裡。

## Capabilities

### Modified Capabilities
- `codex-tribunal-runtime`：兩條 legacy wrapper requirement 對齊實際路由與 `--score-only`，不再寫具體 model ID。

## Impact

- 只改 spec 文字，沒有程式行為改變：`scripts/tribunal-all-claude.sh` 本來就原樣轉給 `tribunal.sh`，`scripts/vibe-scorer.sh` 本來就帶 `--score-only`。
