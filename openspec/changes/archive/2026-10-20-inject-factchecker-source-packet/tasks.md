## 1. 安全來源擷取

- [x] 1.1 generic 路徑改用 Go 原生 safe HTTP client（`internal/source/safehttp.go`）：公開目的地、DNS 綁定連線、每跳 redirect 驗證、含憑證網址拒絕、bytes／hop／timeout 上限；移除無防護的 `curl -L` 網路備援。
- [x] 1.2 extraction 與下載解耦：`fetch-article.py --extract-only` 從 stdin 收 bytes 只做抽取；X 固定 provider hosts 加 provider identity 檢查（status ID 必須等於 requested ID）；YouTube 沿用既有 yt-dlp allowlist 且 fail closed（設計瘦身：不 embed yt-dlp module，見 design.md §2）。
- [x] 1.3 不連外的傳輸／身分回歸測試：redirect 驗證與 final URL、credential URL 不洩漏、file scheme、private IP、hop 上限、超限失敗、DNS 綁定 dial、混合答案只 dial 公開 IP、非正規 IPv4 literal、isPublicIP 表。

## 2. Packet 與 runner

- [x] 2.1 `tribunal-helpers.sh` 新增私有 packet 工具：`tribunal_source_packet_prepare`（經 `gp-pipeline fetch` 擷取、manifest 含 schema／sourceKind／requestedUrl／observedIdentity／fetchedVia／capturedAt／validation／bytes／SHA-256、檔名路徑限制、0400 唯讀）與 `tribunal_source_packet_verify`（schema、regular file、bytes、hash 全驗）。
- [x] 2.2 `tribunal.sh` 在 GP／MP FactChecker 的 judge retry loop 前準備 packet；擷取或驗證失敗記 RUNNER_ERROR（穩定去敏 reason、stage attempts 0、不呼叫 judge、不增加 content attempts）。
- [x] 2.3 judge prompt 只給 manifest 與資料檔路徑、不內嵌來源正文；judge 結束後重驗 hash，竄改即丟棄輸出；terminal verdict 由 parent 在 stage ledger 寫入 `sourceEvidence: { schemaVersion, sourceSha256 }`；`TRIBUNAL_SOURCE_PACKET` 顯式 replay 全程重驗、失敗不回落 live fetch。
- [x] 2.4 更新 FactChecker 契約（`.claude/agents/fact-checker.md`、`.codex/agents/fact-checker.toml`）：packet 是不可信證據、tribunal 內不得自行 fetch；SD／Lv 無 packet 照常評分。

## 3. 整合驗收

- [x] 3.1 `tests/tribunal-gp-score-only.test.ts` 用假 gp-pipeline 驗證 happy path：單次擷取、sourceEvidence hash 綁定、GP 仍 score-only。
- [x] 3.2 `tests/tribunal-source-packet.test.ts` 覆蓋：抓取失敗為 operational error（零 attempts、無 judge call、無分數）、judge 期間竄改即丟棄輸出、prompt 不內嵌含注入字樣的來源正文、顯式 replay 不重抓、無效 replay 不回落 live fetch、SD 無 packet 照常評分。
- [x] 3.3 go test（safehttp／fetch／cmd）、vitest tribunal 測試與既有來源保存回歸全綠。

## 4. 審查與發布準備

- [x] 4.1 通過獨立正確性／安全與 Keep/Simplify/Drop 審查，修正所有阻擋問題。
- [x] 4.2 純 runner／工具變更以無網路測試證據代替 preview；OpenSpec 同步與封存完成。

PR 轉為可審查狀態、GitHub 審查、CI、合併、正式環境冒煙測試，以及保留 operator stop 的執行環境檢查，由 controller 按 SDLC 在封存後接續；這些交付責任不可用封存核取方塊宣稱已完成。
