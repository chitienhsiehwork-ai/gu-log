## Why

gu-log 的 glossary 已經是 accepted English terms 與讀者 mental model 的 SSOT，但目前 glossary entry 只是資料；既有文章正文裡的裸詞不會自動變成 `/glossary#...` 連結。

這會造成兩個問題：

- 新增 glossary term 後，讀者在舊文看到同一個詞，仍然沒有入口可以跳到定義。
- `check-jingjing.mjs` 會把 glossary term 視為可接受英文，卻沒有保證文章真的有把讀者帶到 glossary。

Elixir 是這次暴露問題的案例：glossary 已新增，但 CP-179 / SP-187 / EN posts 裡既有的 Elixir 裸詞沒有同步 backfill glossary link。

## What Changes

新增 deterministic glossary link coverage 機制，分三個 phase 落地：

1. **Phase 1：changed-term / changed-post ratchet**
   - 新增 `scripts/check-glossary-links.mjs`，只 report、不改檔。
   - 新增 `scripts/apply-glossary-links.mjs`，idempotent 補第一個 safe occurrence。
   - pre-commit 與 CI 對「新增或修改的 glossary terms」與「新增或修改的 posts」執行 hard gate。

2. **Phase 2：全站 report + safe backfill**
   - checker 支援全站掃描與 JSON/text report。
   - fixer 支援 `--all` / `--term`，每篇每 term 最多補一個 safe link。
   - 先 backfill 已確認 safe 的 existing corpus，避免一次把所有 ambiguous term 硬套上去。

3. **Phase 3：全站 hard gate**
   - CI 新增全站 glossary coverage check。
   - 每篇 post 的正文若出現 enabled glossary term，至少要有一次 safe link 指向對應 glossary anchor。

## Policy

- 每篇文章每個 glossary term **只要求第一個 safe occurrence** 連到 glossary；不要求每次出現都連。
- 不掃 frontmatter、code block、inline code、既有 Markdown link、URL、HTML attributes、import/export。
- 預設跳過 blockquote，避免污染 source quote。
- 中文文章使用 `/glossary#<anchor>`；英文文章使用 `/en/glossary#<anchor>`。
- `aliases` 不等於自動 link match。只有 `linking.match` 或 canonical term 進 matcher。
- 必須提供 ignore escape hatch：`<!-- glossary-ignore Term -->` 或 frontmatter `glossaryIgnore`。

## Impact

### Affected specs

- 新增 `glossary-link-coverage` capability。

### Affected code / scripts

- `scripts/check-glossary-links.mjs`
- `scripts/apply-glossary-links.mjs`
- `package.json` scripts
- pre-commit hook
- CI workflow
- tests for deterministic parser / matcher / fixer

### Expected outcome

新增或更新 glossary term 時，相關既有文章會被 deterministic checker 擋下，直到至少第一個正文出現點連到 glossary。這讓 glossary 從「有定義但不一定被用到」變成 gu-log corpus 的可維護知識網。
