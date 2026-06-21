# glossary-identity-ssot Specification

## Purpose
TBD - created by archiving change migrate-tribunal-to-codex. Update Purpose after archive.
## Requirements
### Requirement: People glossary entries SHALL 儲存在 glossary SSOT

gu-log posts 反覆提到的人物 SHALL 在 `src/data/glossary.json` 中有 `people` category、canonical term、short definition、related entries，以及 first-definition post。

#### Scenario: Andrej Karpathy 出現在新 post

- **WHEN** 一篇 post 提到 Andrej Karpathy
- **THEN** 該 post MAY link 到 glossary entry
- **AND** 除非文章需要新的 contextual angle，該 post SHALL NOT 重新完整介紹他的背景

### Requirement: Glossary aliases SHALL 支援 identity linking

Glossary entries SHALL 支援 aliases，讓 librarian tooling 能偵測常見短稱、handles、拼寫變體。

#### Scenario: Article body 使用 alias

- **WHEN** article text 使用 `Karpathy`、`SimonW` 或 `bcherny`
- **THEN** librarian tooling SHALL 能將該 alias 對應到 canonical glossary entry

### Requirement: Glossary UI SHALL 明確 render people category

Glossary page SHALL 將 `people` 作為 first-class category render，並顯示明確 label，而不是 fallback 成 raw 或 missing category text。

#### Scenario: People category exists

- **WHEN** glossary 至少有一個 entry 使用 category `people`
- **THEN** glossary page SHALL 顯示 people category filter/label
- **AND** 這些 entries SHALL 可透過 stable glossary anchors 到達

