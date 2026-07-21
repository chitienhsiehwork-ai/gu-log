# Proposal: Reader revision manifest fail-closed

## Why

`package.json` 的 prebuild 用 `|| true` 包住兩個 manifest generator，而 `.vercelignore`
只放行 `scripts/build-version-manifest.mjs`——`scripts/build-reader-revision-manifest.mjs`
在 Vercel 打包裡根本不存在。結果是：production / preview 每一次建置，Reader revision
generator 都以 MODULE_NOT_FOUND 失敗、被 `|| true` 靜默吞掉，網站端出的是 committed
的 `src/data/post-reader-revisions.json`——只要有人忘了在本機重生它，讀者的
已讀/重讀判定就默默用到 stale revision，而且沒有任何 blocking check 會抓到
（CI 的 unit test 只測 hash function，不測 manifest freshness）。這是 audit
roadmap（issue #585）P1 列的 fail-open publishing 風險。

## What Changes

- prebuild 對 Reader revision generator **fail-closed**：generator 缺席或執行失敗
  時，`astro build` 必須失敗，不得靜默端出 stale manifest。
- `.vercelignore` 放行 prebuild 需要的每一個 generator script，讓 Vercel 打包
  不可能漏掉 `build-reader-revision-manifest.mjs`。
- PR CI 增加 **blocking** 的 Reader revision manifest freshness check
  （`build-reader-revision-manifest.mjs --check`），並納入 `ci-passed` 聚合 gate。
  （誠實定位：`.vercelignore` 修好後 production 每次 build 都會重生 manifest，
  擋 stale 上線的主防線是 fail-closed prebuild + 打包；CI check 保的是
  committed 檔案與內容一致的 repo hygiene——本機 dev、hook、以及任何直接
  讀 committed manifest 的路徑。）
- 保護既有 `post-versions.json` 政策：它是 full-git-history 導出，shallow 建置
  （Vercel / CCC）必須繼續使用 committed 檔案、不得被錯誤重生——本 change 的
  regression test 把這條固定下來，防止 prebuild 改動順手弱化它。

## Capabilities

### New Capabilities

- `prebuild-manifest-fail-closed`: 建置管線對 manifest generator 的
  fail-closed 契約——generator 缺席/失敗擋 build、部署打包必含 generator、
  CI blocking freshness check、full-history manifest 在 shallow 建置的安全語意。

### Modified Capabilities

- （無——`post-version-manifest` 管的是 site 端 revision 語意，本 change 不動
  revision 的計算方式或讀者可見行為。）

## Impact

- `package.json`（prebuild script）
- `.vercelignore`（un-ignore reader revision generator）
- `.github/workflows/ci.yml`（新 blocking freshness check + `ci-passed` needs）
- `tests/post-version-manifest.test.ts` 或新測試檔（regression coverage）
- 不動：`scripts/build-reader-revision-manifest.mjs` 的 hash 語意、
  `scripts/build-version-manifest.mjs` 的 shallow-skip 邏輯、reader tracker 前端。
- 與 active change `automate-post-version-manifest-freshness` 無重疊：那個 change
  管 `post-versions.json` 的 post-commit 自動化；本 change 管 Reader revision
  manifest 的建置/打包/CI fail-closed，不碰 post-commit hook。
