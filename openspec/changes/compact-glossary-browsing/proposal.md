# Proposal

## Why

ShroomDog 在 2026-10-12 的 chat 說詞彙表太長、要一直滑，提議把人物和其他分類拆成獨立頁面，同時要加一個 Kubernetes 條目（原話是 "add a kubernetes page"）。

三位唱反調的審查員量了線上版：

- 手機上 `/glossary` 約 41 個螢幕，`/en/glossary` 約 47 個。
- 每個詞條的高度，MoguNote 佔 56%，定義佔 27%，人物詞條總共只佔 13%。
- 照分類拆頁之後，光「概念」一頁還有約 29 個螢幕。

拆頁還會弄壞既有連結：文章裡有 1,874 條 `/glossary#…`，MoguNote 前綴有 3,959 處 `/glossary#mogu`。網址 `#` 後面的部分不會送到伺服器，沒辦法轉址。三位一致建議同一頁、把每個詞條變短，不拆頁。

審查也挖出幾個既有問題：

- `glossary.css` 裡縮小 MoguNote 的規則用了只有 Astro scoped style 才認得的 `:global()`，瀏覽器整條丟掉。
- 分類按鈕寫死在兩頁：「平台」底下 0 筆；`products`、`models` 沒有按鈕，中文頁直接顯示英文原字。
- 錨點有四份各自推導的邏輯，已經對不上。例如頁面是 `software-3.0`，checker 要求文章寫 `#software-30`。mp-212 的中英文版共有 8 條連到不存在的錨點，11 條英文文章的連結指向繁中詞彙表，`related` 有 7 條指向不存在的詞條。
- 加新詞條時，changed-term ratchet 要求每篇提到它的文章都補連結，可是「只改連結」的豁免兩邊都有問題：
  - pre-commit 自 e501524c 起只放行含站內文章連結的 diff，只加 glossary 連結的 diff 不放行，所以 Kubernetes 的補連結會被擋下；hook 的錯誤訊息還建議用 `--no-verify`。
  - 反過來，pre-commit 與 CI 都是不驗證就把 glossary 連結剝掉再比對。CI 還會先把行排序。結果錯錨點、錯語言，甚至包在 code 區塊裡的連結都可能被當成「只改連結」放行。

## What Changes

- **詞彙表改成精簡瀏覽**
  - 每個詞條預設顯示名稱、英文名、分類和一兩行定義，點一下就地展開完整定義、MoguNote、外部連結、相關詞條與文章。
  - 從 `/glossary#<錨點>` 進來時，目標詞條直接展開。
  - 搜尋、分類按鈕與 A–Z 列在捲動時保持可用。
  - 修好 MoguNote 縮小規則。
- **分類從資料產生**：分類按鈕依資料實際用到的分類產生，每個分類都要有中英文 label，缺了就讓測試失敗；沒有詞條的分類不出現按鈕。篩選只在頁內，不寫進網址。
- **中英文共用**：兩頁改用同一個元件，行為一致；英文頁的文章連結顯示英文版標題。
- **錨點只有一套規則**
  - 頁面 id、`related` 連結、checker 與 fixer 改用同一套錨點規則；Librarian packet 不再自己推錨點，改讀 checker 的結果。
  - 錨點推出來是空的或重複，測試就失敗。
  - glossary 檢查新增兩種失敗：文章或 `related` 連到不存在的錨點，以及文章連到另一種語言的詞彙表。
  - 修掉 mp-212 的死錨點、11 條連錯語言的連結，以及 7 條 `related`。
- **只改 glossary 連結的修改可以被機械證明**
  - 所有「只改連結」的豁免共用一個「先驗證、再剝掉」的函式：連結要指向該語言、啟用中詞條的正確錨點，位在可以放連結的地方，新包起來的文字要是該詞條的寫法；剝掉驗證過的連結後，整份檔案要跟修改前逐字相同。
  - pre-commit 與 CI 都用它，CI 的行排序比對拿掉。
  - hook 的錯誤訊息不再建議 `--no-verify`。
- **新增 Kubernetes 條目**
  - 分類是 `platforms`，`definedIn` 指向 Lv-18，`aliases` 收 `K8s`，自動比對只用正式名稱 `Kubernetes`。
  - 同一個 commit 替 31 篇提到它的文章補連結（繁中 16、英文 15）。
  - 條目的定義與 MoguNote 由固定版本寫手產生。
- **網址不變**：`/glossary`、`/en/glossary` 與所有 `#錨點` 都維持原樣。不做分類分頁，也不做單詞頁；理由與重啟條件記在 design.md。

## Capabilities

### New Capabilities

- `glossary-browsing`：讀者瀏覽與落地詞彙表的方式，包括：
  - 每種語言一頁；
  - 詞條預設精簡、就地展開；
  - 從錨點進來時目標詞條展開；
  - 分類篩選從資料產生並有雙語 label；
  - 中英文行為一致。

### Modified Capabilities

- `glossary-link-coverage`：新增三條要求：
  - 錨點只能由同一套規則推導；
  - glossary 連結要指向存在的錨點與正確語言；
  - 只改 glossary 連結的修改由同一套「先驗證、再剝掉」的證明放行，略過內容品質 gate。

## Impact

- 頁面與樣式：`src/pages/glossary.astro`、`src/pages/en/glossary.astro`，抽出共用元件；`src/styles/glossary.css`。
- 資料與設定：`src/data/glossary.json`（Kubernetes 條目、修正 `related`）、`src/config/glossary.ts`（分類 label；刪掉沒有引用的清單）、共用的錨點模組。
- 工具與 gate：glossary 的檢查器與修正器、Librarian packet、pre-commit 的「只改連結」豁免與 PR content gate，加上對應的單元測試與 Playwright spec。
- 內容：31 篇補 Kubernetes 連結；mp-212 中英文版修死錨點；英文文章裡連錯語言的連結改連英文詞彙表。都是只改連結的修改，不重跑 Tribunal。
- 不受影響：網址、`glossary-identity-ssot` 的 Mogu 與人物錨點、文章正文其他內容、搜尋索引。
