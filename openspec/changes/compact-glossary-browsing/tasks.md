# Tasks

> 實作 commit 不碰 `openspec/**/specs/**`（唯讀牆）。每一組做完，`pnpm exec vitest run` 與該組動到的 Playwright spec 都要是綠的。組別順序就是 commit 順序：後面的組依賴前面的組（例如修文章要先有第 2 組的證明，否則沒有分數的舊文會被 score gate 擋下）。這個 PR 動到文章，合併時必須用 merge，不得 squash。

## 1. 錨點只剩一套規則

- [x] 1.1 新增共用的錨點模組（有 `linking.anchor` 就用它，否則照 checker 現行的 `slugify`），讓詞彙表頁面的 id、頁內 `related` 連結、`check-glossary-links.mjs` 與 `apply-glossary-links.mjs` 都改用它。`tribunal-librarian-packet.py` 不再自己推錨點，改呼叫 `check-glossary-links.mjs --format json`，用回報的結果列出可能漏連的詞條。單元測試涵蓋：
  - `Software 3.0` 的頁面 id、checker 預期錨點、fixer 錨點三者相同（對應「名稱含標點的詞條」）；
  - 合成資料裡有純中文、沒設 `linking.anchor` 的詞條，或兩個詞條推出相同錨點時，測試失敗並指出詞條（對應「推不出錨點的詞條」）；
  - 現有 `glossary.json` 沒有空錨點或重複錨點。

## 2. 只改 glossary 連結的證明

- [x] 2.1 抽出共用的「先驗證、再剝掉」正規化函式（規則見 design §8）：glossary 連結要指向該文章語言、啟用中詞條的正確錨點，位在 `buildUnsafeMask` 的安全區，新包起來的文字要能被 checker 的比對規則認成該詞條，只改錨點的既有連結保留原文字；驗證過的才剝掉；剝完整份檔案逐字比對，不 trim、不排序。站內文章連結沿用既有驗證。接到三個地方：
  - `scripts/check-staged-internal-post-links.mjs`（pre-commit 的豁免），拿掉「至少一條文章連結」的條件；
  - `scripts/list-content-gate-posts.mjs`，刪掉 `isLinkOnlyDiff`，taxonomy 證明的連結正規化也換成它；
  - `check-glossary-links.mjs --check-canonical-staged-file` 保留自己的方向性規則與逐字 `[term](/glossary#錨點)` 的文字規則，只有錨點從共用模組取得。

  glossary 資料讀跟文章同一個版本（pre-commit 讀 staged，CI 讀 head）。單元測試涵蓋：
  - 沒有 scores 的舊文只加 Kubernetes 連結，兩邊都放行；
  - mp-212 那種只改錨點大小寫、文字不變的連結放行；
  - 夾帶改字或改 frontmatter 不放行；
  - 錯錨點、停用詞條、語言路徑錯誤不放行，即使同一個修改裡有一條合法的站內文章連結；
  - 新連結落在 code block、inline code、frontmatter、JSX 屬性裡不放行；
  - `[這裡](/glossary#kubernetes)` 不放行；
  - 只調換行序不放行。

  證明本身的情境由單元測試涵蓋；hook 與 CI 的整合測試只驗接線：pre-commit 讀 staged 的 glossary、CI 讀 head 的 glossary，各加一個被擋下的情況（對應「新詞條替舊文補連結」要求兩個 gate 都放行）

- [x] 2.2 `.githooks/pre-commit` 的錯誤訊息不再建議 `--no-verify`，改指向修法。驗證：`rg -n 'no-verify' .githooks/` 只剩禁止用法的說明，hook 測試綠

## 3. 死錨點檢查與修正（同一個 commit）

- [x] 3.1 `check-glossary-links.mjs` 新增連結檢查：文章裡指向不存在錨點的 glossary 連結（大小寫不符也算；停用自動連結的詞條算存在，不能沿用 `normalizeGlossary`）、英文文章連 `/glossary#…` 或繁中文章連 `/en/glossary#…`、`related` 列出不存在的詞條；失敗時列出檔案與錨點，或詞條與找不到的名稱。測試用合成資料涵蓋這幾種失敗，以及連到 `#thread` 不算死錨點（對應「Glossary 連結 SHALL 指向存在的錨點與文章的語言」的四個情境）
- [x] 3.2 修掉現有違規，跟 3.1 放同一個 commit：先跑 3.1 的檢查列出清單；mp-212 中英文版大小寫錯的錨點改正，沒有詞條的（`#Opus`）拿掉連結；英文文章裡連到 `/glossary#…` 的改連 `/en/glossary#…`；`related` 改正或刪除。驗證：commit 時 pre-commit 用第 2 組的證明放行，`pnpm run glossary:check` 全站通過，`post-versions.json` 與 `post-reader-revisions.json` 跟著同一個 commit 更新

## 4. Kubernetes 條目與補連結（同一個 commit）

- [x] 4.1 在 `src/data/glossary.json` 新增 Kubernetes：`category: platforms`；`en: Kubernetes`；`aliases` 含 `K8s`；`definedIn` 指向 `lv-18-20261011-livingdevops-kubernetes`；`related` 只放 glossary 裡真的存在的詞條；不設 `linking.match`。`definition`、`moguNote`、`enDefinition`、`enMoguNote` 一字不改照貼固定版本寫手的產出（這個 change 目錄裡的 `kubernetes-entry.json`），實作的 agent 不得自己改寫或補字
- [x] 4.2 跑 `node scripts/apply-glossary-links.mjs --term Kubernetes` 替所有提到它的文章補連結（繁中連 `/glossary#kubernetes`，英文連 `/en/glossary#kubernetes`），逐一檢查 diff；mp-39 與 en-mp-39 的第一處落在「Google Kubernetes Engine」裡，有別的位置就改連同篇較自然的位置（實際：兩篇全文只有這一處，保留原位置，見 design §9）。4.1 與 4.2 放同一個 commit。驗證：pre-commit 用第 2 組的證明放行，`pnpm run glossary:check` 全站 0 violation，`post-versions.json` 與 `post-reader-revisions.json` 跟著同一個 commit 更新

## 5. 精簡的詞彙表頁面

- [x] 5.1 在 `src/config/glossary.ts` 定義分類 id 與中英文 label 的唯一對照，包含 `products`、`models`、`platforms`。篩選按鈕取資料用到的分類，詞條標籤顯示對應語言的 label。單元測試：資料用到沒有 label 的分類就失敗（對應「新分類缺 label」）；沒有詞條的分類不產生按鈕（對應「沒有詞條的分類」）
- [x] 5.2 抽出 `src/components/glossary/` 共用元件，`src/pages/glossary.astro` 與 `src/pages/en/glossary.astro` 改成薄包裝，只傳語言；英文頁的文章連結指向英文版文章、顯示英文版標題。驗證：兩頁 build 出的詞條數、順序與分類一致；英文頁 Kubernetes 的文章連結是英文標題（對應「中英文詞彙表 SHALL 行為一致」的兩個情境）
- [x] 5.3 精簡顯示（規則見 design §2）：
  - CSS 預設顯示名稱、英文名、分類 label 與定義前兩行；每列的複製連結按鈕由 script 加上（剪貼簿要 JS），頁首提到按鈕的說明也只在有 JS 時顯示；
  - `:target` 與 `.is-open` 展開完整定義、MoguNote、外部連結、Thread、相關詞條與文章，`.is-collapsed` 蓋過 `:target`；
  - 沒有 JS 時，展開控制是指向自己錨點的連結；
  - 有 JS 時，展開控制是切換的按鈕，有 `aria-expanded`，處理 `hashchange`，收起靠 `:target` 展開的詞條時加 `.is-collapsed`；
  - 修好 `glossary.css` 裡失效的 `:global()` MoguNote 規則。

  新的 Playwright spec 自己設定 iPhone 13 viewport 與關閉 JavaScript 的情境（e2e-core 預設只跑 Desktop Chrome），並登記進 `tests/spec-ownership.json`、class 設 `blocking`。涵蓋：精簡列沒有顯示 MoguNote、點擊與鍵盤展開、再點一次收起（含從錨點展開的詞條）、從 `/glossary#elixir` 進來時目標已展開且位於可見範圍、點相關詞條時目標展開、關閉 JavaScript 時仍能展開，以及從錨點進來的詞條是展開的（對應「詞條 SHALL 預設精簡並可就地展開」「從錨點進來的詞條 SHALL 直接展開」）

- [x] 5.4 控制列 sticky；詞彙表頁面的 `scroll-padding-top` 等於 sticky 區塊高度，不在詞條上另加 `scroll-margin-top`。點到被目前篩選藏起來的詞條時先切回「全部」。Playwright 涵蓋：手機 viewport 下錨點目標沒有被控制列蓋住；選「人物」篩選後點非人物的相關詞條，篩選切回全部並展開目標；`/en/glossary#andrej-karpathy` 以英文內容展開（對應「篩選中點到被藏起來的詞條」「英文頁從錨點展開」）。詞彙表頁面改成直接跳到錨點，控制列高度由 JS 寫進 `--glossary-toolbar-height`（見 design §3）
- [x] 5.5 更新受影響的既有 Playwright spec 與單元測試（例如 `tests/mogu-note.spec.ts`、`tests/a11y-baseline.spec.ts`、`tests/component-smoke.spec.ts`），並更新頁面上「點術語名稱可複製連結」這類過期的說明文字
- [x] 5.6 跑 `uiux-auditor`：深色與淺色兩種主題、iPhone 13 viewport，WCAG AA 對比，不得有寫死的色碼；修掉 must-fix。記錄修改前後的頁面高度（螢幕數），目標是 zh 從約 41 降到 10 個左右

## 6. 整合驗證

- [x] 6.1 收斂 `src/config/glossary.ts` 裡 `glossaryInclude` 的過期說明：註解寫「跟 /glossary 同步」，實際只列 27 條。依實際用途決定刪除或改正註解，並同步引用它的文件
- [ ] 6.2 跑 `pnpm run build`、`pnpm exec vitest run`、`pnpm run glossary:check`、`node scripts/validate-posts.mjs` 與受影響的 Playwright spec，全部通過；把頁面高度量測與截圖路徑記進 PR 說明
- [x] 6.3 `glossaryExclude` 一樣沒有任何引用，清單裡還有 Benchmark、Token、Prompt 這些現有詞條：刪掉，並把 `GU-LOG_WRITER_PROMPT.md` 叫人放進 `glossaryExclude` 的那句改成指向晶晶體 lint 的 allowlist

## 7. 階段 6 第一輪審查修正

- [ ] 7.1 連結位置規則與證明（規則見 design §8）。改 `scripts/check-glossary-links.mjs`、`scripts/lib/link-only-proof.mjs`、`scripts/apply-glossary-links.mjs` 與它們的測試：
  - `buildUnsafeMask` 補上 `~~~` 與外層較長的 code fence、跨行 inline code、跨行標籤（不分大小寫）、MDX `{…}`；`frontmatterAndCodeMask` 不再是另一份複本，`buildUnsafeMask` 直接用它；能跟 `buildCanonicalUnsafeMask` 共用的部分就共用；
  - 檢查器、修正器與證明共用的「可以放連結」判斷，排除緊貼 `*`、`_`、`~` 的位置、前一個字元是 `\` 的位置，以及其他連結的文字裡（連結文字可以跨行）；第一次出現的位置不能放時改看下一個；
  - 證明加上結構比對：`remark-parse`＋`remark-mdx`＋`remark-gfm` 解析正文（frontmatter 先切掉），驗證過的 glossary 連結換回文字、合併相鄰文字節點、拿掉 `position` 後比較；
  - 刪掉 `validateGlossaryLink`、`isGlossaryMatchText`，canonical 證明改回逐字比對 `[term](/glossary#錨點)`；
  - 改前或改後含 `\uE000` 時證明直接失敗。

  單元測試：審查找到的每一種寫法各一個（`~~~`、巢狀 fence、跨行 inline code、`{…}`、跨行 `<div title>`、緊貼粗體、跨行連結裡、反斜線），證明都要失敗；「第一次出現的位置緊貼粗體，修正器改連下一個位置、檢查器接受」一個。全站 `pnpm run glossary:check` 仍是 0 個違規，這個 PR 補過的 40 篇仍然通過證明。

- [x] 7.2 測試與小清理：hook 與 CI 的整合測試只留接線相關的案例（規則見 tasks 2.1）；刪掉 `tests/glossary-links.test.ts` 比對元件原始碼的斷言；`link-only-proof` 的 `validatePostLink` 改必填、unmerged 檢查留在 pre-commit 那一側、CI 不再假造 `stage`；`findMissingRelated` 拿掉沒人傳的參數；語言路徑改用同一個 `expectedHref`、glossary href 的 regex 只留一份；`list-content-gate-posts.mjs` 拿掉多餘的判斷。
- [ ] 7.3 詞彙表頁面：文章連結改用 `getLocalizedPostUrl`；hash 解碼失敗時不讓初始化中斷；刪掉 `findUnlabeledGlossaryCategories`，測試改成對每個詞條呼叫 `glossaryCategoryLabel`；Playwright 刪掉被涵蓋的重複案例，補「開 `/glossary#software-30` 會展開」與「點相關詞條後目標沒有被控制列蓋住」；CSS 拿掉沒有作用的 `[hidden]` 規則、分類顏色改用一個變數；`glossary.json` 的 `definedIn[].title` 沒有程式在讀，刪掉；`src/lib/glossary-anchor.mjs`、`scripts/tribunal-librarian-packet.py` 過期的註解改正。

## Workflow follow-up

- 依 `.agents/openspec-sdlc.md` 走階段 6 雙審（正確性錨 spec scenario、簡潔度錨 over-engineering）。
- 階段 7：在 chat 提供 preview URL（zh 與 en 詞彙表、一篇補了 Kubernetes 連結的文章）。
- 階段 8：archive 並 sync `glossary-browsing` 與 `glossary-link-coverage`，轉 ready，過 Codex auto-review gate 後用 merge 合併。
