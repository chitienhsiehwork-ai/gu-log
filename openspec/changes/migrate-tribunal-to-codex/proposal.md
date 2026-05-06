## Why

gu-log 的 SP pipeline 和 tribunal 已經在 clawd-vm stash 裡有一版 Codex migration，但正式 repo 還沒有把「從 Claude runtime 遷到 Codex/GPT-5.5」變成可追蹤的 OpenSpec contract。現在要先把既有 VM 工作收編成規格，避免本機 dirty diff 與 VM stash 各自長出兩套現實。

同時 Andrej / Anthropic 兩篇 SP 會碰到既有 gu-log 內容重疊問題；librarian 必須先能利用 glossary 與舊文 evidence packet 做 cross-ref，否則新文會一直重講 Software 3.0 這種 gu-log 已經講過的概念。

## What Changes

- 從 clawd-vm `~/clawd/projects/gu-log` 的 `stash@{1}` 接手 sp-pipeline Codex-only migration。
- 從 clawd-vm `stash@{2}` 接手 tribunal v4 Codex runner、`scripts/tribunal.sh`、`scripts/tribunal-librarian-packet.py`。
- 將 sp-pipeline writing/probe chain 和 tribunal judges 統一到 `codex exec` + `gpt-5.5`。
- 保留可靠 output capture，避免 Codex CLI 的 banner/log 混進文章或 JSON。
- 將 librarian cross-ref 改成 deterministic evidence packet + targeted old-post reading。
- 將 Andrej Karpathy、Simon Willison、Boris Cherny 等人名納入 glossary SSOT，並支援 aliases。
- 用 Andrej SP draft 做 end-to-end smoke test，但正式文章撰寫不列入此 change 的第一批規格 commit。

## Capabilities

### New Capabilities

- `codex-exec-writing-runtime`: 定義 sp-pipeline 使用 Codex/GPT-5.5 產文、評估、probe 的 runtime contract。
- `codex-tribunal-runtime`: 定義 tribunal v4 使用 Codex/GPT-5.5 執行四個 judge 與 writer repair 的 runtime contract。
- `librarian-crossref-evidence`: 定義 librarian evidence packet、舊文 citation、避免重複觀點的 cross-ref contract。
- `glossary-identity-ssot`: 定義人物與概念 glossary SSOT、aliases，以及文章只介紹一次的規則。

### Modified Capabilities

（無。此 change 先新增 Codex migration 與 librarian/glossary contract，不修改已 archived specs 的 normative requirements。）

## Impact

- clawd-vm stash recovery workflow
- `tools/sp-pipeline/`
- `scripts/tribunal.sh`
- `scripts/tribunal-all-claude.sh`
- `scripts/vibe-scorer.sh`
- `scripts/tribunal-helpers.sh`
- `.codex/agents/librarian.toml`
- `.claude/agents/librarian.md`（legacy rubric only；不改 Claude Code frontmatter runtime）
- `src/data/glossary.json`
- `src/pages/glossary.astro`
- `src/config/glossary.ts`
