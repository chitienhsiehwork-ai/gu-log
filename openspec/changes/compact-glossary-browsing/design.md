# Design

## Context

- 動機與量測見 proposal.md〈Why〉。
- 現在的 `/glossary` 與 `/en/glossary` 各寫一份 Astro 頁面。分類按鈕與 label 寫死在頁面裡。
- 錨點有四份推導邏輯：
  - 頁面：`linking.anchor` 或「小寫加連字號」，保留標點；
  - 頁內 `related`：只做「小寫加連字號」，忽略 `linking.anchor`；
  - `check-glossary-links.mjs` 的 `slugify`：去掉英數以外的字元；
  - `tribunal-librarian-packet.py`。
- 文章裡的 1,874 條連結是 checker 與 fixer 寫出來的，用的是 `slugify` 的結果。
- pre-commit 的「只改連結」豁免走 `check-staged-internal-post-links.mjs`。這支程式會把 glossary 連結正規化，但要求至少驗證到一條站內文章連結才放行。
- CI 的 `list-content-gate-posts.mjs` 用 `isLinkOnlyDiff` 正規化兩邊的連結再比對，只加 glossary 連結也會放行。兩邊的規則不一致。

## Goals / Non-Goals

**Goals:**

- 手機上 zh 詞彙表從約 41 個螢幕降到 10 個左右，所有既有錨點照常可用。
- 分類、錨點、補連結的豁免各只剩一份規則，避免再漂移。
- 加入 Kubernetes 條目並補完 31 篇的連結。

**Non-Goals:**

- 不拆分類頁，不做單詞頁，不改任何網址。
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

結論：拆頁的成本高、效益低。「每種語言一頁」寫成 `glossary-browsing` 的要求，以後要拆頁的提案必須先 delta 這條。

重啟條件（任一成立再討論）：

- 詞條多到精簡模式下仍超過約 30 個手機螢幕；
- 或改成單詞頁有明確的 SEO 或分享需求，而且有一套工具能一次、可驗證地遷移全部錨點連結。

### 2. 精簡顯示：CSS 先決定，JS 只做加強

- 伺服器端照常輸出每個詞條的完整內容。
- CSS 預設只顯示詞條列：名稱、英文名、分類 label、定義的前兩行（line-clamp）。完整定義、MoguNote 與 meta 預設隱藏。
- 詞條是 `:target`，或帶有 `.is-open`，就整條展開。所以從 `/glossary#x` 進來時，第一次繪製就是展開的，不會等 JS 跑完才跳動。
- 展開控制在沒有 JS 時是指向自己錨點的連結：點了就變成 `:target`，一次展開一條。有 JS 時改成切換 `.is-open` 的按鈕：可以同時展開多條，回報 `aria-expanded`，並處理 `hashchange`，讓點相關詞條時目標展開。
- 定義全文一直在 DOM 裡，搜尋照樣比對全文。

替代方案：

- 用 `<details>`：沒有 JS 也能切換，但 CSS 沒辦法讓 `:target` 打開它，各家瀏覽器對「錨點自動展開 details」的支援也不一致。
- 等 JS 跑完才收合：錨點落點會跳動。

### 3. 控制列固定在上方

- 搜尋框、分類按鈕與 A–Z 列包成一個 sticky 區塊。
- 詞條設定 `scroll-margin-top`，等於這個區塊的高度，錨點目標才不會被蓋住。
- 「點名稱複製連結」改成每列一個小的複製按鈕，名稱列本身負責展開。複製連結的能力保留。

### 4. 分類只有一份清單

- 在 `src/config/glossary.ts` 定義分類 id 與中英文 label 的對照。按鈕取「資料用到的分類」與這份對照的交集，詞條標籤也從這份對照取。
- 資料出現未知分類就讓單元測試失敗。
- Kubernetes 放 `platforms`，「平台」按鈕因此有了詞條。

### 5. 篩選狀態放 `?cat=`

- JS 在載入時讀 `?cat=`，切換分類時用 `history.replaceState` 更新查詢字串，保留錨點。
- 錨點目標被篩選掉時，先切回「全部」再捲動。

### 6. 中英文共用一個元件

兩頁改成薄薄的包裝，共用 `src/components/glossary/` 底下的元件。語言差異只剩文字來源（定義、MoguNote、label、介面字串）。

### 7. 錨點規則以 checker 的 `slugify` 為準

文章裡的 1,874 條連結都是照 `slugify` 寫的，所以以它為標準。差異只有少數含標點的詞條，例如 `Software 3.0` 的頁面 id 會從 `software-3.0` 變成 `software-30`。

規則放進一個 JS 模組，Astro 頁面、`related` 連結、checker 與 fixer 共用。Python 的 Librarian packet 照同一規則實作，另加一個測試，對全部詞條比對兩邊的結果，任何一條不同就失敗。

死錨點檢查放進 `check-glossary-links.mjs`，檢查文章與 `related`。目前的 10 個死錨點與 7 條 `related` 在同一個 PR 修掉：

- 大小寫錯的改成正確錨點；
- 沒有詞條的移除連結，或改指向正確詞條；
- `related` 指向不存在詞條的，改成正確名稱或刪掉。

### 8. 只改 glossary 連結的證明共用一份

- 抽出一個證明函式：把修改前後的 glossary 連結語法都拿掉之後，兩邊的內容要完全相同；新增或改動的 glossary 連結都要指向該文章語言、啟用中詞條的正確錨點。
- pre-commit（staged 對 HEAD）與 `list-content-gate-posts.mjs`（base 對 head）都呼叫它。既有的站內文章連結驗證保留。
- 新增或移除連結、改正錨點，都算只改連結。
- hook 錯誤訊息改成指向修法，不再建議 `--no-verify`。

### 9. Kubernetes 條目

- 定義與 MoguNote（中英文）由固定版本寫手產生，比喻接 Lv-18 的「一行白板配一位經理」。
- 不設 `linking.match`，只比對正式名稱 `Kubernetes`，預設區分大小寫。`kubernetes.io`、`kubernetes-sigs`、程式碼與元件屬性本來就會被排除。
- 補連結用 `apply-glossary-links.mjs --term Kubernetes`，31 個 diff 逐一看過。例如 mp-39 第一處出現在「Google Kubernetes Engine」裡，改連同篇其他較自然的位置。

## Risks / Trade-offs

- [MoguNote 預設收起來，Mogu 的聲音比較不顯眼] → 從文章點進來的詞條完整展開；在 chat 告知 ShroomDog，要恢復只需調整 CSS。
- [`software-3.0` 這類 id 改變，外部舊連結會失效] → 只影響少數含標點的詞條，站內連結全部改用新規則；接受。
- [sticky 控制列蓋住錨點目標] → `scroll-margin-top`，並在 Playwright 以手機 viewport 驗證目標在可見範圍。
- [只改連結的證明被拿來夾帶改字] → 拿掉連結語法後必須完全相同，並驗證錨點；pre-commit 與 CI 用同一份程式碼。
- [補連結讓 31 篇的版本號各加一] → 這是現行版本清單的既有語意（依 commit 數），接受。這個 PR 動到文章，必須用 merge，不得 squash，否則版本清單會跟 main 歷史對不上。
- [Playwright spec 依賴舊 DOM] → 同一個 PR 更新。

## Migration Plan

網址與資料格式都不變，不需要遷移。要回退就 revert 整個 PR；文章的連結修正是有效連結，可以留著。
