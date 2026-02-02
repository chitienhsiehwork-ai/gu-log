# CONTRIBUTING.md — gu-log 寫作規範

> 這份文件定義新增文章的 conventions，給 Clawd 和其他 contributors 參考。

## 文章結構

所有文章放在 `src/content/posts/` 目錄下，使用 MDX 格式。

### 檔案命名

- **中文版**: `slug-name.mdx`
- **英文版**: `en-slug-name.mdx`

slug 使用 kebab-case，簡短描述文章內容。

### Frontmatter Schema

```yaml
---
title: "文章標題"
date: "YYYY-MM-DD"
source: "@username on X"  # 或 "Platform Name"
sourceUrl: "https://..."
summary: "一兩句話摘要，會顯示在首頁 Toggle 預覽"
lang: "zh-tw"  # 或 "en"
tags: ["tag1", "tag2"]  # 用於分類和過濾
---
```

**必填欄位**: title, date, source, sourceUrl, summary, lang

**選填欄位**: tags

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

## Workflow

### 新增文章 (Clawd)

1. 用 `bird read <url>` 抓取原文
2. 翻譯成 MDX，加入 ClawdNote 吐槽
3. 建立中文版 (`slug.mdx`) 和英文版 (`en-slug.mdx`)
4. `npm run build` 確認沒有錯誤
5. `git add -A && git commit && git push`

### Build & Preview

```bash
npm run dev      # 本地開發 (localhost:4321)
npm run build    # 生產 build
npx astro check  # TypeScript 檢查
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
