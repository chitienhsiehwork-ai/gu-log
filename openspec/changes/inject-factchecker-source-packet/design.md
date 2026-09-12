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

僅在 GP／MP 的 FactChecker 實際需要執行時準備 packet，放在 judge retry loop 前。其他 stages 不 fetch；SD／Lv 繼續正常評分，但不被當成缺 focal source 的翻譯。GP／MP 缺少或不合法的 sourceUrl 是 source-capture error，不得默認成 self-source。

runner 的 source helper 重用 canonical source router 與 validator。X 必須保留完整 Article／self-thread，不接受 focal-only override；一般頁面必須通過 extraction、paywall／shell 與大小檢查；YouTube 沿用既有單影片、完整逐字稿契約，不能 fallback 成一般 HTML。

### 2. 安全 transport 與 extraction 分工

補安全邊界應落在既有 source adapter 的網路層，不在 judge prompt 或另一套臨時 curl wrapper 重做抓文邏輯。所有來源輸入只接受不含 userinfo 的公開 HTTP(S) 位置；拒絕 credential-bearing URL，不把 query 參數當作可任意輸出的診斷資料。

自動擷取會在連線與每次 redirect 前核對目的地，拒絕 loopback、private、link-local、unspecified／保留位址與不支援協定。DNS 檢查須綁定實際連線位址，不能先查一次再讓另一個 client 重新解析；也不能在安全路徑失敗後 fallback 到無檢查的 curl／urllib。限制 redirect 次數、總時間與讀取 bytes。沿用成熟 HTTP client 的 TLS／hostname 驗證，不自行略過憑證檢查。

一般頁面的文字 extraction 可以重用現有 extractor，僅把已安全取得的 bytes 交給它。固定 provider 的 X／YouTube adapter 應保持既有識別與來源型別邊界，不沿來源內文任意追連結。

### 3. Manifest 是 harness 的觀察，source 是不受信任資料

packet 使用新的 0700 private directory；資料檔與 manifest 為 regular files，不接受 symlink 或 workdir 外的 path。資料寫完才發布 manifest，manifest 記錄 schema、requested/canonical source identity、觀察到的 final URL／provider identity、fetch route、capture time、validation 結果、bytes、SHA-256 與相對資料路徑。

來源 header 可以作一致性檢查，但不能取代 adapter 的 observed identity。X 以 status／thread 身分核對，YouTube 以 video ID 核對；一般頁面記錄經安全 redirect 取得的 final URL。資訊未觀察到就明確標未知，不虛構 metadata。

完整性表示已通過 source-type-specific extraction／validation，不宣稱能數學證明網站沒有隱藏內容。已知 teaser、incomplete marker、缺失 thread 段落、付費牆或截斷全部拒絕；不能用摘要補足，也不能靜默刪除尾端以符合 packet 上限。

### 4. 給 judge 資料檔，不把來源內文插進指令

trusted prompt 指定 manifest 與全文資料路徑，要求讀完整來源、核對 evidence，再依既有 rubric 評分。明示來源文字與其連結、假 system 標記、shell 範例都只是 untrusted evidence，不能更改 rubric、輸出路徑、工具權限或要求執行命令。

Codex 與 Claude 的 workdir 都必須看得到 packet，來源檔不得列入 writer 的 writable candidate。judge 前與 judge 後重新驗證 bytes／hash；integrity failure 不採信 score，不寫 authoritative PASS／NEEDS_REVIEW。保留全檔可讀性，不能靠在 prompt 裡塞一段 preview 假裝已交付。

### 5. 一次 capture 與顯式 replay，不建立自動 source cache

同一 invocation 的 FactChecker retry，以及 #1098 合法 writer 改稿後的必要重評，都沿用相同來源 bytes。packet helper 提供顯式載入既有 manifest 的 replay 路徑；必須重新驗證 schema、path、URL identity、bytes 與 hash，不接受只有 source file 非空的捷徑。

packet 不宣稱是文章最初寫作當時的歷史原文，只記錄本次 observation。既有同 revision stage PASS 的 resume 契約不以網路 refetch 推翻；只有 FactChecker 實際重新執行時才建立或驗證它使用的 packet。stage evidence 記錄所用 source hash，使新 score 可以追到具體 bytes，不改 reader revision SSOT。

packet 是本次工作所擁有的 evidence artifact，不建跨文章共享 lookup／過期機制；跟隨既有 worker artifact 生命週期，不寫入 repository、公開 log 或 production site。

### 6. 擷取失敗保留可恢復性

preflight 失敗時記錄穩定、已去敏的 source-capture reason，以既有 RUNNER_ERROR／rc70 結束；尚未呼叫 judge 的 stage attempts 為零，top-level content attempts 不增加。不把 unavailable 分成新的內容型 NEEDS_REVIEW reason，也不自行加排程器或無界 retry。來源完整後由正常 operational recovery 或明確 operator requeue 接續。

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
