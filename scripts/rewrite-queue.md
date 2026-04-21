# Rewrite Queue

> 清單形式記錄：哪幾篇 gu-log 文章需要 rewrite、為什麼、要改什麼方向。
> 由 human（ShroomDog）維護。ralph-loop 或 Clawd 讀這份清單決定下一步動哪篇。
> 一篇文章處理完就把條目移到最底下的「Done」section，保留紀錄不刪掉。

## Pending

### SP-176 「Codex Chronicle — stop explaining context」

- **Ticket**: `SP-176`
- **File**: `src/content/posts/sp-176-20260421-dkundel-codex-chronicle-stop-explaining.mdx`
- **Frontmatter 分數**: 7/8/8/9/8 綜合 8 **FAIL**（Opus 4.6 scorer，2026-04-22 rescored；persona 7 破 pass bar 下限 8）
- **原本分數**: 8/9/8/9/9 綜合 8 PASS（Opus 4.7 scorer，2026-04-21）
- **失分主因**: persona 7 — scorer 原話「Body 有 voice 但整體仍是 Kundel-this/Kundel-that 的分析性 op-ed，strip 掉比喻剩下來的骨架更像 tech analyst recap 而非 LHY 站在台上講課」。跟 SP-175 同一條 decorative trap，只是 ClawdNote 密度高 + narrative 有 Chronicle 代價 pivot，所以不像 SP-175 那麼糟
- **rewrite 方向**：
  1. **開場不要以 Kundel 推文事件為主語**——改成以「你自己昨天打包 context 的場景」切入，讓 Chronicle 的對照有體感，而非從外部觀察 OpenAI 在做什麼
  2. **Wrong Romain / real colleague / Chronicle 代價三段要打散重編**——目前是「條目 1 分析、條目 2 分析、條目 3 分析」的 op-ed 結構。打散成敘事：先用「message Romain」這句話黏住，中段交錯 real colleague / Wrong Romain 做為懸念，最後 Chronicle 代價三連 callback
  3. **結尾不要用「Chronicle 不會問」當 punch**——太 analytical。改成讓讀者看到 Kundel 的 demo 同時腦中浮現「螢幕錄影權限按鈕在哪」的那種個人化警覺
  4. **保留**：五個 ClawdNote 目前都有 opinion、密度達標，只需要把 stance 從「分析性評論」再偏向「朋友在旁邊吐槽」的方向
- **Scorer**: 用 pinned `claude-opus-4-6` 重評；目標 composite ≥ 8 且至少一維 ≥ 9，重點拉 persona 到 8+

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

_(尚無 rewrite 完成紀錄。處理完的條目搬到這裡，附上 after-rewrite commit SHA 跟新分數。)_
