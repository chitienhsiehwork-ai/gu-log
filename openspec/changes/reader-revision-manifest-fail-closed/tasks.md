# Tasks: Reader revision manifest fail-closed

## 1. Fail-closed prebuild 與打包

- [x] 1.1 `package.json` prebuild 移除兩個 `|| true`，改為
      `node scripts/build-version-manifest.mjs && node scripts/build-reader-revision-manifest.mjs`
- [x] 1.2 `.vercelignore` 加 `!scripts/build-reader-revision-manifest.mjs`

## 2. CI blocking freshness check

- [x] 2.1 `.github/workflows/ci.yml` 的 `validate-content` job 加 blocking step：
      `node scripts/build-reader-revision-manifest.mjs --check`
      （job 已在 `ci-passed.needs`，確認不需另外 wiring）

## 3. Regression tests（`tests/prebuild-fail-closed.test.ts`，vitest）

- [x] 3.1 測 generator 缺席：synthetic dir 缺 `scripts/build-reader-revision-manifest.mjs`，
      實跑 package.json 的 prebuild command → 非零退出
- [x] 3.2 測 generator 失敗：generator 以非零 exit code 結束 → prebuild command 非零退出
- [x] 3.3 測打包契約：解析 `package.json` prebuild 引用的每個 `scripts/*.mjs`，
      對照 `.vercelignore` 規則，逐一斷言不被排除
- [x] 3.4 測 CI wiring：解析 `ci.yml`，斷言存在跑
      `build-reader-revision-manifest.mjs --check` 的 step，且所屬 job 在
      `ci-passed.needs` 清單
- [x] 3.5 測 reader manifest freshness check 本體：synthetic dir 內 manifest
      stale → `--check` 非零退出；fresh → exit 0
- [x] 3.6 測 post-versions 安全語意：synthetic shallow clone 上
      `build-version-manifest.mjs` exit 0 且不改寫 committed 的
      `src/data/post-versions.json`

## 4. 驗證

- [x] 4.1 本機跑 `pnpm exec vitest run tests/prebuild-fail-closed.test.ts` 綠
- [x] 4.2 本機跑全套 `pnpm exec vitest run` 綠
- [x] 4.3 本機跑 `pnpm run build`（prebuild 走新 fail-closed 路徑）綠
