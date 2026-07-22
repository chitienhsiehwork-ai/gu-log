# Design: gp-pipeline 補救流程的語意往返完整性

## Current behavior

`runRun` 組裝 JSON 報告時直接讀 `s.ENFilename`。正常發佈成功後，這個欄位有正式名稱；
但補救翻譯流程（尤其 `--dry-run` 或發佈前的成功產物）把實際英文檔記在
`s.ActiveENFilename`，報告因此可能省略 `enFilename`。

`normalizeRalphFrontmatter` 已用 `yaml.v3` 將合法原始純量解碼成語意字串，再呼叫
`frontmatter.QuoteScalar`。後者只取代 `\\` 與 `\"`，所以語意字串內的實際換行、定位或
控制字元會原樣塞進雙引號，破壞 YAML 或改變往返語意。

## Decisions

### D1: 正式檔名優先，實際暫用產物其次

新增一個小型非空值選擇函式給 `runReport.ENFilename`：

1. `s.ENFilename` 非空時使用正式發佈檔名；
2. 否則使用 `s.ActiveENFilename`，代表翻譯步驟實際寫出的英文檔；
3. 兩者皆空才保留 `omitempty` 行為。

這不新增第二個 JSON 欄位，也不改變發佈成功的既有輸出。

### D2: 把引號序列化交給 yaml.v3

`QuoteScalar` 仍接受 Go 語意字串，也仍回傳可直接交給行導向 setter 的純量文字；內部
改用 repo 已依賴的 `go.yaml.in/yaml/v3` 建立字串純量節點，強制雙引號形式，再取得編碼
輸出。編碼器負責引號、反斜線、Unicode、換行、定位與控制字元的完整跳脫。

純記憶體字串純量理論上不會序列化失敗；若 dependency 仍回報錯誤，輔助函式 SHALL
fail closed（panic），不得退回已知不完整的手刻編碼器並寫出不實 YAML。

### D3: 測語意，不把合法輸出鎖成單一位元組形式

既有少數標準位元組斷言可以保留，主要新增表格測試：每個語意輸入先交給
`QuoteScalar`，再用 yaml.v3 解析，斷言解碼值與原值完全相同。Ralph 整合測試則從完整
MDX 取出正規化後的 `source` 再解析，避免把編碼器的合法樣式選擇誤鎖成唯一表示法。

## Test strategy

- `cmd/gp-pipeline`：建立成功報告狀態，覆蓋有正式檔名、只有暫用檔名、兩者皆空三種
  狀態；JSON 往返後斷言 `enFilename`。
- `internal/frontmatter`：表格覆蓋空字串、跳脫引號、反斜線、Unicode、冒號、井字號、
  換行、定位、C0 控制字元與字面包圍引號；每筆都驗語意往返。
- `internal/pipeline`：完整 `source:` 解析、正規化、再解析表格，確認合法單雙引號輸入
  不會重複跳脫；另保留無效 writer 純量的有限度補救回歸。
- 補救整合測試：既有中文正式文章缺英文檔時，翻譯步驟實際建立標準 `en-` 檔案，
  執行報告選擇函式回報該 basename。

## Compatibility and rollout

這是向下相容的 bug fix。JSON 使用者原本拿不到 `enFilename` 的成功情境會開始拿到真實
值，既有值不改名。YAML 在檔案內的引號樣式 MAY 改變，但解析結果不變。不需要文章庫
遷移；現有文章只在下一次正規化器觸碰時採用新編碼。
