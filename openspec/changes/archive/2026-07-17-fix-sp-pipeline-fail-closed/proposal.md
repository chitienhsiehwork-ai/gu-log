## Why

gu-log #546（SP-252 跑程中撞到）記錄了 `gp-pipeline` 三個 fail-open / 誠實性缺口，roadmap #585（P1-8）已把它升級為 must-ship 等級：

1. **standalone `deploy` 檔名槽位空白**：`gp-pipeline deploy --active-file ...` 不帶 `--date-stamp/--author-slug/--title-slug` 時，`internal/deploy/deploy.go` 直接拼出 `sp-252---.mdx` 並 commit+push 到 prod，沒有任何驗證。
2. **`write` 的 help text 說謊**：`cmd/sp-pipeline/main.go` 說 `write` 產「zh-tw + en MDX pair」，但 `internal/pipeline/write.go` 只寫 zh-tw；en 版目前完全靠人／協調 agent 照 CONTRIBUTING.md 的 zh-tw-first SOP 手工用 `claude -p --model claude-opus-4-5` 補，Go pipeline 裡沒有對應步驟。
3. **LLM 寫的 `source:` frontmatter 引號不安全**：write 步驟把 `--source-label` 這類自由文字交給 LLM 自己決定怎麼寫進 frontmatter YAML，撇號／引號／冒號可能產生無效 YAML；`scripts/validate-posts.mjs` 是手刻 regex parser，不是真 YAML parser，抓不到，一路漏到 `pnpm run build`。

## What Changes

- **`deploy` 檔名槽位驗證**：`internal/deploy/deploy.go` 在 bump counter / rename / commit / push 之前，驗證 `DateStamp`（`^\d{8}$`）、`AuthorSlug`、`TitleSlug` 三者非空，缺一律回傳明確錯誤、不產生任何檔案或 side effect。`cmd/sp-pipeline/deploy.go` 同步把三個 flag 標成 cobra required，CLI 層第一時間擋。**不做「從 pending 檔名回推槽位」的猜測式 derive**——pending 檔名格式 `<prefix>-pending-YYYYMMDD-<author>-<title>.mdx` 對 author/title 邊界本質上是 ambiguous 的（dash-joined、無法區分詞界），猜錯會產出「格式正確但語意錯」的檔名，比 fail loud 更危險。
- **新增 `translate` 步驟 + 子命令**：比照 `write`/`refine` 的 dispatcher 模式，新增 `internal/pipeline/translate.go` 與 `translate.tmpl` prompt，用既有 writer LLM chain（`ClaudeOpusPinned`）把過 tribunal 的 zh-tw 定稿翻成 en sidecar。`run` 的 step list 在 `ralph` 之後、`deploy` 之前插入 `translate`，**gate 在 `s.RalphPassed`**（未過分數就跳過 + log warn，維持既有 deploy best-effort 語意，不新增第二個「未過分數擋 deploy」的機制）。同時提供 standalone `gp-pipeline translate` 子命令，供人工／恢復流程對單一已過分數的 zh-tw 檔案補 en。修正 `cmd/sp-pipeline/main.go` 的 help text，不再宣稱 `write` 產雙語 pair。
- **YAML-safe frontmatter 序列化**：不動 `internal/frontmatter/frontmatter.go` 既有的 line-level text-surgery 契約（swap 成真 YAML round-trip 會破壞它刻意的 byte-stability 保證與既有 caller 慣例，如 `deploy.go` 自帶引號的 `SetScalar("ticketId", ...)`）。改為：(a) 把 `internal/pipeline/credits.go` 的 `quoted()` 提升為 `frontmatter` package 內可重用、正確跳脫內嵌 `"`/`\` 的 YAML double-quoted-scalar helper；(b) 在 ralph 的 frontmatter normaliser（`normalizeRalphFrontmatter`）新增一段，對 LLM 自由產出的 `source` 欄位做確定性重新序列化（用同一個安全 quoting helper），保證無論 LLM 寫了什麼引號策略，最終落地的都是合法 YAML；(c) `scripts/validate-posts.mjs` 把手刻 regex frontmatter parser 換成 repo 既有的 `yaml` npm 套件做真解析，當作 defense-in-depth，讓任何欄位的無效 YAML 都在 validate 階段擋下，不再漏到 `pnpm run build`。

## Capabilities

### New Capability
- `sp-pipeline-publish-integrity`：`gp-pipeline` 發佈路徑（standalone deploy / write→translate 雙語契約 / frontmatter YAML 序列化）SHALL fail closed，不得產生格式錯誤的檔名、不實 help text、或無效 YAML frontmatter。

## Impact

- `tools/sp-pipeline/internal/deploy/deploy.go`、`tools/sp-pipeline/cmd/sp-pipeline/deploy.go` — 檔名槽位驗證
- `tools/sp-pipeline/internal/pipeline/translate.go`（新增）、`tools/sp-pipeline/cmd/sp-pipeline/translate.go`（新增）、`tools/sp-pipeline/internal/pipeline/run.go`、`tools/sp-pipeline/internal/pipeline/state.go`、`tools/sp-pipeline/internal/prompts/translate.tmpl`（新增）、`tools/sp-pipeline/cmd/sp-pipeline/main.go` — 翻譯步驟 + help text
- `tools/sp-pipeline/internal/frontmatter/frontmatter.go`（新增 exported quoting helper）、`tools/sp-pipeline/internal/pipeline/credits.go`、`tools/sp-pipeline/internal/pipeline/ralph.go`、`scripts/validate-posts.mjs` — YAML 安全序列化
- 新增/更新 Go 單元測試（`internal/deploy`、`internal/pipeline`、`internal/frontmatter`）與 `scripts/validate-posts.mjs` 對應的既有測試（若有）
- `tools/sp-pipeline/SKILL.md`、`CONTRIBUTING.md` 的直接派生段落（`translate` 子命令、`deploy` 必要 flag）若因本次實作變得不準確，一併更新，不做廣泛 docs cleanup
- **不影響**：`internal/frontmatter/frontmatter.go` 的既有 `SetScalar`/`SetNestedScalar` 契約與呼叫方式；`run` pipeline 既有 `--from-step` 數值（`StepTranslate` 用新的 sparse 整數，不重排既有常數）
