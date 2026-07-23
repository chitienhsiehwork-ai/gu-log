# prebuild-manifest-fail-closed Specification

## Purpose

建置管線對 manifest generator 的 fail-closed 契約：Reader revision
manifest generator 缺席或失敗時擋 build、部署打包必含 prebuild 需要的
每個 generator、PR CI blocking freshness check、以及 `post-versions.json`
的 full-history 語意在 shallow 建置上維持安全，不被此契約弱化。

## Requirements

### Requirement: Reader revision generator failure blocks the build

建置管線（prebuild）SHALL 在執行 Reader revision manifest generator
（`scripts/build-reader-revision-manifest.mjs`）時 fail-closed：
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

`src/data/post-versions.json` 由完整 git history 導出。建置管線 SHALL 僅在 Git
明確確認目前是 shallow clone（Vercel production / preview、CCC sandbox）時，
沿用 committed 檔案、以 exit code 0 跳過重生，且 SHALL NOT 以不完整 history
覆寫它。

在其他情況，generator SHALL 先於記憶體中成功完成 repository probe、所有 history
查詢與 manifest 組裝，才可替換正式檔案。Git executable 不可用、metadata 缺失或
損壞、shallow probe 失敗或回傳無效值，以及任一 history command 失敗時，generator
SHALL 保留既有 manifest bytes 並以非零 exit code 結束。此契約 SHALL 同時適用一般
模式與 `--check`，且 prebuild SHALL 傳播非零 exit code、停止 build。

#### Scenario: 已確認 shallow clone 上跳過重生

- **GIVEN** Git 明確回報建置環境是 shallow clone
- **WHEN** prebuild 執行 `scripts/build-version-manifest.mjs`
- **THEN** script SHALL 以 exit code 0 跳過
- **AND** SHALL NOT 改寫 committed 的 `src/data/post-versions.json`

#### Scenario: Git metadata 缺失或損壞

- **GIVEN** 工作目錄無法被 Git 辨識為有效 repository
- **WHEN** 執行 generator 或 `--check`
- **THEN** script SHALL 以非零 exit code 結束
- **AND** 既有 manifest bytes SHALL 保持不變

#### Scenario: Git executable 不可用

- **GIVEN** generator 無法啟動 Git executable
- **WHEN** 執行 generator 或 `--check`
- **THEN** script SHALL 以非零 exit code 結束
- **AND** 既有 manifest bytes SHALL 保持不變

#### Scenario: Repository probe 失敗或結果無效

- **GIVEN** shallow repository probe 以非零 exit code 結束或回傳 `true` / `false` 以外的值
- **WHEN** 執行 generator 或 `--check`
- **THEN** script SHALL 以非零 exit code 結束
- **AND** 既有 manifest bytes SHALL 保持不變

#### Scenario: History command 執行失敗

- **GIVEN** Git 已確認 repository 不是 shallow clone
- **AND** 任何導出 manifest 所需的 history command 失敗
- **WHEN** 執行 generator 或 `--check`
- **THEN** script SHALL 以非零 exit code 結束
- **AND** 既有 manifest bytes SHALL 保持不變

#### Scenario: 成功計算後才替換 manifest

- **GIVEN** Git 已確認 repository 不是 shallow clone
- **WHEN** generator 成功完成所有 history 查詢與 manifest 組裝
- **THEN** 一般模式 SHALL 以安全替換更新正式 manifest
- **AND** 任何先前失敗 SHALL NOT 留下部分、空白或截斷的正式 manifest

#### Scenario: prebuild 傳播 generator failure

- **GIVEN** `scripts/build-version-manifest.mjs` 因 operational failure 以非零 exit code 結束
- **WHEN** 執行 `package.json` 定義的 prebuild
- **THEN** prebuild SHALL 以非零 exit code 結束，後續 build 不得繼續
