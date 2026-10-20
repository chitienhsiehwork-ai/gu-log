# Proposal

## Why

平行 worker 合 `origin/main` 時，`post-versions-regen` merge driver 會把 main 上新加的文章從 `src/data/post-versions.json` 弄丟。原因有兩個：

1. `scripts/build-version-manifest.mjs` 用 `readdirSync` 列文章路徑，但 git 在把其他合併結果寫進工作目錄之前就先呼叫 driver，所以對方分支的新文章還不在磁碟上。實測還發現更根本的問題：driver 執行時 git 也還沒寫 `MERGE_HEAD`，script 的 merge-aware 分支根本沒啟動，history 只走 `HEAD`。
2. Repo 是 shallow clone 時，script 印一行「using committed post-versions.json」就 exit 0。Driver 因此安靜地留下舊檔，`--check` 也變成 no-op。

## What Changes

- `scripts/merge-post-versions.sh` 從 `git merge` 匯出的 `GITHEAD_<oid>` 環境變數取得合併進來的 head，用 `POST_VERSIONS_MERGE_HEADS` 交給 generator；沒有這個變數時照舊看 `MERGE_HEAD`。
- 合併進行中時，文章路徑改從 git 取：`HEAD` 跟合併進來的 head 的 `.mdx` 聯集，扣掉任一邊相對 merge-base 刪掉（或改名移走）的路徑。合併 commit 的 pre-commit（`--include-staged`）直接用 index，因為那時 index 就是合併結果。
- Shallow clone 只在 Vercel（`VERCEL` 環境變數）或明確 opt-in（`POST_VERSIONS_ALLOW_SHALLOW=1`，給 GitHub Actions 的 shallow build job）時才沿用 committed 檔案；其他情況（merge driver、`--check`、hook、本機 build）以非零 exit code 結束，並提示 `git fetch --unshallow origin`。

## Capabilities

### Modified Capabilities
- `prebuild-manifest-fail-closed`：「Full-history post versions manifest stays safe on shallow builds」的 shallow 跳過範圍從「任何已確認的 shallow clone」縮成「Vercel 或明確 opt-in 的 build」。

## Impact

- `scripts/build-version-manifest.mjs`、`scripts/merge-post-versions.sh`、`tests/post-version-manifest.test.ts`、`tests/prebuild-fail-closed.test.ts`
- `.github/workflows/ci.yml`、`.github/workflows/nightly-deep.yml` 的 shallow `Build` step 加 opt-in 環境變數
- `scripts/hooks/pre-push` 過時註解
- 讀者看得到的東西不變。
