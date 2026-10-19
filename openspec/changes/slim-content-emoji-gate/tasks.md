# Tasks

## 1. 檢查腳本

- [ ] 1.1 `scripts/check-content-emoji.mjs` 改成小腳本：`--staged`／`--base=<sha>` 看 `src/content/posts/` 的新增行，檔案參數看整份檔案，核准清單 `{ path, emoji, reason }` 寫在腳本裡；驗證：`node scripts/check-content-emoji.mjs --base=origin/main` 通過
- [ ] 1.2 刪除 `scripts/lib/reader-surface.mjs`、`quality/content-emoji-allowlist.json`、`tests/helpers/trusted-component-static-strings.mjs` 與 `entities` 套件；`tests/content-emoji-policy.test.ts` 換成小測試（新增行有 emoji 會擋、kaomoji 放行、沒動到的舊行不擋、核准的 emoji 放行）；驗證：`pnpm exec vitest run tests/content-emoji-policy.test.ts`

## 2. 文件

- [ ] 2.1 `docs/shroomdog-editorial-feedback.md`、`CONTRIBUTING.md`、`GU-LOG_WRITER_PROMPT.md` 裡講 approval marker、executable allowlist 的句子改成新做法；驗證：repo 內（不含 archive）沒有檔案再提到被刪掉的檔案或 marker
