# OpenSpec SDLC — gu-log 用 openspec 的標準流程

> 這份是「用 openspec 做事」的單一流程權威（SSOT）。任何 agent 只要在 gu-log 跑了 `/opsx:propose`、產出有 spec delta 的 change，就 MUST 照這條流程走到底。
>
> 個別指令（propose / apply / archive）的機制細節在 `.agents/skills/openspec-*` 與 `.agents/skills/source-command-opsx-*`，這裡**只**定義端到端的「順序、審查 gate、人類介入點、收尾」，不重複各指令的內部步驟。

## 為什麼要這條

openspec 把「改什麼、為什麼改」攤成 proposal / design / tasks / spec，但「提案完之後誰審、什麼時候給人看、做完有沒有收尾」一直沒有被流程化。結果是：

- **review gate 不一致**：有時 0 個 reviewer，有時隨手找一個，品質看運氣。
- **archive 一直被忘記**：截至 2026-06-21，`openspec/changes/` 躺著 20 個沒 archive 的 change，其中一堆早就 ship（例：`move-clarity-vibe-to-fresheyes` 的 v9 已上線）。archive 沒做 = `openspec/specs/` 的穩定 SSOT 沒被更新，下一個 agent 讀到的是過期的 capability。

這條流程把 **archive 變成 merge 前的必經 gate**：PR 沒 archive 就不會 merge。結構上讓「忘記 archive」變成不可能，根治上面那個 backlog。

## 流程（一個 openspec change = 一條 branch = 一個 PR，從 draft 開始）

| 階段 | 動作 | 審查 | 人類介入 |
|---|---|---|---|
| 1. Propose | `/opsx:propose` 產 proposal / design / tasks / spec | — | — |
| 2. Draft PR | 開 **draft PR**，把 propose 產物推上去 | — | — |
| 3. 提案審查 | **1 個 AI subagent** review proposal 的疑慮（方向、scope、有沒有漏 artifact 如 design.md） | 1 reviewer | — |
| 4. 通報 user | 把 **PR url + proposal.md 摘要**丟給 user | — | **人類檢查點 ①**（多半在這——propose + AI review 之後）。user 可讀可不讀；要擋方向就現在擋 |
| 5. Apply | `/opsx:apply` 實作，push 到**同一個 draft PR** | — | — |
| 6. 實作審查 | **2 個 AI subagent 平行**：一個查正確性 + 完整性，一個查簡潔度。**兩個都滿意才算過**，沒過就 iterate | 2 reviewers（平行） | — |
| 7. Archive | `/opsx:archive`：sync spec delta 進 `openspec/specs/`、把 change 移進 `changes/archive/`，commit 進**同一個 PR** | — | — |
| 8. 終審 | PR 轉正（draft → ready），等 CI | — | **人類檢查點 ②**：review 最終 PR（含 archive 後的全貌） |
| 9. Merge | CI 全綠 → auto-merge | — | — |

## 兩個人類檢查點（其餘全自動）

- **① 提案階段**（階段 4）：user 看 proposal 決定方向對不對。這是改動最便宜的時候——還沒寫任何 code，擋下來只損失一份 doc。
- **② 終審階段**（階段 8）：user 看做完 + archive 後的完整 PR。最後一道人類關卡。

中間（apply + 雙審 + archive）全自動，不打擾 user。除非 reviewer 卡關需要 user 拍板某個 critical design decision，否則不主動打斷。

## 為什麼 propose 1 個 reviewer、apply 2 個

- **propose 只動 doc**，錯了改起來便宜，1 個 reviewer 抓方向 / scope / 漏件就夠。
- **apply 動真 code、有真 impact**，要雙視角：一個顧「對不對、有沒有做完」，一個顧「會不會過度複雜」。這兩個維度容易互相拉扯（為了完整而臃腫、為了簡潔而漏 case），分成兩個 agent 平行審，比一個 agent 兼顧可靠。

## reviewer 怎麼來（gu-log 環境差異）

- **mac-CC**：CC 被 deny 裸 `Agent` 工具，開不了 Claude subagent。reviewer 一律委派 cmux 裡的互動式 codex（見 `cmux-orchestrator` skill），controller 負責驗收。
- **CCC**：用 GitHub MCP 或 Task subagent 跑 review。
- 不管哪種，reviewer 都是**獨立 context 的新 agent**，不是 controller 自己回頭看自己——fresh eyes 才抓得到 controller 的盲點。

## archive 的前置（已知 friction）

`/opsx:archive` 需要 `openspec` CLI（`openspec list --json` / `openspec status --json`）。**本機目前沒裝**，sandbox 內 `npx @fission-ai/openspec` 會 403。在 CLI 補上前，archive 要照 `source-command-opsx-archive` skill 手動做：比對 delta spec → sync 進 `openspec/specs/<capability>/spec.md` → `mv` change 到 `changes/archive/YYYY-MM-DD-<name>`。

這條 friction 該被根治（裝好 CLI）。在那之前，手動 archive 仍是 merge 前的硬 gate，不能因為「要手動」就跳。

## 適用範圍

「whenever we use openspec」= 只要跑了 `/opsx:propose`、有 spec delta 的 change，就走全套九階段。純 doc / typo 編輯（沒有 openspec change）走 repo 一般 branch + PR 流程，不需要 propose / apply / archive。
