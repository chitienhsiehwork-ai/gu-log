## Context

部署版 shell Tribunal 會把雙語文章複製到隔離 writer workspace，writer 完成後由 parent 捕獲候選，再以原子 CAS／journal 套回 canonical pair。現行捕獲器要求整段 frontmatter 位元相同，目的是阻止不可信 writer 改動文章身份、來源、日期、分數與 provenance；但 `summary` 同時是文章內容的一部分，會出現在首頁、RSS、搜尋與 API，也在 FactChecker 的事實審查範圍內。

SD-31 的摘要把 824／10,700（約 7.7%）寫成兩成。FactChecker 正確判失敗，writer 也正確改了中英文摘要與正文歸因，但捕獲器因摘要變更拒絕整份候選，第二輪只能重評舊內容。這證明安全邊界目前把一個可判定的內容修正變成 deterministic deadlock。

## Goals / Non-Goals

**Goals:**

- 讓 FactChecker 的一次 bounded rewrite 能修正既有雙語單行 `summary`；沒有 English sidecar 時可修正單語摘要，並一律由下一輪 FactChecker 重新驗證。
- `summary` 以外的 frontmatter 維持位元不變；CAS、journal、race、rollback、recovery 與 validator 邊界不放寬。
- 任何 partial bilingual、YAML 結構變更或不在精確範圍內的改動都封閉失敗。
- 讓 executable gate、writer prompt／role contract 與 runbook 使用同一個 stage-scoped 權限模型。

**Non-Goals:**

- 允許 writer 改 title、ticketId、日期、來源、tags、scores、provenance 或其他 frontmatter。
- 讓 FreshEyes、Librarian、Vibe 或 final-build repair 改摘要。
- 讓 judge 的自然語言理由成為可執行 patch，或擴充 judge JSON schema。
- 改寫 legacy Tribunal v2 的單篇 writer constraint；部署版 canonical runner 仍是 shell Tribunal。
- 用 deterministic code 判定中英文摘要的語意等價。

## Decisions

### 1. 權限屬於 FactChecker retry，不屬於 writer 身份

`run_writer_candidate_transaction` 只接受 stage 作為權限輸入，並在交易內部由 stage 推導 frontmatter policy；caller 沒有另一個 policy 參數可傳。正常 judge loop 的 `factChecker` stage 會推導出 paired-summary，其他 stage 與 final-build repair 則推導出 preserve-all。Writer process 無法從 prompt、文章內容、provider 或環境自行升級權限。`factCheck` 仍只是既有 frontmatter score key，不用於 stage routing。

FactChecker attempt 1 後的 writer 最多產生候選；attempt 2 必須重新讀 canonical 候選並依既有 pass bar 判斷。摘要變好不會直接獲得 PASS，且後續其他 judge writer 不能再改掉已通過 fact check 的摘要。

替代方案是所有 judge writer 都可改 `summary`。這會讓較晚的 Vibe／FreshEyes rewrite 在 FactChecker 通過後改動讀者可見主張而不再重跑 fact check，因此不採用。

### 2. 只替換既有單行 quoted scalar 的 payload

候選驗證器在 zh-tw 與 EN frontmatter 中各找出恰好一個 top-level `summary`。只有 baseline 已使用單一實體行的單引號或雙引號字串、candidate 保持相同 key、縮排、quote style、行尾與位置時，才允許 quote 內的 payload 不同。所有其他 frontmatter bytes 仍逐位元相同。

為了避免重造不完整的 YAML key 等價 parser，只要 frontmatter 要變更，驗證器會先把可處理範圍限縮成「頂層 key 全部使用簡單 plain mapping syntax」；任何 quoted、escaped、tagged、anchored、explicit 或其他非 plain 頂層 key 都封閉拒絕，即使它不是 `summary`。進入這個保守子集後，duplicate key、block scalar、跨實體行 quoted scalar、tag／anchor、plain scalar、欄位新增／刪除／搬移、quote style 變更或 malformed escape 仍一律拒絕。捕獲後仍先在 parent-materialized candidate 上跑既有真 YAML／post validator，通過後才允許 CAS 套用。

替代方案是用 YAML parser 解析整份 frontmatter後比較 object。它會把排序、quote、comment、duplicate-key 與 scalar type 等位元差異正規化掉，擴大目前的安全邊界，因此不採用。

### 3. 英文 sidecar 存在時，摘要變更必須成對

EN sidecar 存在時，paired-summary policy 只接受「兩邊都沒改」或「兩邊 summary 都改」。這無法證明翻譯等義，但能阻止 zh-tw 新摘要與 EN 舊摘要被原子提交。兩份完整 candidate bytes 仍由既有 bilingual CAS／journal 一起套用與復原。沒有 EN sidecar 時，既有單語 transaction 可只修正 zh-tw summary；policy 不會要求建立新的 sidecar。

替代方案是只允許 zh-tw。那能讓 FactChecker 通過，卻會確定製造讀者可見的 bilingual drift，因此不採用。

### 4. Transaction 從 stage 推導一次 policy，供 capture、apply 與 CAS rollback 共用

Transaction 從 stage 推導 policy 後明確保存在 parent-controlled transaction state，candidate capture、apply 與 cheap validation 失敗後的 CAS rollback 都使用這一份值；caller 不傳 policy override。否則 candidate summary 與 baseline summary 的預期差異會讓安全 rollback 自己拒絕。Policy 不藏在 ambient env；錯誤路徑在推導前維持 preserve-all。

既有 journal 記錄完整 baseline／candidate bytes，不需變更格式。Crash recovery 保持 policy-neutral：它只依完整 payload 與 inode identity 收斂成 baseline 或 candidate，不解析、不保存 summary policy。

### 5. Prompt 只描述 policy，code 是執行權威

FactChecker rewrite prompt 與 writer role contract 改成：frontmatter 預設不變；FactChecker retry 若需要修正讀者可見摘要，可同步修正既有 zh-tw／EN `summary`。這是協助 writer 產生可接受候選，不是更窄的結構化授權。真正權限由 parent stage policy、位元比較、validator 與 re-score 共同執行。

## Risks / Trade-offs

- [風險] Writer 可能把摘要改得更會賣但不正確 → 只有 FactChecker retry 有權，下一輪必須重評；其他 stage 與 final-build repair 保持不可改。
- [風險] 行導向 parser 漏過 YAML key 等價寫法 → 不解析等價寫法；摘要變更前先要求所有頂層 key 使用簡單 plain syntax，再檢查既有 quoted single-line summary，其餘 bytes 完全相同，並在 apply 前跑既有真 YAML validator。
- [風險] EN 摘要雖一起改但翻譯不等義 → 保留既有 writer bilingual contract；本 change 只保證原子 pair，不宣稱 deterministic 語意驗證。
- [風險] Rollback 因 policy 遺失而卡住 → transaction 從 stage 推導一次並保存同一 policy，回歸測試走實際 runner 的反向 CAS；crash recovery 另以既有完整 bytes／identity 回歸證明 policy-neutral 收斂。
- [取捨] 不新增 judge-signed structured patch → 少一層 schema／hash／dispatcher coupling；安全性來自 stage-scoped allowlist、full re-score 與既有 CAS，而不是自然語言授權。

## Migration Plan

1. 先加入 snapshot、shell transaction 與 end-to-end retry 的 failing tests。
2. 實作 paired-summary policy，更新 writer contract／runbook，跑 Tribunal safety suites 與 repo gates。
3. 封存 change、讓 CI 全綠後 merge。
4. Merge 後把已停止的 Tribunal runtime 更新到包含本 change 的 `origin/main`，先保留並比較任何無關的 runtime WIP，再跑 doctor 與正常 service canary。
5. SD-31 已由獨立內容 PR 修正並發布，runtime rollout 不重播過時 WIP；改以新文章的正常評審 log、fresh quota 與 production-safe service state 驗證部署合約，並確認 publisher／production gates 仍照常。

回復採 revert 該 commit／PR；runtime 回到 preserve-all policy 後會再次封閉拒絕摘要變更，不需要 journal migration。若部署 smoke 發現未知狀態，保持 service 停止並保留 WIP／journal 證據，不熱修 production runtime。

## Open Questions

無。權限 stage、支援語法、雙語語意、重評與 final-build 邊界皆已收斂。
