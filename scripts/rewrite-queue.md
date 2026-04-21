# Rewrite Queue

> 清單形式記錄：哪幾篇 gu-log 文章需要 rewrite、為什麼、要改什麼方向。
> 由 human（ShroomDog）維護。ralph-loop 或 Clawd 讀這份清單決定下一步動哪篇。
> 一篇文章處理完就把條目移到最底下的「Done」section，保留紀錄不刪掉。

## Pending

### SP-175 「Opus 4.7 prompting cheat sheet」

- **Ticket**: `SP-175`
- **File**: `src/content/posts/sp-175-20260416-anthropic-opus-4-7-prompting-best-practices.mdx`
- **Frontmatter 分數**: 7/8/7/9/7 綜合 7 分（Opus 4.6 scorer，2026-04-18 rescored）
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
