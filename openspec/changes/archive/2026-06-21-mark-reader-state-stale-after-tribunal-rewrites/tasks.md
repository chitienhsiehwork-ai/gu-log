# Tasks

## 0. Prerequisite

- [ ] 0.1 `add-version-aware-reader-state` 已完成 version-aware read records 與 reader-facing revision；否則本 change 不可 apply 到整合階段。

## 1. Rewrite semantics

- [ ] 1.1 定義哪些 tribunal output 屬於 reader-visible rewrite。
- [ ] 1.2 定義 score-only / metadata-only update 不會觸發 stale read。
- [ ] 1.3 確認 tribunal runtime version 不被當成文章版本。

## 2. Integration

- [ ] 2.1 在 tribunal publish/rewrite flow 中更新 reader-facing revision。
- [ ] 2.2 確認 rewritten article 會讓舊 read record 顯示 stale。
- [ ] 2.3 確認 score-only change 不會讓舊 read record 顯示 stale。

## 3. Verification

- [ ] 3.1 建立正文 rewrite 與 score-only update 的測試案例。
- [ ] 3.2 建立 title/description/ClawdNote 是否屬於 reader-visible revision source 的測試案例。
- [ ] 3.3 Reader Tracker 顯示舊版已讀但有新版。
- [ ] 3.4 `openspec validate mark-reader-state-stale-after-tribunal-rewrites --strict` 通過。
