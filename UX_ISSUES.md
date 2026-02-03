# gu-log UX Issues & Guidelines

> 記錄所有已發現的 UX 問題和待檢查項目，供 Claude Code 全面檢查。

---

## 🔴 已知問題 (需要修復)

### 1. ClawdNote 段落間距過大
**狀態**: 🔴 未修復  
**位置**: 多篇文章的 ClawdNote 內容  
**問題**: 使用 `<blockquote class="claude-note">` 格式的文章，段落之間空白太多  
**原因**: 舊格式使用 `<br/><br/>` 造成過多換行  
**解法**: 
- 把所有 `<blockquote class="claude-note">` 改成 `<ClawdNote>` component
- 用正常 Markdown 段落取代 `<br/>` 標籤

**受影響文章** (需要檢查並修正):
- [ ] ai-assistance-coding-skills.mdx (部分已修)
- [ ] agent-ships-while-you-sleep.mdx
- [ ] boris-claude-code-tips.mdx
- [ ] build-claude-tool-for-thought.mdx
- [ ] claude-obsidian-infrastructure.mdx
- [ ] clawdbot-architecture-deep-dive.mdx
- [ ] clawdbot-memory-deep-dive.mdx
- [ ] demo.mdx
- [ ] obsidian-claude-101.mdx
- [ ] obsidian-claude-async-hooks.mdx
- [ ] obsidian-context-engineering.mdx
- [ ] openclaw-talk-deep-dive.mdx
- [ ] redis-is-more-than-just-a-cache.mdx
- [ ] supermemory-for-claude-code.mdx
- [ ] vibe-note-taking-editing-workflow.mdx
- [ ] yapping-to-prds.mdx
- (還有對應的 en-*.mdx 英文版)

---

### 2. TOC 空白問題
**狀態**: 🟡 需確認  
**問題**: 某些文章的 TOC (目錄) 顯示為空白  
**原因**: 文章可能沒有足夠的 h2/h3 標題 (需要 3+ 才顯示)  
**解法**: 
- 檢查文章結構，確保有足夠標題
- 或者在標題不足時完全隱藏 TOC 區塊（目前應該已實作）

**需要檢查**:
- [ ] ai-assistance-coding-skills.mdx - TOC 顯示但為空？
- [ ] 其他短文章是否有同樣問題

---

### 3. BackToTop 按鈕位置
**狀態**: ✅ 已嘗試修復  
**問題**: 按鈕應固定在右下角，但有時會跑位  
**已做**: 
- 加 `!important` 確保 `position: fixed`
- `z-index: 9999`
- 固定 `bottom: 1.5rem; right: 1.5rem`

**需要驗證**: 在不同設備/瀏覽器上測試

---

### 4. ClawdNote 重複 "Clawd:" 問題
**狀態**: ✅ 已修復  
**問題**: Component 自動加 "Clawd：" 前綴，但內容也有，造成重複  
**解法**: 移除 component 的自動前綴，讓內容自己決定

---

### 5. Ticket Badge 顏色
**狀態**: ✅ 已修復  
**改動**:
- CP (Clawd Picks): 低彩度橘 #cb7551
- SP (ShroomDog Picks): 藍色 #268bd2
- SD (ShroomDog Original): 青綠色 #268b79
- 右側顯示完整 label

---

## 🟡 待確認項目

### TOC 點擊導航
- [ ] 點擊 TOC 項目是否能正確跳到對應 section？
- [ ] 中文標題的 ID 生成是否正常？
- [ ] 滾動後 header offset 是否正確（不被擋住）？

### 響應式設計
- [ ] 手機版 TOC 摺疊功能正常？
- [ ] 桌面版 TOC sidebar 正確顯示？
- [ ] BackToTop 在不同螢幕尺寸正確定位？

### 主題切換
- [ ] Tokyo Night 深色主題顯示正常？
- [ ] Solarized Light 淺色主題顯示正常？
- [ ] 切換時無閃爍？

---

## 📋 檢查清單 (給 Claude Code)

### 每篇文章需要檢查:
1. **ClawdNote 格式**
   - 是否使用 `<ClawdNote>` component（而非舊的 blockquote）
   - 內容是否有 `**Clawd：**` 前綴
   - 段落間距是否正常（不要用 `<br/>`）

2. **Frontmatter 完整性**
   - `ticketId` 是否存在且正確
   - `title`, `date`, `source`, `sourceUrl`, `summary`, `lang`, `tags` 是否完整

3. **Import 語句**
   - 如果用到 `<ClawdNote>`，是否有 import
   - 如果用到 `<Toggle>`，是否有 import

4. **TOC 結構**
   - 是否有足夠的 h2/h3 標題（至少 3 個）
   - 標題文字是否適合生成 ID

### 全站需要檢查:
1. **CSS 一致性**
   - `.claude-note` 樣式在 global.css 和 component 是否一致
   - 主題變數是否正確應用

2. **組件功能**
   - BackToTop 固定定位
   - TOC 點擊導航
   - 主題切換
   - 語言切換

---

## 📝 修改記錄

| 日期 | 修改內容 |
|------|----------|
| 2026-02-03 | 建立此文件 |
| 2026-02-03 | 修正 BackToTop 位置 |
| 2026-02-03 | 修正 ClawdNote 重複前綴 |
| 2026-02-03 | 加入 .claude-note global CSS |
| 2026-02-03 | 換成 Tokyo Night 主題 |
| 2026-02-03 | 新增 Ticket Badge 系統 |
| 2026-02-03 | 新增 Clawd Picks section |

---

*此文件供 Claude Code 全面檢查 gu-log 的 UX 問題使用*
