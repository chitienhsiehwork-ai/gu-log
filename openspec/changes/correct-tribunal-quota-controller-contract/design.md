## Context

`tribunal-quota-controller` 的穩定版規格描述的是 2026-05-12 前的預扣
控制器：先用每篇文章的額度成本算冷卻時間，再把
`active_workers * ARTICLE_COST_PCT` 從剩餘額度扣掉。正式控制器
後來刻意改成依視窗經過時間計算的消耗線節奏，但當時沒有先更新 active
OpenSpec change；舊 delta 在後續 archive 時被正確同步成一份已經過時的穩定版
規格。

目前正式程式、正式環境錨定迴歸測試與操作手冊的主要段落
一致：

- 控制器對短、長兩個額度視窗分別比較實際已用百分比與依時間計算的允許消耗線；
- 超前允許消耗線時停止開新工作行程，並回報理想線追上目前用量所需的欠額；
- 任一視窗到達設定的保留底線時停止派送；
- `ARTICLE_COST_PCT` 的指數移動平均與執行中工作數不參與派送閘門；
- 額度資料不完整時進入保守降級模式。

然而穩定版規格的全部 requirement 仍把舊公式、舊常數快照與過時可觀測性
語意寫成 SHALL。這不是單一文字修補能收斂的 drift。這個 change 只修正
規範合約、正式環境錨定測試與衍生操作手冊，不操作或重啟
remote Tribunal service。

## Goals / Non-Goals

**Goals:**

- 讓 `tribunal-quota-controller` 的規範 requirements 完整描述現行依時間計算的
  消耗線政策。
- 明訂執行中工作數與單篇成本指數移動平均只供可觀測性，不是假裝能保證
  保留底線的派送預留。
- 把保留底線、欠額、降級、額外用量、歷史、狀態與正式來源優先序寫成可
  對應正式測試的 scenarios。
- 移除只在測試內重演舊公式、卻沒有執行正式控制器的假覆蓋。
- 在 apply 與 archive 階段同步操作手冊殘影及穩定版規格的 Purpose。

**Non-Goals:**

- 不變更額度來源、model routing、credential 或 usage endpoint。
- 不調整正式執行環境預設值，也不以這個 change 提高工作行程並行數。
- 不新增執行中工作預留、強制額度更新或未反映消耗帳本。
- 不啟動、停止、重啟或重新部署 remote Tribunal daemon。
- 不宣稱消耗線節奏能保證執行中的工作絕不穿越額度保留底線。

## Decisions

### 1. 完整替換過時 requirements，不在舊公式上局部補丁

Delta 會移除穩定版規格現有的 11 條 requirements，再新增一組較小、依責任
分界的 requirements。原因是舊規格不只執行中工作預扣過時；冷卻時間
公式、保留底線、冷啟動成本、額外用量門檻、無效視窗與寫入紀錄
語意也都已 drift。沿用舊 requirement 名稱做大量 `MODIFIED` 會保留錯誤概念，
也讓 archive 後的 contract 難讀。

替代方案是只刪除執行中工作 requirement。這會讓其他舊 SHALL 繼續指示 agent
恢復逐篇控制器，因此不採用。

### 2. 用依時間計算的允許消耗線作唯一派送額度閘門

每個視窗的可用預算是 100% 減設定的保留底線；理想用量依該
視窗已經過的時間線性增加，再加設定的突發容許量得到允許已用百分比。
實際已用百分比超前允許線，而且追平時間超過最小派送間隔時，控制器不再開新
工作行程，並以兩個視窗中較長的欠額作為約束來源。

替代方案是用「剩餘可用額度 ÷ 距離 reset 時間」推算每篇 cooldown。這需要可靠
的 per-article cost，會把模型輸出長度、cache lag 與並行工作噪音直接放進安全
gate；現況已刻意移除，不採用。

### 3. In-flight count 與 article-cost EMA 維持 telemetry-only

Production quota reading 可能已包含 active worker 的部分消耗，也可能尚未包含
剛完成工作。直接再扣 `active_workers * EMA` 既可能 double-count，也可能在
cache stale 時低估真實消耗；而且 initial tick 發生在填滿 worker pool 之前，
無法替 upcoming dispatch 做 reservation。因此兩者不得影響 pacing、floor 或
worker recommendation。

若未來要提供「執行中工作也不能穿底」的硬保證，必須另開設計，至少納入 quota
sample timestamp、sample 後未反映消耗 ledger、upcoming dispatch reservation
與 worst-case cost policy。這不是恢復舊乘法公式可以解決的問題。

### 4. 不完整 metadata 走 fallback，不把未知 window 當成滿額

正式來源的短、長視窗剩餘百分比與正數重設資料必須同時可用，控制器才做消耗線
運算。缺欄位、無法解析、非正數重設或監測失敗都回到保守降級；不把未知或過期
重設解讀為「額度全滿、全速跑」。只要回應中出現可辨識的正式來源，該來源無效
就必須立刻安全降級，不得繼續找歷史相容來源來繞過失敗。

歷史 fixture parser 可以留作非規範的開發相容性；`--legacy-quota` 目前不支援
正式 OpenAI 額度輸入，因此不再宣稱它是可用的 operator rollback。操作手冊要
移除這個錯誤復原指引，但這個 proposal 階段不必順手刪除歷史程式碼。

### 5. Observability 描述實際 daemon lifecycle

主迴圈的 `tick`、`dispatch`、`complete` 事件才寫額度歷史；常駐程式啟動時
輪替過期紀錄，完成工作後以有效的單工作行程樣本更新單篇成本指數移動平均。
事件重讀額度失敗時要寫明「不可用」狀態，不得把 `0|-1` 哨兵冒充真實量測；
校準器也必須拒收任一端不可用、缺欄位或含哨兵的樣本。每次主迴圈控制器決策會
更新控制器狀態。`--controller-once` 是純輸出診斷，不假稱一定寫歷史／狀態。
寫檔失敗必須有可見警告或維持安全降級，但可觀測性失敗不應自行開更多工作行程。

替代方案是保留「每次 `controller_tick` 都寫檔」的舊文字。這和 production
diagnostic path 不符，也會讓測試驗證不存在的 side effect，因此不採用。

### 6. Tests 必須執行 production controller

Blocking regression tests 會以 fixture usage monitor 執行
`scripts/tribunal-quota-loop.sh --controller-once`，覆蓋消耗線、較長與相同
欠額、保留底線、執行中工作不參與閘門、混合來源降級與安全閥。生命週期測試另
覆蓋不可用讀值標記與校準拒收。只在 test file
內重寫另一份 Python 公式的 assertions 要移除或改成直接錨定 production
function。

## Risks / Trade-offs

- [把現況正式升成 policy，可能掩蓋現行 policy 的風險] → Draft PR 必須停在
  human checkpoint ①；human 核准前不得 apply。
- [Burn-rate gate 不預扣 in-flight work，執行中的工作可能讓實際剩餘額度穿越
  floor] → Spec 明確限制保證範圍；未來硬 reservation 另開有完整 accounting
  model 的 design。
- [兩個 window 的 reset 或 rounding 邊界可能產生很長 debt] → State 保留完整
  debt 作診斷，daemon 用 bounded live recheck interval 重讀 quota，不無界沉睡。
- [完整替換 requirements 容易漏掉舊 spec 尚有價值的 observability 行為] →
  Delta 逐條列出所有移除理由，新增 requirements 覆蓋歷史輪替、狀態、校準、
  額外用量、降級與正式來源優先序。
- [移除 synthetic tests 可能降低表面 case 數] → 以 production-anchored scenario
  matrix 取代；coverage 以實際 controller branch 為準，不以測試數量為準。

## Migration Plan

1. 在 draft PR 提交 proposal、design、delta spec 與 apply tasks，跑 strict
   OpenSpec validation。
2. 完成一位 proposal reviewer，修正 blocker 後停在 human checkpoint ①。
3. Human 核准 policy 後，才由 builder 依 tasks 更新 production-anchored tests、
   刪除舊 synthetic formula coverage、清理不用的 controller 介面殘影與 runbook。
4. 跑 scenario-to-test 對帳、targeted tests、repo gates 與兩位 implementation
   reviewers。
5. 同一 PR archive change，確認 stable spec Requirements 與 Purpose 都已收斂，
   再停在 human checkpoint ②。
6. 核准後才轉 ready、合併與依 repo SOP 驗證 production。

這個 change 預期不改 production pacing。若 apply 階段發現 contract 暴露真實
edge-case bug，該修正必須有獨立 atomic commit 與 regression test。Rollback
只需 revert 該 code commit；不得靠切回過時 stable spec 或重啟 remote daemon。

## Open Questions

- Human checkpoint ①要決定：是否正式接受現行 burn-rate policy 的保證邊界，
  並把更強的 in-flight reserve guarantee 留給獨立 change；同時接受
  `--legacy-quota` 只剩歷史相容性，不再作為正式 operator fallback。
