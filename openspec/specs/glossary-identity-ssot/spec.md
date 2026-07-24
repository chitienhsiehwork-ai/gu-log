# glossary-identity-ssot Specification

## Purpose

定義人物與 Mogu identity 的 glossary SSOT、alias linking 與 people-category rendering，讓同一實體在內容、連結和 UI 中維持 canonical identity。

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

### Requirement: Mogu SHALL have one canonical glossary identity

The gu-log commentary persona SHALL have exactly one enabled canonical glossary entry named `Mogu`, with stable anchors `/glossary#mogu` and `/en/glossary#mogu`. Active posts and UI SHALL NOT link the persona name to a Clawd anchor or use Clawd as an alias.

#### Scenario: Mogu appears in a post note

- **WHEN** a MoguNote renders a linked persona prefix
- **THEN** the zh-tw prefix SHALL link to `/glossary#mogu`
- **AND** the English prefix SHALL link to `/en/glossary#mogu`

#### Scenario: Retired persona anchor is introduced

- **WHEN** active content links persona prose to `/glossary#clawd` or `/en/glossary#clawd`
- **THEN** glossary validation SHALL fail
- **AND** SHALL suggest the language-appropriate Mogu anchor

#### Scenario: Duplicate persona identity or retired alias is introduced

- **WHEN** glossary data adds a second enabled Mogu persona entry or adds Clawd as an alias for the Mogu persona
- **THEN** glossary identity validation SHALL fail
- **AND** SHALL preserve exactly one canonical Mogu entry and anchor
