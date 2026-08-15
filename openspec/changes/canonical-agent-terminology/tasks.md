## 1. Glossary contract

- [x] 1.1 在 Agent glossary entry 加入 `forbiddenZhTw`、新增獨立 Proxy entry，並把 canonical terminology 提供給 GP 翻譯 context
- [x] 1.2 擴充 glossary checker，回報讀者可見的 zh-tw 禁用詞，同時忽略非 prose 語法
- [x] 1.3 補齊 body、blockquotes、frontmatter 兩種 tags 寫法、unsafe region、英文文章與 changed-term 行為的 unit 與 CLI 測試
- [x] 1.4 補齊 source translator terminology context 的 prompt render、dispatch 與 stale-fingerprint 測試
- [x] 1.5 將 canonical terminology-only diff proof 接進 pre-commit 與 PR content-gate，並測試任何額外 prose 都 fail closed

## 2. Content migration

- [x] 2.1 將 AI agent 語意的「代理人」改成 `Agent`，並確保第一次出現連到 glossary
- [x] 2.2 在不改變意思的前提下，校正 `agency` 雙關與 `meat proxy` 術語，並將後者連到 Proxy glossary
- [x] 2.3 更新 GP-273 preservation fixtures，並確認文章仍忠於原文

## 3. Verification and delivery

- [x] 3.1 執行 glossary 專項測試、完整文章驗證、相關 GP pipeline 測試與網站 build
- [x] 3.2 確認 migration 僅校正術語與 glossary link，沒有需要重跑 Tribunal 的實質內容變更
- [ ] 3.3 在 merge 前同步並 archive OpenSpec change，再驗證 preview 與 production URL
