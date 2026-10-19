# Proposal

## Why

品牌改名（SP／CP → GP／MP、Clawd → Mogu）在 2026-07 就做完了，但「殘留舊名」的 gate 還照切換當下的規格在跑：每個允許的殘留都要記成「完整路徑 + token + 理由 + 預期次數」，次數一變就擋。結果是不相干的 PR（例如 #1114、#1117）只因為某個檔多提一次舊名，就得去改一份 1264 行的 allowlist；scanner 本身 655 行、測試 498 行，還被 pre-commit、jingjing 檢查、content gate 三處拿去做「純改名」豁免。改名已經結束，這套逐檔計數的機制只剩維護成本。

## What Changes

- 退役品牌名檢查改成小掃描器：掃 git 追蹤檔的路徑與內容，擋確定不該回來的舊名（`ClawdNote`、`Clawd` persona、`SP-N`／`CP-N` ticket、`sp-`／`cp-` slug、舊系列路徑與 tag、`sp-pipeline`）。
- 刻意保留舊名的檔案（舊網址 redirect 實作與對照表、拒收舊名的驗證器、測試、歷史紀錄、逐字引用的回饋）改用 scanner 開頭寫死的排除清單，不再逐檔記次數。刪掉 `quality/brand-taxonomy-residual-allowlist.json`。
- 拿掉「只是改名」的豁免路徑：pre-commit 的 `is_canonical_taxonomy_only_diff`、`list-content-gate-posts` 與 `check-jingjing` 裡的 taxonomy 比對。改名已完成，不會再有純改名的 diff。
- 不再檢查部署座標（舊 SSH alias、Unix 路徑）；那是本機或外部設定，repo 不需要 gate。

## Capabilities

### Modified Capabilities
- `brand-taxonomy`：「舊名殘留」的規則從逐檔計數 allowlist 改成排除清單；移除部署座標要進 allowlist 的規定。

## Impact

- `scripts/check-brand-taxonomy.mjs`（655 → 約 80 行）、`quality/brand-taxonomy-residual-allowlist.json`（刪除）、`tests/brand-taxonomy-residual.test.ts`（換成小測試）。
- `scripts/hooks/pre-commit`、`scripts/check-jingjing.mjs`、`scripts/list-content-gate-posts.mjs` 與對應測試。
- 讀者看得到的東西不變：舊網址 redirect 照舊由 `vercel.mjs` 與 `quality/brand-taxonomy-post-migration.json` 處理。
