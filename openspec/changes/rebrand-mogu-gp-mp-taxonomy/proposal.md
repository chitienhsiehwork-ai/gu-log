## Why

gu-log 現在有一套只改到畫面的過渡命名：讀者看到 `GP-` / `MP-` 與 Mogu，但底層仍儲存 `SP-` / `CP-`、`ClawdNote`、`clawdNote`，pipeline 與舊 URL 也繼續散播 Clawd / SP / CP。這個 split-brain contract 讓每個新功能都得記住「顯示名」與「真實值」不是同一個東西，也讓已決定淘汰的品牌名稱持續出現在公開 repo、文章與自動化輸出。

目前只有一位主要讀者，且 ShroomDog 已明確接受 URL 與資料格式的 breaking change。現在一次付清 migration cost，比等外部讀者、第三方整合、更多文章與商業化之後再背永久 compatibility layer 更便宜。

本 change 因此不是 display rename，而是 ground-up taxonomy migration：角色、系列、ticket ID、slug、component、score schema、pipeline、routes、內容 corpus、derived manifests 與 guardrail 全部收斂到同一套 canonical vocabulary。

## What Changes

- gu-log commentary persona 的 canonical 名稱改為 **Mogu**；component 只保留 `MoguNote`，Tribunal 維度只保留 `moguNote`。
- **ShroomDog Picks / SP** 完整改為 **Gu-log Picks / GP**，包含 `GP-N` ticket ID、`gp-` filename/slug、counter key、filter、search、badge、cross-link、測試與 pipeline contract。
- **Clawd Picks / CP** 完整改為 **Mogu Picks / MP**，包含 `MP-N` ticket ID、`mp-` filename/slug、queue、prompt、route、filter、cross-link、測試與自動化 contract。
- `SD`（ShroomDog Original）與 `Lv`（Level-Up）維持不變。
- 移除過渡 alias / shim / display translation，包括 `ClawdNote.astro`、SP command shim、舊 Clawd Picks route 與 `SP→GP` / `CP→MP` 顯示替換。
- 一次性遷移所有 active posts、站內連結、glossary anchor、score data、generated manifests 與 repo-owned fixtures；不 grandfather 舊文章。
- 新增 deterministic residual gate，禁止 active repo 再出現已退役的 persona/component/schema/series contract。
- 不保留舊文章 URL 或 Reader Tracker slug 的 compatibility path。所有 repo-owned cross-link 必須直接改成新 canonical URL。
- 移除 `clawd-picks` / `shroom-picks` / `shroomdog-picks` 這類重複內容類型 tags，不建立 GP/MP 替代 tag；系列身份只由 `ticketId` 決定。
- 保留真實專有名詞與歷史證據：`Claude`、`Claude Code`、`Anthropic`、`OpenClaw`、來源引文，以及尚未遷移的外部部署座標（例如 legacy SSH alias / Unix path）不得被盲目改寫。

## Capabilities

### New Capabilities

- `brand-taxonomy`：定義 Mogu、GP、MP、SD、Lv 的 canonical reader-facing 與 machine-facing contract、breaking migration 邊界、legacy residual gate 與 factual-name exclusions。

### Modified Capabilities

- `extended-post-frontmatter`：ticket prefix 改為 `GP | MP | SD | Lv`；Tribunal Vibe score key 改為 `moguNote`。
- `glossary-identity-ssot`：Mogu persona 只允許一個 canonical glossary identity 與 stable anchor。
- `machine-operator-memory`：repo 文件中的 agent identity 使用 Mogu；legacy host / Unix account 只視為部署座標，不再兼任品牌名稱。
- `github-ai-operator-permissions`：受限 GitHub automation operator 的品牌稱呼改為 Mogu，但權限安全邊界不變。
- `tribunal-scoring-dimensions`：所有 Tribunal 版本的 persona-note 維度改為 `moguNote`，但 clarity 的 version ownership 不變。
- `tribunal-score-persistence`：judge output 與 zh/en score sync 只寫 canonical key / slug。
- `dedup-taxonomy`、`dedup-policy`、`dedup-eval-harness`：living examples 與 fixtures 搬到 GP/MP ID，避免 archive 後仍把 SP/CP 當有效識別字。
- `publish-bar-visibility`：publishing pipeline 的 canonical command 改為 `gp-pipeline`。

## Impact

這是 repo-wide breaking change，預期影響：

- `src/content/posts/` 的 frontmatter、imports、MDX components、內鏈、檔名與 slug。
- `src/content.config.ts`、Tribunal types / pass bar / score serialization、validators、content gates、search、feed、badge、首頁與系列頁。
- `scripts/article-counter.json`、`tools/gp-pipeline/`、Mogu Picks queue / prompt / runner、Obsidian importer、hooks 與 CI。
- glossary、public assets、CSS selectors / variables、tests / fixtures / snapshots、derived manifests 與 active OpenSpec examples。
- `CONTRIBUTING.md`、`GU-LOG_WRITER_PROMPT.md`、AGENTS / playbooks / judge prompts / runbooks 等 derived docs。

外部 VM 的 hostname、SSH alias、Unix user 與既有 filesystem path 不在這個 repo-only migration 內直接改名。它們可暫時保留為 factual deployment coordinates；公開 persona 與 operator prose 必須使用 Mogu。若日後要改 OS identity，應做獨立 infra cutover，不和 content taxonomy 混在同一個 rollback unit。

本 change 是 engineering / branding consistency 決策，不等同於 `Mogu` 的商標 clearance。正式商業化前仍應對預定市場、類別、domain 與相近品牌做獨立 legal/trademark 檢索。

## Approval Meaning

核准本 change 代表接受一次性的 breaking migration：新 main 不再把 SP、CP、Clawd、`ClawdNote` 或 `clawdNote` 當有效 public/data contract，也不為舊 URL、舊 Reader Tracker slug 或舊 pipeline command 留永久相容層。Filename / pathname 改名也代表 Reader Tracker identity、Giscus pathname thread 與 post-version 顯示可能重設；這些都是本次低成本窗口內接受的 break。
