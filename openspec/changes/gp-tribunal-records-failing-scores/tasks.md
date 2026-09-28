## 1. 兩個 Tribunal 入口

- [x] 1.1 `scripts/tribunal.sh`：GP 某一關沒過時照樣把分數寫進 frontmatter（含英文版），接著評完其餘關卡，最後以失敗結束；PASS 與 FAIL 共用同一個寫分數函式
- [x] 1.2 `pnpm tribunal:run`：GP 不在第一個沒過的 stage 結束，dupCheck 沒過也寫分數；Final Vibe 只守改寫，GP 直接略過
- [ ] 1.3 `scripts/tribunal.sh` 重跑時，已記錄 FAIL、frontmatter 分數對得上、而且正文跟評分當時相同的 GP 關卡不重評，直接算進沒過的關卡；正文改過就每一關都重評；指定只跑某一關時不跳過

## 2. 驗證

- [ ] 2.1 回歸測試：第一關與最後一關沒過時，四個評審都有跑、四個分數區塊都在（含英文版）、正文與來源距離章不變、`validate-posts` 通過；v2 另測中間的 stage 沒過時後面照跑；正文沒變時重跑不重評已記錄的 FAIL、正文改過就重評
- [x] 2.2 OpenSpec 嚴格驗證、相關 Vitest 與 Tribunal shell 測試
