## 1. 建立 fixture 目錄結構

- [ ] `mkdir -p tribunal/fixtures/{hard-dup,soft-dup,intentional-series,clean-diff}`
- [ ] 每個子目錄放一個 `.gitkeep` 佔位檔（避免空目錄不進 git）
- [ ] 根目錄 `tribunal/fixtures/README.md` 簡述目錄用途 + fixture YAML schema + 凍結原則

## 2. 寫 fixture schema 驗證

- [ ] 建立 `scripts/eval-dedup-harness.mjs`（初版只做 loader + schema 驗證，evaluator 留給 Level E）
- [ ] 讀取 `tribunal/fixtures/**/*.yaml`，對每筆 fixture 驗證：
  - [ ] 必填欄位齊全：`inputPost`、`corpusSnapshot`、`expectedClass`、`expectedAction`、`humanReasoning`、`sourceRef`
  - [ ] `expectedClass` ∈ `{hard-dup, soft-dup, intentional-series, clean-diff}`
  - [ ] `expectedAction` ∈ `{BLOCK, WARN, allow}`
  - [ ] `inputPost.slug`、`corpusSnapshot[].slug` 為字串
- [ ] 啟動時印出：總 fixture 數 + 四類各自筆數；若某類為 0 印警告
- [ ] 退出碼：schema 違規為 1，其他為 0

## 3. Bootstrap — 3 筆歷史案例 fixture

- [ ] `tribunal/fixtures/soft-dup/gemma-4-dual-post.yaml`
  - [ ] inputPost 收 CP-275 的 slug / frontmatter / lead paragraph
  - [ ] corpusSnapshot 收 CP-242 的 slug / frontmatter / lead paragraph
  - [ ] expectedClass: `soft-dup`、expectedAction: `WARN`（或 `allow`，視 Level B policy B-2-C 判定 —— 已 cross-link 則 allow）
  - [ ] humanReasoning 寫明「同主題不同切入角度 + 已建立 cross-link」
  - [ ] sourceRef: `5631a3cf`（Gemma 4 cross-link commit）
- [ ] `tribunal/fixtures/hard-dup/mythos-techcrunch.yaml`
  - [ ] inputPost 收 CP-298 的 slug / frontmatter / lead paragraph（從 deprecated 前的版本）
  - [ ] corpusSnapshot 收 SP-165 的 slug / frontmatter / lead paragraph
  - [ ] expectedClass: `hard-dup`、expectedAction: `BLOCK`
  - [ ] humanReasoning 寫明「TechCrunch 是對 Anthropic Mythos 官方 blog 的轉述，無 independentDiff」
  - [ ] sourceRef: `2289c882`（Mythos deprecation commit）
- [ ] `tribunal/fixtures/intentional-series/karpathy-ai-engineering.yaml`
  - [ ] inputPost 收 CP-137 的 slug / frontmatter / lead paragraph
  - [ ] corpusSnapshot 收 CP-36 + CP-116 的 slug / frontmatter / lead paragraph
  - [ ] expectedClass: `intentional-series`、expectedAction: `allow`
  - [ ] humanReasoning 寫明「Karpathy 跨年 AI 工程論述系列，三篇互為續作、各自獨立貢獻」
  - [ ] sourceRef: Karpathy trilogy cross-link commit（Level D 執行時從 git log 補）

## 4. 驗證

- [ ] `node scripts/eval-dedup-harness.mjs` 退出碼 0
- [ ] 輸出顯示：總數 3、`soft-dup: 1`、`hard-dup: 1`、`intentional-series: 1`、`clean-diff: 0`（附 warning）
- [ ] `openspec validate add-dedup-eval-harness` 通過
- [ ] `pnpm run build` 不受影響（fixture 目錄不在 Astro content root）

## 5. Clean-diff outstanding 項追蹤

- [ ] 在 `tribunal/fixtures/README.md` 加一段 TODO：「clean-diff 1 筆缺，Level E 開始前補齊」
- [ ] 建立對應 TaskList item 或 GitHub issue（視 repo 管理方式）

## 6. Archive

- [ ] `openspec archive add-dedup-eval-harness --yes`
- [ ] `git push` 到 remote
- [ ] 通知使用者可進 Level E

## 7. 交接到 Level E

- [ ] `scripts/eval-dedup-harness.mjs` 擴充 evaluator 邏輯（讀 Librarian `dupCheck` 輸出、算 per-category precision + recall）
- [ ] Librarian prompt 從 `tribunal/fixtures/` 抽幾筆當 few-shot 範例
- [ ] clean-diff fixture 補齊
