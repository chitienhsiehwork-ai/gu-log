# Post-Implementation Mode（口語：debrief）

目標是讓 user 在 merge/push 前理解關鍵決策，而不是背 diff。這個 mode 適合高風險改動，也適合 user 明確說想確認自己懂這次變更。

## 觸發規則

- Data model、architecture、user-facing behavior、guardrail/SSOT 改動：agent 必須主動提議 post-implementation quiz。
- Type/API contracts、permissions、migration、跨 agent workflow 改動：通常也應提議。
- user 可明確 skip；依 `SKILL.md` 的規則靜默記成 workflow event，不得改變 topic 的學習狀態。
- typo、純格式化、機械小改不觸發。
- 不做 git hook；這是 workflow 規範，不是硬擋。

## 素材來源

- during implementation 的決策紀錄、plan deviations、conservative assumptions。
- `git diff` / PR diff、測試輸出、review findings。
- user 原本的 intent、pre-implementation plan、任何已確認 tradeoff。

## 報告排序

使用 decisions-first, mechanics-last：

1. Design decisions and tradeoffs.
2. Data model / migration / persistence changes.
3. Type/API interfaces and compatibility.
4. User-facing behavior and edge cases.
5. Risk, tests, and residual uncertainty.
6. Mechanical refactoring and file movement.

## 交付方式（拆關，不要一次倒完）

- 不要把整篇高密度報告一次送出再考試 —— user 讀不完就是失敗。
- 照 level-up 主線拆關：一關一個決策（含語氣外殼與類比），關末出該關的 MCQ，user 答對才開下一關。
- 關卡順序沿用上面的 decisions-first 排序；mechanical 改動不開關，收尾一句帶過。

## 題型混用（shotcall ＋ quiz）

- **agent 決策用 shotcall 重演**：實作期間 agent 自行拍的板（plan deviations、conservative assumptions、選 A 沒選 B 的取捨）→ 攤成 shotcall MCQ：選項擺出當時的可行方案、標出 agent 實際選的＋一句理由，user 重新定奪 —— 維持＝放行，推翻＝開後續修正工單。
- **user 理解用 quiz 驗證**：成品懂不懂，走 quiz MCQ（下節規則）。
- 一關仍一題；decisions-first：先 shotcall 重演，再 quiz 收尾。

## Quiz 設計

- 沿用 `SKILL.md` 的 MCQ anti-tell 與 distractor 規則。
- 題目測「user 能否判斷改動是否合理」，不要測背誦哪幾個檔案改了。
- 一關一題，題數跟著決策數走；高風險可加一題 tiny application check。
- 正確答案應要求理解 tradeoff，例如 compatibility、migration order、failure mode、rollback path。
- user 答錯時，回到相關決策脈絡重講，不要急著放行。

## 完成條件

- user 能用自己的話說出最重要的決策與風險，或答對 quiz。
- 若 user skip，靜默記錄這次事件；只有 user 明講時才記原因。接著依一般 review / push 規則繼續。
