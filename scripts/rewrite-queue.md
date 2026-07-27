# Rewrite Queue

> 清單形式記錄：哪幾篇 gu-log 文章需要 rewrite、為什麼、要改什麼方向。
> 由 human（ShroomDog）維護。tribunal-batch-runner 或 Mogu 讀這份清單決定下一步動哪篇。
> 一篇文章處理完就把條目移到最底下的「Done」section，保留紀錄不刪掉。

## Pending

## Done

### GP-175 「Opus 4.7 prompting cheat sheet」✅

- **Ticket**: `GP-175`
- **Files**: `src/content/posts/gp-175-20260416-anthropic-opus-4-7-prompting-best-practices.mdx`、`src/content/posts/en-gp-175-20260416-anthropic-opus-4-7-prompting-best-practices.mdx`
- **Final score**: Vibe 8 / Librarian 9 / Fact 9 / Fresh Eyes 8，`tribunalVersion: 3` **PASS**（2026-04-24）
- **Closure**: 舊 Pending 條目仍停在 2026-04-22 的 FAIL 快照；2026-07-26 依 live frontmatter 對帳後關閉，不重寫文章。

### GP-176 「Codex Chronicle — stop explaining context」✅

- **Ticket**: `GP-176`
- **Rewrite by**: ralph-loop auto-rewrite（attempt 2 writer output，attempt 3 scored PASS）
- **Final score**: P=8 / C=8 / V=8 composite 8 **PASS**（Opus 4.6 scorer, 2026-04-22 05:28 TST）
- **Trajectory**:
  - 2026-04-21 初版：8/9/8/9/9 PASS（4.7 scorer；但 pinned 4.6 rescore 後 FAIL）
  - 2026-04-22 02:49 CC scan：7/8/8/9/8 FAIL（persona 7 破下限）— scorer 抓到 decorative op-ed pattern
  - 2026-04-22 05:28 ralph-loop：8/8/8 PASS（attempt 3）— attempt 1 writer 雖 error 但 revert bug fix 讓 build-passing attempt 被保留，attempt 2 rewriter 繼續在之上改進
- **Commit**: `c25694e2 ralph: GP-176 — PASS (P:8 C:8 V:8)` + `23d14cb9` progress update
- **結構改變**: 原本是 Kundel-this/Kundel-that op-ed → 現在開場「新同事第一天上班」比喻、「三個月 context」框架、Chronicle 當「偷瞄螢幕的眼睛」、收尾「同事會問 Romain 是指 @romainhuet 對吧? Chronicle 不會問」punch line
- **備註**: 這是 ralph-loop 修掉 revert bug 之後第一個成功的 auto-rewrite case；writer attempt 1 雖然 errored（產生壞 MDX），但因為 backup-per-attempt 機制保留了 attempt 1 build-passing 的 rewrite，attempt 2 在那基礎繼續 iterate 到 PASS
