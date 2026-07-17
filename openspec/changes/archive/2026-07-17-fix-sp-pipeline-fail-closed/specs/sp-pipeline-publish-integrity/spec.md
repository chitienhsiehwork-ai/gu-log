## ADDED Requirements

### Requirement: standalone deploy 缺檔名槽位 SHALL fail closed

`gp-pipeline deploy` SHALL 在 bump ticket counter、rename 任何檔案、或 commit/push 之前，驗證 `--date-stamp`（格式 `YYYYMMDD`）、`--author-slug`、`--title-slug` 三者皆非空。任一槽位缺漏或格式錯誤時，`deploy` SHALL 回傳描述性錯誤，且 SHALL NOT 修改 `scripts/article-counter.json`、rename 任何檔案、或產生 git commit。`deploy` SHALL NOT 嘗試從 pending 檔名反推這些槽位——pending 檔名格式（`<prefix>-pending-YYYYMMDD-<author>-<title>.mdx`）對 author/title 邊界本質上是 ambiguous 的，猜測式 derive 可能靜默產出格式正確但語意錯誤的檔名。

#### Scenario: standalone deploy 三個槽位全缺

- **WHEN** operator 執行 `gp-pipeline deploy --active-file sp-pending-20260717-x-y.mdx`，未帶 `--date-stamp`/`--author-slug`/`--title-slug`
- **THEN** 指令 SHALL 以非零 exit code 失敗，錯誤訊息 SHALL 指名缺少的 flag
- **AND** `scripts/article-counter.json` SHALL 維持不變
- **AND** `src/content/posts/` 下 SHALL NOT 有任何檔案被 rename 或建立

#### Scenario: standalone deploy 帶格式錯誤的 date-stamp

- **WHEN** operator 執行 `gp-pipeline deploy --active-file <pending>.mdx --date-stamp 2026-07-17 --author-slug x --title-slug y`（date-stamp 不是 `YYYYMMDD` 格式）
- **THEN** 指令 SHALL 在任何 counter bump 或檔案異動之前失敗

#### Scenario: run pipeline 不受影響

- **WHEN** 完整 `gp-pipeline run <url>` pipeline 執行到 deploy 步驟
- **THEN** deploy SHALL 一如既往成功，因為 `ralph.go` 一定會在 deploy 之前填好 `DateStamp`/`AuthorSlug`/`TitleSlug`

### Requirement: pipeline help text 與自動翻譯 SHALL 誠實一致

`gp-pipeline` 的 root help SHALL NOT 宣稱 `write` 產出 zh-tw + en MDX pair——它只產 zh-tw。SHALL 存在一個自動 `translate` 步驟，在 zh-tw 文章通過 tribunal（Ralph）之後產出 en sidecar，符合 CONTRIBUTING.md 的 zh-tw-first SOP。tribunal 未過分數時，`translate` SHALL 被跳過（記錄，非錯誤），pipeline SHALL 繼續以既有 best-effort 語意只 deploy zh-tw。

#### Scenario: run 通過 tribunal 時產出雙語

- **WHEN** `gp-pipeline run <url>` 完成 `ralph` 步驟且 `RalphPassed = true`
- **THEN** `translate` 步驟 SHALL 執行，在 `deploy` 之前於 `src/content/posts/` 產出 `en-` sidecar 檔案
- **AND** 該 en 檔案的 frontmatter SHALL 有 `lang: "en"`

#### Scenario: run 未過 tribunal 時只 deploy zh-tw

- **WHEN** `gp-pipeline run <url>` 完成 `ralph` 步驟且 `RalphPassed = false`
- **THEN** `translate` 步驟 SHALL 被跳過且不產生錯誤
- **AND** `deploy` SHALL 只以 zh-tw 檔案繼續（既有 best-effort 行為不變）

#### Scenario: standalone translate 用於補救

- **WHEN** operator 執行 `gp-pipeline translate --file <已在 src/content/posts/ 的既有 zh-tw 檔案>`
- **THEN** 指令 SHALL 用與 `write`/`refine` 相同的 writer LLM chain 產出對應的 `en-` sidecar

#### Scenario: help text 準確性

- **WHEN** operator 執行 `gp-pipeline --help`
- **THEN** `write` 那一行 SHALL NOT 宣稱產出 en MDX 檔案
- **AND** SHALL 有一行 `translate` 描述其真實行為（en sidecar，gate 在 tribunal 過分數）

### Requirement: frontmatter 自由文字 scalar SHALL 永遠序列化成合法 YAML

不論上游 LLM writer 第一次寫稿時選了什麼引號策略，`source` frontmatter scalar SHALL 在檔案落地 `src/content/posts/` 前（`ralph` frontmatter normalization 這一關）被確定性地重新序列化成合法 YAML，使用正確跳脫內嵌 `"` 與 `\` 的 quoting helper。`scripts/validate-posts.mjs` SHALL 用真 YAML parser（而非手刻 regex scanner）解析 frontmatter，讓任何欄位的無效 YAML 都在 validate 階段被擋下，不漏到 `pnpm run build`。

#### Scenario: 帶撇號的 source label 最終落地合法 YAML

- **WHEN** write 步驟的 LLM 輸出裡 `source:` 的值（例如 `Simon Willison's Weblog`）用了不安全或缺漏的引號
- **THEN** 經過 `ralph` 步驟後，該檔案的 `source:` 那一行 SHALL 是合法 YAML（可被無錯解析）
- **AND** 對該檔案跑 `node scripts/validate-posts.mjs` SHALL NOT 因無效 YAML 而拒絕它

#### Scenario: validate-posts 能抓到真正無效的 YAML

- **WHEN** 某個 frontmatter 欄位含有未跳脫、無效的 YAML（例如未終止的 quoted scalar）
- **THEN** `node scripts/validate-posts.mjs` SHALL 失敗，錯誤訊息 SHALL 指出該檔案
- **AND** 這個失敗 SHALL 發生在 deploy 步驟呼叫 `pnpm run build` 之前

#### Scenario: 既有文章庫不受影響

- **WHEN** `scripts/validate-posts.mjs` 的 frontmatter parser 換成真 YAML parser
- **THEN** 每一篇既有已發佈文章的 frontmatter SHALL 依然能被成功解析（實作前已驗證：1157 篇文章、0 個解析失敗）
