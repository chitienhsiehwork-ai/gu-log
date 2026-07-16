# Value Review Runbook — 動手前先審「該不該做」

> **最好的 code 常常是不寫 code、做一個好決定。** 這份 runbook 記錄一個方法:在建任何「機制」之前,用對抗式 reviewer subagent 壓力測試它**該不該存在**。方法本身 runtime-中性;spawn 的機制各 runtime 不同(見末段)。

## 為什麼

Agent(尤其是自己提案的那個)對「動手建東西」有系統性偏誤——寫了 code / spec 感覺像進度,不寫像沒做事。但一個過度工程、或方向錯的機制**上線後的成本**,遠高於「花幾個 subagent 先問清楚該不該做」。這個方法的價值:在沉沒成本產生**之前**,讓「不該做 / 該縮小 / 有更乾淨的替代」有機會勝出。

真實案例(2026-07-16):一份完整的 openspec change(`conditional-fact-verification`)差點上線,三個對抗式 reviewer 一致否決——它拿一個無害的不一致換一個有害的、還是自己提案人沒察覺的過度工程。最後**不寫那個機制**,改成一份決策記錄。全案見 `openspec/changes/archive/2026-07-16-reject-claim-free-factcheck-fastpath/design.md`。

## 什麼時候跑

動手建**非-trivial 的東西**之前,尤其符合任一條:

- 要新增一個 openspec capability / 機制 / 非小型 refactor / SOP 或 gate 變更
- **提案是你自己想出來的**、或你已經投入寫了草稿(投入 = 偏誤最強的時候)
- 動到 load-bearing 的東西(品質 gate、pipeline、發佈流程)
- user 一句直覺(「不如直接跳過 X」)你正要照做——先驗證那個直覺,別直接執行

trivial 機械改動(改文案、bump counter、順手修 lint)不需要,別把方法變儀式。

## 方法

spawn **N 個獨立 reviewer subagent(N=2–4,視 blast radius)**,每個一個**不同的 principal-engineer 視角**,硬性要求:

1. **zero parent context**——不要餵它「我們已經決定要做」的 framing,它要能獨立判「不該做」。
2. **預設懷疑**——明講「你的工作是誠實回答該不該存在,不是背書;越能證明不值得做越有用」。能不能講出「別做」是它有沒有用的試金石;講不出來 = 橡皮圖章。
3. **對 code 驗證,不憑記憶**——叫它去讀真 SSOT(code / spec / frontmatter),別接受散文宣稱。這次兩個站不住的論證,就是 reviewer 去讀 `pass-bar.ts` 才抓到的。
4. **收斂成一句 verdict**——別開無止境調查支線;要一個「該做 / 縮小 / 不做 + 理由」的結論。

跑過有效的三個視角(可依題目換):

| 視角 | 專問 |
|---|---|
| **價值 / YAGNI** | 問題是真的還 cosmetic?值得這個成本嗎?什麼都不做的代價、機率?最便宜的替代? |
| **設計空間 / 替代** | 有沒有被跳過、但更乾淨的通解?(常見:把 special-case 補丁換成重新定義既有概念) |
| **失敗模式 / 二階效應** | 這機制會製造什麼新問題?會被 game 嗎?具體場景:「這樣一篇輸入 + 這樣一次判斷 → 這個壞結果」 |

## 收斂後怎麼辦

綜合三方:

- **一致說該做** → 做,但把它們指出的護欄補進去。
- **一致說不做 / 縮小 / 換方向** → 那就是決定。**不要為了護自己的提案或 user 的初始直覺而硬推——證據優先。**
- **不做,但分析有價值** → 別讓它蒸發。用 **openspec 決策記錄**存起來:把「刻意不做 X」編碼成一條 living spec requirement(未來要做 X 的提案會撞到它、被迫 delta),完整理由 + 重啟條件放 `design.md`。這樣同一個題目下次冒出來不用重吵一遍。範式見上述 2026-07-16 案例的 `tribunal-verification-scope` capability。

## Runtime 差異(只有 spawn 機制不同,方法一樣)

- **Claude Code**:用 `Agent` tool spawn(`general-purpose` / `Plan` / `fork`),一則訊息多個 tool call 併發跑。
- **Codex / 其他**:用該 runtime 自己的 parallel subagent 機制。

> 這條屬於跨領域 agent 行為紀律,與 [`docs/agent-discipline.md`](agent-discipline.md)〈完全自主〉同源:自主不只是「敢直接 merge」,也是「敢在動手前否決一個壞主意、包括自己的」。
