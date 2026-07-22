# Tasks

## 1. Test-first 回歸覆蓋

- [ ] 1.1 新增 command-level 補救測試：實際執行 `run --from-step translate --file <existing>.mdx --json`，確認 stdout `enFilename` 與磁碟上的英文檔一致。
- [ ] 1.2 新增產物選擇測試：正式英文檔名優先；只有實際暫用檔時仍輸出；名稱已預填但檔案不存在時省略。
- [ ] 1.3 新增 `RalphPassed=false` 加 `--dry-run` 成功路徑，確認預填的 `ActiveENFilename` 不會造成虛假回報。
- [ ] 1.4 新增 `QuoteScalar` 語意往返表格：跳脫引號、反斜線、Unicode、冒號、井字號、換行、定位、回車、控制字元、空字串、前後空白與字面包圍引號。
- [ ] 1.5 固定行導向 getter 的邊界：block scalar 與跨實體行 quoted scalar 不屬於本 change 支援語法。
- [ ] 1.6 擴充 ralph 正規化器表格，驗證合法單行 YAML 解析、序列化、再解析後不會重複跳脫且語意相同；無效 writer 純量仍走有限度補救。

## 2. Implementation

- [ ] 2.1 讓 `runReport.ENFilename` 只從 `PostsDir` 內實際存在的 regular file 選值，正式檔名優先、暫用檔名其次。
- [ ] 2.2 以 yaml.v3 完整純量編碼器取代手刻反斜線與雙引號跳脫，維持 `QuoteScalar` 接受語意值的契約。
- [ ] 2.3 保留無效 writer 純量的既有限度補救，以及行導向 frontmatter 編輯邊界。

## 3. Verification and lifecycle

- [ ] 3.1 執行 `tools/gp-pipeline` 全套 Go 測試，以及可行範圍的 race detector。
- [ ] 3.2 執行 repo 相關 lint、型別檢查、內容驗證、build 與 pre-push gates。
- [ ] 3.3 完成正確性、安全性與簡化審查，逐條核對差異規格情境。
- [ ] 3.4 同步差異規格、封存 change，通過 OpenSpec ownership 與 archive gate 後才合併。
