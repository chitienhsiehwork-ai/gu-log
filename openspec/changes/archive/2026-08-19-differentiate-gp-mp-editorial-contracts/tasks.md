## 1. Contract 與派生文件

- [x] 1.1 更新 `CONTRIBUTING.md` 與 `GU-LOG_WRITER_PROMPT.md`：GP 是由來源作者擁有聲音的忠實翻譯；MP 是由 Mogu 撰寫、以來源為根據，並遵守 claim closure 的文章。
- [x] 1.2 更新 gp-pipeline、Mogu Picks、X source intake 與 agent 文件，不再把 MP 稱為翻譯或要求完整覆蓋來源。
- [x] 1.3 收掉已被取代的 `add-editorial-spine-rebuild` active change，不把尚未實作的三模式 capability 同步進 stable specs。

## 2. 生成與編輯審查 contract

- [x] 2.1 讓 MP 的 `write`、`review`、`refine` prompt 能辨識系列；允許選材與重建結構，同時禁止遺失 controlling caveat、錯誤歸因、挪用來源經歷或杜撰可信的人類假履歷。
- [x] 2.2 更新 prompt data 與 call sites，讓 review／refine template 收到 series prefix，且不改變 GP、SD 或 Lv routing。
- [x] 2.3 將 Fact Checker 與 Librarian 判準拆成 GP translation fidelity 和 MP grounding／attribution，並同步 Claude、Codex agent 定義。
- [x] 2.4 更新 Tribunal Writer 與 Vibe scoring 指引，允許 MP 把 Mogu 分析留在 body，且不因省略或重排來源而扣分。
- [x] 2.5 讓 MP 的 MoguNote 維持選配；完整 MP 不得只因缺少 note 而被 prompt 或 scoring 判 fail、降級或強迫補寫。

## 3. 讀者可見 identity

- [x] 3.1 更新 zh-TW／English 首頁與 Mogu Picks 系列頁文案，把 MP 描述為 Mogu 消化來源材料後寫出的文章。
- [x] 3.2 更新 zh-TW／English 文章來源標示：GP 保留翻譯用語；MP 改用來源材料用語。
- [x] 3.3 更新 technical details，在不改 content schema 的前提下區分 GP translation、MP source-grounded writing 與 SD／Lv writing。

## 4. 驗證

- [x] 4.1 新增 prompt contract tests，證明 GP 保留 translation fidelity；MP 可選材／重建，但必須保留 claim closure、正確歸因與事實 grounding。
- [x] 4.2 新增無 MoguNote 的 MP acceptance fixture，證明完整文章不會只因缺少 note 而 fail 或被強迫補寫。
- [x] 4.3 新增 pipeline regression tests，證明 MP 繼續使用既有 non-GP flow，GP 繼續使用 source-preservation。
- [x] 4.4 新增雙語 UI tests，證明 MP 不再顯示翻譯標示，且 GP 標示不變。
- [x] 4.5 執行 strict OpenSpec validation、focused tests、相關 full repository checks 與 deterministic MP prompt／routing fixtures；由 correctness reviewer 對無法做 deterministic semantic verdict 的 scenarios 做 Tier-2 binary 對帳。所有 checks 通過；同步 `origin/main` 的 theme-toggle 修正後，`pnpm spec:ownership` 回報 18 個 blocking、27 個 nightly、0 個 quarantined specs。
- [x] 4.6 完成兩種 theme 的 reader-visible UI QA，並記錄適用證據。

## 5. Debrief 拍板後的 contract 收斂

- [x] 5.1 更新 MP contract：允許貼近來源翻譯／改寫或自由重建，不設最低改寫幅度，也不新增子模式或 GP fidelity 承諾。
- [x] 5.2 更新 writer／reviewer／judge：不得只因 MP 太接近或太遠離來源而扣分，仍須檢查 claim closure、歸因與可查證性。
- [x] 5.3 收窄 MoguNote 第一人稱經驗邊界：允許實際發生的 editorial／tool interaction 與明顯奇幻 persona；阻止挪用來源作者經歷及看似真實的人類假履歷。
- [x] 5.4 新增 deterministic contract／semantic fixtures，並完成 scenario-to-tier 對帳。
- [x] 5.5 執行 strict OpenSpec validation、focused／full checks、correctness review 與 simplify review，確認 change 已可 archive。
