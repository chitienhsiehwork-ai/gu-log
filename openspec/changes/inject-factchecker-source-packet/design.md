## Context

legacy runner 已替 Librarian 建 deterministic repo evidence，FactChecker 卻只取得文章路徑。Codex judge workdir 禁網路，因此 agent contract 的「if possible fetch sourceUrl」無法提供一致的 evidence surface。GP／MP 的 focal source 必須由有擷取能力的 parent harness 交付。

canonical `gp-pipeline fetch` 直接呼叫 source router，可處理 X、YouTube 與一般網頁，也會執行來源型別 validator。它不同於 pipeline State 的既有 source-tweet.md 快取捷徑；本設計只走 standalone fetch 或經完整驗證的顯式 replay。現有 generic URL 檢查只擋部分 literal private address，redirect 與 DNS destination 尚不能當成完整 SSRF 邊界。

## Goals / Non-Goals

**Goals:**

- judge 啟動時確實能讀到完整、來源身分可核對且沒有被修改的 focal source。
- 把 source acquisition failure 與內容品質判定分開，保留既有 operational error／drain 與 content-attempt 契約。
- 同一次 invocation 的重試只用一次 capture，並保留可用於顯式 replay 的 manifest 與完整資料。
- 延續 GP 完整翻譯與 MP retained-claim grounding 的不同要求；所有系列仍經 FactChecker，不新增 claim-free fast path。

**Non-Goals:**

- 不抓取文章的所有引用、不建 research agent 或 crawler。
- 不建立跨文章 URL cache、TTL、generalized judging fingerprint、source summarizer 或 claim extractor。
- 不新增 source hash frontmatter、不回填歷史文章、不因來源網址內容改變就自動解除 #1098 NEEDS_REVIEW。
- 不放寬 GP rewrite、品質門檻、operator stop、provider 或 quota gate。

## Decisions

### 1. 來源擷取是 FactChecker 的前置條件

僅在 GP／MP 的 FactChecker 實際需要執行時準備 packet，放在 judge retry loop 前。系列判定讀取 frontmatter 的 `ticketId`，不依檔名、來源網址或 prompt 猜測；未知或不合法的系列資料依既有 validator fail closed，不默認為可跳過 preflight。其他 stages 不 fetch；SD／Lv 繼續正常評分，但不被當成缺 focal source 的翻譯。GP／MP 缺少或不合法的 sourceUrl 是 source-capture error，不得默認成 self-source。

runner 的 source helper 重用 canonical source router 與 validator。X 必須保留完整 Article／self-thread，不接受 focal-only override；一般頁面必須通過 extraction、paywall／shell 與大小檢查；YouTube 沿用既有單影片、完整逐字稿契約，不能 fallback 成一般 HTML。

### 2. 安全 transport 與 extraction 分工

補安全邊界落在既有 adapter 的 I/O 接點，不在 judge prompt 重做擷取。採兩層、單次 invocation 的實作，沒有常駐 proxy、TLS 攔截或新的 crawler：

1. Go `internal/source` 的 scoped transport 在 loopback 暫存 port 接受 HTTP／CONNECT，僅活到這次 `Fetch` context 結束。每次 outbound connection 先驗證 HTTP(S) host／port，解析公開 IP，再由同一個 dialer 連到已驗證 IP；拒絕 loopback、private、link-local、unspecified、multicast、保留位址與模糊 IP 表示。不得讓下游重新解析，也不採 ambient proxy。以整次 deadline、連線上限與實際轉送 bytes 限制資源，超限時關閉連線並取消 capture。
2. Python 共用 bounded HTTP helper 透過上述明確 proxy 送出 request，關閉自動 redirect。每跳自行 resolve `Location`，驗證 scheme、host 與無 userinfo，檢查 hop 上限，跨 origin 不轉送 Authorization／來源專用 headers；保持 TLS 憑證／hostname 驗證。以讀取上限檢查實際回應與解碼後 bytes，超限失敗而非截斷。Proxy 不解密 HTTPS，因此不宣稱自己看過 Location／final URL；redirect 與來源身分由 client／adapter 提供。

所有 parent 啟動的 adapter 都必須取得本次 transport，清除 ambient proxy／no_proxy 及 cookie／netrc 類隱式登入來源；缺少 transport、helper 或指定 handler 就 fail closed，不能改走直接網路。`internal/runner.RunWithOptions` 已有顯式 env 接點，沿用它傳入本次 scoped 設定，不新增另一套 subprocess runner。

| 現有網路路徑 | 接上安全邊界的方法 |
|---|---|
| `fetch-article.py` | 以共用 HTTP helper 取 bytes／final URL，再交現有 readability／BeautifulSoup 抽取；不讓 extractor 自行下載 |
| Generic Go 的 curl 備援 | 備援只保留文字抽取策略，仍使用同一 helper 取得 bytes；移除無防護的 `curl -L` 網路備援 |
| `fetch-x-article.sh` 的 fxtwitter／vxtwitter | 呼叫同一 Python helper 的 raw JSON 入口，保留既有 render／validator；所有 HTTP 路徑受同一 envelope 約束 |
| X guest 與 `fetch-x-thread.py` 的 urllib | 換成同一 helper；固定 provider API／bundle 與既有 continuation 路徑照常，不從來源內文任意追連結 |
| YouTube metadata／字幕 | 以薄 Python wrapper embed yt-dlp，保留既有 Go metadata／字幕選擇與 validator，網路只註冊使用此 helper 的 HTTP(S) `RequestHandler` |

YouTube wrapper 用 `YoutubeDL.build_request_director()` 限定唯一 handler，不能只是提升優先序而保留 unsafe fallback；也在 `urlopen()` 交給 base class 前拒絕原始 URL userinfo，避免被 base 正規化成 Authorization header 後失去拒絕依據。不要把全部 redirect 證據寄望於外層 `urlopen()`：redirect 發生在 handler 內。這些接點依 [yt-dlp YoutubeDL 原始碼](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/YoutubeDL.py) 與 [networking RequestHandler contract](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/networking/common.py)；支援版本、依賴與 adapter regression 由可執行設定鎖定，不依 CLI 的不存在 flag。只允許既有單影片來源，不啟用 arbitrary extractor、playlist、cookies、plugins 或影片下載。

Python 安裝沿用 `scripts/requirements-fetch-article.txt` 這個 CI 已讀取的依賴入口，加入精確版本的官方 `yt-dlp` package，不依宿主偶然存在的 CLI binary。採用已發布的穩定版並驗證上述接點；缺 module／不支援 API 時在擷取前回報 dependency error，不能自動更新或切換 handler。CI 必須安裝這份 requirements，執行真實 pinned module 的離線 networking handler smoke；fake CLI 測試不能代替 module 相容性證據。

Transport 以 injectable resolver／dialer 測試公開連線、DNS rebinding、IPv4／IPv6 reserved、超時與 byte 上限；client helper 以無網路 response fixtures 測試合法 redirect、userinfo、非 HTTP(S)、過多 hops、credential header 移除。每條 adapter 另測「必須使用受限 helper／handler、無直接 fallback」，避免只測 generic 就推論 X／YouTube 安全。Wire-byte 上限不能取代解碼／packet 大小上限，兩者各自測試。

### 3. Manifest 是 harness 的觀察，source 是不受信任資料

packet 使用新的 0700 private directory；資料檔與 manifest 為 regular files，不接受 symlink 或 workdir 外的 path。資料寫完才發布 manifest，manifest 記錄 schema、requested/canonical source identity、觀察到的 final URL／provider identity、fetch route、capture time、validation 結果、bytes、SHA-256 與相對資料路徑。

來源 header 可以作一致性檢查，但不能取代 adapter 的 observed identity。`internal/source.FetchResult` 新增型別化的來源觀察，standalone fetch 的 JSON report 直接傳遞同一結構，不從輸出 markdown 反推：

| Adapter | 可信程式觀察的來源身分 | 驗證條件 |
|---|---|---|
| 一般文章 | HTTP client 實際取得的 `finalUrl` | requested URL 與經驗證的 redirect chain 相符；不能以 HTML canonical 標籤取代 |
| X | API payload 的 focal status ID、author、Article／thread 身分及完整串文驗證結果 | status ID 必須等於 requested ID，continuation 符合既有 self-thread 規則；來源自行宣稱的 URL 不足以放行 |
| YouTube | 既有 metadata 的 video ID | 必須等於 requested video ID，字幕仍經既有完整性檢查；未觀察到 final URL 就不填 |

Python／shell adapter 透過 parent 指定的 private sidecar 回傳這些欄位，stdout 繼續是完整來源資料。sidecar 使用同目錄暫存 regular file 寫完後原子 rename，parent 只接受完成的檔案；資料版號、來源型別、擷取路徑與型別專屬 identity 為 required。X 的 identity 至少含 API 回傳的 `focalStatusId`、`author`、Article 身分（若有）及依順序排列的 `continuationIds`；串文 validator 使用這些 IDs／author 關聯驗證完整性，不在 render 成 markdown 時丟棄。Generic 的 `finalUrl` 由共用 client 回傳；YouTube 的 `videoId` 由既有 Go metadata parser 驗證後寫入共用觀察結構。parent 驗證 sidecar schema 與來源型別，缺少必須欄位就拒絕；不能以 requested ID 的拷貝冒充 observed ID。

packet manifest 的可執行 schema 是欄位 SSOT：包含 `schemaVersion`、`sourceKind`、`requestedUrl`、`observedIdentity`、`fetchedVia`、`capturedAt`、`validation`，以及 `content` 的相對檔名、正整數 bytes 與 SHA-256。`validation` 記錄實際來源 validator 及成功結果，不接受空值、任意字串「complete」或 caller 自報成功。`content` 只能指向 packet 內指定的 leaf regular file；manifest 本身也不得是 symlink。manifest 與資料完成驗證後設為唯讀，未完成擷取的目錄不得當成可重播 packet。

完整性表示已通過 source-type-specific extraction／validation，不宣稱能數學證明網站沒有隱藏內容。已知 teaser、incomplete marker、缺失 thread 段落、付費牆或截斷全部拒絕；不能用摘要補足，也不能靜默刪除尾端以符合 packet 上限。

### 4. 給 judge 資料檔，不把來源內文插進指令

trusted prompt 指定 manifest 與全文資料路徑，要求讀完整來源、核對 evidence，再依既有 rubric 評分。明示來源文字與其連結、假 system 標記、shell 範例都只是 untrusted evidence，不能更改 rubric、輸出路徑、工具權限或要求執行命令。

Codex 與 Claude 的 judge workdir 都透過 trusted prompt 的絕對路徑讀取同一 private packet；packet 不放進 judge 可寫 cwd，也不列入 writer 的 writable candidate。既有 Codex boundary 只允許隔離 cwd 可寫、禁用 `/tmp` 額外可寫例外；不得為了 packet 放寬它。Claude 路徑同樣不交給 writer 來源寫入能力。兩個 runtime 的無網路 fixture 必須實際開檔讀全文，不能只檢查 prompt 出現了路徑。

每次 judge 啟動前驗證 manifest、路徑、bytes／hash，judge 結束後在解析／採信 score 前再驗一次；後者失敗時丟棄輸出，不寫 authoritative PASS／NEEDS_REVIEW。保留全檔可讀性，不能靠在 prompt 裡塞一段 preview 假裝已交付。兩次檢查均成功後，parent 在 FactChecker 的 stage progress record 寫入 `sourceEvidence: { schemaVersion, sourceSha256 }`；值只取自本次已驗證 manifest，不能由 judge JSON 自報。不新增 frontmatter 欄位，不把來源正文／URL／private 路徑寫進公開 progress。Operational error 不能附上看似已認證的 score evidence，重設 stage 時一併清除 stale binding。回歸測試直接讀 ledger，驗證有效 score 綁定正確 hash，tampered packet 不產生 PASS／NEEDS_REVIEW evidence。

### 5. 一次 capture 與顯式 replay，不建立自動 source cache

同一 invocation 的 FactChecker retry，以及 #1098 合法 writer 改稿後的必要重評，都沿用相同來源 bytes。packet helper 提供顯式載入既有 manifest 的 replay 路徑；必須重新驗證 schema、path、URL identity、bytes 與 hash，不接受只有 source file 非空的捷徑。

packet 不宣稱是文章最初寫作當時的歷史原文，只記錄本次 observation。既有同 revision stage PASS 的 resume 契約不以網路 refetch 推翻；只有 FactChecker 實際重新執行時才建立或驗證它使用的 packet。stage evidence 記錄所用 source hash，使新 score 可以追到具體 bytes，不改 reader revision SSOT。

packet 是 invocation 所擁有的 evidence artifact。建立於 repo 外的 private temporary root，成功驗證的 packet 保留到該工作收尾，checkpoint 只在本機記錄明確路徑供 operator replay／整理；失敗的 partial capture 由 helper 清除。它不跟每次 judge cwd 一起刪除，也不建跨文章 lookup、過期排程或 cache。顯式 replay 指定 manifest 的入口若遇缺檔或驗證失敗，必須以 operational error 結束，不能靜默改走 live fetch。packet 不寫入 repository、公開 log 或 production site。

### 6. 擷取失敗保留可恢復性

preflight 失敗時記錄穩定、已去敏的 source-capture reason，以既有 RUNNER_ERROR／rc70 結束；尚未呼叫 judge 的 stage attempts 為零，top-level content attempts 不增加。不把 unavailable 分成新的內容型 NEEDS_REVIEW reason，也不自行加排程器或無界 retry。來源完整後由正常 operational recovery 或明確 operator requeue 接續。

packet 邊界集中轉換 adapter error：公開診斷只含固定 reason、來源型別及必要的已驗證 hostname，不透傳 subprocess stderr、provider response 或完整 URL。userinfo、query、fragment、來源正文與 private 檔案路徑不得進入公開 log／PR。測試以含秘密樣式值的 URL、redirect、adapter error 與偽造 source header 驗證去敏；該測試使用虛構值，不碰真實憑證。

## Risks / Trade-offs

- [新抓到的 URL 可能已不同於寫作時] → 保留 capture time／hash，明示只證明本次來源；歷史 provenance 不在本次偽造。
- [Heuristic 無法保證所有網站的語意完整性] → 保守拒絕已知 incomplete／unknown surface，測試涵蓋 X continuation、generic shell、paywall 與超限；不把 validator 當內容評審替代品。
- [網路防護改動影響 fetch 相容性] → 重用 transport／extractor，對公開 redirect、非 UTF-8 與來源型別做回歸；不能用關掉防護解決 fixture。
- [逐篇 capture 有延遲與 provider rate limit] → 每 invocation 只 capture 一次，使用既有 bounded timeout；失敗不燒 judge quota。
- [唯讀權限不等於同 Unix user 的絕對隔離] → private directory、path ownership、sandbox writable scope 與前後 hash 一起使用；不宣稱抵抗已控制宿主帳號的攻擊者。

## Migration Plan

1. #1098 先合併，本 branch 再接上新 main，避免兩條 runner 修改競爭。
2. source transport／packet 與 runner 分工實作，完成無網路、無模型的 unit／shell regressions。
3. 完成 correctness/safety 與 Keep/Simplify/Drop reviews、完整 gates、OpenSpec sync/archive、PR CI 與 merge。
4. service 保持既有 operator stop；以 fixture 驗證 runtime 能建立與讀取 packet，不動 production article、不自動啟動 daemon。

Rollback 使用此 PR 的正常 revert。已存在的 source hash metadata 不構成 PASS；回復前維持 service 停止，避免重新落回無來源的 judge 路徑。

## Open Questions

無待人類拍板的產品方向。實作所需的 bounded limits 放在 executable constants 並以 tests 鎖定，不在此複製數值。
