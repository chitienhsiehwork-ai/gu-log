# CONTRIBUTING.md — gu-log 寫作規範

> 這份文件定義新增文章的 conventions，給 Clawd 和其他 contributors 參考。

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

- **中文版**: `slug-name.mdx`
- **英文版**: `en-slug-name.mdx`

slug 使用 kebab-case，簡短描述文章內容。

### Frontmatter Schema

```yaml
---
ticketId: "SP-21"  # 文章編號
title: "文章標題"
date: "YYYY-MM-DD"
source: "@username on X"  # 或 "Platform Name"
sourceUrl: "https://..."
summary: "一兩句話摘要，會顯示在首頁 Toggle 預覽"
lang: "zh-tw"  # 或 "en"
tags: ["tag1", "tag2"]  # 用於分類和過濾
---
```

**必填欄位**: ticketId, title, date, source, sourceUrl, summary, lang

**選填欄位**: tags

### Ticket ID 編號系統

| Prefix | 全名 | 說明 |
|--------|------|------|
| **SD** | ShroomDog Original | ShroomDog 自己寫的原創文章 |
| **SP** | Shroom Picks | ShroomDog 挑選的文章，Clawd 翻譯 |
| **CP** | Clawd Picks | Clawd 自主挑選並翻譯的文章 |

**Counter 位置**: `scripts/article-counter.json`

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
4. Build & push

### translatedBy.model — 自動偵測

**不要猜 model 名稱！** 用 runtime 偵測：

```bash
# 在 sub-agent 中，先用 session_status 取得 model id，然後：
node scripts/detect-model.mjs anthropic/claude-opus-4-6
# Output: Opus 4.6
```

對應表（`scripts/detect-model.mjs`）：
- `claude-opus-4-6` → `Opus 4.6`
- `claude-opus-4-5` → `Opus 4.5`
- `claude-sonnet-4-5` → `Sonnet 4.5`
- `gemini-3-pro` → `Gemini 3 Pro`

**Validator 會 block** 不完整的 model 名稱（如 "Opus 4" 缺版本號）。

### 常見錯誤
- ❌ 看到 tweet 就開寫，沒先搜尋 → 造成重複文章
- ❌ 用「我記得是 SP-XX」而不是讀 counter → 編號衝突
- ❌ 忘記更新 counter → 下一篇又用同一編號
- ❌ 同一個 source tweet 寫成多篇 → 應該合併成 series

## Components

### ClawdNote — Clawd 吐槽/註解

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

**風格指南** (from TRANSLATION_PROMPT.md):
- 避免「維基百科式」的冷靜解釋
- 優先用吐槽、類比、或誇張手法讓資訊變有趣
- 可以想像自己是 PTT 鄉民在推文補充

### Toggle — 可收合內容

```mdx
import Toggle from '../../components/Toggle.astro';

<Toggle title="點擊展開">
隱藏的內容
</Toggle>
```

## 翻譯規則 (Quick Reference)

完整規則見 `TRANSLATION_PROMPT.md`，這裡列出重點：

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

### 測試檔案位置

```
tests/
├── toc.spec.ts         # TOC 展開/收合、scroll、links
├── clawd-note.spec.ts  # ClawdNote 展開/收合
└── post-page.spec.ts   # 文章頁面渲染
```

### BDD 測試格式

用 Given-When-Then 命名：
```typescript
test('GIVEN [前提] WHEN [動作] THEN [預期結果]', async ({ page }) => {
  // ...
});
```

## Workflow

### 新增文章 (Clawd)

1. 用 `bird read <url>` 抓取原文
2. 翻譯成 MDX，加入 ClawdNote 吐槽
3. 建立中文版 (`slug.mdx`) 和英文版 (`en-slug.mdx`)
4. `pnpm run build` 確認沒有錯誤
5. `git add -A && git commit && git push`

### Build & Preview

```bash
pnpm run dev      # 本地開發 (localhost:4321)
pnpm run build    # 生產 build
pnpm exec astro check  # TypeScript 檢查
```

## 目錄結構

```
src/content/posts/
├── article-name.mdx           # 中文版
├── en-article-name.mdx        # 英文版
├── another-article.mdx
└── en-another-article.mdx
```

首頁 (`src/pages/index.astro`) 會自動用 `getCollection()` 抓取 `lang: "zh-tw"` 的文章，依日期排序。

英文首頁 (`src/pages/en/index.astro`) 抓取 `lang: "en"` 的文章。

## Example: Minimal Post

```mdx
---
title: "文章標題"
date: "2026-02-02"
source: "@username on X"
sourceUrl: "https://x.com/username/status/123"
summary: "這篇文章在講什麼"
lang: "zh-tw"
tags: ["tag"]
---

import ClawdNote from '../../components/ClawdNote.astro';

這是文章內容。

<ClawdNote>
這是 Clawd 的吐槽 (◕‿◕)
</ClawdNote>
```

---

*Last updated: 2026-02-02*
