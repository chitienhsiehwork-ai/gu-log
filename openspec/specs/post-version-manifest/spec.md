# post-version-manifest Specification

## Purpose

定義兩項責任：共用的 reader-facing revision 契約，以及 committed post version
manifests 應遵守的 repo-owned freshness protections。

## Requirements

### Requirement: Articles expose reader-facing revisions

The site SHALL expose a reader-facing revision for each published article that Reader Tracker can compare against stored read records. This revision SHALL be derived from reader-visible content, not from raw file commit count alone.

#### Scenario: Tracker renders article rows

- **GIVEN** Reader Tracker renders a published article
- **WHEN** the article row is created
- **THEN** the row SHALL have access to the article's current reader-facing revision

### Requirement: Revision source is shared

Article pages and Reader Tracker SHALL use a shared source for current article revision.

#### Scenario: Article page and tracker compare versions

- **GIVEN** an article has a current revision
- **WHEN** the article page records a read
- **AND** Reader Tracker later displays that article
- **THEN** both SHALL use the same revision source

### Requirement: Read-relevant revision shall avoid metadata-only churn

The reader-facing revision SHALL represent changes that matter to a reader's need to reread the article, and SHALL avoid changing solely because backend-only metadata changed.

#### Scenario: Only backend scoring metadata changes

- **GIVEN** an article's reader-visible body is unchanged
- **AND** only backend scoring metadata changes
- **WHEN** the site computes read-relevant revision
- **THEN** the revision SHALL NOT change solely because of that metadata update

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
