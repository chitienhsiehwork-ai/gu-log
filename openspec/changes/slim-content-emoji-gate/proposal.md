# Proposal

## Why

「文章不放 emoji」這條編輯規則本身沒問題，但它的 gate 在 2026-08 一天內長成約 5400 行：`scripts/check-content-emoji.mjs`（406 行）、`scripts/lib/reader-surface.mjs`（2021 行，裡面有 TOML frontmatter parser、srcset 解析、CSS／JS escape 解碼、ESTree 靜態字串投影）、2517 行的測試加 387 行的測試 helper，再加上一份從來沒有任何條目的 allowlist，以及要求 feedback corpus 鏡像 path、行號、整行 hash、核准數量的 approval marker（corpus 裡一筆都沒有）。

真正要防的只有一件事：LLM 寫手順手在文章裡加 emoji。沒有人會用 CSS escape 或 MDX 運算式把 emoji 偷渡進站。spec 卻把這些實作細節全寫成 SHALL scenario，任何人想改小都會撞到規格。

## What Changes

- 編輯規則不變：讀者看得到的文章內容預設不放 emoji；kaomoji 照用；GP 自動寫作沒有例外；英文 sidecar 翻譯照舊省略 emoji 字形。
- gate 改成小腳本：只看 `src/content/posts/` 下新增或修改的行（`git diff -U0`），找到 emoji 就回報 `path:line:emoji`。pre-commit（`--staged`）、CI（`--base=<sha>`）、gp-pipeline（直接給檔案）用同一支腳本，CLI 不變。沒動到的舊行不擋。
- ShroomDog 核准某篇文章保留某個 emoji 時，直接在腳本裡加一筆 `{ path, emoji, reason }`。不再要求行號、整行 hash、核准數量，也不再要 feedback corpus 鏡像 machine marker。
- 刪掉 `scripts/lib/reader-surface.mjs`、`quality/content-emoji-allowlist.json`、`tests/helpers/trusted-component-static-strings.mjs`，2517 行測試換成幾個案例的小測試；只給 reader-surface 用的 `entities` 套件一起移除。

## Capabilities

### Modified Capabilities
- `editorial-charter`：「Reader-visible article content MUST exclude unapproved emoji」改回單純的政策描述，拿掉 HTML entity、CSS／JS escape、ESTree source span、import 白名單、整行 hash 綁定等實作細節。

## Impact

- `scripts/check-content-emoji.mjs`（406 → 約 70 行）、`scripts/lib/reader-surface.mjs`（刪除）、`quality/content-emoji-allowlist.json`（刪除）、`tests/content-emoji-policy.test.ts`（換成小測試）、`tests/helpers/trusted-component-static-strings.mjs`（刪除）。
- `docs/shroomdog-editorial-feedback.md`、`CONTRIBUTING.md`、`GU-LOG_WRITER_PROMPT.md` 裡講 approval marker／executable allowlist 的句子。
- pre-commit、`.github/workflows/ci.yml`、gp-pipeline 的 content lint 呼叫方式不變。
- 讀者看得到的東西不變。
