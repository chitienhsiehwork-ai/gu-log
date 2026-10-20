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

### 2. 安全 transport 與 extraction 分工（實作時瘦身）

原草案規劃 loopback proxy、Python 共用 HTTP helper 與 yt-dlp module embedding。實作前的對抗式 review 判定那套與實際威脅面不成比例，改採依 adapter 分級的最小邊界；這段是取代草案的最終決策：

- **任意 host 只出現在 generic 路徑**：X 走固定 provider hosts（fxtwitter／vxtwitter／X guest API），YouTube 走既有 yt-dlp allowlist 且 fail closed，兩者的目的地不是攻擊者可控的任意 URL。因此 SSRF 邊界集中在 generic 路徑，以 Go 原生 `internal/source/safehttp.go` 實作，不另建常駐 proxy 或 TLS 攔截。
- **DNS 檢查綁定實際連線**：safe client 自行 resolve、過濾公開 IP、直接 dial 已驗證的 IP literal（TLS SNI／憑證驗證照原 hostname），杜絕 check-then-re-resolve 的 rebinding 空窗；拒絕 loopback、private、link-local、CGNAT、保留段與非正規 IPv4 literal，不採 ambient proxy。
- **每一跳 redirect 重新驗證**（scheme、userinfo、host、IP literal），hop 數有上限；回應 bytes 超限直接失敗、不截斷；整體 timeout 固定。resolver／dialer 可注入，測試不碰網路。
- **extraction 與下載解耦**：`fetch-article.py --extract-only` 從 stdin 收 safe client 抓回的 bytes，只做 readability 抽取，不再自行下載；Go generic 路徑的 `curl -L` 網路備援移除，備援只剩本地 `cleanupHTML`。
- **yt-dlp 不 embed**：YouTube 沿用既有 CLI 呼叫、單影片、完整逐字稿契約與 allowlist；本變更不動它的網路層，也不把 pinned yt-dlp module 接進 requirements。
- **X provider identity 檢查**：`fetch-x-article.sh` 驗證 provider 回傳的 status ID 等於 requested ID，來源自報的 URL 不足以放行。

### 3. Manifest 是 harness 的觀察，source 是不受信任資料

packet 使用新的 0700 private directory；資料檔與 manifest 為 regular files，不接受 symlink 或 workdir 外的 path。資料寫完才發布 manifest，manifest 記錄 schema、requested/canonical source identity、觀察到的 final URL／provider identity、fetch route、capture time、validation 結果、bytes、SHA-256 與相對資料路徑。

來源 header 可以作一致性檢查，但不能取代 adapter 的 observed identity。`internal/source.FetchResult` 新增型別化的來源觀察，standalone fetch 的 JSON report 直接傳遞同一結構，不從輸出 markdown 反推：

| Adapter | 可信程式觀察的來源身分 | 驗證條件 |
|---|---|---|
| 一般文章 | HTTP client 實際取得的 `finalUrl` | requested URL 與經驗證的 redirect chain 相符；不能以 HTML canonical 標籤取代 |
| X | API payload 的 focal status ID、author、Article／thread 身分及完整串文驗證結果 | status ID 必須等於 requested ID，continuation 符合既有 self-thread 規則；來源自行宣稱的 URL 不足以放行 |
| YouTube | 既有 metadata 的 video ID | 必須等於 requested video ID，字幕仍經既有完整性檢查；未觀察到 final URL 就不填 |

實作上這些觀察由 `gp-pipeline --json fetch` 的 JSON report 直接傳遞（`FetchResult.FinalURL` 與 fetch report 的 `sourceKind`／`finalUrl`／`fetchedVia`／`handle`／`bytes`），packet helper 從 report 的 `output` 建 manifest，不從輸出 markdown 反推，也不另建 sidecar 檔案協定。X 的 provider identity 檢查在 `fetch-x-article.sh` 內：provider payload 的 status ID 必須等於 requested ID；YouTube 的 video ID 由既有 Go metadata parser 驗證。不能以 requested 值的拷貝冒充 observed 值。

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

1. 可先平行實作不碰 runner 的 source transport／adapter；#1098 合併後本 branch 接上新 main，才開始 runner 接線，避免兩條狀態機修改競爭。
2. source transport／packet 與 runner 分工實作，完成無網路、無模型的 unit／shell regressions。
3. 完成 correctness/safety 與 Keep/Simplify/Drop reviews、完整 gates、OpenSpec sync/archive、PR CI 與 merge。
4. service 保持既有 operator stop；以 fixture 驗證 runtime 能建立與讀取 packet，不動 production article、不自動啟動 daemon。

Rollback 使用此 PR 的正常 revert。已存在的 source hash metadata 不構成 PASS；回復前維持 service 停止，避免重新落回無來源的 judge 路徑。

## Open Questions

無待人類拍板的產品方向。實作所需的 bounded limits 放在 executable constants 並以 tests 鎖定，不在此複製數值。
