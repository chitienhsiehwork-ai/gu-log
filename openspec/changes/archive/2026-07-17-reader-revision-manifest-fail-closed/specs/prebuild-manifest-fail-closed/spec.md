# prebuild-manifest-fail-closed Delta Spec

## ADDED Requirements

### Requirement: Reader revision generator failure blocks the build

建置管線（prebuild）在執行 Reader revision manifest generator
（`scripts/build-reader-revision-manifest.mjs`）時 SHALL fail-closed：
generator 檔案缺席或以非零 exit code 結束時，整個 build SHALL 失敗，
不得靜默沿用 committed 的 `src/data/post-reader-revisions.json`。

#### Scenario: Generator script 缺席

- **GIVEN** 打包產物（例如 Vercel deploy bundle）裡沒有
  `scripts/build-reader-revision-manifest.mjs`
- **WHEN** 執行 prebuild
- **THEN** prebuild SHALL 以非零 exit code 結束，build 不得繼續

#### Scenario: Generator 執行失敗

- **GIVEN** `scripts/build-reader-revision-manifest.mjs` 存在但執行時以非零
  exit code 結束
- **WHEN** 執行 prebuild
- **THEN** prebuild SHALL 以非零 exit code 結束，build 不得繼續

### Requirement: Deploy packaging includes every prebuild generator

部署打包規則（`.vercelignore`）SHALL 放行 prebuild 引用的每一個
generator script，使部署環境的 prebuild 能實際執行它們。

#### Scenario: Reader revision generator 進入 deploy bundle

- **GIVEN** `package.json` 的 prebuild 引用 `scripts/build-reader-revision-manifest.mjs`
- **WHEN** 依 `.vercelignore` 規則過濾檔案
- **THEN** `scripts/build-reader-revision-manifest.mjs` SHALL 保留在打包產物內

#### Scenario: prebuild 引用的任何 generator 都不得被打包規則排除

- **GIVEN** `package.json` 的 prebuild 引用一個 `scripts/` 下的 script
- **WHEN** 依 `.vercelignore` 規則過濾檔案
- **THEN** 該 script SHALL 保留在打包產物內（regression test 逐一驗證）

### Requirement: PR CI blocks stale reader revision manifest

PR CI SHALL 以 blocking job/step 執行
`node scripts/build-reader-revision-manifest.mjs --check`，且該 job SHALL
屬於 `ci-passed` 聚合 gate 的 `needs` 清單；committed manifest 與 posts
內容不一致時，PR SHALL 無法通過 required check。

#### Scenario: Manifest stale 時 CI 變紅

- **GIVEN** 某篇 post 的 reader-visible 內容已改變，但
  `src/data/post-reader-revisions.json` 未重生
- **WHEN** PR CI 執行 freshness check
- **THEN** 該 check SHALL 失敗，`ci-passed` SHALL 不通過

#### Scenario: Freshness check 掛在聚合 gate 上

- **GIVEN** `.github/workflows/ci.yml` 定義了 `ci-passed` 聚合 gate
- **WHEN** 檢視執行 freshness check 的 job
- **THEN** 該 job SHALL 出現在 `ci-passed` 的 `needs` 清單中

### Requirement: Full-history post versions manifest stays safe on shallow builds

`src/data/post-versions.json` 由完整 git history 導出。在 shallow clone
（Vercel production / preview、CCC sandbox）上，建置管線 SHALL 繼續使用
committed 的檔案、SHALL NOT 以不完整 history 重生覆寫它；本 change 對
prebuild 的任何修改 SHALL NOT 弱化這個行為。

#### Scenario: Shallow clone 上跳過重生

- **GIVEN** 建置環境是 shallow clone
- **WHEN** prebuild 執行 `scripts/build-version-manifest.mjs`
- **THEN** script SHALL 偵測 shallow 狀態、以 exit code 0 跳過，
  且 SHALL NOT 改寫 committed 的 `src/data/post-versions.json`
