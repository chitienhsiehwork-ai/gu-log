## Why

目前文章 canonical URL 只提供完整 HTML；實測同一個 production URL 即使帶 `Accept: text/markdown`，仍由 Vercel CDN 回傳約 94 KB 的同一份 HTML，也沒有 `Vary: Accept`，而對應 `.md` URL 是 404。既有 `/api/posts/{slug}.json` 雖可取得內容，卻是給程式使用的 raw MDX schema：不易從文章頁發現，也包含 import、JSX 與互動元件語法，不是 agent 或讀者可直接消費的乾淨 Markdown。

需要先建立一個由既有文章 SSOT 衍生、能在 build time 完整驗證的 Markdown 表示層。這能用低風險的 static artifact 解決「可取得、可發現、語意乾淨」三個核心問題，同時保留 HTML 與 JSON API 的既有契約。Canonical URL 的 `Accept` content negotiation 牽涉 Vercel filesystem precedence、CDN cache key 與 legacy redirect，將另提 change，在 explicit `.md` 端點穩定後再處理。

## What Changes

- 為所有繁中與英文 canonical post 產生 build-derived 靜態 `.md` 表示，路徑分別為 `/posts/{slug}.md` 與 `/en/posts/{slug}.md`。
- 文章 HTML `<head>` 加入指向對應 `.md` 的 `rel="alternate"`，讓 agent 與工具可從 canonical 頁面發現 Markdown 表示。
- 以「原始 MDX 結構盤點 + 已渲染文章語意投影」的混合匯出器處理文章：原始 MDX 用來列舉並封閉檢查自訂元件、原生 JSX 元素、語意 class／attribute 與 expression form；已渲染 `.post-content` 用明確轉接器轉成乾淨 Markdown，保留 Astro 已解析的資產 URL 與實際呈現語意。
- 明確投影 Mogu／ShroomDog 註解、程式碼、圖片、Mermaid、diff、quiz／toggle 等既有文章元件，以及目前 corpus 使用的 `artifact-callout` 原生 JSX 結構；輸出不得殘留 MDX import、JSX、script、導覽、互動控制、重複的隱藏內容或僅供 HTML 防斷行的 Unicode 字元。遇到未知元件、未知原生 JSX 結構／語意屬性或無法完整轉換的表達式時，整個 build 封閉失敗。
- 每篇已渲染文章輸出永遠存在的 machine-readable effective-status marker，由 post route 直接使用 `resolvePostStatus()` 產生；匯出器分別讀取正文與 status marker，缺漏、無效或與人類可見 banner 不一致時使 build 失敗。
- Markdown 使用有版本的固定 YAML frontmatter 與固定正文順序，逐欄對應既有 schema／helper：slug、語系、title、summary、兩種日期、source／sourceUrl、optional author、authorshipNote、absolute canonical URL、effective status 與 optional replacement；不得將抽象或推測欄位當成 metadata。
- 以全 corpus completeness gate 比對繁中／英文 HTML、既有 JSON API 與新 Markdown artifacts；任一缺檔、slug 不一致或轉換失敗都阻止 deploy。
- 保持 `/api/posts/{slug}.json` schema v2 的實際欄位、raw MDX body 與 HTTP contract 完全不變，並加入 non-regression tests；不得宣稱目前 JSON API 擁有不存在的 status 欄位。
- 為 explicit `.md` 回應設定正確 Content-Type，更新 Vercel route-budget gate 讓 headers／redirects／rewrites 都納入總量，並在 preview／production smoke test 驗證 `.md` 端點。
- 本 change 不實作 canonical URL 的 `Accept` negotiation；後續 change 才加入 q-value-aware routing、`Vary: Accept`、cache isolation、legacy 308 與 HTML／Markdown 交錯請求驗證。

## Capabilities

### New Capabilities

- `post-markdown-representation`: 定義所有文章的 build-derived Markdown artifact、discovery、語意 fidelity、fail-closed completeness 與既有 JSON API 相容性。

### Modified Capabilities

（無。）

## Impact

- Build pipeline：新增文章 Markdown exporter，並接到既有 Astro build 後處理與全 corpus validation。
- `src/layouts/BaseLayout.astro` 與繁中／英文 post routes：只在文章頁輸出對應的 Markdown alternate link。
- Post component markup／adapter registry：為既有自訂文章元件提供穩定、可測的語意投影契約。
- `vercel.mjs` 與 route-budget validation：為兩個語系的 `.md` 靜態資源設定 header，並以總路由規則數封閉驗證平台上限。
- Tests／deploy smoke：新增 fixture fidelity、全 corpus completeness、JSON API non-regression 與 preview／production `.md` 驗證。
- Part of #689；canonical same-URL content negotiation 不在本 change。
