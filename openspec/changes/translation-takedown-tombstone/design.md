# Design

## Context

- ShroomDog 2026-09-26 的決定：GP 是沒取得作者同意的整篇翻譯，全部下架成墓碑頁；取材自付費新聞媒體的 MP 也下架；`retired`／`deprecated` 只是貼標籤，真的下架要保留網址、清空內文、回 410、從列表與機器輸出拿掉；公開 repo 清掉 HEAD 上的副本，git 歷史先接受（issue #1111）。
- 2026-09-27 ShroomDog 在 chat 授權「下架清單不用給我看，直接 e2e 做完」。本 change 因此不設逐篇確認 gate：清單依規則產生，controller 對帳，下架直接排進 apply。這筆授權同時滿足 owner 的通則「不要刪除任何已發布內容，除非我明確同意」。
- 網站是 Astro 靜態輸出、部署在 Vercel，沒有 adapter。根目錄已有 Vercel Routing Middleware（`middleware.ts`，matcher 為 `/posts/:path*` 與 `/en/posts/:path*`），目前負責 HTML／Markdown 內容協商。`vercel.mjs` 產生 1,079 條 redirects 加 3 條 headers，共 1,082 條平台路由，上限 2,048。
- 目前的 slug 集合不變式在 `scripts/build-post-markdown.mjs` 的 `assertInputSlugSets()`：MDX 檔名集合要等於 `dist/api/posts/*.json` 集合，也要等於 `dist/posts/*/index.html` 加 `dist/en/posts/*/index.html` 的集合；產生 `.md` 後再檢查 Markdown 集合等於來源、各語言的 Markdown 集合等於同語言 HTML 集合。任何不符都讓 postbuild 失敗。
- 下架前的語料：GP 繁中 271 篇（GP-1 到 GP-275，缺 53、145、147、163）、英文 270 篇（GP-275 沒有英文）；MP 繁中 302、英文 300。Frontmatter 共用欄位 `summary`、`translatedBy`、`tags`、`scores` 等，約 84 個 script／test／workflow 直接讀 `src/content/posts`。

## Goals / Non-Goals

**Goals：**

- 下架文章的原網址保留，改成定稿墓碑頁並回 HTTP 410；任何建置產物與 repo HEAD 都不再出現譯文。
- 三種輸出（HTML／JSON／`.md`）對下架文章的處理一致，而且由 build 封閉驗證。
- 下架是一個有 schema、有 gate 的正式狀態，之後的下架批次（例如 MP 防翻譯檢查的結果）可以重用同一套機制。
- 本次批次：GP 全部、付費新聞網域的 MP，依規則產生、可重算。

**Non-Goals：**

- 不做「改寫成導讀」；那是後續 change，會從高分文與 owner 精選挑選。清單裡保留下架前分數，方便後續挑選。
- 不改寫 git 歷史（issue #1111），也不處理 repo 外的快取與舊 deployment（見 Risks，只給建議）。
- 不判定 MP 邊界案例；它們留給之後的 MP 防翻譯檢查。
- 不改 GP 列表頁與首頁的文案；GP 列表會變成 0 篇，首頁 GP 區塊本來就會在沒有文章時自動隱藏。
- 不新增逐篇 redirect，也不引入 Vercel adapter 或 server output。

## Decisions

### D1. 狀態模型：新增 `status: taken-down`，frontmatter 只留墓碑需要的欄位

- 不沿用 `retired`：現在的 `retired` 語意是「事實過時但仍公開」，列表、API、`.md` 都照常輸出全文。新狀態讓「下架」有明確、可驗證的意義。
- 不叫 `withdrawn`：`brand-taxonomy` 已用 withdrawn 描述「重分類後舊網址轉址到新文章」，意思不同，避免混淆。英文 UI 標籤是「Taken down」，名稱一致。
- 下架文章的 frontmatter 採 allowlist，其他欄位一律拒絕：

  | 欄位 | 必填 | 用途 |
  |---|---|---|
  | `ticketId` | 是 | 標籤、配對 |
  | `title` | 是 | 視覺隱藏 h1 與 `<title>`（gu-log 自己的標題） |
  | `lang` | 是 | 路由、配對 |
  | `status: taken-down` | 是 | 狀態 |
  | `translatedDate` | 是 | 石碑的發表日期 |
  | `takenDownAt` | 是 | 石碑的下架日期（`YYYY-MM-DD`） |
  | `source` | 是 | 來源名稱；卡片標題的 fallback |
  | `sourceUrl` | 是 | 卡片連結與網域 |
  | `sourceTitle` | 是 | 卡片上的原文標題（新欄位） |
  | `author` | 否 | 卡片上的原作者（沿用既有欄位） |

  `summary`、`tags`、`scores`、`translatedBy`、`originalDate`、`series`、dedup 與 taxonomy 欄位都移除：它們不是墓碑需要的，其中 `summary` 本身就是來源的衍生文字。

  範例：

  ```yaml
  ---
  ticketId: GP-273
  title: 人，才是那個迴圈
  lang: zh-tw
  status: taken-down
  translatedDate: "2026-08-13"
  takenDownAt: "2026-09-28"
  source: brentfitzgerald.com
  sourceUrl: https://brentfitzgerald.com/posts/the-human-is-the-loop/
  sourceTitle: The human is the loop
  author: Brent Fitzgerald
  ---
  ```

- 正文必須是空的（只允許空白），包含不得留 `import` 行。
- 繁中與英文 sidecar 各自寫 `status: taken-down`，不靠 `resolvePostStatus()` 的繼承：兩邊正文都要清空，schema 也要能逐檔驗證。配對一致性（同 `ticketId` 兩檔都下架，`takenDownAt`、`sourceUrl`、`sourceTitle`、`author` 相同）由 validator 檢查。
- Zod schema 改成「一般文章 schema ∪ 下架文章 schema（strict）」，以 `status` 區分；`src/utils/post-status.ts` 提供 `isTakenDown()` 與型別收窄，讓只處理一般文章的頁面不必到處判斷 optional 欄位。
- `PostStatus` 加入 `taken-down`：`getPublishedPosts()` 已經只收 `published`，自然排除；`getListablePosts()` 目前只排除 `deprecated`，要加上 `taken-down`；`getIndexPosts()` 與導覽 baseline 跟著排除。
- 下架文章的來源 metadata（`sourceTitle`、`author`）在執行下架時補齊，規則見 D8。

### D2. 墓碑頁：同一個路由、同一個 HTML 路徑

- 繁中與英文文章路由遇到下架文章時，在 `BaseLayout` 內只渲染新的墓碑元件（沿用站上的 header、主題切換、footer），`getStaticPaths()` 照常輸出，所以 `dist/posts/<slug>/index.html` 仍存在。
- `BaseLayout`：`noindex`；不輸出 `.md` alternate；`<title>` 為「<標題>（已下架） - gu-log」／「<title> (taken down) - gu-log」；meta description 用站台預設值，不用 `summary`。
- 不渲染：目錄、tags、`ArticleActionArea`（已讀、分享、登入 CTA）、相關文章／系列導覽／上下篇、`ArticleTechnicalDetails`（版本與 GitHub 修改歷史連結）、Giscus 留言、AI popup、狀態 banner、原本的來源列（由「去讀原文 →」卡片取代）。
- 機器 marker：墓碑的 `<article>` 帶 `data-post-tombstone`、`data-post-status="taken-down"`、`data-post-slug`、`data-post-lang`，不帶一般文章的 `data-post-representation`。Exporter 與 postbuild 檢查用它確認「墓碑頁真的渲染成墓碑」。
- 版面與素材照 `design-ref/tombstone-c-v9.html`：石碑圖寬約 225px 靠右下、Mogu 約 150px 疊在左下；碑文用 HTML 疊在石面上。素材 `tombstone.webp`（450×507）、`mogu-crying.webp`（280×320）是 2x 已裁切版，從 `design-ref/` 複製到 `src/assets/tombstone/`。兩張圖都是裝飾，`alt=""`，意思由旁邊的文字承擔。
- 顏色用站上既有 token（`--color-surface`、`--color-border`、`--color-accent`、`--color-mogu-orange`、系列 badge token 等），不寫死 hex。唯一例外是碑文：石頭素材在深淺主題都是米色，新增 `--color-tombstone-ink`（`#3d4a4e`）與 `--color-tombstone-rule`（`rgba(61, 74, 78, 0.35)`），兩個主題定義相同值，並用 `check-contrast` 與 uiux-auditor 驗證對比。「已下架」標籤用暖橘（`--color-mogu-orange` 系列）。
- 顏文字：一律經過 `src/plugins/remark-kaomoji-nowrap.mjs` 的 `protectKaomoji()`（站上不斷行規則的 SSOT）。實測目前 `ಥ_ಥ` 本來就不會斷、`((( ；ﾟДﾟ)))` 保護後不會斷，但 `(－人－)` 偵測不到而且可斷；要擴充偵測字元（例如全形 `－`），並把三個顏文字加進 `scripts/check-kaomoji-unbreakable.mjs` 的 corpus 鎖住。`ಥ` 依賴 Kannada 字型，定稿用 Google Fonts 的 Noto Sans Kannada 等字型；apply 時以截圖確認系統 fallback 可接受，不行才只在墓碑頁載入 `text=` 子集字型。
- 日期格式：`YYYY.MM.DD – YYYY.MM.DD`（`translatedDate` 到 `takenDownAt`）。
- 英文石碑第二行「a gu-log translation」比中文長，允許換成兩行或調小字級，以 390px 寬、雙主題截圖驗證不溢出石面。

### D3. 文案

定稿與決定來源不同，分三組。所有對話框行句尾不加句號；卡片的網域取 `sourceUrl` 的 hostname 並去掉開頭 `www.`；`author` 缺少時卡片第二行只顯示網域。

**GP 繁中（owner 定稿，不改字）**

| 位置 | 文字 |
|---|---|
| 標籤 | `<ticketId>`、「已下架」 |
| 石碑 | 「gu-log 的」／「翻譯文章之墓」／「<發表日期> – <下架日期>」／「安息吧 (－人－)」 |
| 對話框標題 | 「Mogu 內心小劇場：」 |
| 對話框 | 嗚嗚，我辛辛苦苦翻了一整篇 ಥ_ಥ／結果才知道，整篇翻譯要先經過作者同意／可是我太 i 了，不敢問 ((( ；ﾟДﾟ)))／只好幫中文版立個小墓碑／還好原文沒事，點下面去看原汁原味的吧！ |
| 卡片 | 「去讀原文 →」／`sourceTitle`／「`author` · 網域」 |
| 頁尾 | 「回首頁 →」 |
| 視覺隱藏 h1 | 「<標題>（gu-log 翻譯文章，已下架）」 |

**GP 英文 sidecar（controller 2026-09-27 定案）**

| 位置 | 文字 |
|---|---|
| 標籤 | `<ticketId>`、「Taken down」 |
| 石碑 | 「Here lies」／「a gu-log translation」／「<published date> – <takedown date>」／「Rest in peace (－人－)」 |
| 對話框標題 | 「Mogu's inner monologue:」 |
| 對話框 | Waaah, I translated this whole thing ಥ_ಥ／Then I learned: translating a whole article needs the author's OK／But I'm way too introverted to ask ((( ；ﾟДﾟ)))／So I gave the translation a little tombstone／Good news: the original is alive and well. Go read it below! |
| 卡片 | 「Read the original →」／`sourceTitle`／「`author` · domain」 |
| 頁尾 | 「Back to home →」（由站上既有的「Back to home」加上與中文版相同的箭頭位置推導） |
| 視覺隱藏 h1 | 「<title> (gu-log translation, taken down)」（由石碑與標籤文案推導） |

**MP（建議版，待 owner 確認，見 Open Questions）**

`brand-taxonomy` 規定 MP 不得被標示成翻譯或使用「原文出處」類標籤。GP 文案直接套到 MP 會違反這條，也和「MP 由 Mogu 依來源撰寫」的系列身份不符。建議 MP 只做最小改字，其餘沿用定稿：

| 位置 | GP 定稿 | MP 建議 |
|---|---|---|
| 石碑第二行 | 翻譯文章之墓 | 改寫文章之墓 |
| 對話框第 1 行 | 嗚嗚，我辛辛苦苦翻了一整篇 ಥ_ಥ | 嗚嗚，我辛辛苦苦寫了一整篇 ಥ_ಥ |
| 對話框第 2 行 | 結果才知道，整篇翻譯要先經過作者同意 | 結果才知道，整篇改寫也要先經過作者同意 |
| 對話框第 4 行 | 只好幫中文版立個小墓碑 | 只好幫這篇立個小墓碑 |
| 對話框第 5 行 | 還好原文沒事，點下面去看原汁原味的吧！ | 還好來源沒事，點下面去看原汁原味的吧！ |
| 卡片標籤 | 去讀原文 → | 去讀來源 → |
| 視覺隱藏 h1 | （gu-log 翻譯文章，已下架） | （gu-log 改寫文章，已下架） |
| 英文石碑第二行 | a gu-log translation | a gu-log rewrite |
| 英文第 1、2、4、5 行 | translated／translating／the translation／the original | Waaah, I rewrote this whole thing ಥ_ಥ／Then I learned: rewriting a whole article needs the author's OK／So I gave the rewrite a little tombstone／Good news: the source is alive and well. Go read it below! |
| 英文卡片標籤 | Read the original → | Read the source → |
| 英文 h1 | (gu-log translation, taken down) | (gu-log rewrite, taken down) |

若 owner 選擇 MP 與 GP 完全同一版，controller 要在 `brand-taxonomy` delta 另加墓碑例外，並把 `post-takedown` 的 MP 情境改成沿用 GP 文案。

### D4. HTTP 410：沿用既有 Routing Middleware，不新增路由

- 限制：Vercel 靜態設定做不到 410。`redirects` 只接受 3xx，`rewrites`／`headers` 不能改狀態碼；舊式 `routes` 可以設 `status`，但不能和現有的 `redirects`／`headers` 並用；逐篇規則會吃掉約 550 條預算，owner 也已否決逐篇轉址。
- 做法：`middleware.ts` 已經攔截 `/posts/*` 與 `/en/posts/*`。新增判斷，把請求路徑正規化（去掉一個結尾斜線）後比對下架清單：
  - 正式網址（有無結尾斜線）：middleware 以 `fetch` 取同語言的靜態墓碑 `…/<slug>/index.html`，再包成 `new Response(body, { status: 410 })`，`Content-Type: text/html; charset=utf-8`，保留 `Vary: Accept`。`…/index.html` 不符合 `isCanonicalPostPath()`，middleware 會直接放行，不會遞迴。
  - `HEAD`：回 410、不帶正文。
  - `Accept` 偏好 Markdown：仍回 410 墓碑 HTML，不改寫到 `.md`。
  - `<slug>.md`：回 410 與簡短 `text/plain` 說明，不含譯文。
  - subrequest 失敗時仍回 410（最小 HTML，只含回首頁連結），狀態碼不退回 200，也不回傳任何譯文。
- 為什麼不用 `next({ status: 410 })` 或 `rewrite(url, { status: 410 })`：這兩種寫法在非 Next.js 的 Routing Middleware 上會不會真的改掉最終狀態碼，官方文件沒有保證，只能部署後才知道；自己組 `Response` 是文件明載的用法，狀態碼由程式碼決定，也能用 vitest mock `fetch` 測。代價是每次開墓碑多一次同站請求，墓碑流量很低，可以接受。
- 直接請求 `…/<slug>/index.html` 會拿到 200 的同一份墓碑 HTML。內容一樣不含譯文，接受。
- 平台路由數不變（1,082）；`tests/vercel-routing-config.test.ts` 加上鎖定。
- 下架清單：`scripts/build-taken-down-registry.mjs` 從 frontmatter 產生 `src/data/taken-down-posts.json`（排序後的正式路徑清單），commit 進 repo，給 middleware 與 `astro.config.mjs` 的 sitemap filter import。比照 `post-versions.json`：pre-commit 動到文章時重生並 stage，prebuild、pre-push 與 CI 跑 `--check`，過期就失敗。這樣不論 Vercel 何時打包 middleware，打包到的都是 fresh 的清單。

### D5. 三種輸出與 slug 集合不變式

令 S 為 MDX 檔名集合、T 為 frontmatter `status: taken-down` 的集合、L = S − T：

- HTML（繁中加英文）集合 = S：網址保留；T 的頁面必須帶墓碑 marker，L 的頁面必須帶一般文章 marker。
- `dist/api/posts/*.json` 集合 = L。
- `.md` 集合 = L；各語言 `.md` 集合 = 同語言 HTML 集合 ∩ L。
- T 與 JSON、`.md` 的交集為空；`src/data/taken-down-posts.json` 的內容 = T。

每個 slug 要嘛三種輸出都有（未下架），要嘛只有 HTML 墓碑（下架），不會出現半套。檢查放在 `assertInputSlugSets()` 與 exporter，任何不符都讓 postbuild 失敗。Exporter 原本「每篇都有 route marker」的規則延伸成：L 的 marker 照舊交叉驗證 status banner；T 只驗證墓碑 marker 存在、不輸出 Markdown。

### D6. 出口盤點

| 出口 | 目前 | 下架後 | 機制 |
|---|---|---|---|
| 文章頁 HTML | 全文 | 墓碑頁 | D2 |
| HTTP 狀態 | 200 | 410 | D4 middleware |
| `/api/posts/{slug}.json` | 含整份 MDX 原文 | 不產生（404） | `getStaticPaths()` 排除 T |
| `.md` 與內容協商 | 全文 Markdown | 不產生；`.md` 回 410；協商不改寫 | D4、D5 |
| RSS、`/api/feed.json`、三份搜尋索引 | 只收 `published` | 自動排除 | `getPublishedPosts()` |
| sitemap | 所有頁面 | 排除 T | `@astrojs/sitemap` filter |
| 首頁、系列頁、tags、tags 索引、Level-Up 頁 | listable／index | 排除 | `getListablePosts()` 排除 T |
| 閱讀紀錄 | published | 自動排除 | `getPublishedPosts()` |
| glossary 的「文章」連結（`definedIn`） | 直接列出 | 渲染時排除 T | glossary 頁讀下架清單 |
| 相關文章、系列、上下篇 | published baseline | 自動排除；墓碑本身不渲染 | D1、D2 |
| OG／meta description | 站台預設 | 站台預設；`noindex` | D2 |
| 版本號與 GitHub 修改歷史連結 | `ArticleTechnicalDetails` | 不渲染 | D2 |
| `post-versions.json`、`post-reader-revisions.json` | 只有計數與 hash | 保留，不含內文 | 不變 |
| 品牌遷移前的舊文章網址（`quality/brand-taxonomy-post-migration.json`） | 308 → 200 | 308 → 410（507 條指向 GP、7 條指向這批 MP） | 轉址不動 |
| 其他文章裡指向下架文章的連結 | 指向全文 | 指向墓碑 | 不改文章內容 |
| 仍公開的 deprecated MP 的「已被取代」連結 | 指向 GP 全文 | 指向墓碑（8 篇，見清單 `knownEdges`） | 不改，列為已知邊界 |
| 伴隨 artifact 頁（`/artifacts/gp-194-*`、`/artifacts/gp-245-*`、`public/artifacts/gp-251-unknowns/`） | 公開 | 保留 | 前兩個是 gu-log 自製 demo；gp-251 是 Anthropic Apache-2.0 授權的範例與翻譯。都不是下架文章的譯文，墓碑也不連過去 |
| 只被下架文章 import 的圖檔（`src/assets/posts/gp-251-fable-unknowns/`、`gp-nvidia-hardware-codesign/`） | 建置輸出 | 不再輸出；HEAD 刪除 | D9 |

Postbuild 洩漏檢查擴充 `scripts/verify-canonical-public-output.mjs`：T 的路徑不得出現在 sitemap、RSS、搜尋索引、JSON feed；`dist/api/posts/` 與 `.md` 不得有 T；T 的 HTML 必須有墓碑 marker，且不得含 `.post-content`、`.md` alternate、版本歷史連結、Giscus 與 AI popup 的 marker。

### D7. 內容 gates、Tribunal 與自動化

- 下架不是改寫，不需要 Tribunal 分數。Score floor、代名詞、晶晶體、AI tells、glossary 連結覆蓋、topic dedup 等「reader-visible 內容變更」類 gate 跳過 T；集中在 `scripts/list-content-gate-posts.mjs` 與一個共用的「是否下架」判斷，避免每個 script 各寫一份。Emoji gate 仍檢查墓碑 frontmatter（`sourceTitle`、`author` 會出現在頁面上）。
- `scripts/validate-posts.mjs` 對 T 走專屬分支：allowlist、正文為空、配對一致、日期格式；跳過 kaomoji 必填、MoguNote、model signature、英文正文不得有 CJK 等內容規則。
- Tribunal：batch runner 目前只跳過 `deprecated`，要改成只挑 live 文章；quota loop、`tribunal-v2-run.ts`、gp-pipeline `ralph` 同步。Publisher 與寫手不得寫入下架文章；validator 的「正文必須為空」是最後防線。
- 以既有文章當語料的工具（dedup、`suggest-crosslinks`、`inject-related-posts`、Librarian 交叉連結證據）排除 T，避免建議讀者去讀墓碑，也讓之後的導讀改寫不會被 dedup 擋掉。
- 部署 smoke：「最新文章」選取排除 T；舊網址轉址檢查在終點是 T 時接受 410；`verify-post-markdown-deployment.mjs` 的 sentinel 從 GP-1（示範文，會下架）換成仍公開的文章；新增 `scripts/verify-takedown-deployment.mjs` 檢查代表性墓碑（繁中／英文、有無結尾斜線、HEAD、`Accept: text/markdown`、`.md` 回 410、API 回 404），以及一篇未下架文章仍回 200。
- 測試 fixture：28 個 Playwright spec（另有少數 vitest、Go 與 shell 測試）用 21 篇真實 GP 當測試頁，要換成仍公開的文章或既有 fixture 頁；會掃全部文章的測試要跳過墓碑。

### D8. 下架批次、規則與工具

- 清單：`takedown-list.json`，從 main（847d1f67）的 frontmatter 依規則產生，記錄授權、規則、網域清單、每張 ticket 的 slug／標題／`sourceUrl`／下架前狀態與分數、39 個 MP 邊界案例與理由、8 個已知邊界（仍公開的 deprecated MP 指向下架的 GP）。
- 規則：
  - `gp-all`：所有 `GP-N`，繁中與英文都下架，沒有例外（包含 `sourceUrl` 是 example.com 的 GP-1 示範文、deprecated 的 GP-35、沒有英文的 GP-275）。
  - `mp-paid-news-domain`：只看 `sourceUrl`。hostname 轉小寫、去掉開頭 `www.` 後，等於清單網域或是它的子網域。清單只收「以新聞為主業、一般文章預設在訂閱或計量付費牆後」的媒體：nytimes.com、wsj.com、bloomberg.com、ft.com、economist.com、theinformation.com、washingtonpost.com、reuters.com、theatlantic.com、newyorker.com、wired.com。本次命中 MP-114（nytimes.com）、MP-118（theatlantic.com）、MP-131 與 MP-284（bloomberg.com）。
  - 不確定就不下架：Business Insider（2025-11 起大部分文章撤掉付費牆）、The Verge（2024-12 起只有原創報導與專題走計量付費牆，本篇是一般新聞）、HBR（付費雜誌但不是新聞媒體）、SemiAnalysis／Lenny's／Pragmatic Engineer（付費電子報，前段常免費）、Nature Medicine（期刊論文）、TechCrunch 等免費新聞網站、只在 `source` 欄提到付費媒體的文章、SemiAnalysis 在 X 上的公開貼文。
- 工具：`scripts/take-down-posts.mjs`（可重用於之後的下架批次）
  - `--list <path> --verify`：用清單內的規則重算目前語料，和清單比對；有差異就失敗並列出。Controller 靠它對帳。
  - `--dry-run`／`--apply --date YYYY-MM-DD`：把清單內的檔案改成 D1 的墓碑 frontmatter、清空正文，列出因此不再被引用的 `src/assets/posts/**`；可重跑（已下架的檔案不再變動）。
  - `--resolve-source-metadata`：補 `sourceTitle` 與 `author`。一般網頁依序取 `og:title`、`twitter:title`、`<title>`，作者取 author meta 或 JSON-LD；X 走既有的 `scripts/fetch-x-article.sh`：X Article 用文章標題，一般貼文用主推文第一行（收斂空白、最多 80 字元加「…」），作者用顯示名稱。抓不到（付費牆擋 bot、貼文已刪）時 `sourceTitle` 退回 `source`、`author` 留空，並輸出 fallback 清單給 controller 看。所有值都要過 emoji 檢查（保留顏文字），而且不得用 gu-log 自己的標題冒充原文標題。
- `takenDownAt` 是實際執行下架那天（Asia/Taipei 日期）。

### D9. Repo HEAD 上的副本

- 下架文章正文：由 D8 的下架 commit 清掉。
- `sources/`：刪除第三方原文擷取（`anthropic/`、`openai/`、`x/`、`supergoal/`、`synthid-c2pa/`、`mattpocock-skills-teach/`、`leerob-agents.md`、`earendil-pi-autoresearch-databricks.md`、`clawd-rip-events.json`、`clawd-rip-timeline.md`）；保留 `sources/chatgpt/`（ShroomDog 自己的 ChatGPT 對話）。`brand-taxonomy` 掃描排除 `sources/**` 的設定不受影響。
- gp-pipeline 測試資料：`tools/gp-pipeline/internal/preservation/testdata/gp-273/`（Brent Fitzgerald 原文與兩版譯文）換成自寫的合成 fixture，保留原本 regression 測的四種 finding（第一人稱、固定詞、unsupported packaging、重複結語）；`tools/gp-pipeline/testdata/clean-fxtwitter.md` 換成自寫推文。
- 只被下架文章使用的 `src/assets/posts/**` 圖檔在下架 commit 一併刪除。
- `.agents/skills/shroomdog-url-fetch/SKILL.md`（與它的鏡像，若存在）改成：第三方原文的長期擷取放 repo 外，不 commit；ShroomDog 自己的 ChatGPT 對話仍可存在 `sources/chatgpt/`。
- 不在範圍：`docs/shroomdog-editorial-feedback.md`、tribunal fixtures、`src/data/glossary.json`、`scores/tribunal-progress.json` 等處的短句引用（掃描到每處只有一到數句，不構成副本）；git 歷史（issue #1111）。

### D10. GP 暫停收新文（待 owner 確認）

- 依 owner 的理由（整篇翻譯要作者同意），在後續 change 定義同意紀錄之前，GP 不應該再有公開文章。做法是 `editorial-charter` 新增要求，validator 拒絕任何非 `taken-down` 的 GP（含 `GP-PENDING`）。這條規則要排在下架 commit 之後才啟用。
- 影響：gp-pipeline 的 GP lane 會在 deploy 驗證時被擋下（fail closed）；在途的 GP draft PR #978 會過不了 CI，需要 controller 處理。相關 derived 文件（CONTRIBUTING 的 GP 流程、`tools/gp-pipeline/SKILL.md`）加一行指回 charter。
- 若 owner 不同意，拿掉這條要求與 validator 規則即可，其餘設計不受影響。

## Risks / Trade-offs

- **410 機制**：middleware 的同站 subrequest 在 preview 可能被 Vercel SSO protection 擋住，preview 上也無法用 curl 驗證狀態碼 → 以本機 build、vitest 與 production smoke 為準；preview 只驗墓碑畫面（必要時用本機 `astro preview` 截圖）。Subrequest 失敗時仍回 410，不會退回 200，但讀者看到的會是最小 HTML 而不是墓碑設計，所以 production smoke 同時檢查狀態碼與正文裡的墓碑 marker。若 production 證實平台會擋同站 subrequest，備案是改用 `rewrite(url, { status: 410 })` 並以 production smoke 確認狀態碼真的是 410；兩條路都失敗才回 chat 升級。
- **Frontmatter consumers 多**：約 84 個 script／test／workflow 讀文章 frontmatter，很多假設 `summary`、`translatedBy`、`tags` 一定存在 → 先落地 schema、`isTakenDown()` 與 gate 例外，再跑完整 vitest、shell 測試與 build，最後才做下架 commit。
- **大 commit**：下架 commit 改 549 個檔案，pre-commit 的逐檔 gate 會跑很久 → gate 先正確跳過 T；必要時分 GP／MP 兩個 commit，但同一個 PR。
- **E2E fixture 大量換頁**：28 個 Playwright spec 要改測試頁，改完要確認 `tests/spec-ownership.json` 分類不變。
- **Tribunal VM daemon**：worker worktree 不會自動跟上 main，同步前舊 runner 可能挑到墓碑去評分或改寫 → merge 前後暫停 daemon、同步 worker 再恢復；即使沒做到，validator 會擋下寫回正文的 PR。
- **舊 deployment 網址**：Vercel 每次部署都有獨立網址。若 Deployment Protection 沒涵蓋非正式網域，舊 deployment 仍能看到全文 → 建議 owner 在 Vercel 確認 Standard Protection（或刪除舊 deployment、設定保留期限）。這需要 owner 的 Vercel 權限，不在 repo 內。
- **其他 repo 外出口**：git 歷史與 GitHub commit 頁（#1111）、iOS app 已快取的 API JSON、搜尋引擎與 Wayback 快取、AI popup 後端（api.shroomdog.dev，若它有自己的快取）、GitHub Discussions 上既有的 Giscus 留言串 → 410、`noindex` 與 sitemap 移除只能加速搜尋引擎除名，其他只能列出。
- **SEO**：約 550 個網址回 410 並移出 sitemap，會從搜尋結果消失；這是預期結果。
- **MP 範圍比原本估計小**：owner 原先聽到「約 20 篇新聞或付費媒體」，保守規則只命中 4 篇，其餘 39 篇留給之後的 MP 防翻譯檢查。回報時要講清楚。
- **已知邊界**：8 篇仍公開的 deprecated MP 的「已被取代」連結會指到墓碑；GP-1 示範文的「去讀原文」會連到 example.com；GP 列表頁會是 0 篇（apply 時確認 Astro 對空列表仍產生第 1 頁，deploy smoke 要求 `/gu-log-picks` 回 200）。
- **英文碑文排版**與 **`ಥ` 字型 fallback**：以雙主題、390px 截圖驗證。

## Migration Plan

1. 機制（不改任何文章內容）：schema 與狀態 helper、validator、下架清單產生器與 freshness gate、墓碑元件與素材、文章路由、middleware 410、輸出排除與 sitemap filter、slug 不變式與洩漏檢查、gates 與 Tribunal 例外、部署 smoke、E2E fixture 換頁。每項各自 atomic commit，完整測試與 build 綠燈。
2. 下架工具與來源 metadata：完成 `take-down-posts.mjs`，補齊 `sourceTitle`／`author`，controller 用 `--verify` 對帳並看 fallback 清單。若 main 在這段期間新增 GP，先更新清單再對帳。
3. 下架 commit：套用清單（549 檔）、重生下架清單與 manifests、刪除孤兒圖檔。
4. （owner 確認後）啟用 GP 暫停收新文規則。
5. HEAD 副本清理與 skill 文字。
6. 文件同步（CONTRIBUTING 的 status 語意與下架流程、GP 相關 derived 文件、playbook 的 Tribunal 必跑規則加上下架例外）。
7. Preview 驗證墓碑畫面 → archive → 轉 ready → auto-merge → production smoke（410、404、200、sitemap／RSS／搜尋不含下架網址），在 chat 回報 production URL。
8. 營運：暫停並同步 Tribunal VM worker；提醒 owner 檢查 Vercel Deployment Protection。

回退：下架是法律面的決定，預設 forward-fix。真的需要回退時 revert 下架 commit 即可恢復內容（git 歷史仍在），但要先得到 owner 同意，因為那等於重新公開。

## Open Questions

需要 owner 決定（controller 在 chat 問）：

1. **GP 暫停收新文（D10）**：建議同意。這是 owner「整篇翻譯要作者同意」的直接推論；不同意就拿掉一條 charter 要求與一條 validator 規則。
2. **MP 墓碑文案（D3）**：建議用 MP 最小改字版（改寫文章之墓、去讀來源），因為 `brand-taxonomy` 禁止把 MP 標成翻譯。若 owner 要 GP、MP 同一版，controller 需要同步修改 `brand-taxonomy` 與 `post-takedown` delta。

其餘技術細節（410 做法、清單格式、欄位命名、英文頁尾與 h1 的推導文字）已在上面給出建議，由 controller 決定。
