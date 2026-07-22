# Tasks

## 1. Test-first regression coverage

- [x] 1.1 新增 real shallow clone 測試：一般模式與 `--check` 都 exit 0，既有 sentinel manifest bytes 不變。
- [x] 1.2 新增 Git metadata 缺失測試：一般模式與 `--check` 都 non-zero，既有 sentinel manifest bytes 不變。
- [x] 1.3 新增 Git executable 不可用測試：一般模式與 `--check` 都 non-zero，既有 sentinel manifest bytes 不變。
- [x] 1.4 新增 history command failure 測試：一般模式與 `--check` 都 non-zero，既有 sentinel manifest bytes 不變。
- [x] 1.5 新增 shallow probe 回傳 `true` / `false` 以外值的測試：一般模式與 `--check` 都 non-zero，既有 sentinel manifest bytes 不變。
- [x] 1.6 新增 `package.json` prebuild 傳播測試：operational failure non-zero，確認 shallow 可成功繼續。

## 2. Generator implementation

- [x] 2.1 嚴格區分已確認 shallow、已確認 non-shallow 與 probe failure。
- [x] 2.2 移除 history failure 寫入空 manifest 的降級路徑，讓錯誤傳播成 non-zero。
- [x] 2.3 確保一般模式與 `--check` 在 operational failure 時都不改動既有 manifest。
- [x] 2.4 先完成完整 manifest 計算，再以同目錄暫存檔加 rename 安全替換正式檔案。

## 3. Verification

- [x] 3.1 執行 post version manifest 與 prebuild fail-closed targeted tests。
- [x] 3.2 執行 repo 的相關 lint、typecheck、build 與 manifest freshness checks。
- [x] 3.3 驗證 OpenSpec artifacts；若 CLI 仍不可用，記錄限制並執行 repo 內可用的結構驗證。
