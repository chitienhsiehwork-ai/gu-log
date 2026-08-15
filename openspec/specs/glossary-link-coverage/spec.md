# glossary-link-coverage Specification

## Purpose

定義文章 glossary link coverage 的語言路由、安全掃描區域、linking config、checker／fixer 分工與 blocking rollout，確保術語連結完整且不破壞 MDX。

## Requirements

### Requirement: Posts MUST link enabled glossary terms at least once

For each enabled glossary term that appears in a post body, the post SHALL contain at least one Markdown link from a safe occurrence of that term to the corresponding glossary anchor.

The system SHALL enforce article-level coverage, not occurrence-level coverage: one glossary link per term per post is sufficient.

#### Scenario: first safe occurrence is linked

- **WHEN** a post body contains the enabled term `Elixir`
- **AND** the post does not contain a link to `/glossary#elixir` or `/en/glossary#elixir` as appropriate for its language
- **THEN** the glossary coverage checker SHALL report a missing link violation
- **AND** the fixer SHALL be able to wrap the first safe occurrence in a Markdown link

#### Scenario: repeated occurrences do not require repeated links

- **WHEN** a post body contains `Elixir` ten times
- **AND** at least one safe occurrence links to the expected glossary anchor
- **THEN** the checker SHALL treat that term as covered for that post
- **AND** SHALL NOT require the other nine occurrences to be linked

---

### Requirement: Glossary link scanning MUST ignore unsafe regions

The glossary link scanner SHALL ignore non-prose or unsafe regions when detecting linkable occurrences.

Unsafe regions include:

- YAML frontmatter
- fenced code blocks
- inline code spans
- existing Markdown links and link targets
- raw URLs
- import/export lines
- raw MDX/HTML component tags and attributes
- blockquotes by default

#### Scenario: frontmatter term is ignored

- **WHEN** a post summary contains `Elixir` in YAML frontmatter
- **AND** the body does not contain `Elixir`
- **THEN** the checker SHALL NOT report a missing Elixir glossary link

#### Scenario: source quote term is ignored by default

- **WHEN** `Elixir` appears only inside a Markdown blockquote
- **THEN** the checker SHALL NOT require that quoted occurrence to be linked
- **AND** the fixer SHALL NOT modify the quote

#### Scenario: existing link text is not relinked

- **WHEN** a post contains `[Elixir](/glossary#elixir)`
- **THEN** the fixer SHALL NOT wrap `Elixir` again
- **AND** the checker SHALL count the term as covered

---

### Requirement: Link target MUST follow post language

The glossary link target SHALL match the post language.

For zh-tw posts, the target SHALL be `/glossary#<anchor>`. For English posts, the target SHALL be `/en/glossary#<anchor>`.

#### Scenario: zh-tw post links to zh-tw glossary

- **WHEN** a zh-tw post contains a safe `Elixir` occurrence
- **THEN** the fixer SHALL link it as `[Elixir](/glossary#elixir)`

#### Scenario: English post links to English glossary

- **WHEN** an English post contains a safe `Elixir` occurrence
- **THEN** the fixer SHALL link it as `[Elixir](/en/glossary#elixir)`

---

### Requirement: Automatic matching MUST use linking config, not all aliases

The glossary matcher SHALL use explicit `linking.match` values when present. If no `linking.match` exists, it SHALL use the canonical `term` only. It SHALL NOT automatically use every value in `aliases` as a link matcher.

#### Scenario: aliases are not automatic matches

- **WHEN** a glossary entry has alias `Power Elixir`
- **AND** `linking.match` only contains `Elixir`
- **THEN** the checker SHALL NOT require `Power Elixir` to link unless it also contains the canonical matcher `Elixir` as a configured safe match

#### Scenario: longer configured match wins

- **WHEN** `Codex app server` and `Codex` are both configured match strings
- **THEN** the scanner SHALL prefer the longer match at the same location
- **AND** SHALL NOT partially link `Codex` inside `Codex app server`

---

### Requirement: Checker and fixer MUST be separate

The system SHALL provide a checker that reports violations without changing files and a fixer that applies deterministic safe links.

#### Scenario: checker fails without modifying files

- **WHEN** a post is missing a glossary link
- **THEN** `scripts/check-glossary-links.mjs` SHALL exit non-zero
- **AND** SHALL NOT modify the post
- **AND** SHALL print the file, term, line, expected link, and suggested fixer command

#### Scenario: fixer is idempotent

- **WHEN** `scripts/apply-glossary-links.mjs --term Elixir` is run twice
- **THEN** the second run SHALL produce no additional changes
- **AND** existing glossary links SHALL remain valid Markdown

---

### Requirement: CI and pre-commit MUST enforce all three rollout phases

The implementation SHALL include all three rollout phases:

- Phase 1 changed-term / changed-post ratchet
- Phase 2 full-site report plus safe backfill support
- Phase 3 full-site hard gate in CI

#### Scenario: changed glossary term checks existing posts

- **WHEN** a PR adds or changes an enabled glossary term
- **THEN** CI SHALL check all existing posts for missing coverage of that changed term
- **AND** the PR SHALL fail until matching posts contain a glossary link or explicit ignore

#### Scenario: changed post checks enabled glossary terms

- **WHEN** a PR adds or changes a post
- **THEN** CI SHALL check that post for all enabled glossary terms
- **AND** the PR SHALL fail if any safe occurrence lacks article-level glossary coverage

#### Scenario: full-site CI gate catches historical drift

- **WHEN** any enabled glossary term appears in any post body without article-level coverage
- **THEN** `pnpm run glossary:check` SHALL fail in CI
- **AND** SHALL provide actionable output for backfill or ignore

### Requirement: Glossary entries MAY forbid non-canonical zh-tw terms

啟用中的 glossary 項目 MAY 宣告 `forbiddenZhTw` 字串清單。Glossary 檢查器 SHALL 將 zh-tw 文章裡每一處讀者可見的禁用字串回報為阻擋發布的標準用詞違規，並 SHALL 指出該項目的 canonical `term` 作為替換目標。

檢查器 SHALL 對讀者可見的 `title`、`summary`、inline 或 block-list `tags` frontmatter 欄位與正文套用此規則；Markdown blockquote 也是讀者可見正文，SHALL 納入掃描。檢查器 SHALL NOT 掃描英文文章，亦 SHALL NOT 掃描程式碼區塊、行內程式碼、URL、Markdown 連結目的地、import/export 陳述式、MDX/HTML 標籤或屬性等非正文語法。

#### Scenario: forbidden Agent translation fails

- **WHEN** `Agent` glossary 項目在 `forbiddenZhTw` 宣告一個中文譯名
- **AND** zh-tw 文章在讀者可見的正文使用該譯名
- **THEN** 檢查器 SHALL 以非零狀態結束
- **AND** SHALL 回報檔案、行號、禁用詞、標準用詞與預期 glossary anchor

#### Scenario: frontmatter is reader-visible terminology

- **WHEN** zh-tw 文章的標題、摘要或標籤含有已設定的禁用詞
- **THEN** 檢查器 SHALL 回報標準用詞違規

#### Scenario: non-prose syntax is not rewritten policy

- **WHEN** 已設定的禁用字串只出現在程式碼區塊、行內程式碼、URL、連結目的地、import/export 語法，或 MDX/HTML 標籤或屬性
- **THEN** 檢查器 SHALL NOT 回報標準用詞違規

#### Scenario: blockquote remains reader-visible prose

- **WHEN** zh-tw 文章只在 Markdown blockquote 中使用已設定的禁用詞
- **THEN** 檢查器 SHALL 回報標準用詞違規

#### Scenario: English post does not inherit zh-tw ban

- **WHEN** 英文文章含有與 `forbiddenZhTw` 相符的文字
- **THEN** 檢查器 SHALL NOT 回報標準用詞違規

#### Scenario: changed glossary entry triggers historical scan

- **WHEN** PR 在啟用中的 glossary 項目新增或修改 `forbiddenZhTw`
- **THEN** 既有 changed-term ratchet SHALL 掃描所有 zh-tw 文章是否含有該項目的禁用詞
- **AND** 全站 glossary hard gate SHALL 阻止歷史違規上線

### Requirement: Canonical terminology-only migrations MUST be mechanically provable

既有文章只因 `forbiddenZhTw` 遷移而變更時，content-quality gate MAY 略過既有文章缺少 scores 的歷史債務，但 SHALL 先以確定性 proof 證明 staged 內容只包含：禁用詞改成該 entry 的 canonical `term`、`term（禁用詞）` 合併成 canonical term，以及對 canonical term 加上 glossary link wrapper。

Pre-commit 與 PR content-gate file selection SHALL 使用同一個 proof contract。任何不屬於上述轉換的 reader-visible 文字變更 SHALL 使 proof 失敗，並 SHALL 維持既有 score、pronoun 與內容品質 gate。

#### Scenario: mechanical Agent migration does not rescore legacy prose

- **WHEN** 無 scores 的既有文章只把「代理人」改成 `Agent`，並在第一次出現加上 `/glossary#agent` link
- **THEN** canonical terminology proof SHALL 通過
- **AND** content gate SHALL NOT 因該機械式 migration 要求重跑整篇 Tribunal

#### Scenario: adjacent rewrite cannot hide behind terminology migration

- **WHEN** staged 文章除了禁用詞替換與 glossary link 之外，還改寫同一行或相鄰行的其他 prose
- **THEN** canonical terminology proof SHALL 失敗
- **AND** 文章 SHALL 繼續接受一般 score 與內容品質 gate
