## MODIFIED Requirements

### Requirement: Canonical archive SHALL 保留 planning artifacts 並同步 stable specs

每個 canonical PR-new archive SHALL 包含下列 artifacts：`.openspec.yaml`、`proposal.md`、`design.md`、`tasks.md`，以及至少一個 `specs/<capability>/spec.md`。每一項 SHALL 是非空 regular file；只建立 matching directory、空 marker 或無關 dummy file 不得算完成 archive。

若 validation target 有 reachable active snapshot，validator SHALL 以 parent edge 數計算各 snapshot 到 exact head 的最短 graph distance，並選取距離最小的 nearest frontier。frontier 只有一個 snapshot，或多個 snapshots 的 active subtree path sets 完全相同時，Canonical archive 的相對 path set SHALL 是該共同 path set 的 superset；同距離 snapshots 的 path sets 不同時 SHALL fail closed，不得任選較小集合。validator SHALL NOT 把距離更遠的 active snapshots 聯集成額外要求。從未留下 active snapshot 的 direct archive 只適用 mandatory shape 與其自身 delta specs 的 stable-spec sync 要求。

對 canonical archive 內每個 `specs/<capability>/spec.md`，exact head SHALL 存在對應的 `openspec/specs/<capability>/spec.md` regular nonempty blob。若 exact base 不存在該 stable spec，exact head 的 blob SHALL 視為新增；若 exact base 已存在，exact head 的 blob OID SHALL 與 exact base 不同。例外是整個 capability 退役：delta 只有 `## REMOVED Requirements`，exact base 有該 stable spec、exact head 已刪除它。

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

- **WHEN** canonical archive 包含 `specs/<capability>/spec.md`，但 exact head 缺少對應 stable spec（退役除外），或 stable spec 的 blob OID 與 exact base 相同
- **THEN** 該 validation target SHALL 失敗

#### Scenario: Delta spec 與 stable spec 一起完成

- **WHEN** canonical archive 保留 `specs/<capability>/spec.md`
- **AND** exact head 的對應 stable spec 是 exact base 不存在的新 blob、blob OID 相對 exact base 已改變，或該 capability 依上述規則退役
- **THEN** 該 capability SHALL 通過 delta-to-stable 同步檢查

#### Scenario: Stable spec 只有 file mode 改變

- **WHEN** exact head 的 stable spec tree entry 只有 file mode 改變，blob OID 與 exact base 相同
- **THEN** 該 capability SHALL NOT 通過 delta-to-stable 同步檢查
