## 1. Contract 與派生文件

- [ ] 1.1 更新 `CONTRIBUTING.md` 與 `GU-LOG_WRITER_PROMPT.md`：GP 是由來源作者擁有聲音的忠實翻譯；MP 是由 Mogu 撰寫、以來源為根據，並遵守 claim closure 的文章。
- [ ] 1.2 更新 gp-pipeline、Mogu Picks、X source intake 與 agent 文件，不再把 MP 稱為翻譯或要求完整覆蓋來源。
- [ ] 1.3 收掉已被取代的 `add-editorial-spine-rebuild` active change，不把尚未實作的三模式 capability 同步進 stable specs。

## 2. 生成與編輯審查 contract

- [ ] 2.1 讓 MP 的 `write`、`review`、`refine` prompt 能辨識系列；允許選材與重建結構，同時禁止遺失 controlling caveat、錯誤歸因、捏造事實或親身經歷。
- [ ] 2.2 更新 prompt data 與 call sites，讓 review／refine template 收到 series prefix，且不改變 GP、SD 或 Lv routing。
- [ ] 2.3 將 Fact Checker 與 Librarian 判準拆成 GP translation fidelity 和 MP grounding／attribution，並同步 Claude、Codex agent 定義。
- [ ] 2.4 更新 Tribunal Writer 與 Vibe scoring 指引，允許 MP 把 Mogu 分析留在 body，且不因省略或重排來源而扣分。

## 3. 讀者可見 identity

- [ ] 3.1 更新 zh-TW／English 首頁與 Mogu Picks 系列頁文案，把 MP 描述為 Mogu 消化來源材料後寫出的文章。
- [ ] 3.2 更新 zh-TW／English 文章來源標示：GP 保留翻譯用語；MP 改用來源材料用語。
- [ ] 3.3 更新 technical details，在不改 content schema 的前提下區分 GP translation、MP source-grounded writing 與 SD／Lv writing。

## 4. 驗證

- [ ] 4.1 新增 prompt contract tests，證明 GP 保留 translation fidelity；MP 可選材／重建，但必須保留 claim closure、正確歸因與事實 grounding。
- [ ] 4.2 新增 pipeline regression tests，證明 MP 繼續使用既有 non-GP flow，GP 繼續使用 source-preservation。
- [ ] 4.3 新增雙語 UI tests，證明 MP 不再顯示翻譯標示，且 GP 標示不變。
- [ ] 4.4 執行 strict OpenSpec validation、focused tests、相關 full repository checks 與 synthetic MP acceptance fixtures。
- [ ] 4.5 完成兩種 theme 的 reader-visible UI QA，並記錄適用證據。
