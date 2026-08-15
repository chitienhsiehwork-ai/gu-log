## ADDED Requirements

### Requirement: Chinese prose MUST use glossary canonical terminology

zh-tw 文章在描述 glossary 已定義的技術概念時 SHALL 使用該 entry 的 canonical `term`。Writer 與 translator SHALL NOT 以自行發明的直譯、舊譯名或 glossary 明確禁用的替代詞取代 canonical term。

Glossary terminology normalization SHALL 只改變「怎麼稱呼同一個概念」，不得藉此改變 source payload、voice、語氣或論證關係。每篇第一次安全出現的 canonical term SHALL 依 glossary link coverage contract 連到對應 anchor。

#### Scenario: AI agent keeps the canonical English term

- **WHEN** zh-tw 文章描述能使用工具並自主執行任務的 AI agent
- **AND** glossary 的 canonical term 是 `Agent`
- **THEN** 正文 SHALL 使用 `Agent`
- **AND** SHALL NOT 使用該 glossary entry 明確禁用的中文譯名

#### Scenario: terminology normalization preserves source meaning

- **WHEN** translator 把同一概念的禁用舊譯名換成 canonical term
- **THEN** 它 SHALL 保留 source 的人稱、主張、語氣與句子關係
- **AND** SHALL NOT 把術語修正擴張成自由重寫

#### Scenario: related but different concept is rewritten accurately

- **WHEN** source 使用 `proxy`、法律代表或其他並非 AI agent 的概念
- **THEN** writer SHALL 使用符合該脈絡的自然詞
- **AND** SHALL NOT 為了套用 `Agent` glossary 而把不同概念誤標成 `Agent`
- **AND** 技術中介或轉發比喻 MAY 使用獨立的 `Proxy` glossary term
