# Tasks

## 1. Test-first 回歸覆蓋

- [ ] 1.1 新增執行報告測試：正式英文檔名優先；只有暫用英文檔時仍輸出 `enFilename`；兩者皆空時維持省略。
- [ ] 1.2 新增既有文章缺英文檔的翻譯補救回歸，確認實際寫出的檔名與報告選擇結果一致。
- [ ] 1.3 新增 `QuoteScalar` 語意往返表格：跳脫引號、反斜線、Unicode、冒號、井字號、換行、定位、控制字元、空字串與字面包圍引號。
- [ ] 1.4 擴充 ralph 正規化器表格，驗證合法 YAML 解析、序列化、再解析後不會重複跳脫且語意相同。

## 2. Implementation

- [ ] 2.1 讓 `runReport.ENFilename` 先讀正式檔名，缺少時退回實際暫用英文檔名。
- [ ] 2.2 以 yaml.v3 完整純量編碼器取代手刻反斜線與雙引號跳脫，維持 `QuoteScalar` 接受語意值的契約。
- [ ] 2.3 保留無效 writer 純量的既有限度補救，以及行導向 frontmatter 編輯邊界。

## 3. Verification and lifecycle

- [ ] 3.1 執行 `tools/gp-pipeline` 全套 Go 測試，以及可行範圍的 race detector。
- [ ] 3.2 執行 repo 相關 lint、型別檢查、內容驗證、build 與 pre-push gates。
- [ ] 3.3 完成正確性、安全性與簡化審查，逐條核對差異規格情境。
- [ ] 3.4 同步差異規格、封存 change，通過 OpenSpec ownership 與 archive gate 後才合併。
