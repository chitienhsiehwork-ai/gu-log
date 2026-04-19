# dedup-taxonomy Specification

## Purpose
TBD - created by archiving change add-dedup-policy. Update Purpose after archive.
## Requirements
### Requirement: Source hierarchy enumeration

每一篇 gu-log post SHALL 被分類為 `primary` / `derivative` / `commentary` 其中**恰好一種**。此分類是 taxonomy 中 source hierarchy 維度的值。

- `primary`：post 直接建構在「事實產生者本身所發出的內容」上（官方 PDF、企業 blog、作者本人 tweet、arXiv 論文、開源 repo commit）。
- `derivative`：post 建構在「第三方對 primary 的轉述」上（TechCrunch 報導、Hacker News rollup、媒體報導、翻譯文）。
- `commentary`：post 建構在「對某事的觀點 / 分析 / 評論」上（部落格分析、Substack 評論、podcast 訪談摘要、Twitter 長 thread 反思）。

#### Scenario: 翻譯 Anthropic 官方 System Card PDF

- **WHEN** 某 post 直接翻譯 Anthropic 官方 244 頁 Mythos System Card
- **THEN** 該 post 的 source type SHALL 是 `primary`
- **AND** 其 primary 目標 SHALL 是 Anthropic System Card 本身

#### Scenario: 翻譯 TechCrunch 對官方 PDF 的報導

- **WHEN** 某 post 直接翻譯 TechCrunch 針對 Anthropic Mythos System Card 的新聞報導
- **THEN** 該 post 的 source type SHALL 是 `derivative`
- **AND** 其 primary 目標 SHALL 是 TechCrunch 那篇報導，而不是 Anthropic PDF

---

### Requirement: One-hop rule for primary determination

Post 的 `primary` SHALL 以 one-hop 原則決定：只採該 post **直接** 翻譯 / 引用 / build 在其上的上一層內容，系統 SHALL NOT 跨多層追溯到事實最深源頭。

#### Scenario: 翻譯 OpenAI blog，其中引用 Stanford 論文

- **WHEN** 某 post 直接翻譯自 OpenAI 官方 blog
- **AND** 該 OpenAI blog 的內文引用了 Stanford 某篇 arXiv 論文作為實驗依據
- **THEN** 該 post 的 `primary` SHALL 是 OpenAI blog
- **AND** Stanford 論文 SHALL NOT 被記為該 post 的 `primary`（即使它是事實鏈的最深源頭）

#### Scenario: Retweet 的 primary 判定

- **WHEN** 某 post 基於 Karpathy 轉推 @simonw 的推文並加了 Karpathy 自己的 commentary 撰寫
- **AND** post 的內容重心在 Karpathy 的 commentary（不是 Simon 的原推文）
- **THEN** 該 post 的 `primary` SHALL 是 Karpathy 的 retweet-commentary 聲明

---

### Requirement: Proxy distinction

記者、轉推者、翻譯者這類「relay 他人內容」的身份 SHALL NOT 被記為所 relay 內容的 `primary` 作者。`authorType = proxy` 的身份只描述傳遞行為，不主張內容創作權。

#### Scenario: Simon Willison 訪談 Anthropic 員工

- **WHEN** 某 post 翻譯 Simon Willison 對 Anthropic 員工的訪談稿
- **AND** 訪談內容主要是被訪者發言
- **THEN** 若 post 重心是「Simon 的訪談 framing 跟延伸分析」，`authorCanonical` SHALL 是 `simon-willison`（Simon 是 commentary primary）
- **AND** 若 post 重心是「被訪者的原始發言」，`authorCanonical` SHALL 是被訪者的 canonical ID（Simon 僅為 proxy）

---

### Requirement: Temporal type enumeration

每一篇 post SHALL 被分類為 `event` / `evergreen` / `hybrid` 其中恰好一種。

- `event`：綁在某個特定、不重演的事件上（模型發表、產品更新、人員異動、單一新聞事件）。
- `evergreen`：綁在長期存在的概念 / 技巧 / 方法論上，預期跨年仍有閱讀價值。
- `hybrid`：同時承載 event 觸發點跟 evergreen 概念內容，以**內容重心**決定套用哪一條規則。

#### Scenario: Gemma 4 發佈當天的規格介紹

- **WHEN** post 為 CP-242（Gemma 4 launch 當天譯自官方發文的規格介紹）
- **THEN** temporal type SHALL 是 `event`

#### Scenario: Karpathy 解釋 agentic engineering 概念

- **WHEN** post 為 CP-36（Karpathy 對 agentic engineering 概念的解釋）
- **THEN** temporal type SHALL 是 `evergreen`

#### Scenario: 演講事件搭載概念內容

- **WHEN** post 為 CP-116（Karpathy 在 SF AI Startup School 的演講，同時包含「演講事件」跟「Software 3.0 概念」）
- **THEN** temporal type SHALL 是 `hybrid`
- **AND** dedup 規則 SHALL 以內容重心決定適用 event 或 evergreen rule

---

### Requirement: Time does not produce duplicates

Post 的年齡 SHALL NOT 單獨構成 `deprecated` status 的觸發條件。一篇 event-driven post 即使事件已過、新版本已發佈，仍 SHALL 保持 `published`，作為該時點的歷史紀錄，除非**同一個 cluster 內**另有 post 取代它。

#### Scenario: GPT-4o 發佈 post 在 GPT-5 出現後

- **WHEN** 一年前發佈的 GPT-4o 介紹 post 仍在 corpus 中
- **AND** OpenAI 在之後發佈 GPT-5（是**不同事件**，不在同 cluster）
- **THEN** GPT-4o 發佈 post 的 status SHALL 維持 `published`
- **AND** 系統 SHALL NOT 因年齡將其 deprecate

#### Scenario: Cluster 內被取代

- **WHEN** CP-298（Mythos 事件的 TechCrunch derivative 翻譯）與 SP-165（同事件的 Anthropic primary 翻譯）處於同一 `event` cluster
- **AND** CP-298 沒有 SP-165 未涵蓋的獨立 diff
- **THEN** CP-298 SHALL 被 deprecate，`deprecatedBy` SHALL 指向 SP-165

---

### Requirement: Sequence type enumeration

每一篇 post SHALL 被分類為 `standalone` / `series` 其中恰好一種。若為 `series`，SHALL 進一步區分為 `intentional` 或 `emergent`。

#### Scenario: 刻意連載教學系列

- **WHEN** post 的 frontmatter 帶有 `seriesId: "prompt-caching-tutorial"`
- **THEN** sequence type SHALL 是 `series`，series kind SHALL 是 `intentional`

#### Scenario: 同作者湧現式主題群

- **WHEN** CP-36 / CP-116 / CP-137 三篇由同一 canonicalId（`andrej-karpathy`）撰寫
- **AND** 三篇在 50 天內發表，主題互有關聯（AI 開發工程的演進）
- **AND** 三篇 frontmatter 皆無共通 `seriesId`
- **THEN** 系統 SHALL 偵測為 `emergent` series
- **AND** SHALL 建議人工升級成 `intentional`（例如補 `seriesId: "karpathy-thinking-evolution"`）

---

### Requirement: Intentional series declared via seriesId

當 post 屬 intentional series 時，SHALL 於 frontmatter 帶 `seriesId`（kebab-case）。同 `seriesId` 的 posts SHALL 被 dedup 系統視為合法連載，不 trigger duplicate 規則。

#### Scenario: Dedup gate 對 intentional series 放行

- **WHEN** 一篇新 post 與另一篇 already-published post 內容高度相似
- **AND** 兩篇的 `seriesId` 相同
- **THEN** dedup gate SHALL 放行新 post，不標記為 duplicate

---

### Requirement: Emergent series detection rule

系統 SHALL 在以下三條件同時成立時，將兩篇或以上 post 標記為 `emergent` series 候選：
1. 同 `authorCanonical`；
2. 發佈日期相距在 14 天之內；
3. 內容主題重疊度 > 70%；
4. 所有 post 皆**沒有**共通 `seriesId`。

#### Scenario: 命中 emergent rule

- **WHEN** 兩篇 post `authorCanonical` 同為 `andrej-karpathy`
- **AND** 發佈日期相距 10 天
- **AND** 主題重疊度 78%
- **AND** 兩篇皆無 `seriesId`
- **THEN** 系統 SHALL 將它們標為 `emergent` series 候選
- **AND** SHALL 要求後寫的一篇在內文 cite 前一篇並明示 diff（否則 dedup gate 不放行）

#### Scenario: 不同作者高重疊不觸發 emergent

- **WHEN** 兩篇 post `authorCanonical` 不同
- **AND** 內容重疊度 > 70%
- **THEN** 系統 SHALL NOT 觸發 emergent series rule（此為 cluster 層級問題，不是 series 問題）

---

### Requirement: Author canonical identity

每一篇 post SHALL 於 frontmatter 帶 `authorCanonical`（kebab-case 唯一 ID）跟 `authorType`（`individual` / `org` / `proxy` 擇一）。Dedup 系統 SHALL 以 `authorCanonical` 進行同作者比對，SHALL NOT 以 raw `source` 字串比對。

#### Scenario: 同一作者跨平台

- **WHEN** 一篇 post 譯自 `@karpathy` on X
- **AND** 另一篇 post 譯自 `karpathy.ai` 個人 blog
- **THEN** 兩篇的 `authorCanonical` SHALL 皆為 `andrej-karpathy`
- **AND** 即使 `source` 字串不同，系統 SHALL 視為同作者

---

### Requirement: Individual vs org author distinction

同一個自然人以個人身份發文跟以組織身份發文，SHALL 被記為**不同** `authorCanonical`（一個 individual ID、一個 org ID）。同 author type 才觸發 same-author dedup 規則；跨 type SHALL NOT 觸發。

#### Scenario: 員工 personal blog vs org official blog

- **WHEN** post 1 譯自 `bcherny.com`（Boris Cherny 個人 blog），`authorCanonical = boris-cherny`，`authorType = individual`
- **AND** post 2 譯自 `anthropic.com/blog`（官方 blog，Boris Cherny 為共同署名之一），`authorCanonical = anthropic`，`authorType = org`
- **AND** 兩篇主題重疊度 75%、間隔 10 天
- **THEN** same-author dedup rule SHALL NOT 觸發（type 不符）
- **AND** 此情境改由 cluster-level 規則處理

---

### Requirement: Proxies are not authors

`authorType = proxy` 的主體（如：轉推者、翻譯者、新聞稿 relay 記者）SHALL NOT 被登錄為所 relay 內容的 `authorCanonical`。Proxy 僅於 metadata 追蹤傳遞鏈，不進入 dedup 作者比對。

#### Scenario: 純轉推無 commentary

- **WHEN** Karpathy 純轉推 @simonw 的 tweet，不加任何 commentary
- **AND** 某 post 基於該 tweet 內容撰寫
- **THEN** `authorCanonical` SHALL 是 `simon-willison`，不是 `andrej-karpathy`
- **AND** Karpathy 在此情境為 proxy，不計入作者

---

### Requirement: Cluster membership by shared target

兩篇或以上 post 屬於同 cluster 的條件 SHALL 是「共同指向同一個 target」— event、entity 或 concept。Cluster 成員身份 SHALL NOT 由 source type（primary / derivative / commentary）決定；source type 僅為 cluster 內部角色標籤。

#### Scenario: Primary + derivative + commentary 全為 cluster 成員

- **WHEN** SP-165（primary，官方 PDF 翻譯）、CP-298（derivative，TechCrunch 報導翻譯）、假想 CP-NNN（commentary，部落客對 Anthropic 透明度的分析）三篇皆在談 Mythos 事件
- **THEN** 三篇 SHALL 皆為「Mythos event」cluster 的成員
- **AND** source type 差異 SHALL 僅影響 cluster 內部的處置規則（primary 留、無 diff derivative 可 deprecate、commentary 獨立 angle 通常留），SHALL NOT 影響 membership

---

### Requirement: Cluster types

Cluster SHALL 至少區分為以下三型之一：`event` / `entity` / `concept`。

- `event`：凝聚於某特定、一次性事件（例：Anthropic Mythos 揭露、Gemma 4 發佈日）。
- `entity`：凝聚於某長期存在的標的（例：Sonnet 模型家族、Cursor 產品線、Karpathy 思想演進）。
- `concept`：凝聚於某 evergreen 觀念或技巧（例：agentic engineering、prompt caching、vibe coding）。

#### Scenario: Sonnet 版本演進是 entity cluster

- **WHEN** gu-log 有 Sonnet 3.0 / 3.5 / 4.0 / 4.6 各版本發佈對應 post
- **THEN** 這些 post SHALL 皆為「Sonnet 模型家族」entity cluster 的成員
- **AND** 該 cluster SHALL 適用 intentional series 規則（若有 `seriesId: "sonnet-release-history"`）或 emergent series 規則

---

### Requirement: Multi-label cluster membership

一篇 post MAY 同時屬於多個 cluster。Frontmatter `clusterIds` SHALL 支援 list 形式。

#### Scenario: CP-36 多重 cluster

- **WHEN** CP-36（Karpathy agentic engineering 提議）存在
- **THEN** 其 `clusterIds` SHALL 同時包含：
  - `karpathy-2026-02-04-tweet`（event cluster — 那則 retrospective tweet 本身）
  - `agentic-engineering`（concept cluster — evergreen 概念）
  - `karpathy-thinking-evolution`（entity cluster — Karpathy 思想線 emergent series）

---

### Requirement: Cluster membership is non-transitive

Cluster 成員關係 SHALL NOT 具 transitive 性。若 post A 與 B 共享 cluster X，且 B 與 C 共享 cluster Y，系統 SHALL NOT 自動將 A 與 C 視為共享任何 cluster。

#### Scenario: 跨 cluster 不自動傳遞

- **WHEN** CP-36 與 CP-116 共享 `karpathy-thinking-evolution` cluster（entity）
- **AND** CP-116 與 假想 CP-NNN（某作者寫的 LLM OS 反思）共享 `llm-os-concept` cluster（concept）
- **THEN** CP-36 與 CP-NNN SHALL NOT 被自動視為共享任何 cluster
- **AND** 若要將兩者歸為同 cluster，SHALL 要求 explicit 標記（人工審核或獨立規則命中）

---

### Requirement: Discrete labels over fuzzy weighting (Design Principle #1)

所有 categorical 維度（source type、temporal type、sequence type、author type、cluster type）SHALL 以 discrete enum 表示。系統 SHALL NOT 對 categorical 維度引入 weighted score 或 hidden tuning 參數。Fuzzy weighting SHALL 僅限於本質連續的維度（如：內容重疊度百分比、Jaccard similarity 分數）。

#### Scenario: 不允許 weighted author-type score

- **WHEN** 設計 same-author dedup 規則時，有人提議「individual ↔ org 以 0.3 權重觸發弱版本規則」
- **THEN** 此設計 SHALL 被拒絕
- **AND** 規則 SHALL 改為 binary：同 `authorType` 才觸發，跨 `authorType` 不觸發

#### Scenario: 允許 weighted content-overlap score

- **WHEN** 系統比對兩篇 post 的主題重疊度
- **AND** 計算結果為 0.78（78% 重疊）
- **THEN** 此 continuous score SHALL 允許與門檻值比較（例如 > 0.70 觸發 emergent rule），此為合法用法

