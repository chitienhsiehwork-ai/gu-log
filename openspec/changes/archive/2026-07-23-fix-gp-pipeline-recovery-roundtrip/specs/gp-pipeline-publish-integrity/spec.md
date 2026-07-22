## MODIFIED Requirements

### Requirement: frontmatter 自由文字純量 SHALL 永遠序列化成合法 YAML

不論上游 LLM writer 第一次寫稿時選了什麼引號策略，`source` frontmatter 純量 SHALL
在檔案落地 `src/content/posts/` 前（`ralph` frontmatter normalization 這一關）先以 YAML
解析器解碼成語意字串，再由完整 YAML 純量編碼器確定性地重新序列化。

對現有行導向 `source:` 路徑可讀取的合法單一實體行字串純量（包含跳脫引號、反斜線、
Unicode、冒號、井字號，以及以 escape 表示的換行、定位與控制字元），解析、序列化、
再次解析後的語意值 SHALL 與原值完全相同，且 SHALL NOT 重複跳脫。block scalar 與跨
實體行 quoted scalar 不在此 requirement 的支援語法內。若完整編碼器無法序列化語意
字串，pipeline SHALL fail closed，不得退回只處理部分字元的手刻引號函式。
`scripts/validate-posts.mjs` SHALL 繼續使用真 YAML 解析器，讓任何欄位的無效 YAML 在
validate 階段被擋下。

#### Scenario: 帶撇號的 source label 最終落地合法 YAML

- **WHEN** write 步驟的 LLM 輸出裡 `source:` 的值（例如 `Simon Willison's Weblog`）用了不安全或缺漏的引號
- **THEN** 經過 `ralph` 步驟後，該檔案的 `source:` 那一行 SHALL 是合法 YAML（可被無錯解析）
- **AND** 對該檔案跑 `node scripts/validate-posts.mjs` SHALL NOT 因無效 YAML 而拒絕它

#### Scenario: validate-posts 能抓到真正無效的 YAML

- **WHEN** 某個 frontmatter 欄位含有未跳脫、無效的 YAML（例如未終止的 quoted scalar）
- **THEN** `node scripts/validate-posts.mjs` SHALL 失敗，錯誤訊息 SHALL 指出該檔案
- **AND** 這個失敗 SHALL 發生在 deploy 步驟呼叫 `pnpm run build` 之前

#### Scenario: 既有文章庫不受影響

- **WHEN** `scripts/validate-posts.mjs` 使用真 YAML 解析器解析 frontmatter
- **THEN** 每一篇既有已發佈文章的 frontmatter SHALL 依然能被成功解析

#### Scenario: 合法跳脫引號與反斜線保持語意

- **GIVEN** `source` 是含跳脫引號與反斜線的合法 YAML 純量
- **WHEN** ralph 正規化器解析、重新序列化，再次解析輸出
- **THEN** 第二次解析的語意值 SHALL 等於第一次解析的值
- **AND** 輸出 SHALL NOT 把跳脫標記保留成額外資料字元

#### Scenario: Unicode、冒號與井字號保持語意

- **GIVEN** `source` 語意值含 Unicode、冒號或井字號
- **WHEN** 引號輔助函式序列化後由 YAML 解析器讀回
- **THEN** 解碼值 SHALL 與原語意值完全相同

#### Scenario: 換行、定位與控制字元以合法跳脫表示

- **GIVEN** `source` 語意值含實際換行、定位或控制字元
- **WHEN** 引號輔助函式序列化該值
- **THEN** 輸出 SHALL 是單一合法 YAML 字串純量
- **AND** YAML 解析器讀回的值 SHALL 與原語意值完全相同

#### Scenario: 多行 YAML 語法維持在行導向 getter 邊界外

- **GIVEN** `source` 使用 block scalar 或跨實體行 quoted scalar 語法
- **WHEN** 行導向 frontmatter getter 讀取欄位
- **THEN** 此 change SHALL NOT 宣稱能正規化該語法
- **AND** 完整 frontmatter validator 仍 SHALL 依真 YAML parser 判斷整份文件是否合法

#### Scenario: 無效 writer 純量維持受限補救

- **GIVEN** writer 產生解析器無法接受的 `source` 純量
- **WHEN** ralph 正規化器執行
- **THEN** 既有有限度的 delimiter recovery MAY 處理常見錯誤引號
- **AND** 補救出的語意字串仍 SHALL 交給完整 YAML 純量編碼器寫回

### Requirement: 補救成功 JSON SHALL 回報實際寫出的英文產物

`gp-pipeline run --json` 成功時，若 pipeline 已產生英文對應檔，`enFilename` SHALL 回報
`PostsDir` 內實際存在之 regular file 的 basename。正式發佈檔案存在時 SHALL 優先回報
正式名稱；尚未產生正式檔案但翻譯步驟已寫出暫用檔案時 SHALL 回報暫用 basename。只有
未產生英文產物時才可省略欄位。

#### Scenario: 既有正式文章缺英文檔時執行翻譯補救

- **GIVEN** 既有中文正式文章尚無標準 `en-` 對應檔
- **WHEN** `run --from-step translate --file <existing>.mdx --json` 成功寫出英文檔
- **THEN** 報告的 `enFilename` SHALL 等於實際寫出的檔案 basename
- **AND** SHALL NOT 因 `State.ENFilename` 尚空而省略欄位

#### Scenario: 預填暫用名稱但未寫檔時不得回報

- **GIVEN** `RalphPassed=false`，且 `ActiveENFilename` 已預填但對應檔案不存在
- **WHEN** `run --dry-run --json` 成功結束
- **THEN** 報告 SHALL 省略 `enFilename`
- **AND** SHALL NOT 把預定名稱冒充為實際產物

#### Scenario: 正式發佈檔名優先於暫用名稱

- **GIVEN** pipeline 狀態同時有暫用英文檔名與正式發佈英文檔名
- **WHEN** `run --json` 組裝成功報告
- **THEN** `enFilename` SHALL 回報正式發佈檔名

#### Scenario: 沒有英文產物時省略欄位

- **GIVEN** pipeline 未寫出英文對應檔，且沒有正式英文檔名
- **WHEN** `run --json` 組裝成功報告
- **THEN** 報告 SHALL 依 `omitempty` 省略 `enFilename`
