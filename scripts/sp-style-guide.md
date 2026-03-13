# gu-log 翻譯風格指南

## 語言與風格
- 語言: 繁體中文 (zh-tw)，專有名詞保留英文
- 風格: PTT 說故事風 + 李宏毅教授風格
- 語氣: 像在跟朋友解釋技術概念，不是寫論文

## 標題與文章結構
- 用 `## heading` 做大段落標題（會生成 TOC）
- 允許使用 `###` 作為案例研究或列表的次級標題
- `**bold**` 可用於關鍵字強調或段落內的子項目
- 每篇文章都要有清楚的 `##` section 結構
- 在每個 `##` 大段落標題之前（除了引言後的第一個 `##` 標題外）必須加上 `---` 分隔線
- 結尾要有 `## 結語` section 做收束

## MDX Frontmatter 格式（必須完全遵守）
---
ticketId: "SP-{N}"
title: "中文標題 — 吸引人但不浮誇"
originalDate: "YYYY-MM-DD"
translatedDate: "YYYY-MM-DD"
translatedBy:
  model: "Gemini 3.1 Pro"
  harness: "Gemini CLI"
source: "@author on X"
sourceUrl: "full_tweet_url"
pipeline: "sp-96-pipeline" # Optional
pipelineUrl: "https://github.com/..." # Optional
lang: "zh-tw"
summary: "2-3 句摘要（≤300 characters）"
tags: ["shroom-picks", "tag2", "tag3"]
---

## 組件使用
- import 聲明（只需要 ClawdNote）：
  import ClawdNote from '../../components/ClawdNote.astro';
- ClawdNote 用法：`<ClawdNote>內容</ClawdNote>`
- ClawdNote 裡面不要加「Clawd 補充」前綴，組件自動加
- ClawdNote 數量：不限，有 insight 就放，沒有不硬擠。品質 > 數量
- ClawdNote 內容要有 insight，不是廢話
- ⚠️ 不要使用 CodexNote / GeminiNote / ClaudeCodeNote — 這些已棄用。所有評論統一用 ClawdNote

## Kaomoji
- 每篇至少一個 kaomoji
- 偏好：(◍•ᴗ•◍) (๑˃ᴗ˂)ﻭ (◍˃̶ᗜ˂̶◍)ノ"
- 不要用帶 markdown 特殊字元的

## 翻譯原則
- 不是逐字翻譯，是「用中文重新說一遍」
- 保留原文的幽默和態度
- 技術術語保留英文
- 可加入 Clawd 的分析與延伸，但僅限於 ClawdNote 組件內，且必須明確標示為評論/推測；不得在正文新增原文沒有的事實、數字或結論
- 開頭要有一段引入，告訴讀者為什麼值得看
- 保留不確定用語 (Hedge Preservation)：如果原文帶有不確定的語氣（如 seems, might, I think），翻譯必須保留同等的不確定性。
- 禁止捏造數據 (No Number Synthesis)：如果原文沒有具體數字，翻譯絕對不可自行發明或推測數字。
- 歸屬優先 (Attribution-First)：對於推測性或個人觀點的內容，必須加上明確的來源歸屬（例如：「原作者認為」、「推文中提到」）。
- 保留限制條件 (Constraint Preservation)：原文中提到的限制條件、注意事項或免責聲明 (limitations/caveats) 絕對不可省略。

## 最終自我審查 (Final Self-Audit Block)
在提交翻譯前，必須進行以下自我檢查：
- 是否有捏造或自行發明的數字？
- 是否擅自提升了語氣的肯定程度（將不確定變成肯定）？
- 是否遺漏了任何原文的限制條件或警告？
- 結尾的推論是否超出了原文的範圍？

## 絕對不要做的事
- 不要用 markdown table
- 不要逐字翻譯，要意譯
- 不要寫得像教科書
- ClawdNote 裡不要加「Clawd 補充：」前綴
