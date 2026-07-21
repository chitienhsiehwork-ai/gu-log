## ADDED Requirements

本 capability 是給合作中的 agent／operator 使用的 lifecycle guard，只判定事件所指定、目前仍可從 PR head 抵達的 commit graph。它不是 security boundary，也不承諾抵抗 PR 同時修改 checker／workflow，或 force-push 擦除已不可達歷史。

下列條文依實際判定順序排列。第一層先規定 CI 只有一個聚合出口，避免檢查存在卻沒有真正參與合併決策。第二層固定事件提供的提交與已提交樹狀態，讓每次執行都能重現同一份證據。第三層區分原本就存在的進行中變更與本次新引入的變更，只讓後者承擔新的收尾義務。第四層從可達提交歷史保留義務，即使中途建立的目錄後來被直接刪除，也不能因此消失。第五層才檢查歸檔目錄、規劃文件與穩定規格是否完整對應。最後一層處理草稿轉為可審查狀態時的全新執行證據。

這個排序同時界定錯誤責任。輸入物件不存在、提交歷史無法完整走訪，或合併圖上出現無法可靠選擇的最近快照，都屬於無法判定，必須直接擋下；已能可靠判定但缺少歸檔、檔案形狀不合或穩定規格未同步，則是明確的政策違規。兩者都不能合併，但診斷必須讓維護者看得出應該修執行環境，還是修變更本身。

條文只約束合作流程可觀察到的證據，不把這道檢查包裝成敵對安全邊界。若提交者同時竄改檢查器、工作流程或可達歷史，應由更高層、由基準分支掌控的機制處理。這裡選擇清楚且可測的責任範圍，目的是防止正常協作漏掉收尾，而不是用複雜機制製造虛假的安全感。

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
