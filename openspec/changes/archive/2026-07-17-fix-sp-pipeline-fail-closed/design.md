## Context

三個獨立 fail-open 缺口都在 `tools/sp-pipeline`（gu-log 發文 Go pipeline）。這是個人副業 blog 的內部工具，不是多租戶系統——設計目標是「便宜、正確、不過度工程」，不是通用防護框架。動手前跑過三個 zero-context 對抗式 reviewer（value/YAGNI、design-space/替代方案、failure-mode/二階效應），三份 verdict 高度收斂，本 design 直接採納收斂結論。

## Goals / Non-Goals

**Goals**
- `deploy` 不可能產生 `sp-N---.mdx` 這類格式錯誤檔名，且失敗必須發生在任何檔案 rename / counter bump / commit / push 之前。
- `gp-pipeline` 的 help text 對 `write` 的宣稱與實際行為一致；提供一個真的能自動產生 en sidecar 的路徑，而不是永遠依賴人工。
- LLM 寫入 frontmatter 的 `source` 欄位無論引號策略為何，最終落地檔案都是合法可解析的 YAML。
- 三項修復都 additive、狹窄，不改變既有 caller 的既有行為。

**Non-Goals**
- 不做「從 pending 檔名回推槽位」的猜測式 derive（見 D1）。
- 不把 `internal/frontmatter/frontmatter.go` 換成真 YAML round-trip 序列化器（見 D3）。
- 不做通用 provider/writer-mode gating 框架——`GP_WRITER_MODE` 是 bash tribunal rewrite loop（`scripts/tribunal-helpers.sh`）專屬的成本控制機制，Go 側 `write`/`refine` 從來不吃它，`translate` 步驟比照既有 `write`/`refine` 行為，不新增它沒有的守門。

## Decisions

### D1：deploy 檔名槽位——fail loud only，不 derive

`internal/deploy/deploy.go` 在 `Run()` 開頭（counter bump 之前）新增驗證：
```go
if opts.DateStamp == "" || !dateStampRe.MatchString(opts.DateStamp) {
    return nil, fmt.Errorf("deploy: --date-stamp required and must be YYYYMMDD, got %q", opts.DateStamp)
}
if opts.AuthorSlug == "" {
    return nil, fmt.Errorf("deploy: --author-slug required")
}
if opts.TitleSlug == "" {
    return nil, fmt.Errorf("deploy: --title-slug required")
}
```
`cmd/sp-pipeline/deploy.go` 同步把三個 flag 標 `MarkFlagRequired`，CLI 層直接擋（cobra 的錯誤訊息比 deep-in-Run 的錯誤更早出現，兩層是 defense-in-depth，不是重複）。

**為什麼不 derive**：pending 檔名格式是 `<prefix>-pending-YYYYMMDD-<author>-<title>.mdx`——`sanitizeSlug()`（`internal/pipeline/slug.go`）把 author handle 和 title 都轉成 dash-joined 小寫字串，兩者中間沒有結構化分隔符。對抗式 reviewer 具體舉例：`sp-pending-20260717-john-smith-my-great-article.mdx` 無法用 dash-split 明確判斷 author 是 `john-smith`（兩個 token）還是 `john`（一個 token）。日期本身雖然可以安全地用固定寬度（8 位數字）從檔名反推，但單獨解出日期、仍要求 author/title 兩個 flag，等於「部分 derive + 部分必填」——兩套心智模型混在一起，比「三個都必填」更複雜卻沒有多少實際好處（`deploy` 是低頻的手動恢復路徑，SKILL.md 記錄的救援範例已經在傳 `--title`，補齊另外兩個 flag 不是大負擔）。選最簡單、最安全的選項：三個都必填，錯誤訊息直接告訴 operator 要補什麼。

### D2：`translate` 步驟——比照 write/refine 的既有模式，gate 在 RalphPassed

新增 `internal/pipeline/translate.go`，結構比照 `write.go`：
- 讀 `postsDir/s.ActiveFilename`（ralph 已經把過 tribunal 的 zh-tw 定稿放在這裡，含 canonical frontmatter stamp）。
- 用 `s.writerDispatcher()`（與 write/refine 同一個 dispatcher，`ClaudeOpusPinned`）跑一個新的 `translate.tmpl` prompt，指示 LLM 把整篇 zh-tw MDX（frontmatter + body）翻成道地英文 MDX，`lang: "en"`，其餘 frontmatter 欄位对应翻譯或保留（`sourceUrl`、`ticketId` 等不翻），並遵守 `GU-LOG_WRITER_PROMPT.md` 對 en 版的既有規則（保留原文 quote、不要逐字翻譯）。
- 寫出 `postsDir/s.ActiveENFilename`。

`internal/pipeline/run.go` 的 `steps` slice 在 `"ralph"` 之後、`"deploy"` 之前插入 `{"translate", s.Translate}`。`Translate()` 內部邏輯：
```go
if !s.RalphPassed {
    s.Log.Warn("Step 4.8: translate — SKIPPED (tribunal did not pass; deploying zh-tw only)")
    return nil
}
```
**為什麼 gate 在 RalphPassed，不是新機制**：`ralph.go` 現有 log-and-continue 語意（tribunal 沒過也不擋 deploy，"Deploying best effort"）已經是既定行為；translate 沿用同一個旗標，不新增第二套「有沒有過分數」的判斷路徑，也完全對齊 CONTRIBUTING.md 的 zh-tw-first SOP（「過分數之後才翻 en 版」）。

`state.go` 新增 `StepTranslate = 48`（Ralph=47、Deploy=50 之間的既有 sparse 間隙，不重排既有常數，`--from-step` resume 邏輯不受影響）。

`cmd/sp-pipeline/translate.go` 提供 standalone 子命令（比照 `deploy` 的「recovering a partially-deployed article」定位），供人工對一篇已過 tribunal、但因某種原因 en 沒補上的既有檔案手動觸發。

`cmd/sp-pipeline/main.go` 的 root help 從 `write draft the zh-tw + en MDX pair` 改為誠實描述：`write` 只產 zh-tw draft，`translate` 才是 en sidecar 的來源，且只在 tribunal 過分數後執行。

**不做的事**：不讓 translate 檢查 `GP_WRITER_MODE`（那是 bash tribunal rewrite loop 專屬機制，Go 側 write/refine 從未檢查它，translate 比照既有行為，新增檢查反而是不一致的特例）；不把 translate 塞進 `write` 本身（write 仍只認領 zh-tw draft，符合 zh-tw-first 的階段劃分）。

**Note（Opus proposal reviewer 提出、已採納）**：`translate.go` 的 `Translate()` method SHALL 比照其餘 step method 自己的既有 pattern，開頭先做 `s.shouldSkipBelow(StepTranslate)`——`run.go` 的執行迴圈本身不對每個 step 做 per-step gating，`--from-step` resume 完全靠每個 step method 自己在開頭檢查，這是既有一致模式（見 `write.go:29`、`ralph.go:34`、`credits.go:36`），translate 沒有理由是例外。

**Note（en sidecar 的 frontmatter 安全網範圍，已採納）**：D3 的第 2 層（ralph normaliser 對 `source` 做確定性重新序列化）只作用在 zh-tw 的 `s.ActiveFilename`——`translate` 在 ralph 之後才跑（因為要等 `RalphPassed` 才知道要不要翻），所以新產生的 en sidecar 的 `source:` 欄位不會經過這層重新序列化。en sidecar 的安全網只有 D3 第 3 層（`validate-posts.mjs` 真 YAML 解析，在 deploy 流程裡）——意思是 en 檔案若有不安全引號會讓 deploy 失敗（fail closed），而不是像 zh-tw 版那樣被自動修正。這個行為可接受（deploy 本來就該在無效 YAML 時失敗），但設計上不是「ralph 是進 posts dir 前最後一道 normalizer」的無例外陳述——en 檔案繞過了這一關，只被最後一道 validate 擋。

### D3：YAML 安全序列化——不換 frontmatter.go 的契約，換掉不安全的引號函式 + 加一層確定性重新序列化 + validate-posts 真解析

**為什麼不換 `frontmatter.go` 的契約**：package doc 明講設計目標是 byte-stable、O(frontmatter-length)、不做全量 YAML round-trip；既有測試（`TestParse_RoundTripByteStable`、`TestRoundTrip_RealPost`、`TestSetScalar_ReplaceExisting/AppendMissing`）鎖住這個保證。既有 caller（`deploy.go` 的 `SetScalar("ticketId", `"`+ticketID+`"`)`、`credits.go`/`ralph.go` 透過 `quoted()` 的 `SetNestedScalar`）都是「呼叫方自己先加引號、`SetScalar` 逐字寫入」的契約，換成真序列化器會破壞這個契約與上述測試。

三層修復，各自獨立、風險遞增可控：

1. **修 `quoted()` 本身**：`internal/pipeline/credits.go` 的 `quoted()` 目前只包一層雙引號、不跳脫內嵌 `"`/`\`。搬到 `internal/frontmatter` package，變成 exported `frontmatter.QuoteScalar(s string) string`，正確跳脫（`\` → `\\`、`"` → `\"`），`credits.go`/`ralph.go` 既有呼叫點原地替換成 `frontmatter.QuoteScalar`。這是 2-3 行邏輯改動 + 搬家，byte-for-byte 相容既有無特殊字元的輸入。
2. **ralph normaliser 新增一段確定性重新序列化 `source` 欄位**：`normalizeRalphFrontmatter`（`ralph.go`）目前只碰 `translatedBy.*` 和 `pipeline` block；新增一步讀出現有 `source:` 的值（用 `f.GetScalar("source")`，剝掉既有引號取得裸字串)，再用 `frontmatter.QuoteScalar` 重新寫回。這一步保證**無論 LLM 在 write 階段選了什麼引號策略**（沒引號、單引號、雙引號但沒跳脫），最終進 posts dir 的檔案都會被 ralph 這關重新序列化成保證合法的 YAML——時機點正確（write/review/refine 都在 ralph 之前跑完，ralph 是進 posts dir 前的最後一道 frontmatter normalizer）。
3. **`validate-posts.mjs` 換成真 YAML 解析**：`scripts/validate-posts.mjs` 的 `parseFrontmatter()` 目前是手刻 regex（`kv.match(/^(\w[\w.]*?):\s*(.+)/)` 等）。repo 已經在多處（`scripts/dedup-gate.mjs`、`scripts/score-floor-check.mjs` 等）用 `yaml` npm 套件（`package.json` 既有 dependency，非新增）。把 `parseFrontmatter` 換成 `yaml.parse()`，無效 YAML 直接拋出並被 validator 標記為失敗——這是 defense-in-depth：就算未來有其他欄位（不只 `source`）被自由文字污染，也會在 `validate-posts.mjs`（deploy 流程與 CI 都會跑）擋下，不會漏到 `pnpm run build`。**這一步 SHALL 保留現有 `parseFrontmatter` 的回傳型別契約**（scalar 一律字串、`tags` 是字串陣列）——現有實作是「先 regex 抓出來、再手動剝引號」，回傳的永遠是字串；`yaml.parse()` 原生會把未加引號的日期解成 JS `Date`、數字解成 number，直接吃原始回傳會靜默改變下游 ~19 條規則（`DATE_PATTERN.test(fm.originalDate)`、`URL_PATTERN.test(fm.sourceUrl)` 等）的行為。實作在 `yaml.parse()` 之後加一層淺層 coercion，確保「怎麼讀」換了但「讀出什麼型別」不變。

**風險**：`yaml.parse()` 對現有 1150+ 篇文章的 frontmatter 必須全部能解析成功，否則會製造大量新的 false-positive 失敗。實作時 MUST 先跑一次 `yaml.parse()` 掃過所有既有 posts（不改任何檔案，純驗證），確認零解析錯誤，才能把它接進 blocking path；若發現既有檔案解析失敗，先修那些檔案（machine-detectable、atomic commit）或retreat 到「新檔案才強制、既有檔案 warn-only」的縮小範圍，並在 tasks.md 記錄實際結果。

## Risks / Trade-offs

- **D1**：三個必填 flag 對「已經很清楚自己在幹嘛」的 operator 增加一點點打字量；換來的是不可能再產生格式錯誤檔名。可接受。
- **D2**：`run` pipeline 多一次 LLM 呼叫（僅在 tribunal 過分數時），成本增加但這正是 CONTRIBUTING SOP 原本就預期的行為，只是之前沒被自動化。
- **D3**：`validate-posts.mjs` 換真解析器是三項裡風險最高的一步（可能對既有 1150+ 篇文章暴露之前規則沒抓到的格式問題）——tasks.md 把「先跑一次非阻斷掃描」列為獨立、優先的驗證任務，避免這步驟意外讓大量既有文章卡進 blocking gate。

## Migration Plan

無資料遷移。三項都是新增驗證/新增步驟/替換內部 helper，對既有已發佈文章的 frontmatter 內容零改動（`validate-posts.mjs` 換解析器只影響「怎麼讀」，不改「寫了什麼」）。

## Open Questions

無——三個對抗式 reviewer 的建議已經收斂進上述決策，沒有需要 escalate 給 ShroomDog 的設計分歧。
