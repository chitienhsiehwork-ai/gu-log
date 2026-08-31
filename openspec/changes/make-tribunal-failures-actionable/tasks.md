## 1. 可採取行動的狀態機

- [ ] 1.1 在 legacy runner 加入共用的 reader revision 比較 helper、評審前與終態前的漂移檢查，以及原子的 `mark_article_needs_review` transition。
- [ ] 1.2 只有具權威性、符合 schema 的 GP source-preservation no-rewrite FAIL 才回傳 exit code `3`；`--score-only` 維持 rc `1`，其他操作性失敗語意不變。
- [ ] 1.3 runner 初始化時略過 reader revision 未變的現行版 `NEEDS_REVIEW`；reader-visible revision 或 Tribunal version 改變後安全重設。

## 2. 重新入列與下游使用者

- [ ] 2.1 新增具鎖定與保留稽核紀錄的 `scripts/tribunal-requeue.sh`，讓 operator 能明確把相同 revision 重新入列。
- [ ] 2.2 更新 quota loop 與 bounded batch 的 selector／exit 統計，依 revision 略過 `NEEDS_REVIEW`，同時繼續其他安全工作。
- [ ] 2.3 在發布器狀態與 monitor snapshot 分開呈現 `NEEDS_REVIEW`，且發布器只選現行 Tribunal version 的 article-level PASS。

## 3. 回歸測試

- [ ] 3.1 新增 deterministic shell 測試，涵蓋首次 GP FAIL、不增加 attempt、未變 input 略過、reader-visible 修改、明確重新入列、version 重設、執行中漂移、hash 失敗與雙 worker 安全性。
- [ ] 3.2 新增回歸測試，證明 score-only GP、malformed output、quota、runner error、non-GP judge-only 與 non-GP bounded rewrite 都不會取得具權威性的終態原因。
- [ ] 3.3 新增發布器、scheduler 與 monitor 回歸測試，證明舊 PASS evidence 無法發布現行 `NEEDS_REVIEW` 文章，且舊 Tribunal version 的 PASS 不符合資格。
- [ ] 3.4 在 repo 的 shell contract ownership 測試登記新測試，並執行聚焦的 Vitest、shell 與 OpenSpec 驗證。

## 4. 審查與交付

- [ ] 4.1 完成獨立 correctness/safety 與 Keep/Simplify/Drop reviews，並修正所有 blocking finding。
- [ ] 4.2 跑完所有必要 hook／gate、封存 OpenSpec change、推送 feature branch、通過 PR CI、合併，最後在不繞過 service gate 的前提下驗證安全的 runtime checkout。
