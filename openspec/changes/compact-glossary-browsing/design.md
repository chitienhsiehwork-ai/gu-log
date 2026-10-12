# Design

## Context

- 動機與量測見 proposal.md〈Why〉。
- 現在的 `/glossary` 與 `/en/glossary` 各寫一份 Astro 頁面。分類按鈕與 label 寫死在頁面裡。英文頁的文章連結顯示中文標題。
- 錨點有四份推導邏輯：
  - 頁面：`linking.anchor` 或「小寫加連字號」，保留標點；
  - 頁內 `related`：只做「小寫加連字號」，忽略 `linking.anchor`；
  - `check-glossary-links.mjs` 的 `slugify`：去掉英數以外的字元；
  - `tribunal-librarian-packet.py`：`term.lower().replace(' ', '-')`。
- 文章裡的 1,874 條連結是 checker 與 fixer 寫出來的，用的是 `slugify` 的結果。
- 「只改連結」的豁免有三條路徑，都是不驗證就把 glossary 連結剝掉：
  - pre-commit 走 `check-staged-internal-post-links.mjs`：剝掉 glossary 連結，再要求至少驗證到一條站內文章連結才放行。所以只加 glossary 連結會被擋；反過來，只要同時有一條合法的文章連結，錯錨點的 glossary 連結就一起過關。
  - CI 的 `list-content-gate-posts.mjs` 用 `isLinkOnlyDiff`：剝掉兩邊的連結、把行 trim 再排序後比對。行序調換也會過，pre-commit 卻會擋。
  - 同一支程式的 taxonomy 證明，也先用同一個正規化剝掉連結。
- `check-glossary-links.mjs --check-canonical-staged-file` 另有一套「把禁用中文詞換成 canonical 詞條連結」的證明。它已經會驗證新包的連結必須是 `[term](/glossary#anchor)`。
- 全域 CSS 在 `html` 上設了 `scroll-padding-top`。

## Goals / Non-Goals

**Goals:**

- 手機上 zh 詞彙表從約 41 個螢幕降到 10 個左右，所有既有錨點照常可用。
- 分類、錨點、補連結的豁免各只剩一份規則，避免再漂移。
- 加入 Kubernetes 條目並補完 31 篇的連結。

**Non-Goals:**

- 不拆分類頁，不做單詞頁，不改任何網址。
- 篩選狀態不寫進網址。沒有人要求分享篩選結果；以後有需求再加。
- 不把詞彙表加進站內搜尋索引。
- 不調整 Docker 這類其他候選詞條的收錄。審查提到 Docker 有 35 篇提及卻沒有詞條，留給之後決定。
- 不改 `glossary-identity-ssot` 的 Mogu 與人物規則。

## Decisions

### 1. 不拆頁（決策紀錄）

量測結果：

- 人物只佔高度的 13%。
- 把非「概念」的分類全部拆走，「概念」一頁還有約 29 個螢幕。
- 文章與 MoguNote 有數千條 `/glossary#…` 連結。錨點不會送到伺服器，所以 Vercel 轉址接不住；用 JS 轉址又照顧不到不執行 JS 的讀者、爬蟲與 `.md` 匯出。
- 全站改寫連結會撞上 119 到 237 篇沒有分數的舊文 gate。
- 以後分類一調整，就得搬一批連結。

結論：拆頁的成本高、效益低。「每種語言一頁」寫成 `glossary-browsing` 的要求，以後要拆頁的提案，必須先用 delta spec 改掉這條要求。

重啟條件（任一成立再討論）：

- 詞條多到精簡模式下仍超過約 30 個手機螢幕；
- 或改成單詞頁有明確的 SEO 或分享需求，而且有一套工具能一次、可驗證地遷移全部錨點連結。

### 2. 精簡顯示：CSS 先決定，JS 只做加強

- 伺服器端照常輸出每個詞條的完整內容。
- CSS 預設顯示詞條列：名稱、英文名、分類 label、定義的前兩行（line-clamp）。完整定義、MoguNote 與 meta 預設隱藏。定義的第一句因此要能單獨成立。
- 每列的複製連結按鈕由 script 用 template 加上，因為剪貼簿本來就要 JS。沒有 JS 時，點詞條名稱的錨點連結會改網址，一樣能分享；頁首提到按鈕的那句說明也只在有 JS 時顯示。
- 詞條是 `:target`，或帶有 `.is-open`，就整條展開。所以從 `/glossary#x` 進來時，第一次繪製就是展開的，不會等 JS 跑完才跳動。
- 展開控制在沒有 JS 時是指向自己錨點的連結：點了就變成 `:target`，一次展開一條。這時沒辦法向輔助技術回報展開狀態，所以 spec 只要求有 JS 時回報。
- 有 JS 時改成切換 `.is-open` 的按鈕：可以同時展開多條，回報 `aria-expanded`，並處理 `hashchange`，讓點相關詞條時目標展開。
- 收起一個靠 `:target` 展開的詞條時，JS 加上 `.is-collapsed` 蓋過 `:target`。只用 `history.replaceState` 拿掉錨點不夠，有些瀏覽器不會因此更新 `:target`。
- 定義全文一直在 DOM 裡，搜尋照樣比對全文。

替代方案：

- 用 `<details>`：沒有 JS 也能切換，但 CSS 沒辦法讓 `:target` 打開它，各家瀏覽器對「錨點自動展開 details」的支援也不一致。
- 等 JS 跑完才收合：錨點落點會跳動。

### 3. 控制列固定在上方

- 搜尋框、分類按鈕與 A–Z 列包成一個 sticky 區塊。
- 錨點目標不被蓋住，靠詞彙表頁面上的 `scroll-padding-top`（等於 sticky 區塊的高度）。不另外在詞條上加 `scroll-margin-top`，因為它會跟全域的 `scroll-padding-top` 疊加。
- 「點名稱複製連結」改成每列一個小的複製按鈕（有 JS 時），名稱列本身負責展開。複製連結的能力保留。
- 詞彙表頁面改成直接跳到錨點（`scroll-behavior: auto`），不用全站的平滑捲動。Chromium 從網址錨點進來時也會慢慢捲，捲到一半網頁字型換上，目標就停在控制列底下。控制列的實際高度由 JS 量好，寫進 `--glossary-toolbar-height`；沒有 JS 時用接近實際高度的預設值。

### 4. 分類只有一份清單

- 在 `src/config/glossary.ts` 定義分類 id 與中英文 label 的對照。按鈕取「資料用到的分類」與這份對照的交集，詞條標籤也從這份對照取。
- 資料出現未知分類就讓單元測試失敗。
- Kubernetes 放 `platforms`，「平台」按鈕因此有了詞條。

### 5. 篩選只在頁內

- 分類篩選是頁內狀態，不寫進網址；重新載入就回到「全部」。
- 點到被目前篩選藏起來的詞條（例如相關詞條）時，先切回「全部」再展開、捲動。
- 替代方案：寫進 `?cat=`。沒有人要求分享篩選結果，還要處理錨點與篩選衝突，先不做。

### 6. 中英文共用一個元件

兩頁改成薄薄的包裝，共用 `src/components/glossary/` 底下的元件。語言差異只剩文字來源：定義、MoguNote、label、介面字串，以及文章連結（英文頁連英文版文章、顯示英文版標題）。文章標題讀該語言版本文章的 frontmatter，已下架的文章不列出。

### 7. 錨點規則以 checker 的 `slugify` 為準

文章裡的 1,874 條連結都是照 `slugify` 寫的，所以以它為標準。差異只有少數含標點的詞條，例如 `Software 3.0` 的頁面 id 會從 `software-3.0` 變成 `software-30`。文章裡原本連 `#software-30` 的連結因此變成有效。

- 規則放進一個 JS 模組，Astro 頁面、`related` 連結、checker 與 fixer 共用。模組的測試擋下空錨點（例如純中文的 term）與重複錨點，這種詞條要設 `linking.anchor`。
- Librarian packet 不再自己推錨點，改呼叫 checker 的 `--format json`，用它回報的結果列出可能漏連的詞條。少一份要對齊的實作，也不用另寫一致性測試。
- checker 新增連結檢查：
  - 文章的 glossary 連結指向不存在的錨點（大小寫不符也算）就失敗。判斷存在與否要把停用自動連結的詞條算進去，所以不能直接沿用會濾掉停用詞條的 `normalizeGlossary`。
  - 英文文章連到 `/glossary#…`、繁中文章連到 `/en/glossary#…` 就失敗。這條檢查負責落實既有的〈Link target MUST follow post language〉。
  - `related` 列出不存在的詞條就失敗。
- 同一個 PR 修掉現有違規：mp-212 中英文版大小寫錯的錨點改正、沒有詞條的（`#Opus`）拿掉連結；連錯語言的英文文章連結改連 `/en/glossary`；`related` 改正或刪掉。

### 8. 只改 glossary 連結的證明共用一份「先驗證、再剝掉」

- 抽出一個正規化函式，拿修改前後兩個版本來比：
  - 新增或改動的每個 glossary 連結先驗證：指向該文章語言、啟用中詞條的正確錨點，而且位在 `buildUnsafeMask` 判定的安全區（不在 code、frontmatter、JSX 屬性或既有連結裡）。沒有變動的既有連結在兩邊一起剝掉，不影響比對。
  - 新包起來的文字（修改前那個位置不是連結）要能被 checker 的比對規則認成該詞條；只改錨點的既有連結保留原文字，例如 mp-212 的 `[glossary 有完整拆解](/glossary#Codex)`。
  - 驗證過的才剝掉，驗證不過的原樣留著，比對自然失敗。
  - 剝掉之後整份檔案（含 frontmatter）逐字比對，不 trim、不排序。
- 站內文章連結沿用既有的驗證，兩種連結在同一個函式裡各自驗證。
- 用它的地方：
  - pre-commit 的「只改連結」豁免（`check-staged-internal-post-links.mjs`），拿掉「至少一條文章連結」的條件；
  - CI 的 `list-content-gate-posts.mjs`，取代 `isLinkOnlyDiff`，taxonomy 證明的連結正規化也換成它；
  - canonical 詞的證明（`--check-canonical-staged-file`）只共用錨點規則：新包的連結必須逐字是 `[term](/glossary#錨點)`，錨點從共用模組取得。它的文字規則比只改連結的證明更嚴，所以不共用文字驗證。
- 驗證要讀跟文章同一個版本的 glossary：pre-commit 讀 staged，CI 讀 head。這樣同一個 commit 新增的 Kubernetes 才算啟用中。
- 原始碼比對之外，再比一次解析後的結構。用網站同一套 parser（`remark-parse`、`remark-mdx`、`remark-gfm`）解析修改前後的正文；frontmatter 已經逐字比過，先切掉。把驗證過的 glossary 連結換回它的文字、合併相鄰的文字節點、拿掉位置資訊後再比。原始碼一樣、渲染卻不同的情況（強調語法被拆開、連結疊在連結裡、反斜線跳脫）都在這裡擋下。結構比對只補原始碼比對看不到的情況，不取代它，因為 spec 要求剝掉連結後逐字相同。
- 「哪些位置可以放連結」只有一份規則，檢查器、修正器與證明共用：
  - 遮罩補上 `~~~` 與外層較長的 code fence、跨行的 inline code、跨行寫的標籤、MDX 的 `{…}`；
  - 不放在緊貼 `*`、`_`、`~` 的位置、前一個字元是 `\` 的位置，以及其他連結的文字裡（包括文字跨行的連結）。

  第一次出現的位置不能放時，檢查器與修正器都改看下一個位置。這樣修正器不會寫出證明會拒絕的連結，檢查器也不會要求一個放不進去的連結。緊貼強調語法的位置其實有些放得下（例如兩側是空白），但一律不放比照 CommonMark 規則判斷簡單，代價只是那一處不連。

- 新增或移除連結、改正錨點，都算只改連結。
- 這條只放寬內容品質 gate。證明涵蓋整份檔案，所以被放行的修改不會動到 frontmatter；pre-commit 對被放行的檔案略過 `validate-posts` 也因此沒有風險。
- hook 錯誤訊息改成指向修法，不再建議 `--no-verify`。

### 9. Kubernetes 條目

- 定義與 MoguNote（中英文）由固定版本寫手產生，比喻接 Lv-18 的「一行白板配一位經理」，定義第一句可以單獨成立。產出存成這個 change 目錄裡的 `kubernetes-entry.json`，實作時原文照貼，不改字；已經手動跑過晶晶體、AI 腔與代名詞檢查。
- 不設 `linking.match`，只比對正式名稱 `Kubernetes`，預設區分大小寫。`kubernetes.io`、`kubernetes-sigs`、程式碼與元件屬性本來就會被排除。
- 補連結用 `apply-glossary-links.mjs --term Kubernetes`，31 個 diff 逐一看過。mp-39 與 en-mp-39 全文只有「Google Kubernetes Engine」這一處提到 Kubernetes，連結留在其中的「Kubernetes」上：GKE 就是 Google 託管的 Kubernetes，連過去語意正確；要避開只能改字或加 `glossaryIgnore`，那就不是只改連結了。
- 條目與 31 篇補連結放同一個 commit。分開的話，只有條目的那個 commit 會被 changed-term ratchet 擋下（31 篇都還沒連）。

## Risks / Trade-offs

- [MoguNote 預設收起來，Mogu 的聲音比較不顯眼] → 從文章點進來的詞條完整展開；在 chat 告知 ShroomDog，要恢復只需調整 CSS。
- [`software-3.0` 這類 id 改變，外部舊連結會失效] → 只影響少數含標點的詞條，站內連結全部改用新規則；接受。
- [sticky 控制列蓋住錨點目標] → 用頁面的 `scroll-padding-top`，並在 Playwright 以手機 viewport 驗證目標在可見範圍。
- [只改連結的證明被拿來夾帶改字或亂加連結] → 先驗證再剝掉、整份檔案逐字比對，再比一次解析後的結構；新包的文字要是詞條的寫法；pre-commit 與 CI 用同一份程式碼。
- [只改錨點時，新錨點跟連結文字無關] → 讀者看到的文字不變，spec 也允許只改錨點的連結保留原文字（例如 mp-212 那條）；接受，不另外檢查。
- [glossary.json 裡的文字沒有內容 gate] → Kubernetes 的四段文字由固定版本寫手產生，人工看過，並手動跑過晶晶體、AI 腔與代名詞檢查。
- [補連結讓 31 篇的版本號各加一] → 這是現行版本清單的既有語意（依 commit 數），接受。這個 PR 動到文章，必須用 merge，不得 squash，否則版本清單會跟 main 歷史對不上。
- [Playwright spec 依賴舊 DOM] → 同一個 PR 更新。

## Migration Plan

網址與資料格式都不變，不需要遷移。

回退：整個 PR revert 會連文章的連結修正與 Kubernetes 補連結一起退掉。UI、gate、資料與文章分成不同的 commit，合併用 merge，所以要只退 UI，revert UI 的那幾個 commit 就好；文章的連結修正都是有效連結，可以留著。
