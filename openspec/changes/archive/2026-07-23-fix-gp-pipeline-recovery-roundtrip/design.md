# Design: gp-pipeline 補救流程的語意往返完整性

## Current behavior

`runRun` 組裝 JSON 報告時直接讀 `s.ENFilename`。正常發佈成功後，這個欄位有正式名稱；
但補救翻譯流程（尤其 `--dry-run` 或發佈前的成功產物）把英文檔名記在
`s.ActiveENFilename`，報告因此可能省略 `enFilename`。反過來說，ralph 也可能在翻譯
真正寫檔前預填這個欄位；它是候選名稱，不足以單獨證明產物存在。

`normalizeRalphFrontmatter` 已用 `yaml.v3` 將合法原始純量解碼成語意字串，再呼叫
`frontmatter.QuoteScalar`。後者只取代 `\\` 與 `\"`，所以語意字串內的實際換行、定位或
控制字元會原樣塞進雙引號，破壞 YAML 或改變往返語意。

## Decisions

### D1: 只從磁碟上實際存在的英文產物選擇檔名

新增一個實際產物選擇函式給 `runReport.ENFilename`：

1. 依序檢查 `s.ENFilename` 與 `s.ActiveENFilename`；
2. 候選名稱必須對應 `PostsDir` 內實際存在的 regular file 才能回報；
3. 正式發佈檔名存在時仍優先，否則才使用暫用檔名；
4. 沒有任何實際產物時保留 `omitempty` 行為。

這不新增第二個 JSON 欄位，也不改變正常發佈成功的既有輸出。它同時避免
`RalphPassed=false`、名稱已預填、`--dry-run` 成功時回報不存在的檔案。

### D2: 把引號序列化交給 yaml.v3

`QuoteScalar` 仍接受 Go 語意字串，也仍回傳可直接交給行導向 setter 的純量文字；內部
改用 repo 已依賴的 `go.yaml.in/yaml/v3` 建立字串純量節點，強制雙引號形式，再取得編碼
輸出。編碼器負責引號、反斜線、Unicode、換行、定位與控制字元的完整跳脫。

若完整編碼器回報錯誤，呼叫路徑 SHALL fail closed，不得退回已知不完整的手刻編碼器
並寫出不實 YAML；具體錯誤傳遞方式由實作依現有 API 邊界決定。

### D3: 測語意，不把合法輸出鎖成單一位元組形式

支援範圍限於現有行導向 parser 能取得的單一實體行 `source:` 字串純量；其解碼後語意
可以包含換行、定位與控制字元。block scalar 與跨實體行 quoted scalar 不在此 change
範圍。既有少數標準位元組斷言可以保留，主要新增表格測試：每個語意輸入先交給
`QuoteScalar`，再用 yaml.v3 解析，斷言解碼值與原值完全相同。Ralph 整合測試則從完整
MDX 取出正規化後的 `source` 再解析，避免把編碼器的合法樣式選擇誤鎖成唯一表示法。

## Test strategy

- `cmd/gp-pipeline`：從 command-level 實際執行
  `run --from-step translate --file <existing>.mdx --json`，同時驗 stdout JSON 的
  `enFilename` 與磁碟上的英文檔。另覆蓋正式檔名優先，以及沒有實際檔案時省略欄位。
- `cmd/gp-pipeline`：覆蓋 `RalphPassed=false`、`ActiveENFilename` 已預填、`--dry-run`
  成功的路徑，確認不存在的英文檔不會被回報。
- `internal/frontmatter`：表格覆蓋空字串、跳脫引號、反斜線、Unicode、冒號、井字號、
  換行、定位、C0 控制字元與字面包圍引號；每筆都驗語意往返。
- `internal/pipeline`：完整 `source:` 解析、正規化、再解析表格，確認合法單雙引號輸入
  不會重複跳脫；另保留無效 writer 純量的有限度補救回歸。
- `internal/frontmatter`：以邊界測試明確固定 block scalar 與跨實體行輸入仍不屬於
  行導向 getter 的支援語法。

## Compatibility and rollout

這是向下相容的 bug fix。JSON 使用者原本拿不到 `enFilename` 的成功情境會開始拿到真實
值，既有值不改名。YAML 在檔案內的引號樣式 MAY 改變，但解析結果不變。不需要文章庫
遷移；現有文章只在下一次正規化器觸碰時採用新編碼。
