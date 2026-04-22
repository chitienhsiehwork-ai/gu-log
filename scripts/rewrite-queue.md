# Rewrite Queue

> 清單形式記錄：哪幾篇 gu-log 文章需要 rewrite、為什麼、要改什麼方向。
> 由 human（ShroomDog）維護。tribunal-batch-runner 或 Clawd 讀這份清單決定下一步動哪篇。
> 一篇文章處理完就把條目移到最底下的「Done」section，保留紀錄不刪掉。

## Pending

### SP-175 「Opus 4.7 prompting cheat sheet」

- **Ticket**: `SP-175`
- **File**: `src/content/posts/sp-175-20260416-anthropic-opus-4-7-prompting-best-practices.mdx`
- **目前分數**: 7/8/7/9/7 綜合 7 **FAIL**（Opus 4.6 scorer, 2026-04-22, CC iter-3 後）— 距 pass bar 差一口氣，clawdNote + clarity 已達 8+，但 persona/vibe/narrative 三維卡 7
- **歷史**:
  - 2026-04-16 初版：8/9/8/9/8 PASS（4.7 scorer；但 user 讀起來「weird to watch」）
  - 2026-04-18 shroomdog override：5/6/3/9/3 FAIL
  - 2026-04-22 ralph-loop attempt 1：5/6/3/9/3（4.6 scorer 跟 human override 同分 — anchor 校準有效）
  - 2026-04-22 CC 手動 rewrite iter-3：7/8/7/9/7（Monday-crash opener + postmortem callback + 把 literal / tool / subagent 三條個性拆進 investigation scenario）
- **仍卡在的結構問題**: scorer 原話「middle enumerates three 同謀 + five effort tiers + three infra changes back-to-back」、「strip test = release notes with a story wrapper」— 素材本身就是 cheat-sheet 性質，Monday-crash 當敘事 wrapper 只救到部分
- **下一步若要 push 到 pass**: 把中段「三個 infra 改動」和「effort 五階梯」再進一步融進 Monday-crash 的 investigation narrative，減少連續枚舉。但 diminishing returns 明顯——可能 ceiling 就是 7
- **Scorer**: 目標 composite ≥ 8 且至少一維 ≥ 9（差 1 點）

---

## Done

### SP-176 「Codex Chronicle — stop explaining context」✅

- **Ticket**: `SP-176`
- **Rewrite by**: ralph-loop auto-rewrite（attempt 2 writer output，attempt 3 scored PASS）
- **Final score**: P=8 / C=8 / V=8 composite 8 **PASS**（Opus 4.6 scorer, 2026-04-22 05:28 TST）
- **Trajectory**:
  - 2026-04-21 初版：8/9/8/9/9 PASS（4.7 scorer；但 pinned 4.6 rescore 後 FAIL）
  - 2026-04-22 02:49 CC scan：7/8/8/9/8 FAIL（persona 7 破下限）— scorer 抓到 decorative op-ed pattern
  - 2026-04-22 05:28 ralph-loop：8/8/8 PASS（attempt 3）— attempt 1 writer 雖 error 但 revert bug fix 讓 build-passing attempt 被保留，attempt 2 rewriter 繼續在之上改進
- **Commit**: `c25694e2 ralph: SP-176 — PASS (P:8 C:8 V:8)` + `23d14cb9` progress update
- **結構改變**: 原本是 Kundel-this/Kundel-that op-ed → 現在開場「新同事第一天上班」比喻、「三個月 context」框架、Chronicle 當「偷瞄螢幕的眼睛」、收尾「同事會問 Romain 是指 @romainhuet 對吧? Chronicle 不會問」punch line
- **備註**: 這是 ralph-loop 修掉 revert bug 之後第一個成功的 auto-rewrite case；writer attempt 1 雖然 errored（產生壞 MDX），但因為 backup-per-attempt 機制保留了 attempt 1 build-passing 的 rewrite，attempt 2 在那基礎繼續 iterate 到 PASS
