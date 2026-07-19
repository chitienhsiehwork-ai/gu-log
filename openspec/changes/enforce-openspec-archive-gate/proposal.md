## Why

gu-log 已把 archive-before-merge 寫成 OpenSpec SDLC 的硬性政策，但目前 CI 沒有對應的機器 gate，完成的 change 仍可能留在 active 目錄，讓 `openspec/specs/` 的穩定 SSOT 落後。舊 PR #482 曾嘗試補洞，但它已經過時，且另建 required workflow 會繞開現有 `ci-passed` 單一聚合點；現在需要一個符合現行 CI 架構的精簡替代方案。

## What Changes

- 在既有 PR Fast Gate 裡加入 blocking archive 檢查，並由現有 `ci-passed` 聚合；不新增 required check，也不改 branch protection。
- draft PR 保持可進行 proposal review；draft 階段的 defer 或 green 結果不得成為 ready merge evidence。每次 `ready_for_review` 都必須產生 fresh run，且該次 archive gate 通過後才可進入 merge。
- 判定基準使用該次 PR 的精確 base commit。base 無法解析時 fail closed，不以 moving branch ref 或空歷史繼續判定。
- PR base 已存在的 active changes 維持 grandfathered，避免新 gate 追溯阻擋既有 backlog；只阻擋該 PR 新引入、到 ready 時仍未正確收尾的 change。
- 有效收尾必須符合 archive 形狀；單純刪除 active change（bare deletion）不得冒充 archive。archive 與 bare-delete 邊界都要有 executable regression 覆蓋。
- 以 fresh implementation 取代 stale PR #482，不沿用它的 standalone workflow 或 moving `origin/main` 假設。
- 本 change 不清理目前的 active backlog，也不新增或調整 GitHub ruleset／branch protection。
- 本 gate 是 cooperative agent／operator 在目前 reachable PR graph 上防止漏 archive 的一致性 guard，不是安全邊界；它不宣稱抵抗 PR 自行修改 checker／workflow、force-push 抹除不可達歷史，或管理者變更 ruleset。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `spec-driven-review-loop`：把既有 archive-before-merge 流程從人工紀律升為可執行的 ready-to-merge gate，定義 exact-base、fail-closed、grandfathering、有效 archive 與 bare deletion 的行為邊界。

## Impact

- CI：現有 `.github/workflows/ci.yml` 的 PR 事件、archive leaf 與 `ci-passed` 聚合關係。
- OpenSpec workflow：`.agents/openspec-sdlc.md` 中「CI 尚未強制」的現況說明需在 gate 上線後同步更新。
- 驗證：archive 判定邏輯與對應的 executable regression tests，涵蓋 draft evidence 不得沿用、`ready_for_review` fresh run、exact base、invalid base、grandfathered active change、有效 archive 與 bare deletion。
- 無對外 API、資料格式或 runtime dependency 變更；不需要 GitHub 設定 mutation。
