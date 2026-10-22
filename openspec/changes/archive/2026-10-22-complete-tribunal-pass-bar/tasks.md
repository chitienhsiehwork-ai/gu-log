## 1. Spec

- [x] 1.1 新增 Librarian、Fact Checker 的 pass bar 要求，數值照現在的 code 與評分標準。
- [x] 1.2 新增「四位評審都過才算 PASS」的要求，含 runner gate 與網站判定要一致。

## 2. 測試

- [x] 2.1 新增 `tests/tribunal-pass-bar-parity.test.ts`：同一批 case 餵給 `tribunal.sh` 的 `check_pass_bar` 與 `meetsPublishBar`，結果都要等於本 spec；確認 `STAGES` 剛好是四位評審。

## 3. 文件

- [x] 3.1 `scripts/vibe-scoring-standard.md` 與 `CONTRIBUTING.md` 的 pass bar 改指本 spec；`tribunal.sh` 的 `check_pass_bar` 註解改指本 spec。

## 4. Archive

- [x] 4.1 把 delta 同步進 `openspec/specs/tribunal-scoring-dimensions/`，change 移到 archive；同一個 PR 一起 commit。
