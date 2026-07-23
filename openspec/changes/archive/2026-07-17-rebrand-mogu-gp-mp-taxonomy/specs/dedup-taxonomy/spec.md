## MODIFIED Requirements

### Requirement: Temporal type enumeration

每一篇 post SHALL 被分類為 `event` / `evergreen` / `hybrid` 其中恰好一種。

- `event`：綁在某個特定、不重演的事件上（模型發表、產品更新、人員異動、單一新聞事件）。
- `evergreen`：綁在長期存在的概念 / 技巧 / 方法論上，預期跨年仍有閱讀價值。
- `hybrid`：同時承載 event 觸發點跟 evergreen 概念內容，以**內容重心**決定套用哪一條規則。

#### Scenario: Gemma 4 發佈當天的規格介紹

- **WHEN** post 為 MP-242（Gemma 4 launch 當天譯自官方發文的規格介紹）
- **THEN** temporal type SHALL 是 `event`

#### Scenario: Karpathy 解釋 agentic engineering 概念

- **WHEN** post 為 MP-36（Karpathy 對 agentic engineering 概念的解釋）
- **THEN** temporal type SHALL 是 `evergreen`

#### Scenario: 演講事件搭載概念內容

- **WHEN** post 為 MP-116（Karpathy 在 SF AI Startup School 的演講，同時包含「演講事件」跟「Software 3.0 概念」）
- **THEN** temporal type SHALL 是 `hybrid`
- **AND** dedup 規則 SHALL 以內容重心決定適用 event 或 evergreen rule

### Requirement: Time does not produce duplicates

Post 的年齡 SHALL NOT 單獨構成 `deprecated` status 的觸發條件。一篇 event-driven post 即使事件已過、新版本已發佈，仍 SHALL 保持 `published`，作為該時點的歷史紀錄，除非**同一個 cluster 內**另有 post 取代它。

#### Scenario: GPT-4o 發佈 post 在 GPT-5 出現後

- **WHEN** 一年前發佈的 GPT-4o 介紹 post 仍在 corpus 中
- **AND** OpenAI 在之後發佈 GPT-5（是**不同事件**，不在同 cluster）
- **THEN** GPT-4o 發佈 post 的 status SHALL 維持 `published`
- **AND** 系統 SHALL NOT 因年齡將其 deprecate

#### Scenario: Cluster 內被取代

- **WHEN** MP-298（Mythos 事件的 TechCrunch derivative 翻譯）與 GP-165（同事件的 Anthropic primary 翻譯）處於同一 `event` cluster
- **AND** MP-298 沒有 GP-165 未涵蓋的獨立 diff
- **THEN** MP-298 SHALL 被 deprecate，`deprecatedBy` SHALL 指向 GP-165

### Requirement: Sequence type enumeration

每一篇 post SHALL 被分類為 `standalone` / `series` 其中恰好一種。若為 `series`，SHALL 進一步區分為 `intentional` 或 `emergent`。

#### Scenario: 刻意連載教學系列

- **WHEN** post 的 frontmatter 帶有 `seriesId: "prompt-caching-tutorial"`
- **THEN** sequence type SHALL 是 `series`，series kind SHALL 是 `intentional`

#### Scenario: 同作者湧現式主題群

- **WHEN** MP-36 / MP-116 / MP-137 三篇由同一 canonicalId（`andrej-karpathy`）撰寫
- **AND** 三篇在 50 天內發表，主題互有關聯（AI 開發工程的演進）
- **AND** 三篇 frontmatter 皆無共通 `seriesId`
- **THEN** 系統 SHALL 偵測為 `emergent` series
- **AND** SHALL 建議人工升級成 `intentional`（例如補 `seriesId: "karpathy-thinking-evolution"`）

### Requirement: Cluster membership by shared target

兩篇或以上 post 屬於同 cluster 的條件 SHALL 是「共同指向同一個 target」— event、entity 或 concept。Cluster 成員身份 SHALL NOT 由 source type（primary / derivative / commentary）決定；source type 僅為 cluster 內部角色標籤。

#### Scenario: Primary + derivative + commentary 全為 cluster 成員

- **WHEN** GP-165（primary，官方 PDF 翻譯）、MP-298（derivative，TechCrunch 報導翻譯）、假想 MP-NNN（commentary，部落客對 Anthropic 透明度的分析）三篇皆在談 Mythos 事件
- **THEN** 三篇 SHALL 皆為「Mythos event」cluster 的成員
- **AND** source type 差異 SHALL 僅影響 cluster 內部的處置規則（primary 留、無 diff derivative 可 deprecate、commentary 獨立 angle 通常留），SHALL NOT 影響 membership

### Requirement: Multi-label cluster membership

一篇 post MAY 同時屬於多個 cluster。Frontmatter `clusterIds` SHALL 支援 list 形式。

#### Scenario: MP-36 多重 cluster

- **WHEN** MP-36（Karpathy agentic engineering 提議）存在
- **THEN** 其 `clusterIds` SHALL 同時包含：
  - `karpathy-2026-02-04-tweet`（event cluster — 那則 retrospective tweet 本身）
  - `agentic-engineering`（concept cluster — evergreen 概念）
  - `karpathy-thinking-evolution`（entity cluster — Karpathy 思想線 emergent series）

### Requirement: Cluster membership is non-transitive

Cluster 成員關係 SHALL NOT 具 transitive 性。若 post A 與 B 共享 cluster X，且 B 與 C 共享 cluster Y，系統 SHALL NOT 自動將 A 與 C 視為共享任何 cluster。

#### Scenario: 跨 cluster 不自動傳遞

- **WHEN** MP-36 與 MP-116 共享 `karpathy-thinking-evolution` cluster（entity）
- **AND** MP-116 與假想 MP-NNN（某作者寫的 LLM OS 反思）共享 `llm-os-concept` cluster（concept）
- **THEN** MP-36 與 MP-NNN SHALL NOT 被自動視為共享任何 cluster
- **AND** 若要將兩者歸為同 cluster，SHALL 要求 explicit 標記（人工審核或獨立規則命中）
