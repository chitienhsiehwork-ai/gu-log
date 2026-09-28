## MODIFIED Requirements

### Requirement: Fixture 凍結原則

Fixture 一旦 commit 進 git，SHALL NOT 被自動化工具修改。允許的修改情境僅限：

- 人類發現 fixture 本身的 `expectedClass` 判錯 → 可修正 + commit message SHALL 以 `fix(fixture): <slug>` 開頭並說明改動原因
- 新增 fixture → 照正常新增流程
- 刪除過時 fixture（例如對應 post 已從 corpus 永久下架）→ commit message SHALL 以 `chore(fixture): remove <slug>` 開頭並說明原因
- fixture 的 `contentSnapshot` 含第三方原文或已依 `post-takedown` 下架的譯文 → 可換成保留原本判斷關係的合成摘要，`expectedClass`、`expectedAction`、`humanReasoning` 與 `sourceRef` 不變；commit message SHALL 以 `fix(fixture): <slug>` 開頭並說明是為了移除下架內容

#### Scenario: Ralph Loop 不得改 fixture 內文

- **WHEN** Ralph Loop 執行 rewrite pass
- **AND** 它的 file glob 意外匹配到 `tribunal/fixtures/*.yaml`
- **THEN** runner SHALL 跳過該檔案
- **AND** 記錄一則 warning log

#### Scenario: 人類修正 fixture 需標記

- **WHEN** 人類發現 `gemma-4-dual-post.yaml` 的 `expectedClass` 應為 `clean-diff` 而非 `soft-dup`
- **THEN** commit message SHALL 為 `fix(fixture): gemma-4-dual-post — reclassify soft-dup → clean-diff`
- **AND** commit body SHALL 說明重新判定的理由（避免未來對 fixture 版本演進失去追溯性）

#### Scenario: 移除 fixture 裡的下架譯文

- **WHEN** 一筆 fixture 的 `contentSnapshot` 是已下架 GP 的譯文段落
- **THEN** 人類 MAY 把它換成自寫的合成摘要，讓兩篇之間的主題與差異關係維持可判斷
- **AND** `expectedClass`、`expectedAction`、`humanReasoning` 與 `sourceRef` SHALL 不變
- **AND** commit message SHALL 以 `fix(fixture):` 開頭並說明是為了移除下架內容
