## 1. 資料契約與策展解析

- [x] 1.1 在 post schema 新增預設為 `false` 的 optional `unlisted` 布林欄位，並補 schema regression test
- [x] 1.2 建立唯一的有序策展 ticketId 清單，初始順序為 `GP-127`、`GP-101`、`GP-110`，並驗證不得重複
- [x] 1.3 實作雙語策展 resolver，集中處理 published、現有首頁 eligibility（含 grandfathered）、unlisted 繼承、缺翻譯與 safe-skip 規則
- [x] 1.4 補齊 resolver 單元測試，覆蓋雙語順序、retired、deprecated、unlisted、below-bar、grandfathered、缺語言版本與重複設定

## 2. 真實首頁呈現

- [x] 2.1 建立共用 `ShroomDogChoice` Astro component，以單一 11px 外框、hairline 與 responsive spacing 呈現首選及兩篇延伸選文
- [x] 2.2 加入繁中與英文文案，不顯示 `SD` 圓章，並讓文章標題連結具有可辨識的 hover／focus 狀態
- [x] 2.3 將 resolver 與 component 接到繁中、英文首頁的 Gu-log Picks 之前
- [x] 2.4 移除 discussion-only 靜態 layout artifact，讓 Vercel branch root 成為唯一 preview surface

## 3. 驗證與交付

- [x] 3.1 執行 targeted unit／component tests、Astro check 與 production build
- [x] 3.2 以 390×844 的 dark／light 真實首頁截圖驗證 a11y、contrast、theme parity 與無水平溢位
- [x] 3.3 完成獨立 correctness、simplicity 與 UI/UX review，修正 blocker 後重新驗證
- [ ] 3.4 確認 Vercel branch `/` 與 `/en/` deployment READY 並完成 preview smoke test
