## Why

gu-log 已經把 `Agent` 收進 glossary，正文卻仍混用「代理人」，讀起來像硬翻譯，也讓同一個技術概念失去固定名字。標準用詞必須由 glossary 管理並由檢查器執行，不能只靠 writer 記得某一條 prompt。

## What Changes

- 讓 glossary entry 可以宣告中文正文不得使用的舊譯名。
- 中文文章出現禁用譯名時，glossary checker 必須報錯；英文文章、程式碼、引文與其他既有 unsafe region 不受影響。
- 將 `Agent` 設為 AI agent 的 canonical term，禁用「代理人」，並維持每篇第一次安全出現連到 `/glossary#agent`。
- 新增獨立的 `Proxy` glossary entry，說清楚它是替另一端收送、轉發或代行的中介，與能自主執行任務的 `Agent` 不同。
- 清理既有中文文章中的「代理人」；真正表示 `proxy` 或依賴英文雙關的段落改寫成不使用該詞的自然中文。
- 讓 GP 翻譯 prompt 從 glossary 讀取 canonical terminology，避免模型重新發明譯名。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `editorial-charter`: 中文正文應採用 glossary 宣告的 canonical term，不得自行換成被禁用的直譯。
- `glossary-link-coverage`: glossary checker 除了連結覆蓋，也必須依 entry 設定阻擋中文正文中的禁用譯名。

## Impact

- `src/data/glossary.json` 的 entry schema、Agent entry 與新 Proxy entry
- glossary checker、測試與 CI 既有 hard gate
- GP source-translation prompt 的 glossary context
- 目前含有「代理人」的 5 篇中文文章，以及 GP-273 的 preservation fixtures
