## Context

文章目前有兩種公開表示：正式 HTML 與 `/api/posts/{slug}.json` schema v2。HTML 適合瀏覽器，但包含版面、CSS、hydration 與導覽；JSON API 則刻意保留原始 MDX 內文，內含匯入、JSX 與互動元件語法。兩者都不是方便 agent 閱讀的乾淨 Markdown，而且文章頁沒有 alternate 可發現性。

Production baseline 證實 Vercel 會把正式文章 URL 的 HTML 快取並直接回給 `Accept: text/markdown` 請求；`.md` 端點尚不存在。Vercel 官方建議以專用 Markdown 端點搭配依標頭路由，但一般 rewrite 受 filesystem precedence 影響，標頭比對在 `vercel dev` 也無法完整本機驗證。三位獨立價值／架構 reviewer 因此一致給出 `SHRINK`：先建立明確的靜態表示與完整忠實度關卡，再用獨立 change 處理正式 URL 協商與快取隔離。

這個 change 橫跨建置流程、文章元件、HTML 可發現性、Vercel 回應標頭與部署 smoke test。權威內容仍只有 `src/content/posts/`；Markdown 是部署產物，不進 Git，也不形成第二份內容 SSOT。

## Goals / Non-Goals

**Goals:**

- 每一篇可建置的繁中與英文文章都有固定可重現、可直接存取的 `.md` 表示。
- Markdown 保留文章核心 metadata、來源／作者、有效狀態、標題階層、連結、程式碼、圖片、註解與自訂元件的閱讀語意。
- 從 canonical HTML 可標準化發現對應 Markdown URL。
- 未知元件／原生 JSX 結構、無法安全投影的 MDX、缺漏 artifact 或跨格式 slug drift 會使 build 封閉失敗。
- 保持既有 HTML 行為與 `/api/posts/{slug}.json` schema v2 完全相容。

**Non-Goals:**

- 不在本 change 對正式 URL 實作 `Accept: text/markdown` 內容協商、q-value 解析器、Routing Middleware、`Vary: Accept` 或快取鍵隔離。
- 不改變正式 URL、尾端斜線或既有 308 redirect 契約。
- 不建立新的內容資料庫、持久化 generated Markdown，或讓 Markdown 成為可編輯 SSOT。
- 不加入 `application/markdown`、HTTP `Link` header、`llms.txt`、`sitemap.md`、MCP resource 或全文搜尋索引。
- 不修改既有 JSON API 的 raw MDX body、欄位或版本。

## Decisions

### 匯出器採原始 MDX 盤點 + 已渲染文章投影

匯出器在建置後執行，但不是對整頁 HTML 做盲目的通用 HTML-to-Markdown 轉換。它分成兩個互相制衡的輸入面：

1. 解析原始 MDX AST，列舉匯入、自訂元件、原生 JSX 元素、語意 class／attribute 與表達式形態，確認每種非標準結構都存在於明確的轉接器登錄表，且沒有不能靜態判定的內容表達式。
2. 讀取同一篇建置輸出中的 `.post-content`，只對文章語意 DOM 做投影；標準元素用固定規則轉換，自訂元件則依穩定標記與元件專用轉接器輸出閱讀語意。

這個混合設計同時避免兩種失敗：只從原始 MDX 轉換會重做 Astro 資產解析，且容易錯過元件實際呈現語意；只做通用 DOM 轉換則可能把折疊內容、互動控制、隱藏重複內容或版面外框一起輸出。原始內容盤點負責封閉失敗，已渲染內容投影負責忠於實際頁面；兩者對不上就中止建置。

### 自訂文章元件與原生 JSX 使用明確的語意轉接器登錄表

第一版登錄表 SHALL 覆蓋目前全文集內所有自訂文章元件，包括 MoguNote、ShroomDogNote、Toggle、LevelUpProgress、LevelUpQuiz、AnalogyBox、Mermaid、PostImage、DiffBlock 與 CodexLearningMap；也 SHALL 覆蓋既有 `a.artifact-callout` 與其固定巢狀 `span` 結構。每種投影定義：

- 可接受的 props／children 結構；
- 已渲染 DOM 的穩定標記；
- Markdown 的可閱讀表示；
- 不應輸出的互動控制、裝飾或隱藏內容；
- 測試資料與 snapshot assertions。

`artifact-callout` 固定投影成一個使用主要 `<strong>` 文字的絕對 Markdown link，接著各保留一次 label 與 meta；`tap`、`cta`、icon、`aria-hidden` 裝飾與重複連結文字不得輸出。新增／改名文章元件、未知原生 JSX 階層、未知語意 class／attribute 或未登錄表達式但沒有轉接器時，原始內容盤點 SHALL 使建置失敗。不能只以「把未知標籤的文字留下」繼續部署，因為那會把無聲的資料遺失變成 production 產物。

Remark plugin 在已渲染文字內加入的 Word Joiner（U+2060）與不換行空白（U+00A0）只服務 HTML 防斷行。匯出器 SHALL 移除 U+2060，並把這類 U+00A0 正規化成一般空白，保留人眼可見字串但不把僅供渲染的控制字元洩漏到 Markdown。

### 文章狀態由每篇都存在的 machine-readable marker 傳遞

繁中與英文 post route SHALL 直接以既有 `resolvePostStatus(post, allPosts)` 結果，在每個 `<article>` 輸出永遠存在的 machine-readable marker。Marker 至少包含 `published`／`deprecated`／`retired` effective status、nullable replacement ticket 與 nullable absolute replacement URL；不能用「banner 不存在」推測 published。

`PostStatusBanner` 仍是人類可見表示，並增加相同狀態的穩定驗證標記。匯出器另行讀取 article marker，不把 banner 算進 `.post-content` 正文；非 published marker 必須有同狀態 banner，published marker 必須沒有 status banner。Marker 缺少、enum 無效、replacement 契約錯誤或兩者不一致都 SHALL 使建置失敗。英文文章沿用目前由繁中來源繼承 effective status 的規則，避免在第二支 script 重做一套狀態解析器。

### Markdown artifact 使用固定、有版本的 metadata schema

每個 `.md` SHALL 以 YAML frontmatter 開頭，欄位順序與 SSOT mapping 固定如下：

```yaml
---
schemaVersion: 1
slug: <post.id>
ticketId: <post.data.ticketId>
lang: <post.data.lang>
title: <post.data.title>
summary: <post.data.summary>
originalDate: <post.data.originalDate>
translatedDate: <post.data.translatedDate>
source: <post.data.source>
sourceUrl: <post.data.sourceUrl>
author: <post.data.author or null>
authorshipNote: <getPostAuthorshipNote(...)>
canonicalUrl: <absolute getLocalizedPostUrl(post)>
status: <resolvePostStatus(...).status>
replacementTicketId: <resolved ticket or null>
replacementUrl: <absolute resolved URL or null>
---
```

字串 SHALL 由 YAML serializer 安全引用，不得手工串接；optional 欄位缺少時輸出明確 `null`。Frontmatter 後的閱讀順序固定為：單一 `# title`；只在非 published 時出現、並帶 replacement 的狀態 blockquote；單一來源歸屬 blockquote（含 source、sourceUrl，並依存在與否帶 author／authorshipNote）；最後才是 `.post-content` 正文。正文不得重複頁面 header 的 H1、日期或來源卡。

既有 JSON detail endpoint 沒有 status 欄位。匯出器 MAY 讀建置後 JSON 來對齊其實際 metadata 欄位與 raw body，但 effective status 只能讀上述 route marker；JSON 不得被改寫或擴欄來服務 Markdown。

### `.md` 是僅供部署的靜態產物

輸出路徑固定為 `dist/posts/{slug}.md` 與 `dist/en/posts/{slug}.md`，對應正式 HTML 的 `dist/.../{slug}/index.html`。產物由建置流程固定產生，不提交 Git；任何內容修改只改 MDX／元件／status SSOT。

匯出器在暫存位置完成單篇輸出與驗證後才改名到正式路徑。整批建置最後比對繁中／英文 HTML、JSON 與 Markdown 的 slug 集合；集合不相等、空輸出、status marker 缺漏／不一致、殘留匯入／JSX／script／U+2060／U+00A0、無效 URL 或轉接器錯誤都讓建置以非 0 結束，因此不會部署半套表示。

### Discovery 只出現在文章頁

`BaseLayout` 新增 optional `markdownUrl`，只有繁中與英文 post route 傳入。存在時 `<head>` 輸出：

```html
<link rel="alternate" type="text/markdown" href="…" />
```

`href` SHALL 是可由外部 client 直接解析的正式絕對 URL，並對應同語系 `.md` 端點。首頁、標籤頁與其他版面使用者不得得到無效 alternate link。

### Vercel 回應標頭採固定數量規則，路由額度計入全部路由項目

兩個語系的 `.md` 路徑使用 O(1) pattern 設定 `Content-Type: text/markdown; charset=utf-8`，不得依文章展開成上千條路由。現有路由額度關卡只計 redirects，這個 change SHALL 改為計算 Vercel config 中 headers、redirects 與 rewrites 的平台路由總量，避免加入回應標頭後仍得到假綠燈。

靜態產物的 filesystem routing 保持單純；本 change 不用 rewrite 偽裝正式 URL 協商。Preview／production smoke test SHALL 實際請求繁中與英文 `.md`，檢查 status、Content-Type、代表性忠實度、alternate link 與既有 JSON API；不能只靠 `vercel dev`，因為官方文件明示回應標頭 `has` 比對不在本機完整運作。

### 正式 URL 協商是獨立第二期 change

Explicit `.md` 與忠實度關卡穩定後，另提 change 實作能理解 q-value 的 `Accept` 內容協商。第二期必須同時解決：HTML 明確偏好、Markdown 明確偏好、wildcard／缺標頭、q=0、HEAD、`Vary: Accept`、CDN 快取隔離、既有 308、尾端斜線、API 排除，以及 HTML／Markdown 交錯請求不串快取。預期優先評估薄 Routing Middleware；只有 preview 證明低階路由 config 能在 filesystem precedence 前正確工作時才採用純 config 方案。

拆期不是放棄 #689 的核心需求，而是讓表示正確性與路由／快取正確性各有可回退、可歸因的 review surface。

## Risks / Trade-offs

- [已渲染標記與元件 DOM drift] → 正文標記、永遠存在的 status marker 與元件轉接器都是 route／component／匯出器共用的明確契約；測試資料、全文集盤點與 snapshot 同時守住來源標籤和已渲染結構。
- [通用 HTML 轉換遺失元件語意或輸出重複內容] → 只轉 `.post-content`，自訂元件一律走明確轉接器；未知標籤／表達式封閉失敗，不允許 best-effort 部署。
- [建置後匯出器增加建置時間與記憶體] → 單篇串流／有界處理，量測全文集建置；靜態產物只在建置時產生，不增加 runtime compute。
- [讀取建置後 JSON 可能被誤認為建立新 SSOT] → JSON 只作 metadata 投影與跨格式驗證，權威來源仍是 content collection；JSON schema 加 non-regression test 鎖住。
- [只交付 explicit `.md`，尚未達成同 URL 協商] → alternate 可發現性與直接端點已提供立即價值；第二期有明確快取／redirect 驗收矩陣，不讓危險路由偷渡進第一期。
- [Vercel Content-Type 或路由 pattern 與本機行為不同] → preview 與 production smoke test 是必要關卡，且路由額度計入所有路由項目。

## Migration Plan

1. 建立盤點／轉接器契約與代表性測試資料，先讓未知或未覆蓋元件顯式失敗。
2. 實作已渲染文章投影、metadata／status 忠實度與單篇產物原子寫入。
3. 接到建置流程，加入全文集 HTML／JSON／Markdown slug 完整性與 JSON non-regression 關卡。
4. 加入文章頁 alternate link、Vercel `.md` Content-Type 與路由額度總量驗證。
5. 在 draft PR 完成正確性、簡化審查與 preview smoke test；封存／同步後由 human checkpoint 決定是否 merge。
6. 若需 rollback，移除匯出器建置步驟、alternate link 與 Vercel 回應標頭規則；既有 MDX、HTML 與 JSON API 不需資料 migration。

## Open Questions

（無；正式 URL 協商的 middleware／路由選型刻意延至第二期，需以第一期 preview 產物做快取與 filesystem precedence 實驗。）

## References

- [Vercel：Making agent-friendly pages with content negotiation](https://vercel.com/blog/making-agent-friendly-pages-with-content-negotiation)
- [Vercel：Make your documentation readable by AI agents](https://vercel.com/kb/guide/make-your-documentation-readable-by-ai-agents)
- [Vercel project configuration：Rewrites 與 filesystem precedence](https://vercel.com/docs/project-configuration/vercel-json)
- [Vercel Limits：Routes](https://vercel.com/docs/limits)
