# Proposal: Post version manifest generator fail closed

## Why

`src/data/post-versions.json` 必須由完整 git history 導出。現行 generator
無法取得 history 時，會把錯誤降級成警告並寫入空 manifest；這會讓 Git
不可用、metadata 損壞或 history command 失敗的建置看似成功，卻帶著錯誤資料部署。

Shallow clone 是唯一可安全沿用 committed manifest 的已知情境。其他無法證明
history 完整性的錯誤都必須 fail closed，且不得改動既有 manifest。

## What Changes

- 只有 git 明確回報目前是 shallow clone 時，generator 才跳過重生、保留既有檔案並 exit 0。
- Git executable 不可用、metadata 缺失或損壞、shallow probe 失敗，以及 history command
  失敗時，generator 保留既有檔案並以非零 exit code 結束。
- `--check` 遵守同一套判斷，不得把 operational failure 當成 freshness success。
- generator 先完整算出結果，再以安全替換寫入，避免失敗留下部分或空白 manifest。
- 以 synthetic repo 與 prebuild regression tests 固定 Vercel / CI 的傳播契約。

## Non-goals

- 不改變 manifest 的 full-history 計數語意。
- 不新增或修改 post-commit 自動 commit 機制。
- 不讓 shallow build 嘗試補抓 history 或重生 manifest。
- 不處理 `post-reader-revisions.json` 的生成邏輯。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `prebuild-manifest-fail-closed`: 收緊 `post-versions.json` generator 的 shallow
  例外與 operational failure 契約，並固定 prebuild 會傳播失敗。

## Impact

影響 `scripts/build-version-manifest.mjs`、manifest regression tests 與 `package.json`
prebuild 契約。正常 full-history 開發流程與已確認的 shallow Vercel build 行為不變；
原本會靜默產生錯誤資料的異常建置將改為明確失敗。

## Approval Meaning

核准此 change 代表只有「已確認 shallow」能安全沿用 committed manifest；任何無法
可靠確認 git/history 狀態的 operational failure 都必須保留原檔並擋下 build。
