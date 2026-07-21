## Context

`.agents/openspec-sdlc.md` 已把「同一個 PR 在 ready 前完成 sync + archive」定成硬性流程，但現行 `.github/workflows/ci.yml` 只有 warn-only 的 `openspec-wall`，沒有 blocking archive gate。現行 branch protection 以 `ci-passed` 作單一 required check；`ci-passed` 對每個 `needs` job 採 positive-match，只有 `success` 可通過，`skipped` 也會擋 merge。

本 gate 要回答的是一個 lifecycle 問題：相對於該次 PR event 的精確 base commit，PR 是否新引入 OpenSpec change，並在同一條可達 commit graph 裡完成 canonical archive 與 stable spec sync。它不是一般檔案 lint，也不能只看 PR 最終 diff，因為 change 可以先建立、後來被直接刪除，最後 diff 不再留下 active path。

以下以 `B` 表示 `github.event.pull_request.base.sha`，以 `H` 表示 `github.event.pull_request.head.sha`：

- **active change**：某個 commit tree 下 `openspec/changes/<name>/` 的一層子目錄，排除 `archive/`。
- **PR-new archive entry**：存在於 `H`、不存在於 `B` 的 `openspec/changes/archive/` 一層子項目；先完整收集，再驗日期、名稱與目錄形狀，因此格式錯誤的新增項目也不會被過濾掉。
- **introduced name**：在 `H` 可達但 `B` 不可達的任一 commit tree 曾是 active change，且同名 change 不在 `B` 的 active set。
- **validation target**：introduced active name 與所有 PR-new archive entries 的 tagged union；同一個 canonical archive 同時對應兩者時只需驗一次，但任一 unmatched／malformed archive entry 仍是獨立 failure。

Stakeholders 是依 OpenSpec SDLC 工作的 controller、builder、reviewer，以及以 `ci-passed` 判斷可否 merge 的 GitHub ruleset。執行環境維持既有 `pull_request` 的 read-only `contents` 權限；checker 只需 Node.js 與 Git，不安裝 OpenSpec CLI 或 package dependencies。

### 閱讀方式

這份設計先固定可相信的證據，再判斷生命週期是否完整。事件提供的兩個提交是唯一邊界；檢查器只讀已提交的 Git 物件，不碰工作目錄，也不追著會移動的遠端分支跑。接著才從可達歷史找出本次變更真正引入的名稱，確認它們沒有停在進行中狀態，並核對歸檔內容與穩定規格是否一起落地。最後才把結果接回既有的單一 CI 聚合點。這個順序很重要：任何前置證據不可靠，就應停止判定，而不是拿後面的檔案形狀猜答案。

設計也刻意把「可以由本機測試證明」與「必須在 GitHub 現場觀察」分開。前者用暫存 Git 儲存庫重現歷史與樹狀態，後者由 controller 在合併前記錄事件轉換與檢查結果。兩邊都不能用文件宣稱代替證據，但也不必把外部平台行為硬塞進單元測試。如此既能維持可重現性，也不會假裝掌握實際上屬於 GitHub 的排程語意。

## Goals / Non-Goals

**Goals:**

- 在既有 PR Fast Gate 加入 Node-only blocking leaf，並由 `ci-passed` 聚合，不新增 required context。
- draft PR 可正常做 proposal/apply；轉 ready 後必須有新的 workflow run，且該 run 使用 exact `B`/`H` 通過 archive gate，舊的 draft green 不得冒充 merge evidence。
- fail closed 地區分 policy violation 與「無法可靠判定」，並讓 log／測試可辨識。
- grandfather `B` 已存在的 active backlog；對本 PR 新引入的 change 與 archive entry，抓到仍 active、bare deletion、非 canonical archive、partial archive 與未 sync stable spec。
- 以 temp Git repositories 編碼 commit-history 行為，而不只測純集合函式。

**Non-Goals:**

- 不清理、強迫歸檔或裸刪除 `B` 已存在的 active backlog。
- 不修改 GitHub ruleset／branch protection，也不建立第二個 required workflow。
- 不在 CI 執行 archive、推論 spec 語意是否正確，或重做 OpenSpec CLI 的 semantic merge。
- 不把 gate 宣稱成 tamper-proof security boundary；不抵抗 PR 自改 workflow/checker、管理者 bypass，或 force-push 後已不可達的歷史。
- 不沿用 PR #482 的 standalone workflow 或 moving `origin/main` 假設。

## Decisions

### D1：放進 `ci.yml`，以永遠存在的 leaf 接上 `ci-passed`

在現有 `pull_request` trigger 明列：

```yaml
types: [opened, synchronize, reopened, ready_for_review]
```

新增 `openspec-archive` job，並把它加入 `ci-passed.needs`。job 不設 job-level `if`：push to main 或 draft PR 走 step-level defer，明確輸出原因並成功結束；只有 non-draft PR 執行 checkout 與 checker。如此 `ci-passed` 看見的結果永遠是 `success` 或真正的 `failure`，不會因 `skipped` 被 positive-match 擋住。

`ready_for_review` 不只是方便觸發，而是狀態轉換後的必要 merge evidence。該次 run 必須以同一個 `H` 執行 non-draft 路徑並重新產生 `ci-passed`；不得沿用 `opened`／`synchronize` 時 draft defer 的成功結果，也不得以手動 rerun 舊 draft payload 代替。

這項行為是 rollout 的 blocking feasibility gate，不是上線後才觀察的假設。merge 前必須用 live draft → ready probe 證明 fresh run 確實產生，且 ruleset 採用該 run 的新 `ci-passed`；任一項無法證明時，PR 維持 draft、停止 rollout 並改設計，不能靠舊 draft green、手動 rerun 或文件宣稱放行。

不把這個 invariant 塞進 `openspec-wall`：後者是 warn-only、檢查 builder/spec commit separation 的不同 policy，也不在 `ci-passed.needs`。兩者合併會讓 rollout 狀態與失敗語意互相綁死。

**不選 standalone workflow：** 現行 ruleset 的單一聚合點就是 `ci-passed`。另一個 workflow 若不是 required check 就可被繞過；若設為 required，則必須 mutation GitHub ruleset，之後 job／workflow 政名也多一個 drift surface。ready 時多跑一次現有 Fast Gate 是可接受的 runner-minute 取捨。

### D2：workflow 只從 event payload 取得 exact commits

non-draft PR checkout 固定：

```yaml
ref: ${{ github.event.pull_request.head.sha }}
fetch-depth: 0
```

workflow 把 `base.sha` 與 `head.sha` 以環境變數傳給 checker；先確認 checkout 的 `HEAD == H`，再以 SHA fetch `B`，並確認兩者都是可解析的 commit object。任何 checkout、fetch、object lookup 或 Git traversal 失敗都阻擋 job；checker 對這類「無法判定」回傳 exit `2`。

**不選 synthetic merge checkout：** `pull_request` 的預設 `GITHUB_SHA`／`refs/pull/*/merge` 是 GitHub 合成的 merge commit，混入 base tree 且會隨 base 更新。它不是 contributor 提交的 exact head，可能讓 base 上已有的 archive 或 spec 修改污染判定。

不接受 branch name、`github.base_ref` 或 `origin/main` 作 fallback。ref 缺失或物件不可用時 fail closed，不把錯誤轉成空集合繼續。

### D3：以 commit-tree union 找 introduced names

checker 從 commit objects 讀 tree，不讀 working tree。核心集合為：

```text
baseActive = activeDirs(B)
prCommits  = commits reachable from H but not reachable from B
introduced = union(activeDirs(C) - baseActive for every C in prCommits)
headActive = activeDirs(H)
newArchiveEntries = archiveEntries(H) - archiveEntries(B)
validationTargets = introduced-name targets union new-archive-entry targets
```

`prCommits` 使用等價於 `git rev-list H --not B` 的 graph traversal；不要求 `B` 必須是 `H` 的 ancestor，因為尚未 update branch 的 PR 可以合法分岔。只要兩個 commit objects 與 traversal 都可用，就以 payload 描述的兩個 graph tips 判定。

union 讓「commit 1 建 active change、commit 2 直接刪除」仍留下 introduced name。`baseActive` 先被扣除，所以 gate 不追溯阻擋既有 backlog；同名 base active 即使在 PR 中被修改或刪除，也不因 introduced-name 規則失敗。

對每個 introduced name：

1. `H` 仍有同名 active directory → policy violation。
2. `newArchiveEntries` 必須恰有一個 basename 為有效 calendar date 加原 change name 的 canonical archive；零個代表 bare deletion，兩個以上代表歧義。
3. 舊的同名 archive 不算本 PR 的收尾證據。

每個 PR-new archive entry 也都是 validation target：basename 必須能解析成合法 calendar date 與非空 change name，entry 必須是 canonical archive directory，並接受 D4 的 artifact 與 stable-spec 檢查。這項驗證不以 introduced set 為前提，所以 malformed／unmatched entry 會失敗；PR history 沒有可見 active snapshot 的完整 direct archive 則仍可通過。若同一 entry 已是 introduced name 的 matching archive，共用同一份 D4 結果，不重複建立另一套規則。

如果 create/delete 在 push 前已被 squash 或 force-push 成不可達歷史，Git graph 沒有可觀測證據，gate 不宣稱能偵測；這屬於 cooperative threat boundary，而不是再引入外部 state store 的理由。

### D4：archive 證明採 path completeness 與 stable-spec blob evidence

canonical archive 的 mandatory artifact set 只由 delta spec 的「Canonical archive SHALL 保留 planning artifacts 並同步 stable specs」requirement 列舉；本 design 不複製第二份清單。checker constant 與 fixtures 必須對齊該 normative set，schema policy 改動時先改 delta spec，再同步 implementation。

每個 PR-new archive entry 都要符合該 mandatory set。若同名 active change 曾出現在 `prCommits`，checker 以 parent edge 數計算每個 active snapshot 到 `H` 的最短 graph distance，選出距離最小的 nearest frontier。frontier 只有一個 commit，或多個 commits 的 active subtree path sets 完全相同時，該共同 path set 就是最近 snapshot；若同距離 commits 的 path sets 不同，checker 以 exit `2` fail closed，不任選較小集合。archive 的相對 path set 必須是最近 snapshot 的 superset。這裡刻意不取所有歷史 snapshot 的 path union：早期草稿中後來合法撤回的 path 不應被重新塞回 final archive。沒有可見 active snapshot 的 direct archive，則以 normative mandatory set 作 completeness floor。

對 archive 內每個 `specs/<capability>/spec.md`，`H` 都必須存在 `openspec/specs/<capability>/spec.md`。若 `B` 沒有該 stable spec，其 `H` blob 是新增 evidence；若 `B` 已存在，`H` 的 blob OID 必須不同。只改 file mode 或其他未改變 blob OID 的 tree metadata 不算 sync evidence。內容是否忠實套用 delta，仍由 spec scenario review 負責。

本 leaf 只驗 committed path、file shape 與 Git blob evidence；不呼叫 OpenSpec CLI、不載入 schema validator，也不在 checker 內重做 semantic validation。

**不選 strict tree-OID proof：** 要求 active tree 與 archive tree object 完全相同，會把 archive 前完成 task checkbox、補設計說明或加入合法 metadata 視為失敗，也無法證明 stable spec 已 sync。path completeness 加 stable-spec diff 比 byte-for-byte identity 更貼近 lifecycle contract。

### D5：錯誤分類固定為 0／1／2

- exit `0`：所有可適用檢查通過；draft／push defer 由 workflow step 處理，不呼叫 checker。
- exit `1`：可確定的 policy violation，例如 introduced change 仍 active、bare deletion、archive 數量／名稱／shape 不符、stable spec 缺失或未修改。
- exit `2`：無法可靠判定，例如參數不是完整 SHA、commit object 不存在、Git command／tree traversal 失敗或輸出不可解析。

checker 應收集同一類 policy findings 後一次列出，方便一輪修完；operational failure 則立即停止，禁止退化成空結果。GitHub job 對 exit `1`／`2` 都是 blocking failure，但不同訊息可區分「修 lifecycle」與「修 CI／Git evidence」。

### D6：以 temp Git repo 測 graph contract

Vitest 在 `mkdtemp` 建立真正的 Git repository，建立 commits／branches 後以 exact SHA 呼叫 checker。最低矩陣涵蓋：

- 無新 change、base active 保持或被修改：pass。
- 新 active 留在 `H`：exit `1`。
- create → raw delete 的多 commit history：exit `1`。
- create → canonical archive，planning artifacts 完整且 stable specs 已修改：pass。
- 重用舊 archive、零／多個 matching archive、假日期、partial path set：exit `1`。
- stable spec 不存在、blob OID 相對 `B` 未新增／改變，或只有 mode-only change：exit `1`。
- 同一 commit 直接加入完整 canonical archive：pass；同樣沒有 active snapshot、但 archive entry 的名稱／形狀 malformed：exit `1`。
- 早期 active snapshot 曾有、nearest snapshot 已合法移除的非 mandatory path，不要求 archive 保留；不得改用所有歷史 path union。
- invalid／missing object 與 Git traversal failure：exit `2`，不可 fail open。
- 多個 change 必須全部合規；任一 violation 即 exit `1`。

另做 workflow 結構 regression：`ready_for_review` 存在、archive leaf 位於 `ci-passed.needs`、job 沒有 job-level skip，且 checkout／checker steps 使用 payload 的 exact SHAs。

### D7：不採 final diff 或 GitHub files API

`git diff B H` 與 GitHub PR files API 都描述最終狀態，無法看見中途建立後刪除的 active directory；files API 另增加 pagination、截斷、網路與 API availability 變因。Git objects 已由 checkout/fetch 提供，直接掃 `H --not B` 的 commit trees 能在同一個 trust/evidence surface 解決問題，沒有增加 API dependency 的價值。

### D8：安全邊界是 cooperative lifecycle guard

workflow 以 `pull_request`、`contents: read` 執行，不取 secrets、不寫 repo，也不用 `pull_request_target`。它防的是 cooperative agent/operator 忘記 archive、誤做 bare deletion 或 partial sync。

PR 可以在同一個 head 修改 checker、tests 或 workflow；force-push 可以抹掉未再可達的 commits；ruleset admin 也能改 policy。這些都不在本 gate 的防護承諾內。若未來 threat model 變成 hostile contributors，應另設 base-owned reusable workflow／GitHub App 或外部 verifier，而不是把本 change 膨脹成假裝 tamper-proof 的機制。

## Risks / Trade-offs

- **[Risk] `ready_for_review` 在修改 event wiring 的 bootstrap PR 上未依 head 版 workflow 觸發。** → merge 前做 live disposable draft probe；必須觀察到 transition 後的新 workflow run、相同 `H` 的 non-draft archive leaf，以及該 run 新產生的 `ci-passed`。未證明前不得把舊 draft green 當 evidence，也不得用手動 rerun 舊 payload 代替。
- **[Risk] GitHub 對 fork PR 的 exact head checkout 或從 `origin` fetch exact base SHA 行為不同。** → 先測 same-repo PR；若 external forks 是支援範圍，再用 disposable fork probe 驗證，必要時改為明確的 base/head dual remotes。任何未支援形狀都 fail closed。
- **[Risk] GitHub ruleset 對同一 SHA 上舊 draft check 與新 ready check 的選取不如預期。** → live probe 檢查 required context 確實等待 transition 後的 run；若無法保證，停止 rollout 並另提 base-owned evidence 設計，不靠文件承諾補洞。
- **[Risk] 掃描每個 PR-only commit tree 比 final diff 慢。** → 只列目錄與相對 path，不讀 blob；先以真實大型 PR 測量。若日後超時，再以 tree OID cache 去重相同 trees，不先加入 cache 複雜度。
- **[Risk] merge DAG 對「latest active snapshot」可能有多條 side branch。** → 以到 `H` 的最短 parent-edge distance 找 nearest frontier；同距離 snapshots 的 path sets 相同就共用該集合，不同就 exit `2` fail closed。加入 merge fixture 鎖定單一路徑、同集合 tie 與歧義 tie，不任選較小 path set。
- **[Risk] planning artifact graph 日後由 OpenSpec schema 改版。** → mandatory set 以 normative delta spec 為單一列舉處；schema 升級時先更新該 requirement，再同步 checker 與 fixtures，不以寬鬆 fallback 默默放行。
- **[Trade-off] base active 可裸刪除而不被本 gate 擋。** → 這是 proposal 明定的 grandfathering 邊界；若要治理舊 backlog，另開 cleanup change，不在本 gate 擴大 scope。
- **[Trade-off] stable spec「有修改」不等於 semantic sync 正確。** → CI 負責 gross lifecycle evidence；正確性 reviewer 仍逐條對 delta scenario，避免在 Node script 重做 OpenSpec merge engine。

## Migration Plan

1. 在同一個 draft PR 完成 delta spec、checker、temp-repo tests、`ci.yml` leaf／aggregate wiring，以及 `.agents/openspec-sdlc.md` derived view 更新；draft run 只產生 defer success。
2. 以 disposable same-repo draft PR 或本 bootstrap PR 執行 blocking feasibility probe：記錄 ready transition 前後的 run ID、head SHA、event payload action、archive leaf 路徑與 `ci-passed` 結果。必須同時證明 transition 產生 fresh ready run、該 run 實際走 non-draft checker、ruleset 採用其新 `ci-passed`。任一項無法證明就維持 draft、停止 rollout 並改設計；不得 merge，也不得用舊 green 或手動 rerun 替代。
3. feasibility gate 通過且實作與雙審收斂後，controller 才先把 delta sync 到 `openspec/specs/spec-driven-review-loop/spec.md`，再把完整 change move 到 canonical dated archive，commit 仍留在同一個 PR。
4. 將 PR 轉 ready；確認新 run 使用 exact `B`／`H`、checker 驗到本 change 自己的新 archive 與 stable spec 修改，且 `ci-passed` 聚合該 leaf。
5. merge 前 read-only 重查 live ruleset 仍只要求 `ci-passed`；本 rollout 不做任何 ruleset mutation。

Rollback 分兩層：

- **merge 前設計或合約需改：** revert 單一 sync+archive commit，讓 change 回到 active 並回復 stable spec，再修 proposal/design/spec/tests，重新 sync+archive 與 ready evidence。
- **merge 後 gate regression：** 走新的 PR revert `ci.yml` leaf、checker/tests 與 synced requirement；保留原 archive 作歷史證據。若 malformed workflow 讓 required `ci-passed` 根本無法建立，使用既有 ruleset 管理／revert rescue path；不預埋 bypass label、warning mode 或 kill switch。

## Open Questions

以下不是 implementation 自行猜測的項目，必須以 live GitHub probe 在 merge 前關閉：

1. 已存在於 default branch 的 `ci.yml`，在 bootstrap PR 只於 head 新增 `ready_for_review` type 時，GitHub 是否會為該次 transition 排出 head 版 workflow？
2. 同一個 `H` 先有 draft defer success、後有 ready run 時，ruleset 是否穩定採用後者作最新 `ci-passed` evidence？
3. repo 是否承諾支援 fork PR；若是，exact head checkout 與 exact base fetch 的 dual-remote 形狀為何？

任一前兩項未獲正面證據即阻擋 rollout；第三項若不在目前協作模型內，可明確記為 unsupported 並讓該形狀 fail closed。
