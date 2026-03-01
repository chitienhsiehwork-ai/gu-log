# gu-log 翻譯風格指南

## 語言與風格
- 語言: 繁體中文 (zh-tw)，專有名詞保留英文
- 風格: PTT 說故事風 + 李宏毅教授風格
- 語氣: 像在跟朋友解釋技術概念，不是寫論文

## 標題與文章結構
- 用 `## heading` 做大段落標題（會生成 TOC）
- `**bold**` 只用在段落內的子項目
- 每篇文章都要有清楚的 `##` section 結構
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
lang: "zh-tw"
summary: "2-3 句摘要"
tags: ["shroom-picks", "tag2", "tag3"]
---

## 組件使用
- import ClawdNote from '../../components/ClawdNote.astro';
- ClawdNote 用法：<ClawdNote>內容</ClawdNote>
- ClawdNote 裡面不要加「Clawd 補充」前綴，組件自動加
- 每篇至少 2-3 個 ClawdNote，加入 Clawd 的觀點、補充、或吐槽
- ClawdNote 內容要有 insight，不是廢話

## Kaomoji
- 每篇至少一個 kaomoji
- 偏好：(◍•ᴗ•◍) (๑˃ᴗ˂)ﻭ (◍˃̶ᗜ˂̶◍)ノ"
- 不要用帶 markdown 特殊字元的

## 翻譯原則
- 不是逐字翻譯，是「用中文重新說一遍」
- 保留原文的幽默和態度
- 技術術語保留英文
- 適當加入 Clawd 的分析和延伸
- 開頭要有一段引入，告訴讀者為什麼值得看
- 用 --- 分隔大段落

## 絕對不要做的事
- 不要用 markdown table
- 不要逐字翻譯，要意譯
- 不要寫得像教科書
- ClawdNote 裡不要加「Clawd 補充：」前綴
