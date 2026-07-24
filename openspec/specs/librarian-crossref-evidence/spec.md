# librarian-crossref-evidence Specification

## Purpose

定義 Librarian judging 前的 deterministic repo evidence、相似舊文 cross-reference 與同 source URL duplication contract，讓引用或差異化要求可追溯。

## Requirements

### Requirement: Librarian SHALL 在 judging 前收到 deterministic repo evidence

Tribunal Librarian stage 在產生 score 前，SHALL 收到 deterministic evidence packet，內容包含 target metadata、glossary hits、internal link checks，以及 related old posts。

#### Scenario: Librarian stage starts

- **WHEN** Librarian stage 對某篇 post 執行
- **THEN** runner SHALL 為該 post 產生 evidence packet
- **AND** Librarian prompt SHALL 指示 judge 在 broad repo discovery 前先使用該 packet

### Requirement: Similar old posts SHALL 要求 citation 或 differentiation

當 evidence packet 找到相似的舊 gu-log post 時，Librarian SHALL 要求新 post cite 舊 post，或說明 distinct new POV、newer source、或 different practical angle。

#### Scenario: 新 post 與舊 concept coverage 重疊

- **WHEN** 新 GP 重複舊 gu-log post 已經涵蓋的 concept
- **THEN** Librarian SHALL 要求 citation 到相關舊 post
- **AND** 新 post SHALL 說明它新增了什麼 angle

#### Scenario: 主題相似但有 new contribution

- **WHEN** 新 post 涵蓋相似 topic，但加入 distinct POV 或 newer primary source
- **THEN** Librarian MAY 讓該 post pass
- **AND** Librarian SHALL prefer 加 cross-reference，而不是 reject 該 post

### Requirement: Same source URL SHALL 被視為 high-risk duplication

如果 evidence packet 找到舊 post 有相同 source URL，Librarian SHALL 要求明確 attribution 到舊 post，或 recommend merge/reject。

#### Scenario: Same source URL appears

- **WHEN** draft post 的 source URL 與 existing post 相同
- **THEN** Librarian SHALL flag 該 overlap
- **AND** 除非 post 明確說明為何需要 separate post，否則該 post SHALL NOT pass crossRef
