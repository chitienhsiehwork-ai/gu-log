# Proposal: gp-pipeline 補救流程的語意往返完整性

## Why

`gp-pipeline run --from-step translate --json` 在補救流程成功寫出英文對應檔、但尚未
產生正式發佈檔名時，報告只讀 `State.ENFilename`，可能省略實際已寫出的
`enFilename`。同一條發佈路徑的 `source:` 正規化器雖會先用 YAML 解析器解碼，但目前
引號輔助函式只手刻跳脫反斜線與雙引號；換行、定位字元與控制字元可能重新序列化成
無效或語意不同的 YAML。

補救結果與 frontmatter 序列化都是 agent 會依賴的契約。成功結果必須誠實回報產物；
現有行導向 `source:` 路徑能讀取的單一實體行 YAML 字串純量，也必須在解析、序列化、
再次解析後保持語意。

## What Changes

- `run --json` 成功時，只回報已驗證存在的英文檔；正式檔名優先，尚未發佈正式檔名時
  才回報翻譯步驟實際寫出的暫用檔名。
- `source:` 的語意值改由完整 YAML 純量編碼器確定性序列化，不再手刻部分跳脫。
- 對跳脫引號、反斜線、Unicode、冒號、井字號、換行、定位、控制字元與字面包圍引號
  增加語意往返表格測試。
- 以既有中文文章缺英文對應檔的 command-level 補救回歸測試，直接核對 stdout JSON 與
  磁碟產物。

## Non-goals

- 不改變 `--from-step translate` 的編號配置、commit、push 或 counter 行為。
- 不把行導向的 frontmatter 套件改寫成整份 YAML 往返編輯器。
- 不新增對 block scalar 或跨實體行 quoted scalar 語法的支援；語意值內的換行仍須由
  單一實體行純量中的合法 escape 表示。
- 不把無效 YAML 的 writer 輸出當成合法語意；既有有限度補救路徑維持不變。
- 不改變獨立 `translate`／`deploy` 指令的 JSON schema。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `gp-pipeline-publish-integrity`：補上補救 JSON 的產物真實性，以及行導向 `source:`
  路徑可讀字串純量的完整 YAML 語意往返契約。

## Impact

影響 `tools/gp-pipeline/cmd/gp-pipeline/run.go`、frontmatter 引號輔助函式、ralph
正規化回歸測試與補救指令測試。成功 JSON 只會多補原本可能遺漏的 `enFilename`；合法
純量在檔案內的引號形式可能改變，但解析後語意保持相同。

## Approval Meaning

核准此 change 代表 pipeline 成功 JSON 只能回報實際存在的英文產物，且現有行導向
`source:` 路徑可讀取的合法單行字串純量，必須經完整編碼器重新序列化後保持相同語意。
