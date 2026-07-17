<!-- md-zh-tw: ignore -->

## Context

repo 已經出現 `MoguNote` 與 GP/MP 顯示名稱，但 canonical storage 仍是 Clawd/SP/CP。這種 display alias 讓畫面暫時好看，卻把 drift 往 schema、pipeline、URL、tests 與每篇新文章擴散。本設計選擇一次性 schema-and-content cutover，讓 public vocabulary 與 machine vocabulary 完全一致。

## Canonical taxonomy

| 概念 | 退役 contract | 新 canonical contract |
|---|---|---|
| commentary persona | Clawd | Mogu |
| note component | `ClawdNote` | `MoguNote` |
| Vibe score dimension | `clawdNote` | `moguNote` |
| 人選長文翻譯系列 | ShroomDog Picks / SP | Gu-log Picks / GP |
| GP ticket / slug | `SP-N` / `sp-*` | `GP-N` / `gp-*` |
| 自動精選翻譯系列 | Clawd Picks / CP | Mogu Picks / MP |
| MP ticket / slug | `CP-N` / `cp-*` 或 `clawd-picks-*` | `MP-N` / `mp-*` |
| translation CLI | SP shim + `gp-pipeline` | `gp-pipeline` only |
| original / tutorial | SD / Lv | SD / Lv（不變） |

名稱與 ID 不再分成 display alias 與 storage value。任何 UI filter、API feed、搜尋、badge、CLI、JSON、frontmatter 與 test fixture 都直接使用 canonical 值。

## Decisions

### D1 — 一次切換，不長期 dual-read / dual-write

同一個 PR 內先讓 tooling 能處理新 contract，再遷移資料，最後刪除舊 contract。PR 中間的 commit 可以暫時 additive，但 merge 到 main 的狀態 SHALL 只接受新值。

不保留：

- `ClawdNote` component alias
- `clawdNote` schema fallback
- `SP` / `CP` ticket parser
- `sp-` / `cp-` content slug
- SP CLI shim
- Clawd Picks legacy pages
- 舊 URL redirect 與 Reader Tracker slug migration

這項決策是有意識的 breaking change。repo-owned links、fixtures、manifests 與 user-visible paths 必須全部改到新值，不把維護成本推給未來。

### D2 — 保留編號，只換 namespace

文章的數字身份保持不變：`SP-258 → GP-258`、`CP-314 → MP-314`。Counter 的 `next` 也只搬 key，不重編號。這讓 review、git rename detection 與事件追蹤仍可對照，卻不讓舊 prefix 繼續成為 runtime contract。

### D3 — 檔名與 URL 一起 canonicalize

所有 active post filenames 改成 `gp-*` / `en-gp-*` 與 `mp-*` / `en-mp-*`。早期 `shroom-picks-*`、`shroomdog-picks-*`、`clawd-picks-*` 也直接搬到相同 canonical slug family。所有站內 cross-link、translation pair、series navigation、search index、post-version / reader-revision manifest 重新產生。

因為 ShroomDog 已接受 breaking URL，此 change 不新增 redirect map。若外部連結未由 repo 控制，它會失效；這是本次低成本窗口的已接受代價。

Canonical series routes 固定為：GP 使用 `/gu-log-picks`，MP 使用 `/mogu-picks`。系列身份以 `ticketId` 為 SSOT；既有 `clawd-picks` / `mogu-picks` / `shroom-picks` / `shroomdog-picks`（以及任何過渡 `gu-log-picks`）series tags 全部移除，不建立替代 tag，避免內容類型在 tags 再複製一份。CLI 與 Go module 唯一路徑是 `tools/gp-pipeline/` / `gp-pipeline`；不再保留 `tools/sp-pipeline` 或 `sp-pipeline` entrypoint。

### D4 — Ground-up persona migration

所有 active post imports、persona prose、glossary links 與 score blocks 改成 Mogu；series tags 依 D3 直接移除，不改成 Mogu tag。`MoguNote.astro` 成為唯一 note component；`ClawdNote.astro` 在 corpus drain 與 gate update 完成後刪除。Judge output、frontmatter parser、pass bar、score writer 與 UI label 全部只讀寫 `moguNote`。

### D5 — Semantic classifier，不盲目 global replace

Residual inventory 分三類：

1. **必改 contract**：persona、component、schema key、series、ticket、slug、tag、pipeline、route、asset、CSS、測試與 active docs。
2. **保留 factual term**：`Claude` / `Claude Code` / `Anthropic` / `OpenClaw`、第三方名稱、來源原文與精確引文。
3. **外部 deployment coordinate**：legacy SSH alias、Unix user、host-specific home path。它們是外部系統目前的實際地址，不是 public brand。Machine-specific mapping 留在 local machine note；tracked scripts / docs 應使用 `$TRIBUNAL_HOST`、`$GU_LOG_DIR`、`$HOME`、`Tribunal VM` 等中性表達。只有無法在本 change 安全移除的 exact coordinate 才可逐條 allowlist。

`sources/**` 與 archived OpenSpec decision records 是 immutable history trees，可由中央 scanner policy 具名排除；verbatim editorial feedback 可保留引文，但 active lesson / instruction 仍須使用 canonical vocabulary。Active code / docs / posts 的例外必須以 exact path + exact token + reason 集中記錄，不能靠 blanket path exception 躲過 gate。Scanner 不掃 bare `SP` / `CP` 子字串，只掃 ticket、slug、route、tag、label、component、schema key、command 等語意明確 pattern。

### D6 — Merge-ready contract 只保留 canonical 值

Migration ordering：

1. 產生 tracked inventory 與 rename manifest，釘住 pair / duplicate / counter invariants。
2. Validators、types、serialization、routing、counter、pipeline 與 tests 的最終狀態只接受 canonical contract；已退役輸入必須 fail closed。
3. Corpus 以 deterministic codemod 搬移全部 score data、ticket references、內鏈、tags 與 filenames；第二次執行必須 zero diff。
4. 更新 UI / CSS / assets / docs / prompts / OpenSpec examples。
5. Cleanup commit 移除舊 read、aliases / shims / legacy routes，啟用 hard residual gate並重新產生 derived manifests。
6. 合併前跑 residual gate、內容驗證、unit / integration / Go tests、Astro check/build、兩主題視覺 QA 與 preview／local route evidence；合併後 production smoke 依 cutover runbook 執行。

Tracked inventory、rename manifest 與 residual checker 必須在 final acceptance 前一起存在，讓任何中間 commit 都能對照不變量，而不是用未留證據的人工改名宣稱完成。

## Invariants

- 每個 zh-tw / en translation pair 保持同一個新 `ticketId` 與同一個 base slug。
- 每個舊 `SP-N` / `CP-N` 數字各自一對一映射為 `GP-N` / `MP-N`，不得重號、掉號或交叉到錯系列。
- `article-counter.json` 的 GP / MP next number 與舊 SP / CP 值相同、不得倒退，且大於該系列所有已用 number；merge-ready key 只剩 `GP | MP | SD | Lv`。
- post status、deprecatedBy、dedup references、series cross-links 與 cluster evidence 必須跟著 ticket ID 更新。
- build 產物、search/feed、首頁、系列頁與 API 不得把 canonical ID 再轉成另一個 display ID。
- merge-ready tree 的 active runtime / content 不得出現 legacy contract；只有具名 factual/history/deployment allowlist 可通過。

## Verification strategy

### Deterministic migration audit

新增一個 read-only checker，至少驗證：

- invalid legacy ticket IDs / slugs / component imports / score keys 為零
- GP/MP translation pair 與 ticket uniqueness
- counter keys 與最大已用編號一致
- repo-owned `/posts/` links 全部 resolve 到實際 post slug
- deleted alias / shim / route 沒有 import 或 invocation
- residual legacy tokens 只存在於集中 allowlist 的 factual/history/deployment contexts

### Existing gates

- post validation、pronoun / jingjing / AI-tell / glossary / content-integrity gates
- TypeScript / Astro check、unit / integration / E2E tests
- `tools/gp-pipeline` Go tests、doctor 與 dry-run fixtures
- production build
- UI 兩主題與 mobile/desktop spot checks（首頁、GP、MP、文章 badge、MoguNote、搜尋）

## Commit and rollback plan

用可獨立 revert 的 commit 分層：

1. OpenSpec contract
2. core schema / tooling / tests
3. deterministic corpus + filename migration
4. docs / assets / cleanup + derived manifests
5. archive sync

在 merge 前任何失敗都直接 revert 對應 commit 或整個 branch；不以 dual compatibility 修補失敗。merge 後若 production 有 blocking regression，優先 revert PR，修正 migration tooling 後重新切換。

## Risks

- **大量 rename 造成 pair / link 漏改**：以 rename manifest、link resolver 與 pair audit 擋住。
- **score schema 只改一半**：以 fixture 同時涵蓋 parse → judge output → persist → render，並禁止 fallback key。
- **歷史引文被誤改**：codemod 只做 syntax-aware / exact-pattern migration；prose residual 另行人工語意審查。
- **external VM automation 尚在讀舊檔名**：repo merge 前只盤點外部 entrypoint，並在人類檢查點②後取得 producer fence；合併前不改 invocation。外部 entrypoint 只從 merged `origin/main` 的 fresh worktree 切換。Unix identity 本身不在本 change 改名。
- **post-version / reader state 重新識別文章**：這是已接受的 breaking behavior；derived manifest 必須反映新 slugs，不能用 alias 偽裝舊 identity。
- **git-history generator 把舊 slug 長回來**：`post-versions` 目前會掃完整 history；rename 後必須先改 generator 以 current canonical post set 為輸出 domain，再重新產生，不能把歷史路徑當 live key。
- **Giscus thread mapping 失聯**：pathname 變更會使舊文章討論串不再自動接回；這是已接受的 breaking behavior，production smoke evidence 必須明確記錄，不能誤報為無影響。

## Live VM cutover

流程固定為 final human checkpoint② → producer fence → merge → external cutover。Repo migration 與外部 producer 必須用可回退的 stop-the-world cutover，避免 merge 前後仍有已退役 contract output 寫回：

1. Graceful stop Mogu Picks cron / daemon / queue producer；Tribunal 只在其 invocation path 受影響時一併停。
2. 不對現有 stale/dirty VM checkout 做 pull/reset；從 merged `origin/main` 建立 blue/green fresh worktree，舊 checkout 保留作 rollback evidence。
3. 透過 `openclaw cron`（SQLite-backed scheduler）修改 job；不得編輯已遷移的 `jobs.json` backup。新增 repo 外 `mp-writer.md`，更新 Shroom Feed enqueue path，再將 invocation 指向 Mogu / MP / `tools/gp-pipeline`；Unix user 與 filesystem coordinate 不改。
4. 跑一個不 publish 的 dry-run / canary，驗證只產生 canonical contract。
5. Resume producer 並監看第一輪輸出。

若 canary 失敗，producer 維持停止，job message 指回保留的舊 entrypoint 並跑舊 dry-run；通過後才恢復。不得刪除診斷 worktree、手改 scheduler SQLite/backup，或在新舊 contract 混合時繼續產稿。
