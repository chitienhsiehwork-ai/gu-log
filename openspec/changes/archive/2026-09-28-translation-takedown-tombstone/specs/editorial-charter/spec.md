## ADDED Requirements

### Requirement: GP 整篇翻譯 MUST 先取得來源作者同意才可公開

GP 是來源文章的整篇翻譯，屬於改作。GP 翻譯 SHALL 只在取得來源作者對整篇翻譯的同意之後公開。沒有同意紀錄的既有 GP 翻譯 SHALL 依 `post-takedown` 下架成墓碑頁。

在後續的導讀新格式 change 重新定義 GP 之前，GP SHALL 暫停收新文：pre-commit 與 CI SHALL 擋下任何新增的 GP 文章（含 `GP-PENDING`），GP 系列頁與首頁的 GP 區塊 SHALL 顯示改版空狀態，不列出任何文章。自寫示範文 GP-1 不是第三方文章的翻譯，SHALL NOT 被下架，但暫停期間不列在 GP 系列頁與首頁。

本要求 SHALL NOT 改寫 GP 的系列身份定義，也 SHALL NOT 限制 MP、SD 或 Lv 的寫作與發布。

#### Scenario: 新 GP 草稿

- **WHEN** 一個變更新增 `GP-PENDING` 或 `GP-N` 文章
- **THEN** pre-commit 與 CI SHALL 失敗
- **AND** 診斷 SHALL 指出 GP 需要來源作者同意、目前暫停收新文

#### Scenario: 既有 GP 翻譯沒有同意紀錄

- **WHEN** 一篇既有 GP 翻譯沒有來源作者同意的紀錄
- **THEN** 它 SHALL 以墓碑頁下架

#### Scenario: 讀者開啟 GP 系列頁

- **WHEN** 讀者在 GP 暫停期間開啟 `/gu-log-picks` 或 `/en/gu-log-picks`
- **THEN** 頁面 SHALL 回 200 並顯示改版空狀態「GP 正在改版：以後這裡會是 ShroomDog 精選的導讀」或對應的英文句
- **AND** 頁面 SHALL NOT 列出任何文章或墓碑連結

#### Scenario: 其他系列不受影響

- **WHEN** 一個變更新增或修改 MP、SD 或 Lv 文章
- **THEN** 本要求 SHALL NOT 擋下該變更
