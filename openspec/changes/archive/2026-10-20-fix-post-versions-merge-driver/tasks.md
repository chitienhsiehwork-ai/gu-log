# Tasks

## 1. Manifest generator

- [x] 1.1 Driver 用 `GITHEAD_<oid>` 把合併進來的 head 交給 generator；合併進行中時，文章路徑改用各 tip 的聯集扣掉任一邊相對 merge-base 刪掉的路徑；`--include-staged` 合併時改用 index；驗證：merge driver 真實合併測試
- [x] 1.2 Shallow clone 只在 `VERCEL` 或 `POST_VERSIONS_ALLOW_SHALLOW=1` 時跳過，其他情況 exit 1 並提示 `git fetch --unshallow origin`；驗證：shallow fail-closed 測試（一般模式與 `--check`）

## 2. 呼叫端

- [x] 2.1 GitHub Actions 的 shallow `Build` step 設 `POST_VERSIONS_ALLOW_SHALLOW=1`；`scripts/hooks/pre-push` 註解同步
