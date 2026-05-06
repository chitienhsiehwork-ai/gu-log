# 證據：SP pipeline Codex runtime tests

日期：2026-05-07  
範圍：`migrate-tribunal-to-codex` / `codex-exec-writing-runtime`

## Runtime 證據

`tools/sp-pipeline/internal/llm/codex.go` 定義目前維護中的 Codex provider：

- command shape：`codex exec --model <model> -c model_reasoning_effort="<effort>" ... -o <tmp>`
- default constructor：`NewCodexGPT55Medium()`
- default model：`gpt-5.5`
- default reasoning：`medium`

`tools/sp-pipeline/internal/llm/gemini.go` 保留 legacy compatibility naming，但 writing chain 註解已標示維護中的 runtime 是 Codex GPT-5.5 medium。

## Test 證據

第一次執行失敗，原因是 Go 嘗試寫入 sandbox 外的 cache：

```text
open /Users/shroom/Library/Caches/go-build/...: operation not permitted
```

改用 repo-local cache 後重跑：

```bash
GOCACHE=/Users/shroom/gu-log/tmp/go-build-cache go test ./...
```

結果：

```text
ok github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/cmd/sp-pipeline
ok github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/config
ok github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/counter
ok github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/dedup
ok github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/frontmatter
ok github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/llm
ok github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/logx
ok github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/pipeline
ok github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/prompts
ok github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/runner
ok github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/source
```

## Review Notes

- `go test` 通過代表 deterministic provider / output parsing 行為可用，不代表 live GPT-5.5 文章品質已驗證。
- Legacy provider files 與 compatibility flags 內部仍可能提到 Claude/Gemini；review 重點應放在 default production chain 與 user-facing docs/logs。
