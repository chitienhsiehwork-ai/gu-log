# Design

## Context

- ShroomDog 2026-09-26 的決定：GP 是沒取得作者同意的整篇翻譯，全部下架成墓碑頁；取材自付費新聞媒體的 MP 也下架；`retired`／`deprecated` 只是貼標籤，真的下架要保留網址、清空內文、從列表與機器輸出拿掉；公開 repo 清掉 HEAD 上的副本，git 歷史先接受（issue #1111）。
- 2026-09-27 ShroomDog 在 chat 授權「下架清單不用給我看，直接 e2e 做完」。本 change 因此不設逐篇確認 gate：清單由工具依規則產生、controller 對帳，下架直接排進 apply。這筆授權同時滿足 owner 的通則「不要刪除任何已發布內容，除非我明確同意」。
- 第一版提案經兩位審查員審查，結論都是「需修正」。本版照 controller 2026-09-27 的決定改寫：不做 410、不動 middleware、不另開 slug 不變式例外、frontmatter 保留原欄位、清單改由工具產生、加 CI 棘輪、dedup 改成「來源已封鎖」、補齊漏掉的出口與 spec 衝突。
- 網站是 Astro 靜態輸出、部署在 Vercel。`middleware.ts` 負責 HTML／Markdown 內容協商；`vercel.mjs` 產生 1,079 條 redirects 加 3 條 headers，共 1,082 條平台路由。
- 既有 slug 集合不變式在 `scripts/build-post-markdown.mjs` 的 `assertInputSlugSets()`：MDX 檔名（小寫後）集合 = `dist/api/posts/*.json` 集合 = 繁中加英文 HTML 集合，`.md` 集合也要相等。本版不改這條。
- VM 上的 Tribunal 與 publisher 暫停不了，更新也延到導讀新格式上線後；它們目前只跳過 `deprecated`，可能把墓碑當成待評文章去評分或改寫。

## Goals / Non-Goals

**Goals：**

- 下架文章保留原網址，改成定稿墓碑頁；任何建置產物與 repo HEAD 都不再出現下架文章的譯文。
- 下架文章在三種輸出都保留 slug、只剩墓碑內容，既有不變式照樣成立。
- 下架是有 schema、有 gate 的正式狀態，之後的下架批次（例如 MP 防翻譯檢查的結果）可以重用同一套工具。
- VM 上沒更新的自動化就算動到墓碑，也進不了 main。

**Non-Goals：**

- 不做「改寫成導讀」；那是後續 change。GP 暫停收新文會由它解除。
- 不做 HTTP 410，不改 middleware，不新增逐篇 redirect。
- 不改寫 git 歷史（issue #1111），也不處理 repo 外的快取與舊 deployment（見〈交給 owner〉）。
- 不判定 MP 邊界案例；它們留給之後的 MP 防翻譯檢查。

## Decisions

### D1. 狀態與 frontmatter：保留原欄位，只改必要的幾個

- 新狀態 `status: taken-down`。不沿用 `retired`：`retired` 的語意是「事實過時但仍公開」，列表、API、`.md` 都照常輸出全文。不叫 `withdrawn`：`brand-taxonomy` 已用 withdrawn 描述重分類轉址，意思不同。
- 下架時保留原本所有 frontmatter 欄位（`translatedBy`、`scores`、`tags`、`sourceType`、`authorCanonical` 等 dedup 與 taxonomy 欄位都留著），只做這些改變：
  - `status` 改成 `taken-down`，加 `takenDownAt: YYYY-MM-DD`（執行當天的台北日期）。
  - 沒有 `sourceTitle` 才補上（卡片上的原文標題）；沒有 `author` 且查得到時才補上（卡片上的作者）。
  - `summary` 是譯文摘要，換成中性的一句：GP 繁中「這篇翻譯已下架。」、GP 英文「This translation has been taken down.」、MP 繁中「這篇改寫已下架。」、MP 英文「This rewrite has been taken down.」。其他自由文字欄位盤點過：下架文章只有 GP-35 的 `deprecatedReason`，其餘是標題、系列名稱與 pipeline 紀錄，不是譯文。
  - 狀態改變後不相容的欄位要拿掉：`deprecatedBy`、`deprecatedReason`（目前只有 GP-35）、`retiredReason`、`retiredAt`。
  - 正文清空，只剩 frontmatter。
- Schema 不做 union：`status` enum 加 `taken-down`，新增選填 `takenDownAt`、`sourceTitle`；跨欄位不變量加兩條：`taken-down` 必須有 `takenDownAt` 與非空 `sourceTitle`；有 `takenDownAt` 時 `status` 必須是 `taken-down`。
- Validator 對下架文章另外檢查：正文為空、摘要是對應的中性句、繁中與英文一起下架且 `takenDownAt`、`sourceUrl`、`sourceTitle` 相同、`sourceTitle` 不等於 gu-log 自己的標題；並跳過 kaomoji 必填、MoguNote、英文正文不得有 CJK 等只對正文有意義的規則。
- `PostStatus` 加 `taken-down`：`getPublishedPosts()` 只收 `published`，自然排除；`getListablePosts()` 目前只排除 `deprecated`，要加上 `taken-down`；`getIndexPosts()` 與導覽 baseline 跟著排除。繁中與英文檔各自寫 `status`，不靠繼承。

### D2. HTTP：墓碑回 200 加 `noindex`（簡化決策）

- 第一版想用 middleware 以 subrequest 取靜態墓碑再包成 410。審查意見指出：這段在 preview 會被 SSO 擋、subrequest 失敗時讀者只看到最小 HTML、要多一份下架清單與 freshness gate，而 410 的主要效果（從搜尋結果消失）用 `noindex` 加 sitemap 移除也做得到。
- 決定：墓碑頁回 200，`<head>` 帶 `<meta name="robots" content="noindex">`，sitemap 用 filter 排除。Middleware 與 `vercel.mjs` 的文章規則都不動，平台路由數不變。
- 舊品牌文章網址照舊 308 到下架文章的正式網址，追下去是 200 的墓碑，`brand-taxonomy` 的「追下去回 200」不受影響。

### D3. 三種輸出：不變式不動，內容換成墓碑

- HTML：墓碑頁。`<article>` 帶 `data-post-representation`、`data-post-status="taken-down"` 與空的 replacement marker，內含唯一的 `[data-post-tombstone]`，沒有 `.post-content` 與 status banner。`<head>` 照舊有 `.md` alternate。
- JSON（`/api/posts/{slug}.json`）：維持 v2 的欄位，`body` 是空字串、`headings` 是空陣列、`summary` 是中性句。因為正文已清空、摘要已中性化，路由本身不用改。
- `.md`：exporter 對下架文章不投影正文，改產生墓碑 Markdown：同一套 frontmatter（`status: taken-down`），單一 H1、狀態提示、來源標示，最後是墓碑文案與原文連結。依 `post-markdown-representation`「每篇都要有 artifact」的規定一律成功產生；內容協商照舊，`Accept: text/markdown` 拿到的就是墓碑 Markdown。
- Exporter 交叉驗證：frontmatter 是 `taken-down` ⇔ HTML marker 是 `taken-down` ⇔ 頁面有墓碑元素；原始 MDX 正文必須為空。
- 排除：首頁、系列頁、tags、tags 索引、Level-Up、閱讀紀錄、glossary 的文章連結、相關文章、系列與上下篇導覽、RSS、JSON feed、三份搜尋索引、sitemap。
- Postbuild 洩漏檢查擴充 `scripts/verify-canonical-public-output.mjs`：下架網址不得出現在 sitemap、RSS、搜尋索引、JSON feed；下架文章的 JSON `body` 必須為空；`.md` 必須是墓碑；HTML 必須有墓碑 marker 與 `noindex`、沒有 `.post-content`。另外 apply 時用一次性的檢查，拿下架前的正文片段比對整個 `dist/`，確認沒有殘留。

### D4. 墓碑頁版面

- 繁中與英文文章路由遇到下架文章時，在 `BaseLayout` 內只渲染墓碑元件（沿用站上的 header、主題切換、footer）。`BaseLayout` 新增 `robots` 參數，墓碑傳 `noindex`；`<title>` 為「<標題>（已下架） - gu-log」／「<title> (taken down) - gu-log」；meta description 用站台預設值。
- 不渲染：目錄、tags、已讀／分享／登入、相關文章、系列與上下篇導覽、`ArticleTechnicalDetails`（版本號與 GitHub 修改歷史連結）、Giscus、AI popup、狀態 banner、原本的來源列。
- 版面照 `design-ref/tombstone-c-v9.html`：石碑圖寬約 225px 靠右下、Mogu 約 150px 疊在左下，碑文用 HTML 疊在石面上。素材從 `design-ref/` 複製到 `src/assets/tombstone/`（450×507、280×320 的 2x 已裁切 webp），都是裝飾圖，`alt=""`。
- 顏色用站上既有 token；碑文例外：石頭素材在兩個主題都是米色，新增兩個主題同值的 `--color-tombstone-ink`、`--color-tombstone-rule`。「已下架」標籤用暖橘（`--color-mogu-orange` 系列）。
- 顏文字走 `src/plugins/remark-kaomoji-nowrap.mjs` 的 `protectKaomoji()`。實測 `(－人－)` 目前偵測不到而且可斷行，要擴充偵測字元並把三個顏文字加進 `scripts/check-kaomoji-unbreakable.mjs` 的 corpus。
- 用 uiux-auditor 驗證深淺兩主題、390px 與桌面寬度，截圖存 scratchpad。

### D5. 文案

所有文案集中在一個模組（元件、exporter、下架工具、validator 共用），不在各處抄一份。對話框每行句尾不加句號；卡片網域取 `sourceUrl` 的 hostname 去掉開頭 `www.`；沒有 `author` 時卡片第二行只顯示網域。

**GP 繁中（owner 定稿，不改字）**

| 位置 | 文字 |
|---|---|
| 標籤 | `<ticketId>`、「已下架」 |
| 石碑 | 「gu-log 的」／「翻譯文章之墓」／「<發表日期> – <下架日期>」／「安息吧 (－人－)」 |
| 對話框 | 「Mogu 內心小劇場：」＋ 嗚嗚，我辛辛苦苦翻了一整篇 ಥ_ಥ／結果才知道，整篇翻譯要先經過作者同意／可是我太 i 了，不敢問 ((( ；ﾟДﾟ)))／只好幫中文版立個小墓碑／還好原文沒事，點下面去看原汁原味的吧！ |
| 卡片 | 「去讀原文 →」／`sourceTitle`／「`author` · 網域」 |
| 頁尾 | 「回首頁 →」 |
| 視覺隱藏 h1 | 「<標題>（gu-log 翻譯文章，已下架）」 |

**GP 英文 sidecar（controller 定案）**

| 位置 | 文字 |
|---|---|
| 標籤 | `<ticketId>`、「Taken down」 |
| 石碑 | 「Here lies」／「a gu-log translation」／「<published date> – <takedown date>」／「Rest in peace (－人－)」 |
| 對話框 | 「Mogu's inner monologue:」＋ Waaah, I translated this whole thing ಥ_ಥ／Then I learned: translating a whole article needs the author's OK／But I'm way too introverted to ask ((( ；ﾟДﾟ)))／So I gave the translation a little tombstone／Good news: the original is alive and well. Go read it below! |
| 卡片 | 「Read the original →」／`sourceTitle`／「`author` · domain」 |
| 頁尾 | 「Back to home →」（由站上既有的「Back to home」推導） |
| 視覺隱藏 h1 | 「<title> (gu-log translation, taken down)」 |

**MP（controller 定案）**

| 位置 | 繁中 | 英文 |
|---|---|---|
| 石碑 | 「gu-log 的」／「改寫文章之墓」／「<日期> – <日期>」／「安息吧 (－人－)」 | 「Here lies」／「a gu-log rewrite」／「<date> – <date>」／「Rest in peace (－人－)」 |
| 對話框 | 嗚嗚，這篇我寫得太貼近原文了 ಥ_ಥ／結果才知道，這樣也要先經過作者同意／可是我太 i 了，不敢問 ((( ；ﾟДﾟ)))／只好幫它立個小墓碑／還好原文沒事，點下面去看原汁原味的吧！ | Waaah, I wrote this one way too close to the source ಥ_ಥ／Then I learned that needs the author's OK too／But I'm way too introverted to ask ((( ；ﾟДﾟ)))／So I gave it a little tombstone／Good news: the original is alive and well. Go read it below! |
| 卡片標籤 | 去讀來源 → | Read the source → |
| 視覺隱藏 h1 | 「<標題>（gu-log 改寫文章，已下架）」 | 「<title> (gu-log rewrite, taken down)」 |

標籤、對話框標題與頁尾同語言的 GP 版。MP 卡片標籤用「來源」，符合 `brand-taxonomy` 不把 MP 標成翻譯的規定；對話框裡的「原文」是 Mogu 的自白，不是標籤。

**墓碑 Markdown**：石碑文字一行（含日期）、對話框標題與五行、卡片標籤連到 `sourceUrl`，後面接 `sourceTitle` 與「作者 · 網域」。只用上面的文案與 frontmatter，不含任何原本的正文。

### D6. GP 暫停與列表空狀態

- 新增一個 GP 暫停旗標（單一模組），由 GP 系列頁、首頁與 CI 棘輪共用。旗標為真時：
  - `/gu-log-picks` 與 `/en/gu-log-picks` 只產生第 1 頁，顯示「GP 正在改版：以後這裡會是 ShroomDog 精選的導讀」（英文：「Gu-log Picks is being rebuilt: this page will become ShroomDog's curated reading guides.」），不列任何文章、不出現墓碑連結。
  - 首頁與英文首頁不顯示 GP 區塊。
  - CI 棘輪擋下新增的 GP 文章。
- GP-1 是自寫示範文（來源 example.com，不是第三方文章的翻譯），不下架；它照舊可用網址讀到，也照舊在 RSS 與搜尋裡，但暫停期間不列在 GP 系列頁與首頁。部署 smoke 的 Markdown sentinel 照舊用它。
- 導讀新格式的 change 會把旗標關掉，並重新定義 GP 的收文條件。

### D7. 舊品牌轉址與部署 smoke

- GP 暫停後 GP 系列頁只剩第 1 頁，原本舊品牌 GP 列表的 `…/:page` 轉到 `/gu-log-picks/:page`，追下去會 404。決定：舊品牌 GP 列表的數字分頁改成轉到 GP 系列頁本身（`/gu-log-picks`、`/en/gu-log-picks`）。那些舊分頁原本列的就是已下架的翻譯，保留頁碼沒有意義。舊品牌 MP 列表維持保留頁碼。規則數不變，平台路由數仍是 1,082。
- 同步改：`vercel.mjs`、`tests/vercel-routing-config.test.ts`、`scripts/verify-brand-redirects.mjs`（目的地沒有 `:page` 時照字面比對）、`.github/workflows/deploy-smoke-test.yml`（GP 分頁的預期目的地、GP 列表改驗空狀態而不是文章數、最新文章 smoke 跳過下架文章），以及 `brand-taxonomy` delta。

### D8. CI 棘輪與 GP 暫停收新文

新增 `scripts/check-takedown-ratchet.mjs`，pre-commit 以「HEAD 對 staged」、CI 以「PR base 對 head」執行：

1. base 是 `taken-down` 的文章：head 必須還在、仍是 `taken-down`、正文為空。擋的是 VM 上舊版 Tribunal 或 publisher 把全文寫回去。
2. 新增的 GP 文章（含 `GP-PENDING`）一律失敗，診斷指向 `editorial-charter` 的 GP 暫停（D6 旗標為真時）。
3. 新增文章的 `sourceUrl`（正規化後的網址或推文 ID）與任何下架文章相同時失敗：「來源已封鎖」。
4. `sources/` 底下新增 `sources/chatgpt/` 以外的檔案時失敗。

摘要被改掉的情況由 validator（D1）擋。

### D9. Tribunal、內容 gates 與 dedup

- Tribunal 依 status 排除下架文章：batch runner、quota loop、`scripts/tribunal-v2-run.ts`、gp-pipeline `ralph` 的候選選取只挑未下架文章。`tribunal-verification-scope` 補 delta 明寫這是範圍排除，不是驗證例外，Fact Checker 對所有納入範圍的文章照舊無條件執行。該 spec 要求改它的人說明 2026-07-16 決策記錄的兩個顧慮為何不適用：
  - 「無害換有害」：當時擔心 judge 把混合型文章判成「沒有可查證主張」而漏查裡面的事實。下架排除不經過任何 judge 判斷，只看下架工具依 owner 授權規則寫入的 `status`；下架文章沒有正文、也不再公開內容，沒有任何主張會被放出去。
  - 「鼓勵去主張」：當時擔心改寫迴圈為了過 gate 把具體主張改寫成含糊意見。改寫迴圈無法讓文章進入 `taken-down`（那是另一個工具、另一份授權），進入後文章內容整個消失，CI 棘輪也不准再改回來，所以沒有「靠下架過 gate 又繼續發布」的路。
- 內容 gates（score floor、代名詞、晶晶體、AI tells、glossary 覆蓋、topic dedup、翻譯配對）跳過下架文章；frontmatter 驗證與 emoji 檢查照舊。
- Dedup：下架文章是「來源已封鎖」，不是「不存在」。
  - `validate-posts.mjs --check-duplicates` 的既有文章互比，比照 `deprecated` 跳過下架文章，修掉 GP-35（原本 deprecated 指向 GP-105）下架後被判成重複的問題，並加測試。
  - `scripts/dedup-gate.mjs` 的第一層（網址、推文 ID）照舊比對下架文章，命中時回 BLOCK 並說明來源已封鎖；第二層（主題相似度）不比下架文章，因為內容已經不在。
  - CI 棘輪的第 3 條在手動 PR 上做同樣的來源封鎖。
- `dedup-taxonomy`：下架保留 `sourceType` 等欄位，也沒有改 cluster 規則，確認沒有衝突。`dedup-policy` 有一個情境寫死「GP-165 的 status SHALL 維持 published」，GP-165 會下架，所以補 delta：primary 的狀態不能因 dedup 規則改變，但授權下架是外部理由。

### D10. 下架工具與清單

- `takedown-list.json` 只留授權、規則與邊界案例，不存逐篇快照。規則：
  - `gp-all`：所有 GP，排除 GP-1（自寫示範文）。
  - `mp-paid-news-domain`：只看 `sourceUrl`，hostname 轉小寫、去掉開頭 `www.` 後等於清單網域或其子網域。清單只收以新聞為主業、一般文章預設在訂閱或計量付費牆後的媒體：nytimes.com、wsj.com、bloomberg.com、ft.com、economist.com、theinformation.com、washingtonpost.com、reuters.com、theatlantic.com、newyorker.com、wired.com。
  - 邊界案例 39 篇（Business Insider、The Verge、HBR、付費電子報、期刊、免費新聞網站、只在 `source` 欄提到付費媒體、SemiAnalysis 在 X 上的貼文），本次不下架。
- `scripts/take-down-posts.mjs`：
  - `--list <path> --plan`：依規則從當下語料算出下架清單（ticketId、語言、`post.id`、`sourceUrl`）與統計，輸出 JSON。Controller 靠它對帳。
  - `--resolve-source-metadata --cache <path>`：替缺 `sourceTitle`／`author` 的文章查來源 metadata（一般網頁取 `og:title`、`twitter:title`、`<title>` 與 author meta；X 走 fxtwitter，X Article 用文章標題，一般貼文用主推文開頭一句、最多 80 字元）。抓不到就退回 `source`；所有值過 emoji 檢查，而且不得等於 gu-log 標題。結果寫進 cache 檔，不 commit。
  - `--apply --date YYYY-MM-DD --cache <path>`：依 D1 改 frontmatter、清空正文、列出不再被引用的 `src/assets/posts/**`。已下架的檔案不再變動（可重跑）。
- Slug 一律用 `post.id`，也就是正式網址的小寫形式；GP-63 的檔名含大寫（`gp-63-20260214-GP63-…`），要有測試確認工具與清單都用小寫 id。
- 依 main（847d1f67）實算：GP 繁中 270、英文 269（GP-275 沒有英文、GP-1 排除），MP 4 篇 8 檔（MP-114 nytimes.com、MP-118 theatlantic.com、MP-131 與 MP-284 bloomberg.com），共 547 檔。
- 工具與實際下架分成不同 commit。

### D11. Repo HEAD 上的副本

- 下架文章正文：由下架 commit 清掉。
- `sources/`：刪除第三方原文擷取（`anthropic/`、`openai/`、`x/`、`supergoal/`、`synthid-c2pa/`、`mattpocock-skills-teach/`、`leerob-agents.md`、`earendil-pi-autoresearch-databricks.md`、`clawd-rip-events.json`、`clawd-rip-timeline.md`），保留 `sources/chatgpt/`（ShroomDog 自己的 ChatGPT 對話）。CI 棘輪之後擋新增。
- 測試資料：保真 regression 原本的 GP-273 fixture 目錄換成自寫合成稿 `tools/gp-pipeline/internal/preservation/testdata/synthetic-first-person/`，保留原 regression 測的四種 finding；`tools/gp-pipeline/testdata/clean-fxtwitter.md` 換成自寫推文。
- `tribunal/fixtures/`：GP 文章的 `contentSnapshot`（GP-102 約 950 字、GP-143／144／151、GP-165 與它的英文版）換成保留 dedup 判斷關係的合成摘要，`humanReasoning` 與分類不變；MP 的快照不動。依 `dedup-eval-harness` delta 用 `fix(fixture):` commit。
- `public/prompts/ui-ux-auditor-prompt.md`：第三方 prompt 全文（@kloss_xyz），正式站讀得到，而且只有下架的 GP-27／GP-28 連過去，刪除。`scripts/ui-ux-auditor-prompt.md` 是同一份檔案，repo 內沒有任何工具、skill 或文章引用它，也刪除。
- 只被下架文章使用的 `src/assets/posts/**` 圖檔在下架 commit 一併刪除。
- `.agents/skills/shroomdog-url-fetch/SKILL.md`：第三方原文的長期擷取放 repo 外、不 commit；ShroomDog 自己的 ChatGPT 對話仍可放 `sources/chatgpt/`。
- 測試頁：28 個 Playwright spec、`lighthouserc.cjs`、`scripts/visual-test.mjs` 改用仍公開的文章（有同樣元件、TOC、系列、影片、程式碼等特性）。
- 不在範圍：伴隨 artifact 頁（`/artifacts/gp-194-*`、`/artifacts/gp-245-*` 是 gu-log 自製 demo；`public/artifacts/gp-251-unknowns/` 是 Anthropic Apache-2.0 授權的範例與翻譯），以及 docs、glossary、tribunal 進度檔裡一到數句的短引用。

### D12. 出口盤點

| 出口 | 下架前 | 下架後 |
|---|---|---|
| 文章頁 HTML | 全文 | 墓碑頁（200、`noindex`） |
| `/api/posts/{slug}.json` | 含整份 MDX 原文 | 墓碑 metadata、`body` 空字串 |
| `.md` 與內容協商 | 全文 Markdown | 墓碑 Markdown |
| RSS、JSON feed、三份搜尋索引 | 只收 `published` | 自動排除 |
| sitemap | 所有頁面 | filter 排除 |
| 首頁、系列頁、tags、Level-Up、閱讀紀錄 | listable／published | 排除；GP 系列頁與首頁 GP 區塊在暫停期間為空狀態 |
| glossary 的文章連結 | 直接列出 | 渲染時排除 |
| 相關文章、系列、上下篇 | published baseline | 自動排除 |
| OG／meta description | 站台預設 | 站台預設（摘要也已中性化） |
| 版本號與 GitHub 修改歷史連結 | 顯示 | 墓碑不顯示 |
| 舊品牌文章網址 | 308 → 全文 | 308 → 墓碑（200） |
| 舊品牌 GP 列表分頁 | 308 → GP 第 N 頁 | 308 → GP 系列頁 |
| 仍公開的 deprecated MP 指向下架 GP 的「已被取代」連結（MP-66、90、160、238、239、250、261、298） | 指向全文 | 指向墓碑，不改 |
| `public/prompts/ui-ux-auditor-prompt.md` | 第三方全文 | 刪除 |
| 下架文章專用圖檔 | 建置輸出 | 刪除 |

### 交給 owner（CCC 做不到）

- 遠端舊分支（例如 `backup/main-pre-squash`）的 HEAD 上還有全文。CCC 刪 remote branch 會被 git proxy 擋（403），併入 issue #1111 一起處理。
- 舊 Vercel deployment 網址：每次部署都有獨立網址，若 Deployment Protection 沒涵蓋非正式網域，舊 deployment 仍看得到全文。請在 Vercel 確認 Standard Protection，或刪除舊 deployment、設定保留期限。
- VM 更新：已決定延到導讀新格式上線後。在那之前靠 D8 的 CI 棘輪擋住寫回。

## Risks / Trade-offs

- **200 不是 410**：搜尋引擎靠 `noindex` 與 sitemap 移除來除名，速度可能比 410 慢；這是用簡單換可靠。
- **Frontmatter consumers 多**：約 84 個 script／test／workflow 讀文章 frontmatter。保留原欄位降低了破壞面，但正文為空仍可能讓部分工具出錯 → 先落地 schema、gate 例外與測試，再做下架 commit。
- **大 commit**：下架 commit 改 547 個檔案，pre-commit 會跑很久 → gate 先正確跳過下架文章。
- **E2E 換頁**：28 個 spec 要找有同樣特性的替代文章，改完確認 `tests/spec-ownership.json` 不變。
- **VM 舊 runner**：可能對墓碑評分、改寫或寫回摘要 → CI 棘輪與 validator 擋在 PR；VM 會一直開失敗的 PR，直到導讀新格式上線後更新。
- **MP 範圍比原本估計小**：owner 原先聽到「約 20 篇新聞或付費媒體」，保守規則只命中 4 篇。
- **已知邊界**：8 篇仍公開的 deprecated MP 的「已被取代」連結指向墓碑；GP-1 示範文暫停期間不在 GP 系列頁。
- **英文碑文排版**與 **`ಥ` 字型 fallback**：以雙主題、390px 截圖驗證。

## Migration Plan

1. 機制（不改文章內容）：schema 與狀態 helper、文案模組、GP 暫停旗標、墓碑元件與素材、文章路由、exporter、列表與 sitemap、GP 空狀態、舊品牌分頁轉址、validator、CI 棘輪、gates 與 Tribunal、dedup、部署 smoke、E2E 換頁。每項各自 atomic commit，測試與 build 綠燈。
2. 下架工具（獨立 commit），查來源 metadata，controller 用 `--plan` 對帳。
3. 下架 commit：套用規則（547 檔）、刪除孤兒圖檔；重跑 build 與洩漏檢查。
4. HEAD 副本清理（sources、testdata、fixtures、prompt 檔、skill 文字）。
5. 文件同步（CONTRIBUTING 的 status 語意與下架流程、GP 相關 derived 文件、playbook 的 Tribunal 規則）。
6. uiux-auditor → preview → archive 前移除 allowlist 暫時例外 → archive → ready → merge → production smoke。

回退：下架是法律面的決定，預設 forward-fix；revert 下架 commit 等於重新公開，要先得到 owner 同意。

## Open Questions

無。Controller 已依審查意見拍板所有方向；GP 系列頁空狀態的英文句是由繁中定稿翻出，controller 可再調整。
