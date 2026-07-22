## MODIFIED Requirements

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
