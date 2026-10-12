# Tasks

> 實作 commit 不碰 `openspec/**/specs/**`（唯讀牆）。每一組做完，`pnpm exec vitest run` 與該組動到的 Playwright spec 都要是綠的。這個 PR 動到文章，合併時必須用 merge，不得 squash。

## 1. 錨點只剩一套規則

- [ ] 1.1 新增共用的錨點模組（有 `linking.anchor` 就用它，否則照 checker 現行的 `slugify`），讓詞彙表頁面的 id、頁內 `related` 連結、`check-glossary-links.mjs` 與 `apply-glossary-links.mjs` 都改用它。`tribunal-librarian-packet.py` 照同一規則實作，另加一個測試，對 `glossary.json` 全部詞條比對 JS 與 Python 的結果。單元測試涵蓋 `Software 3.0` 的頁面 id、checker 預期錨點、fixer 錨點三者相同（對應「名稱含標點的詞條」）
- [ ] 1.2 `check-glossary-links.mjs` 加死錨點檢查，涵蓋文章裡指向不存在錨點的 glossary 連結（含大小寫不符），以及 `related` 列出不存在的詞條；失敗時列出檔案、錨點或詞條名稱。測試用合成資料涵蓋這兩種失敗（對應「文章連到不存在的錨點」「related 指向不存在的詞條」）
- [ ] 1.3 修掉現有的死錨點與 `related`：先跑 1.2 的檢查列出清單，大小寫錯的改成正確錨點，沒有詞條的移除連結或改指正確詞條，`related` 改正或刪除。驗證：`pnpm run glossary:check` 與 1.2 的檢查全站通過

## 2. 只改 glossary 連結的證明

- [ ] 2.1 抽出共用的證明函式：把修改前後的 glossary 連結語法拿掉後內容完全相同，而且新增或改動的 glossary 連結都指向該文章語言、啟用中詞條的正確錨點。`.githooks/pre-commit`（staged 對 HEAD）與 `scripts/list-content-gate-posts.mjs`（base 對 head）都改用它；既有的站內文章連結驗證保留。測試涵蓋：
  - 沒有 scores 的舊文只加 Kubernetes 連結，兩邊都放行；
  - 夾帶改字不放行；
  - 錯錨點、停用詞條、語言路徑錯誤不放行。

  hook 的整合測試要實際 commit 一次（對應「只改 glossary 連結的修改」的三個情境）
- [ ] 2.2 `.githooks/pre-commit` 的錯誤訊息不再建議 `--no-verify`，改指向修法。驗證：`rg -n 'no-verify' .githooks/` 只剩禁止用法的說明，hook 測試綠

## 3. Kubernetes 條目與補連結

- [ ] 3.1 在 `src/data/glossary.json` 新增 Kubernetes：
  - `category: platforms`；
  - `en: Kubernetes`；
  - `aliases` 含 `K8s`；
  - `definedIn` 指向 `lv-18-20261011-livingdevops-kubernetes`；
  - `related` 只放 glossary 裡真的存在的詞條；
  - 不設 `linking.match`。

  `definition`、`moguNote`、`enDefinition`、`enMoguNote` 由固定版本寫手產生（照所屬 runtime playbook 的固定版本寫手做法），比喻接 Lv-18 的「一行白板配一位經理」；這四段文字不得由實作的 agent 自己寫。驗證：glossary 相關單元測試通過，`check-glossary-links.mjs` 列出待補連結的文章
- [ ] 3.2 跑 `node scripts/apply-glossary-links.mjs --term Kubernetes` 替所有提到它的文章補連結（繁中連 `/glossary#kubernetes`，英文連 `/en/glossary#kubernetes`），逐一檢查 diff；第一處落在「Google Kubernetes Engine」這類專有名詞裡的，改連同篇較自然的位置。驗證：commit 時 pre-commit 用 2.1 的證明放行，`pnpm run glossary:check` 全站 0 violation，`post-versions.json` 與 `post-reader-revisions.json` 跟著同一個 commit 更新

## 4. 精簡的詞彙表頁面

- [ ] 4.1 在 `src/config/glossary.ts` 定義分類 id 與中英文 label 的唯一對照，包含 `products`、`models`、`platforms`。篩選按鈕取資料用到的分類，詞條標籤顯示對應語言的 label。單元測試：資料用到沒有 label 的分類就失敗（對應「新分類缺 label」）；沒有詞條的分類不產生按鈕（對應「沒有詞條的分類」）
- [ ] 4.2 抽出 `src/components/glossary/` 共用元件，`src/pages/glossary.astro` 與 `src/pages/en/glossary.astro` 改成薄包裝，只傳語言。驗證：兩頁 build 出的詞條數、順序與分類一致（對應「中英文詞彙表 SHALL 行為一致」）
- [ ] 4.3 精簡顯示：
  - CSS 預設只顯示名稱、英文名、分類 label 與定義前兩行；
  - `:target` 與 `.is-open` 展開完整定義、MoguNote、外部連結、Thread、相關詞條與文章；
  - 沒有 JS 時，展開控制是指向自己錨點的連結；
  - 有 JS 時，展開控制是切換 `.is-open` 的按鈕，有 `aria-expanded`，並處理 `hashchange`；
  - 修好 `glossary.css` 裡失效的 `:global()` MoguNote 規則；
  - 複製連結改成每列一個按鈕。

  Playwright spec（iPhone 13 viewport）涵蓋：精簡列沒有顯示 MoguNote、點擊與鍵盤展開、從 `/glossary#elixir` 進來時目標已展開且位於可見範圍、點相關詞條時目標展開、關閉 JavaScript 時仍能展開，以及從錨點進來的詞條是展開的（對應「詞條 SHALL 預設精簡並可就地展開」「從錨點進來的詞條 SHALL 直接展開」）
- [ ] 4.4 控制列 sticky，詞條加 `scroll-margin-top`；篩選狀態寫進 `?cat=`，載入時套用；錨點目標被篩選掉時切回「全部」。Playwright 涵蓋 `/glossary?cat=people` 只顯示人物、`/glossary?cat=people#elixir` 切回全部並展開 Elixir、`/en/glossary?cat=people#andrej-karpathy`（對應「篩選狀態 SHALL 放在查詢字串」與英文頁情境）
- [ ] 4.5 更新受影響的既有 Playwright spec 與單元測試（例如 `tests/mogu-note.spec.ts`、`tests/a11y-baseline.spec.ts`、`tests/component-smoke.spec.ts`），並更新頁面上「點術語名稱可複製連結」這類過期的說明文字
- [ ] 4.6 跑 `uiux-auditor`：深色與淺色兩種主題、iPhone 13 viewport，WCAG AA 對比，不得有寫死的色碼；修掉 must-fix。記錄修改前後的頁面高度（螢幕數），目標是 zh 從約 41 降到 10 個左右

## 5. 整合驗證

- [ ] 5.1 收斂 `src/config/glossary.ts` 裡 `glossaryInclude` 的過期說明：註解寫「跟 /glossary 同步」，實際只列 27 條。依實際用途決定刪除或改正註解，並同步引用它的文件
- [ ] 5.2 跑 `pnpm run build`、`pnpm exec vitest run`、`pnpm run glossary:check`、`node scripts/validate-posts.mjs` 與受影響的 Playwright spec，全部通過；把頁面高度量測與截圖路徑記進 PR 說明

## Workflow follow-up

- 依 `.agents/openspec-sdlc.md` 走階段 6 雙審（正確性錨 spec scenario、簡潔度錨 over-engineering）。
- 階段 7：在 chat 提供 preview URL（zh 與 en 詞彙表、一篇補了 Kubernetes 連結的文章）。
- 階段 8：archive 並 sync `glossary-browsing` 與 `glossary-link-coverage`，轉 ready，過 Codex auto-review gate 後用 merge 合併。
