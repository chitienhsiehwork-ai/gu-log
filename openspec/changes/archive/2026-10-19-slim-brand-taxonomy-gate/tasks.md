# Tasks

## 1. 掃描器

- [x] 1.1 `scripts/check-brand-taxonomy.mjs` 改成排除清單 + 退役 pattern 的小掃描器，`pnpm run taxonomy:check` 入口不變；驗證：`pnpm run taxonomy:check` 在目前 tree 為 0 命中，`tests/brand-taxonomy.test.ts` 確認舊名會被抓到、`Claude`／`Claude Code` 不會
- [x] 1.2 刪除 `quality/brand-taxonomy-residual-allowlist.json` 與 `tests/brand-taxonomy-residual.test.ts`；驗證：repo 內沒有其他檔案引用

## 2. 拿掉純改名豁免

- [x] 2.1 pre-commit 刪 `is_canonical_taxonomy_only_diff`；`list-content-gate-posts`、`check-jingjing` 刪 taxonomy 比對與 allowlist 讀取；驗證：`pnpm exec vitest run` 只剩 main 上就會失敗的環境性測試
