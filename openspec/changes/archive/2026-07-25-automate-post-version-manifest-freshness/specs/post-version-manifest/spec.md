## ADDED Requirements

### Requirement: Staged post 變更 SHALL 在同一個 commit 投影出 fresh manifest

在完整 Git history 可用的本機 worktree 中，commit 變更
`src/content/posts/*.mdx` 時，repo-owned pre-commit automation SHALL 把 staged
post 變更投影到完整 Git history 上，重生 `src/data/post-versions.json`，並把結果
stage 進同一個 authored commit。

#### Scenario: Staged post edit 改變版本

- **GIVEN** full-history worktree stage 了一筆 reader-visible post 變更
- **WHEN** pre-commit automation 執行
- **THEN** generator SHALL 在計算 `post-versions.json` 時納入 staged post touch
- **AND** regenerated manifest SHALL stage 進同一個 commit
- **AND** SHALL NOT 要求另一個 generated follow-up commit

#### Scenario: Staged rename 保留 lineage

- **GIVEN** staged post rename 在舊路徑下已有歷史 touches
- **WHEN** pre-commit automation 投影 staged snapshot
- **THEN** manifest SHALL 在 canonical destination path 下保留歷史 count

### Requirement: Manifest freshness SHALL 維持 layered

Pre-commit repair SHALL NOT 取代 blocking pre-push 與 CI freshness checks。

#### Scenario: Local repair 缺席或未完成

- **GIVEN** local pre-commit repair 沒有讓 `post-versions.json` fresh
- **WHEN** pre-push 或 CI 以完整 Git history 檢查 committed manifest
- **THEN** stale manifest SHALL 失敗並輸出 actionable diagnostic
