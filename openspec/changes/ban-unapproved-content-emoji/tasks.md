## 1. Emoji 確定性規則

- [x] 1.1 先新增 Vitest 回歸測試，涵蓋新文章表情圖示、修改既有表情圖示行、未修改的歷史內容、MoguNote／component props／圖片替代文字／code block、MDX import 與註解排除、`(๑•̀ㅂ•́)و✧`／`(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧` 顏文字、Unicode 旗幟／按鍵／ZWJ，以及精確例外清單。
- [x] 1.2 鎖住例外清單的負向案例：同字形複製到另一行、改動已核准行、超出 count、stale line hash、同檔不同字形、不同檔相同字形、缺少或無法解析 `approvalRef` 都必須失敗。
- [x] 1.3 建立 shared reader-surface library，匯出可見 frontmatter／MDX line records 與 source line mapping；讓 reader revision manifest 共用解析 primitives，並以 freshness test 證明現有 hash bytes 不變。
- [x] 1.4 實作 `scripts/check-content-emoji.mjs` 與 `quality/content-emoji-allowlist.json`，重用 shared reader-surface library，讓 staged／PR-base 模式共用偵測器、顏文字邊界、遇錯即停的 diff 處理與例外清單驗證。
- [x] 1.5 把 validator 接進 `scripts/hooks/pre-commit` 與 `.github/workflows/ci.yml`，並以測試鎖住兩邊確實呼叫同一支可執行 SSOT。

## 2. Editorial 與 GP contract

- [x] 2.1 更新 `GU-LOG_WRITER_PROMPT.md`、`CONTRIBUTING.md`、`scripts/en-translation-guide.md` 與 `docs/shroomdog-editorial-feedback.md`，寫明讀者可見內容預設禁用 emoji、保留 kaomoji 與例外授權邊界。
- [x] 2.2 更新 GP 來源翻譯者、來源審查者與英文 sidecar prompts，讓裝飾性表情圖示在譯文封存前省略、語意性表情圖示以自然文字保留。
- [x] 2.3 只 bump GP 來源翻譯者與來源審查者的 prompt contract versions，並更新 prompt／設定檔測試，確保舊 manifest 因執行角色設定指紋改變而失效；英文 sidecar 另以 prompt rendering test 鎖住。

## 3. GP-274 最小修正

- [x] 3.1 只移除 GP-274 繁中與英文結尾的未授權愛心，不改其他正文、links 或 scores。
- [x] 3.2 重新產生 reader revision／post version manifests，確認文章投影的差異只包含使用者授權的表情圖示移除。

## 4. 驗證

- [x] 4.1 跑 emoji 規則測試、完整 Vitest、GP pipeline Go tests、文章驗證、lint、format check 與 production build。
- [ ] 4.2 逐條對帳 OpenSpec scenarios，完成正確性審查與 Keep／Simplify／Drop 簡化審查，修正所有 blocking findings。
