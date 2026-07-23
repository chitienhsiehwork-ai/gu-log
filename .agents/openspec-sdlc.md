# OpenSpec SDLC — gu-log 用 openspec 的標準流程

> 這份是「用 openspec 做事」的單一流程權威（SSOT）。任何 agent 只要在 gu-log 跑了 `/opsx:propose`、產出有 spec delta 的 change，就 MUST 照這條流程走到底。
>
> 個別指令（propose / apply / archive）的機制細節在 `.agents/skills/openspec-*` 與 `.agents/skills/source-command-opsx-*`，這裡**只**定義端到端的「順序、審查 gate、人類介入點、收尾」，不重複各指令的內部步驟。

## 為什麼要這條

openspec 把「改什麼、為什麼改」攤成 proposal / design / tasks / spec，但「提案完之後誰審、什麼時候給人看、做完有沒有收尾」一直沒有被流程化。結果是：

- **review gate 不一致**：有時 0 個 reviewer，有時隨手找一個，品質看運氣。
- **archive 一直被忘記**：change 做完沒 archive，`openspec/specs/` 的穩定 SSOT 就沒更新，下一個 agent 讀到的是過期的 capability。（上線前曾累積一整批沒 archive 的 backlog，這條流程就是為了根治。）

這條流程把 **archive 變成 merge 前的必經 gate**：PR 沒 archive 就不會 merge。結構上讓「忘記 archive」變成不可能，根治上面那個 backlog。

## 流程（一個 openspec change = 一條 branch = 一個 PR，從 draft 開始）

| 階段 | 動作 | 審查 | 人類介入 |
|---|---|---|---|
| 1. Propose | `/opsx:propose` 產 proposal / design / tasks / spec | — | — |
| 2. Draft PR | 開 **draft PR**，把 propose 產物推上去 | — | — |
| 3. 提案審查 | **1 個 AI subagent** review proposal 的疑慮（方向、scope、有沒有漏 artifact 如 design.md） | 1 reviewer | — |
| 4. 通報 user | 把 **PR url + proposal.md 摘要**丟給 user | — | **人類檢查點 ①**（多半在這——propose + AI review 之後）。user 可讀可不讀；要擋方向就現在擋 |
| 5. Apply | **builder subagent** 跑 `/opsx:apply` 做實作重活，push 到**同一個 draft PR**；controller 不親自下海 | — | — |
| 6. 實作審查 | **2 個 AI subagent 平行**（正確性錨 spec scenario / 簡潔度錨 over-engineering）。收斂 = 所有 scenario 對上 **AND** 簡潔度無 blocking，有界 max-N；**不靠「reviewer 主觀滿意」**——詳見〈階段 6：收斂與 escalation〉 | 2 reviewers（平行） | — |
| 7. Archive | `/opsx:archive`：archive 並 sync spec delta，commit 進**同一個 PR**（機制見 skill） | — | — |
| 8. 終審 | PR 轉正（draft → ready），等 CI | — | **人類檢查點 ②**：review 最終 PR（含 archive 後的全貌） |
| 9. Merge | CI 全綠 → auto-merge | — | — |

## 兩個人類檢查點（其餘全自動）

- **① 提案階段**（階段 4）：user 看 proposal 決定方向對不對。這是改動最便宜的時候——還沒寫任何 code，擋下來只損失一份 doc。
- **② 終審階段**（階段 8）：user 看做完 + archive 後的完整 PR。最後一道人類關卡。

中間（apply + 雙審 + archive）全自動，不打擾 user。除非 reviewer 卡關需要 user 拍板某個 critical design decision，否則不主動打斷。

## archive 是 merge 前的必經 gate（policy 絕對強制）

階段 7 的 archive 是 merge 前 policy 層的硬性要求：PR **新引入**一個 active change（base main 上還沒有的），ready 後 MUST 在同一個 PR 內 archive。

- **CI 強制已接線**：既有 [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) 的 `openspec-archive` leaf 會呼叫 [`scripts/check-openspec-archive.mjs`](../scripts/check-openspec-archive.mjs)，並由同一個 `ci-passed` 聚合。實際事件與判定細節以這兩份 executable SSOT 為準。
- **draft 階段不擋**（人類檢查點 ① 還在審 proposal），概念上**轉 ready 後才該生效**。
- 實際觸發的 GitHub Actions event 與 branch protection **以 workflow YAML 為準**，此處只定 policy；gate 只驗證、不執行 archive 動作。

**語意邊界（為什麼這還是「零例外」）**：gate 擋的是「**這個 PR 新引入**的 change 沒收尾」。已經在 main 上的既有 change（gate 上線前留下的 backlog）= grandfathered，不溯及既往——那不是開後門，是物理上已成事實。對**未來每個新 change**，一律「一個 change = 一個 PR = propose + apply + archive」，沒有 `defer-archive` label、沒有 warning-only 模式。需要跨多 PR 的工作，拆成多個各自完成 + 各自 archive 的 capability，而不是讓一個 change 半開著跨 PR。

## 為什麼 propose 1 個 reviewer、apply 2 個

- **propose 只動 doc**，錯了改起來便宜，1 個 reviewer 抓方向 / scope / 漏件就夠。
- **apply 動真 code、有真 impact**，要雙視角：一個顧「對不對、有沒有做完」，一個顧「會不會過度複雜」。這兩個維度容易互相拉扯（為了完整而臃腫、為了簡潔而漏 case），分成兩個 agent 平行審，比一個 agent 兼顧可靠。

## 指揮鏈：coach → controller → workers

最上層 human = coach，其下 main agent = controller，再下 subagents = workers。重活外包，上層只定方向。各自獨立 context：

- **human = coach**：定高層方向、拍板 critical design decision（產品方向 / 架構 / 對外承諾 / 品牌調性）。只停在既有介入點——`opsx explore`（釐清 intent）、審 proposal（檢查點①）、終審（檢查點②）、以及 escalation 例外；**不落到 micro**。
- **controller（main agent）**：不做重活。負責拆 task、給 spec、聚合 verdict 做收斂判定（驗收）、跟 coach 對話拍板。**context 要乾淨**——它是跟 human 討論高層決策的介面，實作細節塞進來就會把這個介面弄髒、塞爆，之後沒空間跟 user 談方向。
- **builder subagent**：吃 proposal / design / tasks，在自己獨立的 context 做實作重活（寫 code、改多檔、debug、跑 `/opsx:apply`）。重活燒的 token 留在 builder 的 context，不污染 controller。
- **reviewer subagent**：獨立 context 的新 agent，fresh eyes 審 builder 的產出（階段 6 兩個平行）——不是 controller 自己回頭看自己，盲點才抓得到。

怎麼生出 builder / reviewer（Claude subagent、cmux 互動式 codex、GitHub MCP）看當下環境能力決定，不寫死。原則不變：**doing 外包給 builder、verifying 外包給 reviewer，controller 專心 orchestrate + 當 user 的翻譯層。**

## 階段 6：收斂與 escalation

階段 6 的「過關」不靠 reviewer 主觀滿意，而是可機器判定的收斂。核心洞察：**code 有客觀真值（測試），內容線 tribunal 用全主觀 LLM judge 是因為 prose 沒有——code 線不該照搬那個主觀性。**

- **executable-first 三層**：scenario 能編成測試的走 **Tier-1**（測試綠才算對上）；真測不了的落 **Tier-2**（reviewer 逐條判 binary 對上/未對上，標記為主觀）；**Tier-3**（checkbox 自報）不可單獨採信。
- **收斂定義**：所有 Tier-1 測試綠 **AND** 所有 Tier-2 判為對上 **AND** 簡潔度 reviewer 無未解 blocking finding。正確性 reviewer 用 spec scenario 當 rubric 逐條對帳；scenario 抓不到臃腫，所以簡潔度那一軌**不可省**（否則雙審之一被廢）。
- **Tier 分類要被覆核**：builder 交 scenario→tier 清單（Tier-1 附測試），正確性 reviewer 覆核分類與 test↔scenario 對應忠實度，可把「不可測」宣稱打回 Tier-1（防 test-gaming）。
- **controller 聚合**：收斂判定由 controller 聚合 reviewer verdict + 測試結果做，不讓渡給單一 reviewer。
- **有界**：iterate 最多 **max-N = 3 輪**（tunable，**此處為 SSOT**）。耗盡仍未收斂 → 升 coach（= 落入既有 critical-decision 例外，**不是新增第三個人類檢查點**）。

### escalation：唯讀牆 + explore-first

- **唯讀牆**：builder 對 openspec spec 檔（`openspec/**/specs/**/*.md`，涵蓋 main specs + change delta）**唯讀**。需要改一條 scenario 才能修好 = 勝利條件變了 = design decision → builder 停手升 coach。強制走 **近似 CI（同一 commit 同時動 spec 檔 + 實作檔 = 違規）+ reviewer backstop**；不靠 runtime hook（builder runtime 不固定、蓋不全）。階段 1 propose（只動 spec）與階段 7 archive（controller sync main specs）不受此牆限制。
- **升級順序**：先 `opsx explore` 釐清（trivial 無 ambiguity 可跳過），coach 核可後由 **controller（非 builder）改 spec delta**，迴圈以新合約重啟、max-N 重計。純實作 bug（不動 scenario）→ builder 在同 PR in-lane atomic 修，不升。

## 適用範圍

「whenever we use openspec」= 只要跑了 `/opsx:propose`、有 spec delta 的 change，就走全套九階段。純 doc / typo 編輯（沒有 openspec change）走 repo 一般 branch + PR 流程，不需要 propose / apply / archive。
