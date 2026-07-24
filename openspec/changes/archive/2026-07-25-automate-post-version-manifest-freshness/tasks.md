# Tasks

## 1. Current-state reconciliation

- [x] 1.1 對照 Git history，驗證 PR #552 與現行 hook／generator 行為。
- [x] 1.2 執行 manifest 與 hook installation targeted tests。
- [x] 1.3 記錄 post-commit auto-commit 為何已被取代且 SHALL NOT 實作。

## 2. Stable contract

- [x] 2.1 以已上線的 staged-projection contract 取代被否決的 post-commit delta。
- [x] 2.2 把 staged projection 與 layered freshness requirements 同步到 `post-version-manifest`。
- [x] 2.3 以現行責任取代 stable capability 的 placeholder Purpose。

## 3. Verification and archive

- [x] 3.1 通過 correctness／SSOT review。
- [x] 3.2 通過 simplify review。
- [x] 3.3 以 strict mode 驗證所有 OpenSpec changes 與 stable specs。
- [x] 3.4 使用 canonical local date 與完整 metadata 封存 change。
