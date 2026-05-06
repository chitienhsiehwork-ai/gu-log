# Evidence: Codex tribunal runtime boundary and safety

Date: 2026-05-07  
Scope: `migrate-tribunal-to-codex` / `codex-tribunal-runtime`

## Runtime Boundary

存在兩套 agent config：

```text
.claude/agents/fact-checker.md
.claude/agents/fresh-eyes.md
.claude/agents/librarian.md
.claude/agents/tribunal-writer.md
.claude/agents/vibe-opus-scorer.md
.codex/agents/fact-checker.toml
.codex/agents/fresh-eyes.toml
.codex/agents/librarian.toml
.codex/agents/tribunal-writer.toml
.codex/agents/vibe-opus-scorer.toml
```

`scripts/tribunal-helpers.sh`：

- 優先讀 `.codex/agents/$agent_name.toml` 作為 Codex agent config。
- 可以讀 `.claude/agents/$agent_name.md` 作為 legacy rubric text。
- 明確要求 Codex 忽略 Claude Code YAML frontmatter runtime fields，例如 `model`、`tools`。
- 實際執行路徑使用 `codex exec --model gpt-5.5`。

## Static Safety Contract

`bash scripts/tests/test-tribunal-safety-contract.sh`：

```text
ok no hook-bypass flags in Tribunal runtime
ok commit/push safety defaults are explicit
ok judge-only/--only-stage requires explicit --allow-rewrite
ok vibe-scorer remains score-only/non-mutating
ok invalid judge JSON fails loudly
ok Codex idle watchdog semantics are present
ok Codex agent specs are separated from Claude Code frontmatter
ok PASS artifact guard remains wired
```

## Review Notes

- `.claude/agents/*.md` 不應被改成 `gpt-5.5` runtime config；Claude Code 未來仍可能使用這些檔案。
- Codex tribunal runtime 的 source of truth 是 `.codex/agents/*.toml` 與 `scripts/tribunal.sh`。
- live LLM smoke tests 仍會花 GPT-5.5 credits 並可能改 frontmatter；執行前應確認是否使用 throwaway fixture 與 non-mutating flags。
