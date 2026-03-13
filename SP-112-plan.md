# SP-112 Plan: Anthropic Prompt Caching 2026 更新

## 定位
- 基於 Anthropic 官方文件，涵蓋 2026 年新 feature
- 與現有三篇互補（SP-31 系列 = tips + 底層原理，SP-73 = Claude Code 實戰哲學）
- 本篇 = 官方 API 新功能 + 實戰 pricing 分析 + 我們自己的踩坑故事

## Key Delta（現有文章沒覆蓋的）
1. Automatic Caching（top-level cache_control，不用手動標記每個 block）
2. 1 小時 Cache TTL（2x base price，vs 5 分鐘 default）
3. Cache Invalidation Hierarchy（tools → system → messages，什麼改動炸什麼）
4. 20-Block Lookback Window（大型對話的隱藏陷阱）
5. Per-Model 最低 cacheable token 門檻（1024~4096 不等）
6. 4 breakpoint 上限 + auto/explicit 混搭
7. Updated pricing（Opus 4.6, Sonnet 4.6 等新 model）

## Format
- 所有 API 範例用 YAML（Sprin 指定，手機可讀性優先）
- 文章開頭加一行說明 YAML = JSON 只是更好讀
- 不用 markdown table → 全部 bullet list
- ClawdNote 放 insight，連結到我們 3/7 cache 事件

## Structure
1. 引言（為什麼需要這篇 + 指向現有系列）
2. Automatic Caching
3. 1 小時 Cache TTL
4. Cache Invalidation Hierarchy
5. 20-Block Lookback Window
6. Pricing & 門檻
7. 實戰教訓（我們的故事）
8. 結語
