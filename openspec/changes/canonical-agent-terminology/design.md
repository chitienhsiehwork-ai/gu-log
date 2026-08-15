## Context

`src/data/glossary.json` 已經是術語、anchor 與自動連結的資料來源，但只能描述「哪些字要連結」，不能描述「哪些舊譯名不准再出現」。因此 writer 可以在 glossary 已有 `Agent` 的情況下，仍把它翻成「代理人」，而既有 hard gate 完全看不見。

## Goals / Non-Goals

**Goals:**

- 讓每個 glossary entry 自己宣告 zh-tw 禁用詞，canonical term 與禁用譯名住在同一份資料。
- 讓 `Agent` 與 `Proxy` 各自有可連結、可重用的 glossary 定義，不再靠含糊中文混成同一個概念。
- 沿用既有 glossary checker、changed-term ratchet 與全站 hard gate，不增加另一套平行 validator。
- 阻擋讀者看得到的禁用詞，同時避免掃到程式碼、URL 或 MDX 語法。
- 把目前 5 篇文章的 21 處「代理人」清成 0，並保留雙關與 `meat proxy` 的原意。

**Non-Goals:**

- 不把英文普通名詞 `agent` 一律改成大寫；專名、英文引文與程式碼維持原文。
- 不讓 fixer 猜測如何改寫禁用詞；checker 只回報 canonical term，由 writer 決定自然句子。
- 不建立全站通用敏感詞或 style blocklist。

## Decisions

### Canonical terminology 住在 glossary entry

在 entry 增加 optional `forbiddenZhTw` array。`term` 本身就是 canonical display term，因此不再另外加 `preferredTerm`，避免兩個欄位互相矛盾。

相較於把「代理人」硬寫進 prompt 或 checker，資料驅動設定可讓未來其他真正需要固定譯名的 glossary term 使用同一個機制，也讓 changed-term CI 自動重掃全站。

### 由既有 glossary checker 負責 fail closed

`check-glossary-links.mjs` 會在 zh-tw post 的 reader-visible text 掃描 `forbiddenZhTw`。違規訊息包含檔案、行號、禁用詞、canonical term 與 glossary URL。英文文章不套用 zh-tw 禁用詞。

掃描器忽略 fenced code、inline code、URL、link destination、import/export 與 MDX/HTML tags/attributes；frontmatter 中讀者會看到的 title、summary、tags 仍納入。既有 `glossary-ignore` 只略過 link coverage，不得繞過 canonical terminology。

### Prompt 只講通用規則，具體詞由資料提供

GP source translation 的 glossary context 會同時提供 canonical term 與禁用譯名；writer prompt 只保留「遵守 glossary canonical terminology」這條耐久原則，不複製 `Agent`／「代理人」對照表。

### 歷史內容一次遷移

所有中文 post 一次清除「代理人」。AI agent 語意改為 `Agent`，每篇第一次安全出現由既有 fixer 連 glossary。新增 `Proxy` entry，定義網路 proxy 與比喻用法共通的「居中代為收送／轉發」角色；`agency` 雙關改成直接解釋英文詞源，`meat proxy` 改成「肉身 Proxy／轉發器」並連到新 entry，不假裝它是 AI agent。

## Risks / Trade-offs

- [禁用詞可能在特殊原文引句中是必要字面內容] → 程式碼與 URL 已排除；真正不可改的 prose 可透過改寫上下文保留意思，但不提供常態 escape hatch，以免規則失效。
- [一次改 5 篇舊文可能碰到翻譯語氣] → AI agent 處只做術語正規化；兩個非 AI agent 例子逐段人工改寫並跑內容 gate。
- [glossary checker 職責變寬] → canonical terminology 與 link coverage 共用同一 entry、同一 safe-text scanner、同一 CI ratchet，比分裂新 script 更容易維護。
