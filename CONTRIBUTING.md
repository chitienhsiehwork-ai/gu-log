# CONTRIBUTING.md — gu-log 寫作規範

> 這份文件定義新增文章的 conventions，給 Clawd 和其他 contributors 參考。
> 完整寫作風格見 `WRITING_GUIDELINES.md`（SSOT）。

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
ticketId: "SP-21"  # 文章編號
title: "文章標題"
originalDate: "YYYY-MM-DD"  # 原文發佈日（SD 系列 = 撰寫日）
translatedDate: "YYYY-MM-DD"  # 翻譯/發佈日
translatedBy:
  model: "Opus 4.6"  # 用 detect-model.mjs 偵測
  harness: "OpenClaw"
  pipeline:
    - role: "Translator"  # 或 "Author"（SD 系列）
      model: "Opus 4.6"
      harness: "Clawd"
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

- **SD** (ShroomDog Original) — ShroomDog 自己寫的原創文章
- **SP** (Shroom Picks) — ShroomDog 挑選的文章，Clawd 翻譯
- **CP** (Clawd Picks) — Clawd 自主挑選並翻譯的文章
- **Lv** (Level-Up) — 入門教學系列

**Counter 位置**: `scripts/article-counter.json`

### 並行撰寫防 ID collision：PENDING ticket pattern

**問題**：兩條 branch 同時在寫 SP/CP，如果都從 `article-counter.json` 讀當前 `next` 值（例如 SP-174），就會撞號——先 merge 的那條沒事，後 merge 的那條要改號、改檔名、改 cross-ref，一堆瑣事。

**SOP**：寫作階段一律用 `PENDING` 當 ticketId + 檔名前綴，**只在 merge 前最後一刻才 allocate 真號**。兩條 branch 各自用 `CP-PENDING` 沒衝突，等要上 main 時才各自跟 counter 要號。

**工作流程**：

```yaml
# 撰寫 / review / tribunal 階段的 frontmatter
ticketId: "CP-PENDING"   # 或 SP-PENDING / SD-PENDING / Lv-PENDING
```

檔名用：`<prefix>-pending-YYYYMMDD-<slug>.mdx`（zh-tw）、`en-<prefix>-pending-YYYYMMDD-<slug>.mdx`（en）

**Merge 前的 swap procedure**（四步，手動或交給 `sp-pipeline deploy`）：

1. `node -e "console.log(require('./scripts/article-counter.json').CP.next)"` 拿下一個真號
2. 改 frontmatter：`ticketId: "CP-PENDING"` → `ticketId: "CP-293"`（兩個檔案都改）
3. Rename 檔案：`cp-pending-20260414-foo.mdx` → `cp-293-20260414-foo.mdx`（兩個檔案都改）
4. Bump counter：`node -e "const fs=require('fs'); const c=JSON.parse(fs.readFileSync('scripts/article-counter.json')); c.CP.next++; fs.writeFileSync('scripts/article-counter.json', JSON.stringify(c,null,2)+'\n');"`
5. `node scripts/validate-posts.mjs` → commit swap → push 到 main

**自動化版本**：`tools/sp-pipeline/sp-pipeline deploy` 包辦整個 swap，在 pipeline orchestrated 流程裡自動跑。

**Gate 行為**：
- `validate-posts.mjs` 接受 `<PREFIX>-PENDING`，跳過 uniqueness 檢查（讓多條 branch 並行用 PENDING）
- `.githooks/pre-commit` 也跳過 PENDING 的 duplicate count 檢查
- `.githooks/pre-push` **阻擋** PENDING 推上 `main` / `master`——這是 SOP 的 safety net，防止 PENDING 誤入 production

**什麼時候可以跳過 PENDING？** 一條 branch 只有一篇、也沒有其他並行工作時，直接用真號也 OK。PENDING 是並行場景的防呆，不是強制規定。

---

### ⚠️ 新增文章前必做（防止重複）

**Step 1: 檢查是否已存在**
```bash
# 用 source URL 或關鍵字搜尋
grep -r "sourceUrl.*twitter\|x\.com.*STATUS_ID" src/content/posts/
grep -ri "AUTHOR_HANDLE\|TOPIC_KEYWORD" src/content/posts/*.mdx
```

**Step 2: 取得下一個 ticket ID**
```bash
cat scripts/article-counter.json | grep -A1 '"SP"' | grep next
# 或
node -e "console.log('SP-' + require('./scripts/article-counter.json').SP.next)"
```

**Step 3: 建立文章並更新 counter**
1. 用上面拿到的編號寫 frontmatter `ticketId: "SP-N"`
2. 建立 zh-tw 和 en 兩個檔案
3. **立即** 更新 counter：
```bash
node -e "const fs=require('fs'); const c=JSON.parse(fs.readFileSync('scripts/article-counter.json')); c.SP.next++; fs.writeFileSync('scripts/article-counter.json', JSON.stringify(c,null,2)+'\n');"
```
4. Validate & push

### translatedBy.model — 自動偵測

**不要猜 model 名稱！** 用 runtime 偵測：

```bash
node scripts/detect-model.mjs anthropic/claude-opus-4-6
# Output: Opus 4.6
```

**Validator 會 block** 不完整的 model 名稱（如 "Opus 4" 缺版本號）。

### 常見錯誤
- ❌ 看到 tweet 就開寫，沒先搜尋 → 造成重複文章
- ❌ 用「我記得是 SP-XX」而不是讀 counter → 編號衝突
- ❌ 忘記更新 counter → 下一篇又用同一編號
- ❌ 同一個 source tweet 寫成多篇 → 應該合併成 series

## Components

### ClawdNote — Clawd 吐槽/註解（所有系列通用）

```mdx
import ClawdNote from '../../components/ClawdNote.astro';

<ClawdNote>
這是我的吐槽內容，可以用 kaomoji (◕‿◕)
</ClawdNote>
```

**使用時機**:
- 補充原文沒說的 context
- 吐槽原作者
- 用台灣讀者熟悉的比喻解釋概念
- 加入幽默感

**風格指南** (from WRITING_GUIDELINES.md):
- 避免「維基百科式」的冷靜解釋
- 優先用吐槽、類比、或誇張手法讓資訊變有趣
- 可以想像自己是 PTT 鄉民在推文補充
- ❌ 不要用反問句問讀者顯而易見的答案

**密度目標**：每 ~25 行 prose 一個 ClawdNote

### ShroomDogNote — ShroomDog 本人的聲音（SD 系列專用）

```mdx
import ShroomDogNote from '../../components/ShroomDogNote.astro';

<ShroomDogNote>
ShroomDog 本人的觀點、origin story、個人經驗
</ShroomDogNote>
```

**使用時機**：SD 系列文章中，ShroomDog 本人想說的話（不是 Clawd 的吐槽）。

### 🔴 已棄用的 Note 類型

~~GeminiNote~~、~~CodexNote~~、~~ClaudeCodeNote~~ 已棄用並刪除（2026-03-17 CEO 決定，2026-03-23 移除）。

**原因**：讀者不在乎哪個 model 寫了哪段。所有 agent 觀點統一用 ClawdNote 發聲。

### Toggle — 可收合內容

```mdx
import Toggle from '../../components/Toggle.astro';

<Toggle title="點擊展開">
隱藏的內容
</Toggle>
```

## 寫作與翻譯規則 (Quick Reference)

完整規則見 `WRITING_GUIDELINES.md`，這裡列出重點：

### 通用規則（所有系列）
- 繁中版：口語化、PTT 說故事風、有梗
- 英文版：Simple English，非母語者也能讀
- 每篇文章必須產出 zh-tw + en 雙語版本
- ❌ 不要用反問句問讀者顯而易見的答案

### 術語處理
- 專有名詞保留英文，必要時括號加註中文
- 技術術語維持英文：API, SDK, SSH, E2E, etc.
- 縮寫第一次出現要展開

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

### 流程

1. **Scorer agent** 讀文章 + 評分標準（`scripts/vibe-scoring-standard.md`），給出三維分數：
   - **Persona**（李宏毅教授風格 0-10）
   - **ClawdNote**（吐槽品質 + 密度 0-10）
   - **Vibe**（整體可讀性 0-10）
2. **Pass bar**：≥ 8/8/8（all series）
3. 沒過 → **Rewriter agent** 改寫 → 再跑 scorer → 最多 3 次
4. 進度追蹤：`scores/tribunal-progress.json`（歷史資料在 `scores/archive/ralph-progress.json`）

### 工具

```bash
# 跑 Vibe scorer on a single file
bash scripts/vibe-scorer.sh <file>

# 跑 tribunal batch（動態掃描 posts/，newest-first）
bash scripts/tribunal-batch-runner.sh
```

### GPT 5.4 Fact-Check（四層驗證）

SP/CP 翻譯文章額外跑 GPT 5.4 fact-check：
1. **翻譯扭曲** — 翻譯有沒有改變原意？
2. **數字捏造** — 有沒有自己發明數據？
3. **原文 claim 驗證** — 原作者的說法本身正確嗎？
4. **錯誤 → ClawdNote 素材** — 發現的錯誤變成 ClawdNote 吐槽素材

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

- **Twitter/X threads**：確認你有全部推文。看 numbering（如 1/5, 2/5...），用 `bird replies <url>` 逐則追完整串
- **多頁文章**：確認不是只拿到第一頁
- **Paywall 內容**：確認穿透成功，不是拿到登入頁
- **影片/podcast**：確認有完整 transcript，不是只有標題和描述

**如果 source 不完整 → 停下來。不要硬寫。** 用部分內容灌水成一整篇文章是最差的結果 — 比沒有文章更糟，因為讀者會以為那就是全部的內容。

Pipeline agents：如果無法取得完整 source，output `INCOMPLETE_SOURCE: <reason>` 並 exit。讓 orchestrator 決定下一步（retry、換工具、skip）。

## Workflow

### zh-tw 優先 SOP（所有系列通用）

**寫作順序：zh-tw 先寫、先 iterate 到過分數，才翻英文。** 英文版是 zh-tw 穩定後的衍生品，不是並行產物。

**為什麼**：vibe-scorer 的迭代會改 persona、重寫 ClawdNote、動段落結構，每一輪都可能大改。如果同時維護 EN 版，等於在翻譯一個不穩定的 draft，浪費 token + 兩邊容易失同步。zh-tw 是 SSOT，先讓它過分數再說。

**例外**：如果你已經確定稿子不會再動（例如從別的過分數的稿子搬過來），可以一次兩版。這是權衡後的例外，不是預設。

### 新增翻譯文章 (SP/CP)

1. 抓原文：tweet 用 `bird read <url>`；blog/docs 用 `WebFetch`
2. 寫 **zh-tw 版** `<prefix>-pending-YYYYMMDD-<slug>.mdx`（加 ClawdNote 吐槽）
3. `node scripts/validate-posts.mjs` 確認 frontmatter 合格
4. 丟 **vibe-opus-scorer** subagent 評分 → 沒過就改寫，最多 3 輪
5. 過分數之後才翻 **en 版** `en-<prefix>-pending-YYYYMMDD-<slug>.mdx`
6. 再跑一次 `validate-posts.mjs` + `pnpm run build`
7. Merge 前把 PENDING swap 成真號（或交給 `sp-pipeline deploy`）
8. `git add` 指定檔案 → commit → push

### 新增原創文章 (SD)

1. Outline → 人類核准
2. 寫 **zh-tw 版** + ClawdNote + ShroomDogNote
3. 丟 **vibe-opus-scorer** 評分 → 沒過就改寫（pass bar: composite ≥ 8 AND 至少一維 ≥ 9 AND 無維 < 8）
4. GPT 5.4 fact-check（如適用）
5. 過分數後才翻 **en 版**
6. 更新 counter → validate → build → push

### SP Pipeline（自動翻譯流程）

```bash
# Canonical: the Go binary (self-compiling wrapper — first run cold-builds)
tools/sp-pipeline/sp-pipeline run <tweet_url>

# Backwards-compat: old bash entry point is a shim that execs into the Go binary.
bash scripts/sp-pipeline.sh <tweet_url>
```

自動流程：抓原文 → 評估 → dedup → 翻譯 → review → refine → credits → Ralph 評分 → commit。

單一 step 也可以直接 call：`tools/sp-pipeline/sp-pipeline fetch <url>` / `eval` / `write` / `review` / `refine` / `ralph` / `deploy`。每個 subcommand 都支援 `--json` 輸出。完整 exit code + flag 對照見 `tools/sp-pipeline/SKILL.md`。

### Validation

```bash
node scripts/validate-posts.mjs  # 驗證所有文章 frontmatter + 格式
pnpm run build                   # 完整 build 檢查
```

## 目錄結構

```
src/content/posts/
├── sp-123-20260322-slug.mdx          # SP 中文版
├── en-sp-123-20260322-slug.mdx       # SP 英文版
├── cp-198-20260322-slug.mdx          # CP 中文版  
├── en-cp-198-20260322-slug.mdx       # CP 英文版
├── sd-10-20260322-slug.mdx           # SD 中文版
├── en-sd-10-20260322-slug.mdx        # SD 英文版
└── lv-11-20260322-slug.mdx           # Lv 中文版
```

首頁 (`src/pages/index.astro`) 會自動用 `getCollection()` 抓取 `lang: "zh-tw"` 的文章，依日期排序。

英文首頁 (`src/pages/en/index.astro`) 抓取 `lang: "en"` 的文章。

---

*Last updated: 2026-03-23*
