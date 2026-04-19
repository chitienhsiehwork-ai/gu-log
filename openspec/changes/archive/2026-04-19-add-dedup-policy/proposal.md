## Why

Gu-log 累積了 922 篇 post（487 zh-tw + 435 en-），日常編輯時陸續浮出好幾組近重複 cluster：Mythos 事件（SP-165 + CP-298）、Gemma 4（CP-242 + CP-275）、Karpathy 思想三部曲（CP-36 + CP-116 + CP-137）。手動逐案審閱後發現，目前的 `scripts/dedup-gate.mjs`（URL normalization + Jaccard topic similarity + intra-queue pairwise）只能擋表層重複，擋不住語意層的 cluster —— 不同來源報導同事件、或同作者湧現式的 emergent series。

缺乏共通語彙跟成文規則的結果：每次重複判斷都是 ad-hoc，寫手沒有自我檢查的依據，Librarian tribunal judge 沒有 `dupCheck` 維度，retroactive corpus 掃描工具（Level G）也沒有規則可引用。

這個 change 建立下游所有 dedup 能力（Librarian dupCheck、semantic gate Layers 4–5、corpus scanner、pipeline 整合）共同引用的**基礎 taxonomy 跟 policy rules**。

## What Changes

- 引入跨 5 個正交維度的共通 **taxonomy**：
  - **Source hierarchy**：`primary` / `derivative` / `commentary`（one-hop 規則 — post 的 `primary` 是它**直接** build 在其上的內容，不追溯到事實最深源頭）。
  - **Temporal type**：`event` / `evergreen` / `hybrid`。
  - **Sequence type**：`standalone` / `series`（`intentional` — 透過 `seriesId` 宣告；`emergent` — 系統事後偵測）。
  - **Author identity**：canonical ID + type（`individual` / `org` / `proxy`）。Proxy（轉推者、翻譯者、記者）**不是**底層內容的作者。
  - **Cluster**：`event` / `entity` / `concept` cluster。支援 multi-label，membership **不具備 transitive 性質**。
- 制定作用於 cluster 成員的 **policy rules**：哪篇留（primary）、哪篇 deprecate（無獨立 diff 的 derivative）、哪些情況必須 cross-link（emergent series）、哪些情況必須明示 diff（同作者 14 天內 >70% 主題重疊）。
- 訂定 **Design Principle #1**：taxonomy 產出離散標籤；fuzzy weighting 只保留給「本質連續」的維度（如內容重疊度百分比）。Categorical 維度上不藏任何 tuning 旋鈕 — rule 必須可解釋、可 unit test、可人工推翻。
- 釐清 `src/content/config.ts` 既有的 3 種生命週期狀態（`published` / `deprecated` / `retired`）並寫明規則：**時間不會製造 duplicate** — 老的 event-driven post 是歷史紀錄，不是 deprecation 候選人。Deprecation 只在**同一個 cluster** 內被另一篇 post 取代時才觸發。

## Capabilities

### New Capabilities

- `dedup-taxonomy`：5 個正交維度的共通語彙（source hierarchy、temporal、sequence、author identity、cluster），含 Design Principle #1。下游每一個 change 都會引用。
- `dedup-policy`：作用於 cluster 的規則 — primary 保留、derivative deprecation、emergent series cross-link、同作者 diff 要求、生命週期狀態規範。依賴 `dedup-taxonomy`。

### Modified Capabilities

_無。_ 這個 change 只引入基礎 specs，沒有修改既有 spec 的行為。

## Impact

- **Code**：此 change 不動 code。下游 changes 會引用這裡的 specs：
  - `extend-post-frontmatter`（Level C）— schema 新增 `clusterIds`、`sourceType`、`seriesId`、`authorCanonical` 欄位。
  - `add-librarian-dupcheck`（Level E）— tribunal 新增 dimension，引用 taxonomy。
  - `add-semantic-dedup-gate-layers`（Level F）— gate Layers 4–5，引用 taxonomy。
  - `add-corpus-dedup-scanner`（Level G）— retroactive cluster 掃描，執行 policy rules。
  - `integrate-dedup-into-pipeline`（Level H）— 把以上串進 CP / SP / Ralph Loop / tribunal。
- **Documentation**：archive 之後 `CONTRIBUTING.md` 跟 `WRITING_GUIDELINES.md` 應加上 cross-link。
- **Operations**：Clawd VM 上的 CP writer 跟 Shroom feed cron 自 2026-04-16 起 **DISABLED**，持續禁用直到下游 work ship。此 change 單獨 ship 不會重啟 cron — 重啟是 Level I（`rollout-dedup-system-v2`）的範疇。
- **Existing posts**：不需要 migration。Classification 前瞻性套用；對既有 922 篇 corpus 的 retroactive 分類屬於 Level G（`add-corpus-dedup-scanner`）範疇。
