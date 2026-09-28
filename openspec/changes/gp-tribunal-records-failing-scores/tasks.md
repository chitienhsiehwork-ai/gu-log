## 1. 兩個 Tribunal 入口

- [x] 1.1 `scripts/tribunal.sh`：GP 某一關沒過時照樣把分數寫進 frontmatter（含英文版），接著評完其餘關卡，最後以失敗結束；PASS 與 FAIL 共用同一個寫分數函式
- [x] 1.2 `pnpm tribunal:run`：GP 不在第一個沒過的 stage 結束，dupCheck 沒過也寫分數；Final Vibe 只守改寫，GP 直接略過

## 2. 驗證

- [x] 2.1 回歸測試：第一關、中間、最後一關沒過時，四個評審都有跑、四個分數區塊都在、正文與來源距離章不變、`validate-posts` 通過
- [x] 2.2 OpenSpec 嚴格驗證、相關 Vitest 與 Tribunal shell 測試
