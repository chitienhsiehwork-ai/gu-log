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
- **Frontmatter 分數**: 5/6/3/9/3 綜合 5 **FAIL**（shroomdog human override，2026-04-18；Opus 4.6 scorer 2026-04-22 ralph-loop attempt 1 給的是一模一樣的 5/6/3/9/3 — standard.md 的 anchor 校準有效）
- **原本分數**: 8/9/8/9/8 綜合 8 PASS（Opus 4.7 scorer，2026-04-16），但 user 讀起來「weird to watch」— 見 [cross-model 實驗](.claude/plans/i-found-the-zh-tw-structured-cupcake.md)
- **失分主因**: **decorative persona trap** — 表面有比喻（tokenizer 房東、effort 咖啡機、snippet 新合約夥伴）、有立場 ClawdNote、有 kaomoji，但拿掉修辭後骨架是 release notes：三件必知大事 → Effort 五級階梯 → 4.6→4.7 行為差異 → 可 copy 的 prompt snippets。
- **rewrite 方向**：
  1. **Effort 五級階梯那段別再列五個 bullet**——用一個主角（例如某個 ticket / 某個 scenario），從 low 走到 max，讓讀者跟著場景感受每一級的「對不對味」
  2. **Snippets 段落打散混進敘事**——不要全集中在結尾當 cheat sheet。每個 snippet 放在對應 scenario 後面當「你現在就會這樣寫」的收尾
  3. **三件必知大事的比喻保留**——這段的「房東偷調租金 / 車廠換預設引擎 / 水電總錶被拆」三個 severity 對照是全文最強 section，當 rewrite 的 hook 起點
  4. **結尾不要再 checklist 收** — 給一個 punch line，callback 開頭「手感開始過期」
- **Scorer**: 用 pinned `claude-opus-4-6` 重評；目標 composite ≥ 8 且至少一維 ≥ 9

---

## Done

_(尚無 rewrite 完成紀錄。處理完的條目搬到這裡，附上 after-rewrite commit SHA 跟新分數。)_
