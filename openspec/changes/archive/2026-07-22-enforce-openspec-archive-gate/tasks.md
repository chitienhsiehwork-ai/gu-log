## 執行原則

清單按依賴關係排列：先固定命令列介面與錯誤分類，再完成生命週期判定，接著用真正的暫存 Git 儲存庫鎖住歷史行為，最後才接入工作流程並更新衍生文件。每個勾選項都必須有可檢查的程式碼、測試或命令輸出；不能因為設計文件已描述預期結果，就把尚未執行的工作視為完成。

builder 只能修改實作、測試、工作流程與衍生說明，不得回頭改寫差異規格來配合程式。若實作發現條文互相衝突、缺少勝利條件或必須改變使用者可見行為，應停止該路徑並交回 controller 處理。合併前的規格同步、正式歸檔與 GitHub 現場探測也由 controller 負責，因此不放進 builder 可自行勾選的完成條件。

驗證結果要分成兩層交付。本機可重現的情境由測試直接證明；平台事件與 ruleset 採用哪次檢查，則要留下可追溯的執行識別與提交證據。前一層未全綠不能進入現場探測，後一層沒有正面證據就維持草稿，兩者都不能以舊的成功結果、手動重跑或口頭說明代替。

## 1. Contract 與 checker 骨架

- [x] 1.1 在 `tests/openspec-archive-gate.test.ts` 建立 delta spec scenario → Tier-1 test case 對照；無法自動化的 live GitHub 行為明列為 Tier-2 rollout evidence，不得用 checkbox 自報代替
- [x] 1.2 新增 `scripts/check-openspec-archive.mjs` CLI，要求完整 `--base <sha>` 與 `--head <sha>`，成功／policy violation／無法判定分別使用 exit `0`／`1`／`2`
- [x] 1.3 實作 fail-closed Git helper：驗證 base/head 都是 commit objects，任何 Git command、tree traversal 或輸出解析失敗立即回 exit `2`，不得 fallback 到 branch ref 或空集合
- [x] 1.4 只從 committed trees 列舉 base active names、HEAD active names、base/head archive entries 與 entry type；不得讀 working tree 或 moving `origin/main`

## 2. Lifecycle 判定

- [x] 2.1 以 `git rev-list <head> --not <base>` 列舉 PR-only reachable commits，對每個 commit tree 收集 active names，並扣除 exact base 已存在的 grandfathered names
- [x] 2.2 建立 validation targets：introduced active names 與所有 PR-new archive entries 的聯集；malformed／unmatched archive entry 不得在 parsing 階段被濾掉
- [x] 2.3 對 introduced name 驗證 HEAD 不再 active，且恰有一個本 PR 新增、日期有效、suffix 完全相符的 canonical archive；舊 archive、裸刪除與多個 matching archives 都要產生 policy finding
- [x] 2.4 對每個 PR-new archive entry 驗證它是一層 canonical directory；即使沒有可見 active snapshot，direct archive 仍須接受完整 shape 與 stable-spec 檢查
- [x] 2.5 對有 active history 的 target，以到 HEAD 的最短 parent-edge distance 找 nearest frontier；同距離 snapshots 的 path sets 相同才共用，不同時 exit `2` fail closed；archive path set 必須涵蓋該最近集合，不得改成所有歷史 snapshots 的 union
- [x] 2.6 依 delta spec 的 normative requirement 驗證 mandatory artifacts 都是非空 regular blobs；不得在 implementation 或 derived docs 建立第二份政策清單
- [x] 2.7 對 archive 內每個 delta capability 驗證 HEAD 有對應非空 stable-spec blob；base 沒有時須為新增 blob，base 已有時 blob OID 必須改變，mode-only change 不算 sync evidence
- [x] 2.8 一次收集並穩定排序所有 policy findings；只有全部 validation targets 通過才 exit `0`，任何已確定 violation exit `1`

## 3. Temp Git repository regression tests

- [x] 3.1 建立隔離的 temp Git repo fixture helper，固定 user/config、建立 commits/branches 並以 exact SHA 呼叫真 CLI，不 mock Git
- [x] 3.2 覆蓋無新 change、base 尚無 `openspec/changes/`、grandfathered active 保留／修改／移除皆通過
- [x] 3.3 覆蓋新 active 留在 HEAD、create→bare delete、active rename，均回 exit `1`
- [x] 3.4 覆蓋完整 create→canonical archive + stable spec sync 與同 commit direct archive，均回 exit `0`
- [x] 3.5 覆蓋重用 base 舊 archive、無效日期／名稱、非 directory entry、零個或多個 matching archives，均回 exit `1`
- [x] 3.6 覆蓋缺 mandatory artifact、空檔、非 regular blob、dummy archive、最近 snapshot 缺 path，均回 exit `1`
- [x] 3.7 覆蓋 stable spec 缺失、blob OID 未變、mode-only change 回 exit `1`；新增或 blob OID 改變才通過
- [x] 3.8 覆蓋多個 changes／archive entries：全部合規才通過，部分違規時診斷列出每個 target 且順序 deterministic
- [x] 3.9 覆蓋 invalid／missing SHA 或 object 與 traversal failure 回 exit `2`；moving remote ref 與 dirty working tree 不得改變 exact-SHA 結果
- [x] 3.10 覆蓋最近 snapshot 而非歷史 union：早期 path 合法撤回後不要求保留，最近 snapshot 的全部 paths 仍必須存在
- [x] 3.11 覆蓋 merge DAG nearest frontier：單一最近 snapshot、同距離同 path set 均可判定；同距離不同 path sets 回 exit `2`

## 4. GitHub Actions wiring

- [x] 4.1 修改 `.github/workflows/ci.yml` 的 `pull_request.types`，保留既有 default events 並加入 `ready_for_review`
- [x] 4.2 新增永遠存在的 Node-only `openspec-archive` leaf：push 與 draft 走 step-level explicit-success no-op；non-draft checkout exact head SHA、完整 history並以 payload exact base/head 執行 checker
- [x] 4.3 把 `openspec-archive` 明列於 `ci-passed.needs`，不得新增 standalone archive workflow、job-level skip、額外 required context、OpenSpec CLI install 或 write permission
- [x] 4.4 新增 workflow 結構 regression，鎖定 `ready_for_review`、exact payload SHAs、step-level defer、leaf 在 aggregator，以及 only-explicit-success 語意

## 5. Derived view 與驗證

- [x] 5.1 更新 `.agents/openspec-sdlc.md` 的現況說明，從「CI 尚未實作」改為指向 `ci.yml` leaf 與 checker；不複製會 drift 的 event／artifact 清單
- [x] 5.2 跑 targeted archive-gate tests，確認每條 Tier-1 scenario 都有忠實對應且全綠
- [x] 5.3 跑 full Vitest、lint、format check、Astro type-check 與 build；若既有 branch/network fixture failure，必須以可重現證據區分，不能標成通過
- [x] 5.4 跑 OpenSpec strict validation，確認 proposal／design／delta spec／tasks 結構與 scenarios 全部有效
- [x] 5.5 交付 scenario→tier 清單與 Tier-2 rollout evidence contract 給 correctness reviewer，並完成獨立 simplify review；所有 Tier-1 綠且無 blocking correctness／simplify finding才算 apply 收斂，實際 Tier-2 probe 不在 apply checkbox 內自報完成

## 6. Controller-owned rollout gates（不屬於 builder apply）

以下依 `.agents/openspec-sdlc.md` 階段 7–9 由 controller 執行，不是 builder 可自行勾選或跳過的實作 task：sync delta spec、canonical archive、draft → ready live feasibility probe、確認 fresh run 採用 event payload 的 exact base／head 且 `ci-passed` 聚合新 leaf、read-only 重查 ruleset、等待完整 CI。任一 live probe 無法證明 fresh ready evidence時，PR 必須維持 draft並停止 rollout，不得用舊 green、手動 rerun或文件宣稱替代。
