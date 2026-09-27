## ADDED Requirements

### Requirement: GP 整篇翻譯 MUST 先取得來源作者同意才可公開

GP 是來源文章的整篇翻譯，屬於改作。GP SHALL 只在取得來源作者對整篇翻譯的同意之後公開。同意紀錄的格式與保存方式由後續 change 定義；在那之前，GP SHALL NOT 有任何公開文章：既有 GP SHALL 依 `post-takedown` 下架成墓碑頁，任何非 `taken-down` 狀態的 GP 文章（含 `GP-PENDING`）SHALL 被 pre-commit 與 CI 的驗證擋下。

本要求 SHALL NOT 改寫 GP 的系列身份定義，也 SHALL NOT 限制 MP、SD 或 Lv 的寫作與發布。

#### Scenario: 新 GP 草稿

- **WHEN** 一個變更新增或修改狀態不是 `taken-down` 的 `GP-PENDING` 或 `GP-N` 文章
- **THEN** pre-commit 與 CI 驗證 SHALL 失敗
- **AND** 診斷 SHALL 指出 GP 需要來源作者同意、目前暫停收新文

#### Scenario: 既有 GP 沒有同意紀錄

- **WHEN** 一篇既有 GP 沒有來源作者同意的紀錄
- **THEN** 它 SHALL 以墓碑頁下架

#### Scenario: 其他系列不受影響

- **WHEN** 一個變更新增或修改 MP、SD 或 Lv 文章
- **THEN** 本要求 SHALL NOT 擋下該變更
