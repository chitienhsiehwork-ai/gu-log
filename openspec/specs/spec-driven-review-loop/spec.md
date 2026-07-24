# spec-driven-review-loop Specification

## Purpose

定義 OpenSpec 的三層指揮鏈、executable-first bounded review、spec delta 唯讀牆、explore-first escalation 與 exact-tree archive gate，讓變更能以正確性和簡潔度共同收斂。

## Requirements

### Requirement: 指揮鏈 SHALL 分三層角色

SDLC SHALL 明訂三層角色，每一層只做自己那層的事：

- **human = coach**：定高層方向、拍板 critical design decision（產品方向 / 架構 / 對外承諾 / 品牌調性）。只停在 #481 既有的介入點——`opsx explore`（釐清 intent）、審 proposal（檢查點①）、終審（檢查點②），以及 escalation 例外；不落到 micro。
- **main agent（local machine actor / CCC）= controller / orchestrator**：不做實作重活，負責拆 task、給 spec、聚合驗收、當 coach 的對話介面，context 維持乾淨。
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

### Requirement: Archive gate SHALL 維持單一 CI aggregate surface

PR Fast Gate SHALL 在既有 workflow 內執行 archive validation leaf，並把該 leaf 明列於既有 `ci-passed.needs`。Archive gate SHALL NOT 另建 standalone workflow，也 SHALL NOT 另設脫離 `ci-passed` 的 archive 專用 status context。

`ci-passed` SHALL 只把 archive leaf 的結果字面值為 `success` 視為此 dependency 通過；任何其他值、缺席或尚未完成都 SHALL 視為 non-success。對同一 workflow 的 `push` event，archive leaf SHALL 實際執行 no-op 路徑並明確回報 `success`，不得以 job-level condition 讓 leaf 被跳過或缺席。

#### Scenario: Ready PR 的 archive leaf 失敗

- **WHEN** ready PR 的 archive validation leaf 回報 failure
- **THEN** 同一次 workflow run 的 `ci-passed` SHALL NOT 回報 success
- **AND** failure SHALL NOT 被 defer、warning 或其他非 `success` 值當成通過

#### Scenario: Push event 不需要判定 PR archive

- **WHEN** 既有 workflow 由 `push` event 觸發
- **THEN** archive leaf SHALL 執行 no-op 路徑並明確回報 success
- **AND** `ci-passed` 看到的 leaf 結果 SHALL 是字面值 `success`

#### Scenario: Archive gate 維持既有 aggregate 介面

- **WHEN** archive gate 接入 PR Fast Gate
- **THEN** archive leaf SHALL 出現在既有 `ci-passed.needs`
- **AND** repo SHALL NOT 新增 standalone archive workflow 或脫離 `ci-passed` 的 archive 專用 status context

### Requirement: Archive 判定 SHALL 綁定事件的 exact committed trees

Archive validator SHALL 使用該次事件固定的 exact base commit 與 exact head commit 作為唯一判定邊界，並從兩者的 committed trees 讀取狀態。它 SHALL NOT 以 `origin/main`、branch name、當下 remote tip、推測的 merge base，或 working tree 取代任一輸入。

若 exact base/head SHA 缺失、不是可解析的 commit、其 tree 無法讀取，或 validator 無法完整列舉指定 commit 範圍，archive leaf SHALL fail closed；不得把無效輸入降級成空 diff、空歷史或通過結果。有效 committed tree 中單純不存在 `openspec/changes/` 路徑則 SHALL 視為空的 active set，而不是輸入錯誤。

#### Scenario: Remote branch 在 workflow 執行期間移動

- **WHEN** 事件已固定 exact base/head commits，之後 remote branch tip 又移動
- **THEN** validator SHALL 仍只比較事件指定的兩棵 committed trees
- **AND** 判定結果 SHALL NOT 因 moving ref 改變

#### Scenario: Exact commit 輸入缺失或無效

- **WHEN** exact base/head SHA 任一缺失、無法解析成 commit，或其 tree 無法完整讀取
- **THEN** archive leaf SHALL 回報 non-success
- **AND** validator SHALL NOT 以空歷史或其他 ref 繼續並放行

#### Scenario: 有效 base tree 尚無 changes 目錄

- **WHEN** exact base commit 與 tree 都有效，但 tree 中尚不存在 `openspec/changes/`
- **THEN** validator SHALL 將 base active set 判為空集合
- **AND** SHALL 繼續依 exact head 與 PR commit graph 做完整判定

### Requirement: Base-active change names SHALL 被 grandfather

Validator SHALL 先從 exact base tree 取得 active change names；任何在 base 已位於 `openspec/changes/<name>/`（`<name>` 不含保留目錄 `archive`）的名稱 SHALL 被 grandfather，不因本 PR 仍保留、修改或移除該名稱而產生本 gate 的新 archive 義務。Grandfather SHALL 只按名稱與 exact base tree 決定，不得讓同一 PR 新引入的其他名稱一併豁免。

#### Scenario: PR 保留既有 active change

- **WHEN** `<legacy>` 在 exact base tree 已是 active change，且 exact head 仍保留 `<legacy>`
- **THEN** archive gate SHALL NOT 要求本 PR archive `<legacy>`

#### Scenario: Grandfathered change 與新 change 並存

- **WHEN** exact base 已有 `<legacy>`，但 PR commit graph 另出現 base 不存在的 `<new>`
- **THEN** validator SHALL 只豁免 `<legacy>`
- **AND** `<new>` SHALL 仍接受全部 archive lifecycle 檢查

### Requirement: Validation targets SHALL 涵蓋 introduced active names 與所有 PR-new archive entries

Validator SHALL 列舉所有「可從 exact head 抵達、但不可從 exact base 抵達」的 PR commits。只要非 grandfathered 名稱曾在其中任一 committed tree 以 `openspec/changes/<name>/` active change 出現，該名稱就 SHALL 成為 introduced-name obligation；後續 commit 的 bare deletion、rename 或暫時消失不得讓 obligation 消失。

Validator 亦 SHALL 列舉 exact head 的 `openspec/changes/archive/` 下，相對 exact base 新增的所有一層 entries，不論該 entry 是否為目錄、名稱是否 canonical，或 PR history 是否曾留下對應 active snapshot。Validation targets SHALL 是 introduced-name obligations 與全部 PR-new archive entries 的聯集；任一 target 違規都 SHALL 使 archive leaf 失敗。

每個 introduced-name obligation 在 exact head tree SHALL 同時滿足：

1. `openspec/changes/<name>/` 已不再是 active change。
2. 恰有一個 PR-new archive directory 位於 `openspec/changes/archive/YYYY-MM-DD-<name>/`；日期段 SHALL 是合法日曆日期，suffix SHALL 與 `<name>` 完全一致。
3. 該 archive path 在 exact base tree 不存在、在 exact head tree 存在；base 已有的 archive 不得重用為本 PR 的完成證據。

每個 PR-new archive entry SHALL 本身是符合 `YYYY-MM-DD-<name>` 的一層 directory，其中日期為合法日曆日期、`<name>` 非空。名稱或 path type 不合規的 PR-new entry SHALL 直接失敗，不得因無法配對 introduced name 而從 validation targets 消失。即使同一個 commit 直接加入 archive、從未留下 active snapshot，該 entry 仍 SHALL 接受完整 archive shape 與 stable-spec sync 檢查。

#### Scenario: Active change 在後續 commit 被直接刪除

- **WHEN** `<new>` 曾在一個 reachable PR commit 中是 active change，但 exact head 只刪除它且沒有 PR-new canonical archive
- **THEN** `<new>` 的 obligation SHALL 失敗
- **AND** bare deletion SHALL NOT 被視為 archive

#### Scenario: Active change 仍留在 HEAD

- **WHEN** 非 grandfathered `<new>` 曾出現在 reachable PR commit，且 exact head 仍有 `openspec/changes/<new>/`
- **THEN** archive gate SHALL 失敗，即使 exact head 同時有名稱相符的 archive directory

#### Scenario: HEAD 有且僅有一個新 canonical archive

- **WHEN** `<new>` 已從 exact head 的 active changes 消失
- **AND** exact head 恰有一個 base 不存在、日期合法且 suffix 完全相符的 `archive/YYYY-MM-DD-<new>/`
- **THEN** `<new>` SHALL 通過 archive path 與數量檢查

#### Scenario: Archive 重用、格式錯誤或不唯一

- **WHEN** `<new>` 只對應到 exact base 已存在的 archive、日期無效、suffix 不同，或 exact head 有多個 matching archives
- **THEN** `<new>` 的 obligation SHALL 失敗

#### Scenario: 同一個 commit 直接加入 canonical archive

- **WHEN** PR-new canonical archive 從未在 reachable PR history 留下同名 active snapshot
- **THEN** 該 archive entry SHALL 仍成為 validation target
- **AND** SHALL 只有在完整通過 mandatory shape 與 stable-spec sync 檢查後才可通過

#### Scenario: PR-new archive entry malformed

- **WHEN** exact head 相對 exact base 新增一個 archive 一層 entry，但它不是 directory、日期無效、名稱為空或不符合 canonical path
- **THEN** archive leaf SHALL 失敗
- **AND** validator SHALL 直接診斷該 entry，不得因它無法對應 introduced name 而忽略

#### Scenario: PR 內 rename active change

- **WHEN** reachable PR history 先出現 active `<old>`，之後改名為 base 不存在的 active `<new>`
- **THEN** `<old>` 與 `<new>` SHALL 各自成為 obligation
- **AND** 任一名稱未在 exact head 滿足完整 archive 條件時，archive gate SHALL 失敗

### Requirement: Canonical archive SHALL 保留 planning artifacts 並同步 stable specs

本 requirement 是本 capability 對 `spec-driven` mandatory archive shape 的唯一列舉。每個 canonical PR-new archive SHALL 包含下列 artifacts：`.openspec.yaml`、`proposal.md`、`design.md`、`tasks.md`，以及至少一個 `specs/<capability>/spec.md`。每一項 SHALL 是非空 regular file；只建立 matching directory、空 marker 或無關 dummy file 不得算完成 archive。

若 validation target 有 reachable active snapshot，validator SHALL 以 parent edge 數計算各 snapshot 到 exact head 的最短 graph distance，並選取距離最小的 nearest frontier。frontier 只有一個 snapshot，或多個 snapshots 的 active subtree path sets 完全相同時，Canonical archive 的相對 path set SHALL 是該共同 path set 的 superset；同距離 snapshots 的 path sets 不同時 SHALL fail closed，不得任選較小集合。validator SHALL NOT 把距離更遠的 active snapshots 聯集成額外要求。從未留下 active snapshot 的 direct archive 只適用 mandatory shape 與其自身 delta specs 的 stable-spec sync 要求。

對 canonical archive 內每個 `specs/<capability>/spec.md`，exact head SHALL 存在對應的 `openspec/specs/<capability>/spec.md` regular nonempty blob。若 exact base 不存在該 stable spec，exact head 的 blob SHALL 視為新增；若 exact base 已存在，exact head 的 blob OID SHALL 與 exact base 不同。只有 file mode 或其他不改變 blob OID 的 tree metadata 變化 SHALL NOT 算完成 sync。

#### Scenario: Archive 包含 mandatory spec-driven artifacts

- **WHEN** validator 檢查一個 canonical PR-new archive
- **THEN** archive SHALL 包含非空 regular file `.openspec.yaml`、`proposal.md`、`design.md`、`tasks.md`
- **AND** SHALL 包含至少一個非空 regular file `specs/<capability>/spec.md`

#### Scenario: Archive 保留最近 active snapshot frontier 的相對 paths

- **WHEN** `<new>` 有多個 reachable active snapshots，且到 exact head 距離最小的 frontier 只有一個 path set
- **THEN** exact head 的 canonical archive path set SHALL 是該最近 frontier path set 的 superset
- **AND** 距離更遠的 snapshots 已移除的 paths SHALL NOT 被聯集成額外 archive 義務

#### Scenario: Merge DAG 的最近 snapshots 互相矛盾

- **WHEN** `<new>` 有多個到 exact head 距離相同的最近 active snapshots，但它們的 active subtree path sets 不同
- **THEN** validator SHALL fail closed 為無法可靠判定
- **AND** SHALL NOT 任選其中一個 path set 或取較小集合放行

#### Scenario: Matching archive 只是 dummy shape

- **WHEN** exact head 有名稱與日期皆 canonical 的 archive directory，但缺少任一 mandatory artifact、缺少最近 active snapshot 的相對 path、artifact 不是 regular file，或檔案為空
- **THEN** 該 validation target SHALL 失敗

#### Scenario: Delta spec 未產生新 stable-spec blob

- **WHEN** canonical archive 包含 `specs/<capability>/spec.md`，但 exact head 缺少對應 stable spec，或 stable spec 的 blob OID 與 exact base 相同
- **THEN** 該 validation target SHALL 失敗

#### Scenario: Delta spec 與 stable spec 一起完成

- **WHEN** canonical archive 保留 `specs/<capability>/spec.md`
- **AND** exact head 的對應 stable spec 是 exact base 不存在的新 blob，或 blob OID 相對 exact base 已改變
- **THEN** 該 capability SHALL 通過 delta-to-stable 同步檢查

#### Scenario: Stable spec 只有 file mode 改變

- **WHEN** exact head 的 stable spec tree entry 只有 file mode 改變，blob OID 與 exact base 相同
- **THEN** 該 capability SHALL NOT 通過 delta-to-stable 同步檢查

### Requirement: 多個 validation targets SHALL 全數獨立通過

同一 PR 出現多個 introduced-name obligations 或 PR-new archive entries 時，validator SHALL 對 validation targets 聯集中的每一項獨立執行適用的 canonical path、active-at-HEAD、archive shape、snapshot path completeness 與 delta-to-stable 檢查。只有全部 targets 都通過時 archive leaf 才能成功；任一 target 失敗 SHALL 使 leaf 失敗，診斷 SHALL 至少列出每個違規名稱或 entry path 及其失敗條件。

#### Scenario: 一個 change 完成但另一個只刪除

- **WHEN** PR 引入 `<one>` 與 `<two>`，其中 `<one>` 完整 archive，但 `<two>` 只有 bare deletion
- **THEN** archive leaf SHALL 失敗
- **AND** 診斷 SHALL 指出 `<two>` 缺少的 archive evidence

#### Scenario: 多個 changes 全部完成

- **WHEN** PR 內每個 introduced-name obligation 都在 exact head 通過各自全部檢查
- **AND** 每個 PR-new archive entry 都在 exact head 通過各自適用的檢查
- **THEN** archive leaf SHALL 通過 archive lifecycle 判定

### Requirement: Draft defer SHALL NOT 成為 ready merge evidence

Draft PR MAY 暫緩完整 archive enforcement，讓 proposal review 繼續；但任何 draft 階段的結果 SHALL NOT 被當成 ready PR 的 archive evidence。`ready_for_review` SHALL 觸發一個針對當下 exact base/head commits 的 fresh workflow run；該 run 的 archive leaf SHALL 實際執行完整判定，且結果字面值為 `success`，fresh `ci-passed` 才能把此 dependency 視為通過。

#### Scenario: Draft 在相同 head SHA 轉為 ready

- **WHEN** draft PR 曾 defer archive gate，之後未新增 commit 就觸發 `ready_for_review`
- **THEN** workflow SHALL 為該 ready transition 建立 fresh run
- **AND** SHALL 重新執行完整 archive validation，而不是沿用 draft 結果

#### Scenario: Ready run 的 archive leaf 未明確成功

- **WHEN** `ready_for_review` 的 fresh run 中 archive leaf 結果不是字面值 `success`、缺席或尚未完成
- **THEN** fresh `ci-passed` SHALL NOT 回報 success
- **AND** workflow SHALL NOT 把 defer、warning 或其他結果當成通過

#### Scenario: Ready run 完整通過

- **WHEN** `ready_for_review` 的 fresh run 對當下 exact base/head 完成 archive validation 並明確成功
- **THEN** fresh `ci-passed` SHALL 將結果字面值為 `success` 的 archive leaf 視為此 dependency 通過
