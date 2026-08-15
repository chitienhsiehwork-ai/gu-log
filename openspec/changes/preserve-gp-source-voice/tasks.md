## 1. 回歸測試與現況鎖定

- [x] 1.1 建立 GP-273 原文、自然第一人稱翻譯與已發布改寫稿的回歸測試樣本
- [x] 1.2 新增現況測試，證明現行 pipeline 允許更換敘事者、全文修稿與 Tribunal 未通過後繼續發布
- [x] 1.3 將 `銜尾蛇`、`演算法動態` 收進自然中文硬性檢查的校準案例

## 2. GP 處理階段架構

- [x] 2.1 將 GP `write` 改為保留原文骨幹的翻譯階段，移除另定角度、重組故事與自由改寫權限
- [x] 2.2 將 glossary、gu-log 站內參照與 MoguNote 拆成正文翻譯完成後的獨立補充階段
- [x] 2.3 為補充階段加入正文保護差異檢查，確保移除補充內容後正文不變
- [x] 2.4 將翻譯者、局部修正者與語感評審拆成不同模型路由、提示詞與輸出契約，並禁止跨角色無聲替補
- [x] 2.5 新增各角色的 config key、dispatcher、profile validation、provider preflight、state、執行報告與可持久追溯資訊
- [x] 2.6 將原文翻譯階段命名為 `source-translate`，和既有英文 sidecar `translate` 明確區隔；未設定完整 GP profile 的 runtime 禁止發布 GP

## 3. Review 與 correction

- [x] 3.1 定義包含原文證據、問題類型與替換邊界的審查產物格式
- [x] 3.2 實作 hash、byte offset、exact old text、單段落與不重疊驗證的 deterministic patch applicator，禁止沒有具體問題就全文重寫
- [x] 3.3 加入作者聲音、人稱、順序、內容與自然中文硬性檢查
- [x] 3.4 讓 GP 明確不進入 `restructure`／`rebuild` 路由
- [x] 3.5 定義 gate verdict envelope、hash/provenance freshness 與 correction 後全量重跑規則

## 4. Publish gate 與文件收斂

- [x] 4.1 讓 GP 硬性檢查未通過、執行器錯誤或缺少有效結論時阻擋發布
- [x] 4.2 收斂 `GU-LOG_WRITER_PROMPT.md`、`CONTRIBUTING.md`、Tribunal 契約與 pipeline skill，移除和新規格衝突的 GP 指令
- [ ] 4.3 在 stable GP contract 與 routing 中明確排除 `restructure`／`rebuild`，並記錄它對舊 active spine change 的優先順序，不跨 change 修改其 artifacts

## 5. 驗證與切換

- [x] 5.1 執行 GP-273 回歸測試與 pipeline 契約測試
- [ ] 5.2 對一組第一人稱、技術教學、短文與原文含 AI 贅文的既有 GP 做新舊平行比較
- [ ] 5.3 完成人工手機閱讀檢查，確認新輸出保留作者聲音且沒有難解直譯詞
- [x] 5.4 切換 GP 預設路徑，並驗證失敗產物可從中斷階段恢復
- [x] 5.5 驗證 `--from-step`、`--file` 與 deploy 都不能沿用 stale 或缺漏的 gate verdict
