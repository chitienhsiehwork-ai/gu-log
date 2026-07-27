# CONTRIBUTING.md — gu-log 寫作規範

> 這份文件定義新增文章的 conventions，給 Mogu 和其他 contributors 參考。
> 完整寫作風格見 `GU-LOG_WRITER_PROMPT.md`（SSOT）。
> 編輯 first-principles 的 SSOT 是 [`editorial-charter` spec](openspec/specs/editorial-charter/spec.md)；本文件只保留可執行 conventions。
> ShroomDog 修稿回饋 corpus 見 `docs/shroomdog-editorial-feedback.md`。
> 這份是內容規則的 SSOT；`AGENTS.md` 路由表指向這裡。

## 🎯 兩層品質門檻：floor ≥3 才能 ship，PASS ≥8 才上首頁（2026-06-10 起）

> 消費端行為（sub-8 照常發佈、首頁排除、精修中 banner、grandfather 例外、tribunal FAIL 對 pipeline 只是 advisory）的 formal spec 是 [`openspec/specs/publish-bar-visibility/spec.md`](openspec/specs/publish-bar-visibility/spec.md)；PASS bar 怎麼算則見 `openspec/specs/tribunal-scoring-dimensions/spec.md`。本節是人話摘要（derived view），判定語意對不上時以 spec 與 code 為準。

gu-log 的品質把關**分兩層**，不要再把它當成「沒過 8 就不准 commit」的單一硬門檻：

| 層 | 門檻 | 誰擋 | 沒過會怎樣 |
|---|---|---|---|
| **Floor（自動 gate）** | scores.vibe 在 + 該版本要求的 vibe 維齊（v9 = 4 維 persona/moguNote/vibe/narrative；v8 = 5 維含 clarity）+ **composite ≥ 3** | pre-commit hook（`scripts/score-floor-check.mjs`） | **擋 commit**。garbage(<3) 跟無分數一律進不了 main |
| **PASS（編輯標準）** | composite ≥ 8 AND 一維 ≥ 9 AND 沒有維 < 8 | UI / 首頁過濾，不是 commit blocker | sub-8 **照樣 ship**，但加「精修中」badge + **不上首頁/featured**，等背景 tribunal 拉到 ≥8 才上 |

**白話**：

- **≥3 就能 commit、能 ship**。一篇 5/10 的文章不會被 hook 擋——它會帶著 tribunal 分數公開顯示（讀者看得到 good/bad 長怎樣，這是 gu-log 的透明度賣點），但**不會出現在首頁**，會被 `getIndexPosts()` 過濾掉，並掛上「精修中」badge。
- **首頁/featured 只放 ≥8 的**。背景 tribunal（有 quota 時跑）把 sub-8 重寫拉到 ≥8，分數一過門檻就自動上首頁。
- **<3 或沒分數一律擋**。那是 garbage（GP-110 那種無聊到 cringe），連當反面教材都不值得公開。
- **歷史文章 grandfathered**：沒有 scores block 的舊文不受影響（照常顯示在首頁），但**一旦 reader-visible 內容被改寫（不是純連結維護），就會觸發 floor gate**，要補一個 ≥3 的 scores.vibe 才能 commit。

**所以「把 FAIL score 寫進 frontmatter」現在是 OK 的**——只要 ≥3。它不再等於「假裝完成」，因為 badge + 首頁隔離會誠實地把它標成「還沒到 featured 水準」。Tribunal 仍然是 reviewer 不是 logger：**有 quota 就該把 sub-8 往 ≥8 推**，但這是背景精修的工作，不是 ship 的硬前提。

**還是要做的事（只是不再 block ship）**：

- 寫新文章時，仍然先跑 tribunal / `vibe-score` skill 拿到真分數塞進 frontmatter（≥3 才能 commit）。
- 分數 6-7 又剛好有 quota → 呼叫 `tribunal-writer` subagent 重寫修 reasons 點出的維度 → 重跑 → 最多 3 輪，能拉到 ≥8 就上首頁。拉不動就先帶 sub-8 badge ship，排進背景 tribunal 佇列。
- **不要為了過 floor 把分數灌水**。score-floor-check 只看 composite ≥3，但灌一個假的 8 進去比誠實標 5 更糟——badge 機制的前提是分數誠實。

**為什麼改成這樣**：

- 單一硬門檻（沒過 8 不准 ship）會讓 velocity 卡死在「每篇都要 iterate 到 8」。改成 floor + 透明 badge 後，velocity 回來了，品質靠「公開分數 + 首頁只放 ≥8 + 背景精修」維持，而不是靠 block。
- gu-log 寫的就是 AI 品質，**把 AI 自評分數攤在陽光下、連 sub-8 的也誠實標記**，本身就是這個 blog 的調性。
- 背景 tribunal 可以排程慢慢把存量往上拉，不用塞在 ship 的關鍵路徑上。

實作介面：自動 gate = `scripts/score-floor-check.mjs`（pre-commit 呼叫）；首頁過濾 = `getIndexPosts()`（`src/utils/post-status.ts`）；badge = `Sub8RefiningBanner.astro`；composite 計算 = `src/utils/tribunal-scores.ts`。重寫 loop：local Claude actor（例如 `m1-cc`）有 `bash scripts/tribunal-batch-runner.sh`、CCC 可以呼叫 `tribunal-writer` agent + `vibe-scorer.sh`。

## 📝 Markdown 文件語言：預設繁中

除非 user 明確要求英文，repo 內所有 `.md` prose 都預設寫成繁體中文，包含 OpenSpec artifacts、design docs、tasks、runbook、README 類文件。user 會等真的有英文讀者 / i18n 需求時再做英文版，現在不要搶先翻英文。

保留必要 English technical terms、檔名、路徑、指令、config key、model ID、permission label、exact UI label，以及 spec reserved words（例如 MUST、SHALL、SHOULD、MAY、NOT、Requirement、Scenario、GIVEN、WHEN、THEN、AND）。不要為了翻譯而把 `git`、`API`、`CLI`、`branch protection`、`auto-merge` 這類術語翻得很彆扭。

**術語決策規則**：如果中文譯法讀起來像硬翻論文腔（例：「擴展測試時運算」），不要直接送出。三選一：保留 canonical English term 並補 glossary、改成自然中文解釋、或標成 terminology decision 交給 ShroomDog / Librarian 判斷。這類問題不是小潤稿，是 gu-log 長期詞彙風格的一部分。

**晶晶體 accepted-English boundary**：`scripts/check-jingjing.mjs` / `src/data/glossary.json` 負責 deterministic enforcement，但可接受 English terms 的新增或移除 SHALL 每次都先與 ShroomDog 討論。這會直接影響閱讀流與語感，不能由 agent 自行擴張或收縮 allowlist。

## 🔗 GP candidate / source evaluation：先判斷「寫什麼」和「不要寫什麼」

ShroomDog 丟外部連結時，先判斷它能不能做成 gu-log；Go 之前一定要先做 overlap evaluation，明確列出：

1. **這次的新東西是什麼**：source 有哪些 gu-log 還沒寫過的事實、結構、平台訊號、產品變化、案例、數字、方法或觀點。
2. **哪些已經被 gu-log 寫過**：搜尋既有 GP/MP/SD/Lv、glossary、MoguNote/ShroomDogNote，標出已覆蓋內容與對應文章。
3. **這篇應該避開什麼**：不要重講既有解釋、比喻、背景知識或結論；必要時只用一句話 recap 並內鏈舊文。
4. **最後才決定 angle**：把文章建立在新增資訊與新增 framing 上，而不是把同一套內容換皮重寫。

Duplicate content is duplicate dead code：對 AI 是 token waste，對人類是 attention waste。gu-log 的文章不是資料庫去重失敗的備份檔；每篇都要有新的資訊增量、判斷增量或敘事增量。

- **「原文已是中文 / 簡體中文分析文」不是 No-go 理由**：gu-log 的價值包含繁體中文、故事性、MoguNote、ShroomDog/Mogu 的讀者脈絡與重新編排，不是只有翻譯語言。
- **「二手整理」不是 No-go 理由**：可以重寫、改編、整理脈絡、引用原文；只要 attribution 清楚、來源可靠、讀者價值夠，就可以寫。
- **「需要驗證數字 / 來源」不是 No-go 理由**：驗證是 agent 的工作。只有驗證後發現 facts 不可靠、無法查證、來源不完整，或支撐不了 8/8/8 publish bar，才可以 No-go。
- 正確流程：讀完整 source → 必要時查 primary sources → 搜尋 gu-log 既有覆蓋 → 判斷 narrative potential / reader value / source reliability / novelty → Go 就用 gu-log 風格重寫並 cite；No-go 要講真正原因。

這條規則的 editorial feedback 原文也記在 `docs/shroomdog-editorial-feedback.md`。未來更新 source-evaluation 類回饋時，兩邊要保持一致：`CONTRIBUTING.md` 放 general rule，editorial feedback corpus 放具體案例和 reusable lesson。

## 🔍 事實查核紀律：AI tooling 的 claim 必須 verify

gu-log 寫的就是 AI / agent / tooling 圈，這個圈子有兩個特性：
1. **變動極快**：上週的事實這週可能就過時
2. **詞彙混亂**：open source、source-available、permissive license、bundled、SDK、CLI、API 容易混為一談

所以對 AI tooling 相關的事實聲明（哪個東西是不是開源、誰收購了誰、哪個 model 何時發布、某個產品支不支援某個 feature），**不要從記憶或直覺答**。要 verify。

**特別容易踩的雷**（已踩過、不要再踩）：

- **Claude Code 是 closed source**，不是 open source、也不是 source-available。GitHub 的 `anthropics/claude-code` repo 只有 plugins / examples / scripts，**核心 CLI 原始碼不在 repo 裡**，是 npm bundled 發布的閉源軟體。License: `© Anthropic PBC. All rights reserved.`
- **Claude Agent SDK** 是另一個專案（Python/TypeScript，MIT License），跟 Claude Code 不一樣，不要混為一談。
- 2026-03-31 那次 512k 行原始碼洩漏，是 npm 發布時缺 `.npmignore` 導致 source map 意外曝光，**不是**駭客入侵也**不是**官方開源。

**操作原則**：

- 寫 glossary、寫文章、跟 user 對話時，AI tooling 相關事實都要 verify
- **⚠️ `WebFetch` 會偷偷摘要，不是原文**：WebFetch 會把 HTML 丟給一個小 model 濃縮後才回傳，**常常漏掉具體 examples、數字、邊界條件**（實測 Anthropic blog 的 `create_issue_from_thread` 例子、`Cloudflare ~2,500 endpoints in ~1K tokens`、elicitation form/URL mode 區別都被摘掉）。**GP/MP 翻譯任務、引述原文、事實查核一律用 `curl -sL -A "Mozilla/5.0..." <url>` 抓原始 HTML 再解析**；WebFetch 只適合「這頁大概在講什麼」這種粗粒度判斷。翻譯基於 WebFetch 輸出 = 基於二手摘要，必踩雷。
- **Subagent 的事實結論要自己驗證一次**：subagent 也會用聽起來合理但錯的詞（例如把 closed source 說成 source-available）。看到關鍵 claim 就 fetch 一次原始碼或 license 確認
- 完整時間線參考 `src/data/glossary.json` 的 Claude Code 條目

## Package manager policy

- 本 repo 僅使用 **pnpm**。
- 變更 dependencies 時，必須同步提交 `pnpm-lock.yaml`。
- 不使用 `package-lock.json`。

## Security gate policy（Level 4）

### Gate 指令

```bash
pnpm run security:gate
```

CI 會 blocking 執行這個 gate：
- 出現 **new high/critical** 且不在 allowlist → PR fail
- allowlist 過期 → 不可放行（視同 fail）

### 分級治理策略

- **runtime/prod 依賴**：高風險優先修復（allowlist 最長 14 天）
- **dev 依賴**：可短期容忍，但要有追蹤（allowlist 最長 45 天）

### Allowlist 維護規範

檔案：`quality/security-allowlist.json`

每筆至少包含：
- `id`（建議填 npm advisory id）和/或 `name`
- `reason`（為什麼暫時放行）
- `expiresAt`（ISO 日期時間，例如 `2026-03-31T00:00:00Z`）

維護原則：
1. 新增例外時，先寫清楚「暫時放行原因」與到期日
2. 到期後不可續用同一筆 entry 混過 gate，必須更新依賴或重新評估
3. 盡量縮短 runtime 例外期限，避免高風險長期堆積

## 文章結構

所有文章放在 `src/content/posts/` 目錄下，使用 MDX 格式。

### 檔案命名

- **中文版**: `{prefix}-{N}-{date}-{slug}.mdx`
- **英文版**: `en-{prefix}-{N}-{date}-{slug}.mdx`

slug 使用 kebab-case，簡短描述文章內容。

### Frontmatter Schema

```yaml
---
ticketId: "GP-21"  # 文章編號
title: "文章標題"
originalDate: "YYYY-MM-DD"  # 原文發佈日（SD 系列 = 撰寫日）
translatedDate: "YYYY-MM-DD"  # 翻譯/發佈日
translatedBy:
  model: "<detect-model output>"  # 必須換成 detect-model.mjs 的實際輸出
  harness: "OpenClaw"
  pipeline:
    - role: "Translator"  # 或 "Author"（SD 系列）
      model: "<detect-model output>"
      harness: "Mogu"
source: "@username on X"  # 或 "ShroomDog Lab"（SD 系列）
sourceUrl: "https://..."
lang: "zh-tw"  # 或 "en"
summary: "一兩句話摘要，會顯示在首頁 Toggle 預覽"
tags: ["tag1", "tag2"]  # 用於分類和過濾
---
```

**必填欄位**: ticketId, title, originalDate, translatedDate, translatedBy, source, sourceUrl, summary, lang

**選填欄位**: tags

### Ticket ID 編號系統

正式 prefix 是 **SD**、**GP**、**MP**、**Lv**；各系列的編輯身份與 fidelity 義務以 [`editorial-charter` spec](openspec/specs/editorial-charter/spec.md) 為準，本節只定義編號 mechanics。

**Counter 位置**: `scripts/article-counter.json`

### 編號分配：PENDING ticket pattern（預設流程）

**這是新文章的預設做法，不是並行才用的特例。** 不管手邊有沒有別篇在寫，新文章一律先用 `PENDING`，**只在 merge 前最後一刻才 allocate 真號**。把「給號」這件事推到流程最尾端，是因為早給號只有壞處、沒有好處：

- **撞號**：兩條 branch 同時寫，如果都先讀 `article-counter.json` 的 `next`（例如 GP-232）就會撞號——先 merge 的沒事，後 merge 的要改號、改檔名、改 cross-ref，一堆瑣事。
- **counter merge conflict**：早給號 = 早 bump counter，每條 branch 都改 `article-counter.json` 同一行，必衝突。留到最後一刻才 bump，衝突視窗縮到趨近於零。
- **白寫**：一篇文章可能 tribunal 沒過、被 user 喊卡而不上 main。早給的號就空掉了，counter 出現跳號。

用 `PENDING` 寫作期間，每條 branch 各自掛 `GP-PENDING` 互不衝突；等真的要上 main，才各自跟 counter 要一個當下最新的號。**單篇、沒有並行工作時也照走 PENDING**——流程一致，不用每次判斷「這次要不要防呆」。

**工作流程**：

```yaml
# 撰寫 / review / tribunal 階段的 frontmatter
ticketId: "MP-PENDING"   # 或 GP-PENDING / SD-PENDING / Lv-PENDING
```

檔名用：`<prefix>-pending-YYYYMMDD-<slug>.mdx`（zh-tw）、`en-<prefix>-pending-YYYYMMDD-<slug>.mdx`（en）

**Merge 前的 swap：一個指令搞定**（手寫 / CCC 路徑）

```bash
# 自動偵測唯一一組 PENDING 文章；多組時用 prefix 或 slug 指定
node scripts/allocate-ticket.mjs            # 只有一組 PENDING 時
node scripts/allocate-ticket.mjs GP         # 多個 prefix 有 PENDING 時，挑 GP
node scripts/allocate-ticket.mjs polished-ui-rules   # 同 prefix 多篇時，用 slug 區分
node scripts/allocate-ticket.mjs GP --dry-run        # 先預覽不動檔案
```

`allocate-ticket.mjs` 做的就是「給號」這一件事、而且**只做這件事**：讀 counter → 把 `GP-PENDING` 換成 `GP-N`（zh-tw + en 兩個檔案的 frontmatter）→ rename 檔名（`gp-pending-…` → `gp-N-…`，你選的日期跟 slug 原封不動保留）→ bump counter → 跑 `validate-posts.mjs`。**它不 commit、不 build、不 push**——所以你可以把它當 merge 前的最後一步，產出一個乾淨的「swap PENDING → GP-N」atomic commit，這時 counter 是最新的。

四步手動版（script 壞了時的 fallback）：
1. `node -e "console.log(require('./scripts/article-counter.json').GP.next)"` 拿下一個真號
2. 改 frontmatter：`ticketId: "GP-PENDING"` → `ticketId: "GP-232"`（兩個檔案都改）
3. Rename 檔案：`gp-pending-20260617-foo.mdx` → `gp-232-20260617-foo.mdx`（兩個檔案都改）
4. Bump counter + `node scripts/validate-posts.mjs` → commit swap

**Pipeline 版本**：`tools/gp-pipeline/gp-pipeline run`／`gp-pipeline deploy` 包辦整個 swap（連 commit / build / push 一起），在 orchestrated 流程裡自動跑——write 階段預設就寫 `PENDING`（`internal/pipeline/write.go`），deploy 階段才 allocate（`internal/deploy/deploy.go`）。手寫路徑想要「只 swap、commit 留給自己」時用上面的 `allocate-ticket.mjs`。

**Gate 行為**：
- `validate-posts.mjs` 接受 `<PREFIX>-PENDING`，跳過 uniqueness 檢查（讓多條 branch 並行用 PENDING）
- `.githooks/pre-commit` 也跳過 PENDING 的 duplicate count 檢查
- `.githooks/pre-push` **阻擋** PENDING 推上 `main` / `master`——這是 SOP 的 safety net，防止 PENDING 誤入 production

**什麼時候可以跳過 PENDING？** 幾乎不需要。預設一律走 PENDING（流程一致、不用每次判斷）。真的只有「100% 確定沒有任何並行工作、而且你就是要立刻給號」時，直接用真號才不算錯——但這沒有省到什麼，還得自己記得 bump counter，所以不建議當習慣。**有疑慮就用 PENDING。**

---

### ⚠️ 新增文章前必做（防止重複）

**Step 1: 檢查是否已存在**
```bash
# 用 source URL 或關鍵字搜尋
grep -r "sourceUrl.*twitter\|x\.com.*STATUS_ID" src/content/posts/
grep -ri "AUTHOR_HANDLE\|TOPIC_KEYWORD" src/content/posts/*.mdx
```

**Step 2: 用 PENDING 開檔（不要現在給號、不要碰 counter）**

frontmatter 寫 `ticketId: "GP-PENDING"`，檔名用 `gp-pending-YYYYMMDD-<slug>.mdx`（en 版 `en-gp-pending-…`）。**這一步不讀 counter、不 bump counter**——給號是 merge 前最後一刻的事，見上面〈編號分配：PENDING ticket pattern〉。

**Step 3: 建立文章 → tribunal → commit（仍然是 PENDING）**
1. 建立 zh-tw 和 en 兩個檔案，frontmatter 都掛 `GP-PENDING`
2. 跑品質 gate（validate / jingjing / pronoun / tribunal），分數寫進 frontmatter
3. Commit + push + 開 PR——**整路都還是 PENDING**（pre-push 只擋 PENDING 進 main/master，feature branch 照常）

**Step 4: merge 前最後一刻才 allocate 真號**

CI 綠、要合的那一刻才 `node scripts/allocate-ticket.mjs GP`（swap + rename + bump counter），產出一個獨立的「swap PENDING → GP-N」commit，然後 merge。這時讀到的 counter 是最新的，撞號跟 counter conflict 的視窗趨近於零。

### translatedBy.model — 自動偵測

**不要猜 model 名稱！** 用 runtime 偵測：

```bash
node scripts/detect-model.mjs "$ACTUAL_MODEL_ID"
```

把 runtime 實際使用的完整 model ID 放進 `ACTUAL_MODEL_ID`；輸出才是 frontmatter 應記錄的 display name。**Validator 會 block** 不完整的 model 名稱（如 "Opus 4" 缺版本號）。

### 常見錯誤
- ❌ 看到 tweet 就開寫，沒先搜尋 → 造成重複文章
- ❌ 寫作階段就給真號（而不是 `PENDING`）→ 跟並行的 branch 撞號、counter merge conflict
- ❌ 早早 bump counter → 文章如果沒上 main，號就空掉、counter 跳號
- ❌ 用「我記得是 GP-XX」硬給號 → 編號衝突（正解：`allocate-ticket.mjs` 在 merge 前讀當下的 counter）
- ❌ 同一個 source tweet 寫成多篇 → 應該合併成 series

## Components

### MoguNote — Mogu 吐槽/註解（所有系列通用）

```mdx
import MoguNote from '../../components/MoguNote.astro';

<MoguNote>
這是我的吐槽內容，可以用 kaomoji (◕‿◕)
</MoguNote>
```

**使用時機**:
- 補充原文沒說的 context
- 吐槽原作者
- 用台灣讀者熟悉的比喻解釋概念
- 加入幽默感
- 承接 GP body 不該放的 source-meta commentary 或 Mogu/gu-log opinion

MoguNote 與翻譯 body 的 first-principles 邊界以 [`editorial-charter` spec](openspec/specs/editorial-charter/spec.md) 為準；下列只是在文章裡落實該邊界的 style guidance。

**風格指南** (from GU-LOG_WRITER_PROMPT.md):
- 避免「維基百科式」的冷靜解釋
- 優先用吐槽、類比、或誇張手法讓資訊變有趣
- 可以想像自己是 PTT 鄉民在推文補充
- ❌ 不要用反問句問讀者顯而易見的答案
- 可驗證 facts 要有來源或保守措辭；推測要明示是推測；不要把 source-limited claim 寫成 verified fact

**密度目標**：每 ~25 行 prose 一個 MoguNote

### ShroomDogNote — ShroomDog 本人的聲音（SD 系列專用）

```mdx
import ShroomDogNote from '../../components/ShroomDogNote.astro';

<ShroomDogNote>
ShroomDog 本人的觀點、origin story、個人經驗
</ShroomDogNote>
```

**使用時機**：SD 系列文章中，ShroomDog 本人想說的話（不是 Mogu 的吐槽）。

### 🔴 已棄用的 Note 類型

~~GeminiNote~~、~~CodexNote~~、~~ClaudeCodeNote~~ 已棄用並刪除（2026-03-17 CEO 決定，2026-03-23 移除）。

**原因**：讀者不在乎哪個 model 寫了哪段。所有 agent 觀點統一用 MoguNote 發聲。

### Toggle — 可收合內容

```mdx
import Toggle from '../../components/Toggle.astro';

<Toggle title="點擊展開">
隱藏的內容
</Toggle>
```

## 寫作與翻譯規則 (Quick Reference)

編輯身份與忠實邊界見 [`editorial-charter` spec](openspec/specs/editorial-charter/spec.md)，完整 operational style 見 `GU-LOG_WRITER_PROMPT.md`；這裡只列 quick reference：

### 通用規則（所有系列）
- 繁中版：口語化、PTT 說故事風、有梗
- 英文版：Simple English，非母語者也能讀
- 每篇文章必須產出 zh-tw + en 雙語版本
- GP body 不用「原作者說 / 原文提到 / 這篇文章在講」這類 source-meta scaffolding；讀者已經看得到 `原文出處：`。必要 evidence boundary 要寫成自然句，Mogu/gu-log commentary 放 `<MoguNote>`。
- ❌ 不要用反問句問讀者顯而易見的答案

### 術語處理

SSOT = `GU-LOG_WRITER_PROMPT.md` 的「術語處理」；此處只是 derived view。

- zh-tw 正文的英文預設翻成自然台灣中文，不在 glossary / allowlist 的英文都要翻
- 只有 `src/data/glossary.json` 已收錄的 term、產品名、公司名、人名、模型名、code identifier、protocol 名、URL、版本號等必要專有名詞才保留英文
- 程式碼、CLI 指令、config key、檔名、路徑、UI label 維持原樣不翻
- 縮寫第一次出現若會影響理解，要展開或用自然中文補一句

### 程式碼
- 程式碼本體、CLI 指令 → 維持原樣不翻
- 程式碼前後的說明文字 → 正常翻譯
- 程式碼內的註解 → 預設不翻

### Kaomoji（推薦）

```
(◕‿◕) (￣▽￣)／ ╰(°▽°)╯ (๑•̀ㅂ•́)و✧ 
(｡◕‿◕｡) ヽ(°〇°)ﾉ (⌐■_■) (╯°□°)╯ 
┐(￣ヘ￣)┌ (¬‿¬) ٩(◕‿◕｡)۶ 
ʕ•ᴥ•ʔ (ง •̀_•́)ง
```

**避免使用** (顯示不好看):
```
(ﾉ∀`*) (つ✧ω✧)つ (๑•́ ₃ •̀๑)
```

## 品質管理：Tribunal

gu-log 使用 tribunal 進行品質管理——一個 multi-agent scoring + rewrite 系統（`tribunal-batch-runner.sh` 批次掃描、`tribunal-all-claude.sh` 單篇執行）。

> ⚠️ 評審維度 / pass bar / model routing 都是 **derived view**，會 drift——權威端：`docs/tribunal-runbook.md`（跑法 + daemon）、`scripts/vibe-scoring-standard.md`（評分標準）、tribunal runtime config（Codex model）與 `.claude/agents/*.md` 的 `model:` frontmatter（Claude role selector）。現行是 **v9 四維 Vibe（Persona / MoguNote / Vibe / Narrative）+ Fact / Librarian / Fresh Eyes 多 judge**；完整 pass bar 見 `AGENTS.md`〈Quality〉摘要或 tribunal-runbook 全文。

1. **Scorer + 多 judge** 讀文章 + 評分標準 → 給分。
2. 沒過 → **Rewriter agent** 改寫 → 再跑 → 最多 3 次。

### 工具

```bash
# 跑 Vibe scorer on a single file
bash scripts/vibe-scorer.sh <file>

# 跑 tribunal batch（動態掃描 posts/，newest-first）
bash scripts/tribunal-batch-runner.sh
```

### Fact Checker（來源與翻譯驗證）

GP/MP 翻譯文章要跟完整 Tribunal 一起跑 Fact Checker，確認事實、翻譯忠實度，以及 source body 與 Mogu/gu-log commentary 的邊界。Fact Checker contract 以 `.claude/agents/fact-checker.md` 為準；model routing 依上節列出的 provider-specific 來源，本節不複製會 drift 的值。

## BDD Testing

**規則：每個 bug = 一個新 BDD test**

當使用者報告 bug 時：
1. 先寫一個 test 來重現 bug（test 應該是紅的）
2. 修 bug
3. Test 變綠 = bug 修好
4. 這個 test 永遠留著，防止 regression

### 測試指令

```bash
pnpm run test        # 跑所有 BDD tests
pnpm run test:toc    # 只跑 TOC 相關測試
pnpm run test:ui     # 開 Playwright UI（本地開發用）
```

### BDD 測試格式

用 Given-When-Then 命名：
```typescript
test('GIVEN [前提] WHEN [動作] THEN [預期結果]', async ({ page }) => {
  // ...
});
```

## Source Completeness（寫之前必讀）

**在動筆之前，必須確認你拿到的是完整的 source material。**

- **Twitter/X threads**：載入 `x-source-fetch`，跑 `bash scripts/fetch-x-article.sh <url>`。若來源明顯是 self-thread，確認輸出有 `Thread: N tweets` 與對應的 `THREAD N/M` 段落；只拿到 focal tweet 就視為 source 不完整並停止寫作
- **多頁文章**：確認不是只拿到第一頁
- **Paywall 內容**：確認穿透成功，不是拿到登入頁
- **影片/podcast**：確認有完整 transcript，不是只有標題和描述

**如果 source 不完整 → 停下來。不要硬寫。** 用部分內容灌水成一整篇文章是最差的結果 — 比沒有文章更糟，因為讀者會以為那就是全部的內容。

Pipeline agents：如果無法取得完整 source，output `INCOMPLETE_SOURCE: <reason>` 並 exit。讓 orchestrator 決定下一步（retry、換工具、skip）。

## Workflow

### zh-tw 優先 SOP（所有系列通用）

**寫作順序：zh-tw 先寫、先 iterate 到過分數，才翻英文。** 英文版是 zh-tw 穩定後的衍生品，不是並行產物。

**為什麼**：vibe-scorer 的迭代會改 persona、重寫 MoguNote、動段落結構，每一輪都可能大改。如果同時維護 EN 版，等於在翻譯一個不穩定的 draft，浪費 token + 兩邊容易失同步。zh-tw 是 SSOT，先讓它過分數再說。

**例外**：如果你已經確定稿子不會再動（例如從別的過分數的稿子搬過來），可以一次兩版。這是權衡後的例外，不是預設。

### 新增翻譯文章 (GP/MP)

1. 抓原文：X/Twitter 用 `x-source-fetch` skill；一般 blog/docs 用 `curl -sL -A "Mozilla/5.0..." <url>` 抓原始 HTML 再解析，不用 `WebFetch` 當翻譯依據
2. 寫 **zh-tw 版** `<prefix>-pending-YYYYMMDD-<slug>.mdx`（加 MoguNote 吐槽）
3. `node scripts/validate-posts.mjs` 確認 frontmatter 合格
4. 丟 **vibe-opus-scorer** subagent 評分 → 沒過就改寫，最多 3 輪
5. 過分數之後才翻 **en 版** `en-<prefix>-pending-YYYYMMDD-<slug>.mdx`
6. 再跑一次 `validate-posts.mjs` + `pnpm run build`
7. Merge 前把 PENDING swap 成真號（或交給 `gp-pipeline deploy`）
8. `git add` 指定檔案 → commit → push

### 新增原創文章 (SD)

1. Outline → 人類核准
2. 寫 **zh-tw 版** + MoguNote + ShroomDogNote
3. 丟 **vibe-opus-scorer** 評分 → 沒過就改寫（pass bar: composite ≥ 8 AND 至少一維 ≥ 9 AND 無維 < 8）
4. 跑 Tribunal Fact Checker（如適用）
5. 過分數後才翻 **en 版**
6. 更新 counter → validate → build → push

### GP Pipeline（自動翻譯流程）

```bash
# Canonical: the Go binary (self-compiling wrapper — first run cold-builds)
tools/gp-pipeline/gp-pipeline run <tweet_url>

```

自動流程：抓原文 → 評估 → dedup → 寫 zh-tw 稿 → review → refine → credits → Ralph 評分 → **translate（只在過分數時觸發，產出 en sidecar）** → commit。

單一 step 也可以直接 call：`tools/gp-pipeline/gp-pipeline fetch <url>` / `eval` / `write` / `review` / `refine` / `ralph` / `deploy`。每個 subcommand 都支援 `--json` 輸出。完整 exit code + flag 對照見 `tools/gp-pipeline/SKILL.md`。

### Validation

```bash
node scripts/validate-posts.mjs  # 驗證所有文章 frontmatter + 格式
pnpm run build                   # 完整 build 檢查
```

## 目錄結構

```
src/content/posts/
├── gp-123-20260322-slug.mdx          # GP 中文版
├── en-gp-123-20260322-slug.mdx       # GP 英文版
├── mp-198-20260322-slug.mdx          # MP 中文版
├── en-mp-198-20260322-slug.mdx       # MP 英文版
├── sd-10-20260322-slug.mdx           # SD 中文版
├── en-sd-10-20260322-slug.mdx        # SD 英文版
└── lv-11-20260322-slug.mdx           # Lv 中文版
```

首頁 (`src/pages/index.astro`) 會自動用 `getCollection()` 抓取 `lang: "zh-tw"` 的文章，依日期排序。

英文首頁 (`src/pages/en/index.astro`) 抓取 `lang: "en"` 的文章。
