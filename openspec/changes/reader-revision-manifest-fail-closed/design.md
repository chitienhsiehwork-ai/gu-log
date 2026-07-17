# Design: Reader revision manifest fail-closed

## Context

現況（`main @ 067d9f94`）：

- `package.json:7`：
  `"prebuild": "node scripts/build-version-manifest.mjs || true && node scripts/build-reader-revision-manifest.mjs || true"`
  ——shell 的 `&&`/`||` 同優先序、左結合，兩個 generator 各自被 `|| true`
  包住，任何失敗都吞掉。`|| true` 是歷史產物（`0acb9b99`：當年 `.vercelignore`
  排除整個 `scripts/`，prebuild 在 Vercel 必炸，只好 fail-open）；後來
  `.vercelignore` 已放行 `build-version-manifest.mjs`，但 reader generator
  （較晚加入）沒跟上。
- `.vercelignore` 排除 `scripts/` 全目錄，只 `!scripts/build-version-manifest.mjs`。
  → Vercel 上 reader generator 必 MODULE_NOT_FOUND，被 `|| true` 吞掉，
  production 端出 committed（可能 stale）的 `post-reader-revisions.json`。
- 兩個 generator 的失敗語意不同：
  - `build-version-manifest.mjs`：需要完整 git history；shallow clone 時
    **script 內部**偵測並 `exit 0` 跳過（committed 檔案就是 SSOT）。git log
    失敗時 catch 後寫出 manifest 並 exit 0。也就是說它自己就不太會非零退出，
    fail-closed 語意由 script 內部政策決定，不靠 `|| true`。
  - `build-reader-revision-manifest.mjs`：純 content-derived（hash 檔案內容），
    不讀 git history（`--include-staged` 才用 git，prebuild 不帶該 flag），
    在 shallow clone / Vercel 上重生是**安全且正確**的。它失敗 = 真的有問題，
    必須擋 build。
- CI：`pnpm versions:check` script 存在但沒有任何 workflow 跑它；unit test
  只驗 hash function 與 `post-versions.json` freshness，不驗 reader manifest
  freshness。
- Local hooks：pre-commit 已會用 `--include-staged` 重生兩個 manifest 並
  stage；但 hooks 沒裝、或直接在 GitHub UI / 其他工具改內容時沒有網。

## Goals / Non-Goals

**Goals:**

- Reader revision generator 缺席或失敗 → build 失敗（Vercel production /
  preview、本機 `pnpm build` 一致）。
- Vercel 打包必含 prebuild 需要的每個 generator。
- PR CI 有 blocking 的 reader manifest freshness check，掛進 `ci-passed`。
- `post-versions.json` 的 shallow-skip / committed-file-is-SSOT 語意不變，
  並有 regression test 固定。

**Non-Goals:**

- 不改 reader revision 的 hash 語意、欄位、或 reader tracker 前端行為。
- 不動 `post-versions.json` 的 post-commit 自動化（屬 active change
  `automate-post-version-manifest-freshness` 的範圍）。
- 不在本 change 處理 pre-push hook 的 reader manifest 檢查——pre-commit
  已自動重生並 stage，CI 是 authoritative backstop；再加一層 hook 檢查是
  重複防線（over-engineering）。

## Decisions

1. **prebuild 移除兩個 `|| true`**：
   `"prebuild": "node scripts/build-version-manifest.mjs && node scripts/build-reader-revision-manifest.mjs"`。
   - Reader generator：直接獲得 fail-closed（缺檔 = node exit 1 = build 炸）。
   - Version generator：shallow-skip 在 script 內部（exit 0），git 完全缺席時
     script 也自行 catch 後 exit 0，移除 `|| true` 不改變其語意；真正的
     I/O 錯誤（寫檔失敗）改為擋 build——這是想要的行為。
   - 替代方案（只對 reader generator 移除 `|| true`）被否決：留一個
     fail-open 的 `|| true` 只是保存已知的壞 pattern，且 version generator
     的安全語意已由 script 內部保證，不需要 shell 層再兜底。
2. **`.vercelignore` 加 `!scripts/build-reader-revision-manifest.mjs`**，
   並用 regression test 把「prebuild 引用的 script 都必須被 un-ignore」
   固定成契約，未來再加 generator 時測試會逼人同步打包規則。
3. **CI：在既有 `validate-content` job 加一個 blocking step 跑
   `node scripts/build-reader-revision-manifest.mjs --check`**，而不是開新 job。
   - `validate-content` 已在 `ci-passed.needs` 裡，內容類檢查語意相符，
     省一個 runner 冷啟動。
   - 不跑 `pnpm versions:check`（它串了 version manifest check；CI checkout
     是 shallow，version check 會走 shallow-skip 變 no-op，跑了只是噪音；
     `post-versions.json` freshness 已由 unit test 用完整 history 驗）。
4. **測試放 `tests/prebuild-fail-closed.test.ts`（vitest，進既有 unit-tests
   job）**，涵蓋四條 scenario：
   - generator 缺席 → prebuild command 非零退出（synthetic dir 實跑 shell）。
   - generator 失敗 → prebuild command 非零退出。
   - `.vercelignore` 解析後，prebuild 引用的每個 script 都被 un-ignore。
   - `ci.yml` 解析後，跑 reader freshness check 的 job 在 `ci-passed.needs`。
   - shallow clone 上 version generator 跳過且不改寫 committed manifest
     （加在既有 `tests/post-version-manifest.test.ts` 或同檔）。

## Risks / Trade-offs

- [prebuild 變嚴，某些奇異本機環境 build 會炸] → 這正是 fail-closed 的目的；
  generator 在無 git 環境（reader：不用 git）與 shallow 環境（version：
  內部跳過）都已安全，炸 = 真問題。
- [`.vercelignore` 允許清單日後又漏新 generator] → regression test 用
  「解析 prebuild 引用 → 對照 ignore 規則」的通用契約擋住，不是寫死檔名。
- [CI shallow checkout 讓 reader `--check` 誤判] → reader manifest 是
  content-derived，不讀 history，shallow 無影響。
- [與 `automate-post-version-manifest-freshness` 撞範圍] → 該 change 管
  post-commit hook 自動化；本 change 不動 hooks，僅動 prebuild/打包/CI。

## Migration Plan

單一 PR：spec commit → 實作 commit（package.json + .vercelignore + ci.yml +
tests）→ archive commit。Revert 任一 commit 都乾淨。部署面第一次生效於
merge 後的 Vercel build；若 Vercel 上炸，代表打包真的缺 generator——
這是預期中的 fail-closed，修法是修打包，不是回滾 fail-open。

## Open Questions

- 無。
