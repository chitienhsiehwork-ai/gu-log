## 1. Glossary contract

- [ ] 1.1 在 Agent glossary entry 加入 `forbiddenZhTw`、新增獨立 Proxy entry，並把 canonical terminology 提供給 GP 翻譯 context
- [ ] 1.2 擴充 glossary checker，回報讀者可見的 zh-tw 禁用詞，同時忽略非 prose 語法
- [ ] 1.3 補齊 body、frontmatter、unsafe region、英文文章與 changed-term 行為的 unit 與 CLI 測試

## 2. Content migration

- [ ] 2.1 將 AI agent 語意的「代理人」改成 `Agent`，並確保第一次出現連到 glossary
- [ ] 2.2 在不改變意思的前提下，重寫 `agency` 雙關與 `meat proxy` 段落，並將後者連到 Proxy glossary
- [ ] 2.3 更新 GP-273 preservation fixtures，並確認文章仍忠於原文

## 3. Verification and delivery

- [ ] 3.1 執行 glossary 專項測試、完整文章驗證、相關 GP pipeline 測試與網站 build
- [ ] 3.2 對有實質內容變更的文章執行 Tribunal，並保存必要 provenance
- [ ] 3.3 在 merge 前同步並 archive OpenSpec change，再驗證 preview 與 production URL
