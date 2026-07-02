# spec-driven-review-loop Specification

## Purpose

定義 gu-log openspec SDLC 階段 6（實作審查）的收斂與升級行為，強化 `.agents/openspec-sdlc.md`（#481）。核心不變量：**一條 behavior-level spec scenario 同時是 coach 的 gate、reviewer 迴圈的 rubric、與 escalation 的邊界。** 所有 requirement 寫在「可觀察行為」海拔，不綁實作細節。

## ADDED Requirements

### Requirement: 指揮鏈 SHALL 分三層角色

SDLC SHALL 明訂三層角色，每一層只做自己那層的事：

- **human = coach**：定高層方向、拍板 critical design decision（產品方向 / 架構 / 對外承諾 / 品牌調性）。只停在 #481 既有的介入點——`opsx explore`（釐清 intent）、審 proposal（檢查點①）、終審（檢查點②），以及 escalation 例外；不落到 micro。
- **main agent（mac-CC / CCC）= controller / orchestrator**：不做實作重活，負責拆 task、給 spec、聚合驗收、當 coach 的對話介面，context 維持乾淨。
- **subagents = workers**：builder（做實作）與 reviewer（審產出、產逐條 verdict），各自獨立 context。

#### Scenario: 角色不越界

- **WHEN** 一個實作任務進入階段 5–6
- **THEN** controller SHALL 把實作外包給 builder、把逐條判定外包給 reviewer，自己不下海寫 code
- **AND** controller SHALL 聚合 reviewer verdict + 測試結果做收斂判定（= #481 的「驗收」職責），不把收斂判定讓渡給單一 reviewer
- **AND** 只有 critical design decision SHALL 上呈 human coach，其餘 SHALL 在 worker 層收斂

### Requirement: 收斂訊號 SHALL executable-first

階段 6 的「過關」SHALL 優先以可執行驗證判定，而非 reviewer 主觀滿意：

- scenario 能編成測試者走 **Tier-1**：對應測試綠才算該 scenario 對上。
- 真的無法自動化者落 **Tier-2**：LLM reviewer 照 scenario 文字逐條判定「對上／未對上」（binary，非分數）。
- **Tier-3**（checkbox 自報）SHALL NOT 作為唯一收斂依據。

#### Scenario: 可測 scenario 以測試判定

- **WHEN** 一條 scenario 對應得到一個可執行測試
- **THEN** 收斂 SHALL 要求該測試實際通過（綠）
- **AND** builder / reviewer 的「我覺得做好了」SHALL NOT 取代測試結果

#### Scenario: 不可測 scenario 才用 LLM judge

- **WHEN** 一條 scenario 無法編成自動化測試
- **THEN** reviewer SHALL 照 scenario 文字逐條判定並輸出機器可讀 verdict（對上／未對上）
- **AND** 該判定 SHALL 標記為 Tier-2（主觀），供 controller 聚合與 coach 終審時辨識

#### Scenario: Tier 分類與測試對應 SHALL 被覆核

- **WHEN** builder 在 apply 把各 scenario 分為 Tier-1 / Tier-2
- **THEN** builder SHALL 交出 scenario→tier 清單（Tier-1 附對應測試）
- **AND** 正確性 reviewer SHALL 覆核分類與 test↔scenario 對應是否忠實（不是把難搞的 scenario 塞去 Tier-2、或用一個不真的編碼該 scenario 的綠測試充數）
- **AND** reviewer MAY 把「不可測」宣稱打回 Tier-1

### Requirement: 收斂 SHALL 同時錨正確性與簡潔度

階段 6 維持 #481 雙審：正確性 reviewer 錨 spec scenario、簡潔度 reviewer 錨 over-engineering。**收斂定義 = 「所有 scenario 對上」AND「簡潔度 reviewer 無未解 blocking finding」**，取代 #481 的「reviewer 滿意」。正確性 reviewer SHALL 把該 change 的 spec scenario 當評分 rubric 逐條對帳；scenario 只描述「行為存在與否」，抓不到臃腫，所以簡潔度那一軌 SHALL NOT 被收斂定義省略。

#### Scenario: 收斂以列舉而非感覺判定

- **WHEN** 一輪雙審完成
- **THEN** 正確性 reviewer 輸出 SHALL 列出每一條 scenario 的對上 / 未對上狀態（含所屬 Tier）
- **AND** 任一 scenario 未對上、或簡潔度 reviewer 有未解 blocking finding 時 SHALL NOT 判為收斂

### Requirement: 審查迴圈 SHALL 有界

階段 6 的 iterate SHALL 有輪數上限（max-N）。耗盡上限仍未收斂 SHALL 升 coach，不得無界重試。此升 coach SHALL 視為落入 #481 既有的「critical design decision」例外，**不是新增第三個人類檢查點**——維持 #481「中間全自動、只在 critical decision 才打斷」的語意。

#### Scenario: 達上限即升級

- **WHEN** builder↔reviewer 迭代達到 max-N 輪仍未讓所有 scenario 對上（或簡潔度仍有 blocking finding）
- **THEN** 迴圈 SHALL 停止並升 coach
- **AND** 升級內容 SHALL 帶上未對上的 scenario 清單與未解的簡潔度 finding

### Requirement: Escalation SHALL 先 explore 再 propose

升 coach 浮上來的是「問題」不是「答案」。升級 SHALL 先進 `opsx explore` 釐清 intent / 範圍，確認後才決定改法，不得跳過 explore 直接生完整 change。

#### Scenario: 卡關升級的順序

- **WHEN** worker 層因 design decision 卡關而升 coach
- **THEN** 預設 SHALL 先 `opsx explore`
- **AND** 只有當解法明顯、無 ambiguity 時 MAY 跳過 explore（不把 explore 儀式化）

### Requirement: Builder SHALL NOT 改 spec delta

builder 的 writable scope SHALL 排除 openspec spec 檔（`openspec/**/specs/**/*.md`，同時涵蓋 main specs 與 change delta；scenario = 合約，對 builder 唯讀）。需要改一條 scenario 才能修好 = 勝利條件變了 = design decision，SHALL 撞唯讀牆並自動升 coach。**此唯讀牆在 apply（階段 5）即生效**；撞牆產生的 escalation 訊號跨階段 5→6，不是只在階段 6 審查迴圈內判定。階段 7 archive 動 main specs 的是 controller，不受此牆限制。

> 唯讀牆的**強制形態**（runtime hook / 近似 CI / doc+reviewer）尚未定案，是需 coach 拍板的方向決策，見 design.md D4。本 requirement 只定「builder 對 spec 唯讀」這個 behavior，不綁強制手段。

#### Scenario: 改合約即升級

- **WHEN** builder 發現非改一條 spec scenario 不可才能讓實作對上
- **THEN** builder SHALL NOT 自行修改 spec delta
- **AND** SHALL 停手並以「需變更合約」為由升 coach（走 explore-first）
- **AND** coach 核可後 SHALL 由 controller（非 builder）改 spec delta，迴圈以新合約重啟、max-N 輪數重計

#### Scenario: 純實作修正不升級

- **WHEN** bug 只需改 code / tasks 即可讓既有 scenario 對上
- **THEN** builder SHALL 在同一個 PR in-lane atomic 修，不升 coach、不開新 change
