# Proposal: 讓文章內圖片可以在 iPhone 雙指放大

## Why

gu-log 的文章有時候需要放一張圖，讓讀者一眼看懂文章在講什麼；像 agent 從 person / computer / chatbot / agent / workers 一路長出來的那種流程圖，小螢幕如果只能縮在正文寬度裡，資訊就變成裝飾品。讀者應該能點開圖片，像看相簿一樣用雙指放大細節。

## What Changes

- 新增文章內可放大圖片能力，供 MDX 文章插入解釋型圖表、截圖、流程圖或資訊圖。
- 圖片在正文中維持 gu-log 版面節奏；點擊後進入沉浸式檢視。
- iPhone / mobile 檢視時，放大檢視 SHALL 支援雙指縮放與拖曳。
- 保留 caption、alt text 與 accessible close controls。
- 定義圖片來源與尺寸策略，避免大圖拖慢文章載入。

## Capabilities

### New Capabilities

- `zoomable-post-images`：定義文章內圖片的插入、放大、mobile pinch zoom、caption/accessibility 與效能要求。

### Modified Capabilities

- 無。

## Impact

會影響文章 MDX 可用元件、圖片樣式、mobile 觸控互動、內容編輯 SOP，以及未來 SP/CP/SD 文章是否能自然加入解釋型圖片。

## Approval Meaning

批准這個 change 等於同意：gu-log 文章可以放 reader-helpful images，而且 mobile 讀者點開後能用雙指放大看細節。

不等於同意：每篇文章都必須配圖，或 agent 可以隨便加未授權圖片。圖片來源、授權、alt text 與 caption 仍然要照內容規則處理。
