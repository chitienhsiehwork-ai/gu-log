## Why

`publish-bar-visibility` 說 PASS bar 怎麼算由 `tribunal-scoring-dimensions` 定義，但這份 spec 只寫了 Vibe 和 Fresh Eyes，缺 Librarian、Fact Checker，也沒寫「四位都過才算 PASS」（#1164 第 2 節 P1）。實際規則散在三個地方：

- production gate 是 `scripts/tribunal.sh` 的 `check_pass_bar`（內嵌 Python），逐關擋。
- 網站首頁門檻是 `src/utils/tribunal-scores.ts` 的 `meetsPublishBar`，四位評審的 AND、Librarian 與 Fact Checker 的門檻在這裡自己算一份。
- 評分標準說 `src/lib/tribunal-v2/pass-bar.ts` 是最終權威，但它只管 Vibe 和 Fresh Eyes。

改了 TS，現有測試全綠，gate 卻沒變；文件又各抄一份，已經跟表格互相矛盾。

## What Changes

- 新增三條要求：Librarian 只看 composite ≥ 8；Fact Checker 分開檢查核心三維的 composite 與 `sourceBoundary`、`commentarySeparation`；四位評審都過才算 PASS，不互相補償，缺任何一位就不算，而且 runner 的 gate 與網站判定對同一份分數要得到相同結果。
- 數值照現在的 code 與評分標準寫，不改任何門檻。
- 同一個 PR 另外的 commit：`tests/tribunal-pass-bar-parity.test.ts` 用同一批 case 同時測 `check_pass_bar` 與 `meetsPublishBar`；評分標準與 CONTRIBUTING 的 pass bar 改指本 spec。

## Capabilities

### Modified Capabilities
- `tribunal-scoring-dimensions`：補齊 Librarian、Fact Checker 的 pass bar 與「四位都過」的條件。

## Impact

- 沒有程式行為改變；`tribunal.sh` 只把 `check_pass_bar` 註解裡的 SSOT 改指本 spec。
- 測試：新增 `tests/tribunal-pass-bar-parity.test.ts`。
- 文件：`scripts/vibe-scoring-standard.md`〈Pass Bar: Code is the Rule〉與權威表、`CONTRIBUTING.md`〈品質管理：Tribunal〉。
