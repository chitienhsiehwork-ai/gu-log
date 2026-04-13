# Obsidian Setup（iPhone + Mac + iCloud）

> 用 Obsidian 當 gu-log 的「草稿編輯器」，**不取代** Astro / Vercel pipeline。iPhone 上寫草稿 → Mac 上 import → 跑 Ralph Loop → `git push`。

## 為什麼這樣分工

- **iPhone**：只負責寫草稿。純 markdown + Obsidian callout。iCloud Drive 自動同步，沒有 git、沒有 terminal、沒有 conflict。
- **Mac**：負責把草稿 import 成 MDX（含 frontmatter、component、ticket ID）、跑品質 tribunal、push。
- **線上**：`gu-log.vercel.app` 正式版。你可以在 iPhone 上同時開 Obsidian（看原始草稿）和 Vercel（看成品），比較 frontend 帶來的加值——字型、TOC、Solarized 主題、ClawdNote 的吐槽框 render、reading progress、系列導覽。

## 一次性設定

### 1. iCloud Drive：建草稿資料夾

在 Mac 上：

```
~/Library/Mobile Documents/com~apple~CloudDocs/Obsidian/gu-log-drafts/
```

或從 Finder 打開 **iCloud Drive**，新建 `Obsidian/gu-log-drafts/`。

**⚠️ 不要把整個 gu-log git repo 搬到 iCloud**。iCloud 會跟 `.git/` 吵架，還會產生一堆 `.icloud` 佔位檔。vault 跟 repo 分家，只靠 import script 串起來。

### 2. Mac 上的 Obsidian

1. 下載 https://obsidian.md 官方版
2. 啟動 → `Open folder as vault` → 選 `iCloud Drive/Obsidian/gu-log-drafts/`
3. Settings → Files & Links → **Default location for new notes**：`In the current folder`
4. Community plugins → 開 → 裝 **Templater**（用來自動塞 frontmatter 骨架）

### 3. iPhone 上的 Obsidian

1. App Store 下載 **Obsidian** 免費版
2. 首次開啟 → `Create new vault` → `Store in iCloud` → **一定要選同一個資料夾名**：`gu-log-drafts`
3. 稍等幾秒，你在 Mac 寫的檔案會自動出現
4. 確認方式：Mac 上建一個 `test.md`，iPhone 上 10 秒內應該看得到

### 4. Templater 模板（選配但超推薦）

在 vault 裡建一個 `_templates/` 資料夾，然後建 `_templates/sd-draft.md`：

```markdown
---
series: SD
title: "<% tp.file.title %>"
summary: ""
tags: []
originalDate: <% tp.date.now("YYYY-MM-DD") %>
---

# <% tp.file.title %>

（寫這裡）

> [!clawd] Clawd 吐槽
> （吐槽內容）
```

再建 `_templates/sp-draft.md`（SP 系列）：

```markdown
---
series: SP
title: ""
summary: ""
source: "@xxx on X"
sourceUrl: "https://x.com/..."
author: "@xxx"
tags: []
originalDate: <% tp.date.now("YYYY-MM-DD") %>
---

# 標題

（翻譯內容）

> [!clawd] Clawd 吐槽
> （吐槽）
```

Settings → Templater → **Template folder location** 設成 `_templates/`。之後 iPhone 上新增筆記就可以選模板。

## Workflow：從 iPhone 草稿到上線

### 在 iPhone / Mac 寫草稿

1. Obsidian 新建筆記，套用 Templater 模板（SD / SP / CP / Lv）
2. 填 `title` / `summary` / `tags`
3. 正文用 markdown 寫，**不要手動寫 `<ClawdNote>` component**——用 Obsidian callout 語法：

   ```markdown
   > [!clawd] Clawd 吐槽
   > 這裡是吐槽內容第一行
   > 第二行
   ```

   ```markdown
   > [!shroomdog]
   > ShroomDog 自己講話
   ```

4. 連結到其他文章用 wikilink：`[[sp-100-xxx]]`，import 時會自動轉成 `/posts/sp-100-xxx`

### 在 Mac 上 import

```bash
# 預覽（不會寫檔也不會 bump counter）
node scripts/obsidian-import.mjs "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Obsidian/gu-log-drafts/my-draft.md" --dry-run

# 正式 import
node scripts/obsidian-import.mjs "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Obsidian/gu-log-drafts/my-draft.md"
```

或一次匯入整個 vault：

```bash
node scripts/obsidian-import.mjs --all "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Obsidian/gu-log-drafts/"
```

import 會自動做：

- ✅ 產生 `src/content/posts/{series}-{N}-{date}-{slug}.mdx`
- ✅ 依照 `scripts/article-counter.json` 拿下一個 ticket ID 並 bump
- ✅ Obsidian callout → `<ClawdNote>` / `<ShroomDogNote>` 元件
- ✅ Wikilink → `/posts/...` 連結
- ✅ 自動加 frontmatter 必填欄位（`translatedBy`、`lang` 等）
- ✅ 跑 `scripts/validate-posts.mjs` 確認沒爛

### 跑品質 tribunal + push

```bash
./scripts/ralph-loop.sh             # Vibe / Fact / Librarian / FreshEyes
git add scripts/article-counter.json src/content/posts/
git commit -m "content(sd-20): ..."
git push
```

Vercel 自動 deploy，幾分鐘後 `gu-log.vercel.app` 上線。

## iPhone 上比較 Obsidian vs 網站

這是這次改動最爽的副作用：**你可以在 iPhone 上同時開兩個 app**，對同一篇文章看兩種體驗。

| 體驗 | Obsidian iOS | gu-log.vercel.app |
|---|---|---|
| 字型 | 系統預設 | Inter + Noto Sans TC |
| 主題 | Obsidian 內建 | Solarized dark / light 切換 |
| TOC | 手動靠 headings | 左側 auto-generated TOC + reading progress |
| ClawdNote | 純 blockquote（callout 渲染） | 有框、有配色、有 persona |
| 系列導覽 | 無 | Prev / Next + 系列章節 |
| Wikilinks | 雙向圖、graph view | 轉成一般連結 |
| Search | 全文（vault 內） | 全文（Pagefind） |
| 分享 | 只能分享 markdown | 有 OG image、RSS、canonical URL |

用這個當「品質 checklist」：**Obsidian 裡沒有的，就是你前端值得投資的地方**。

## 常見問題

**Q: iCloud 同步卡住？**
- iPhone → Obsidian → Settings → Files & Links → 確認 vault path 對
- Mac 上打開 Finder → iCloud Drive，看有沒有「下載中」的雲端圖示
- 重開 Obsidian app 通常就好

**Q: 草稿 import 後想重改怎麼辦？**
- 改 vault 裡的 `.md` → 重新 `obsidian-import.mjs`？**不要**——counter 會再 bump。
- 直接改 `src/content/posts/*.mdx` 比較乾脆。vault 裡的 draft 可以留作原始備份或直接刪掉。
- 或者：import 前就用 `--dry-run` 確認無誤再正式跑。

**Q: SD 系列不需要 `source` / `sourceUrl`？**
- 對，SD 是原創。import script 會自動填 `source: "ShroomDog Lab"` / `sourceUrl: "https://gu-log.vercel.app/"`
- SP / CP 必填，沒填會直接報錯

**Q: 我想在 iPhone 上直接 commit、直接跑 validate？**
- 別。iPhone 跑不動 node script，跑不動 ralph-loop。維持「iPhone = 寫 / Mac = 發布」分工。硬要在 iPhone 上做 git 只會讓你恨自己。

**Q: Templater 太複雜，我想手打 frontmatter？**
- 可以。最少欄位：`series` + `title` + `summary`（SD/Lv）；SP/CP 再加 `source` + `sourceUrl`。其餘 import script 會補。

## 草稿 frontmatter 最小範例

### SD（原創）

```markdown
---
series: SD
title: "我想寫的東西"
summary: "這篇在講什麼"
tags: [ai-agent]
---

正文開始。

> [!clawd] Clawd 吐槽
> 欸這個不錯喔
```

### SP（翻譯）

```markdown
---
series: SP
title: "翻譯後的中文標題"
summary: "一句話摘要"
source: "@karpathy on X"
sourceUrl: "https://x.com/karpathy/status/xxxxx"
author: "@karpathy"
tags: [ai, llm]
originalDate: 2026-04-10
---

翻譯內文。

> [!clawd]
> Clawd 的吐槽
```

---

以上。有問題改這份文件或叫 Claude Code 幫你改 import script。這套是疊加式的——隨時想回純 VS Code 工作流，把 vault 資料夾留著當草稿區就好，什麼東西都不用刪。
