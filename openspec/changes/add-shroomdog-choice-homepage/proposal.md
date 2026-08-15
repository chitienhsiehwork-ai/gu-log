## Why

首頁目前沒有一個能清楚表達 ShroomDog 親自背書、人工排序的長期策展入口；只做討論用靜態 mock 也無法驗證它和真實首頁內容、雙語資料與主題樣式是否協調。這次直接把策展區做進實際首頁，讓 branch preview 成為產品決策與驗收的共同介面。

## What Changes

- 在繁中與英文首頁最前方加入 `ShroomDog’s Choice` 策展區，以較俐落的圓角矩形、單層內容階層呈現一篇主廚首選與兩篇延伸選文，不使用會和 `ShroomDog Original` ticket 前綴混淆的 `SD` 圓章。
- 以單一有序 ticketId 清單管理雙語策展內容；首頁依目前語言解析同一批文章，保留人工排序，不自動補入其他文章。
- 策展文章必須符合首頁品質門檻、有效狀態為 `published`，且未標記為 `unlisted`；缺少翻譯或不合資格時安全略過。
- 在文章 frontmatter schema 加入可選的 `unlisted` 布林欄位，預設為 `false`，並讓英文 sidecar 繼承繁中主文的隱藏判斷。
- 用真實首頁的 Vercel branch preview 取代討論用 HTML artifact，並補齊 resolver、schema、雙語、a11y、主題與 viewport 回歸驗證。

## Capabilities

### New Capabilities

- `shroomdog-choice-homepage`: 定義首頁人工策展的排序、雙語解析、資格門檻、文案承諾與呈現位置。

### Modified Capabilities

- `extended-post-frontmatter`: 新增可選的 `unlisted` frontmatter 欄位，供人工策展等公開入口排除不應被列出的文章。

## Impact

- 影響文章 schema、首頁文章選取 helper、策展設定、繁中／英文首頁、共用首頁元件與相關測試。
- 移除 branch 上的靜態討論 artifact；不新增 route、外部 API 或 runtime dependency。
