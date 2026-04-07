# Article Dedup Strategy — 全面修復方案

**Priority**: P0
**Requested by**: CEO
**Date**: 2026-04-08
**Status**: Approved by CEO (2026-04-08) — Ready for Builder

## Problem Statement

gu-log 有至少 7 組重複文章（同 URL 或同 topic），dedup 工具存在但沒有接入任何 pipeline。目前的防重複完全依賴 AI 手動 grep — 等於沒有。

### 已確認重複文章

| # | 文章組 | 問題類型 | sourceUrl |
|---|---|---|---|
| 1 | SP-127 + CP-250 + CP-261 | 同 URL (CP) + 同 topic (SP↔CP) | anthropic.com/engineering/... + x.com tweet |
| 2 | CP-218 + CP-235 | 同 tweet URL | x.com/karpathy/...2037200624450936940 |
| 3 | CP-238 + SP-138 | 同 tweet, SP/CP 都翻 | x.com/bcherny/...2038454336355999749 |
| 4 | CP-66 + SP-50 | 同 tweet, SP/CP 都翻 | x.com/karpathy/...2021633574089416993 |
| 5 | CP-151 + CP-156 | 同 tweet URL | x.com/karpathy/...2031135152349524125 |
| 6 | CP-160 + SP-111 | 同 tweet, SP/CP 都翻 | x.com/AndrewYNg/...2031051809499054099 |
| 7 | SP-35 + SP-105 | 同 source URL | code.claude.com/docs/en/agent-teams |

### Root Cause Analysis

| Dedup 機制 | 存在 | 接入 pipeline | 涵蓋範圍 | 問題 |
|---|---|---|---|---|
| URL exact match (cp-dedup-guard.sh L1) | Yes | **No** | CP only | 沒被呼叫 |
| Keyword Jaccard (cp-dedup-guard.sh L2) | Yes | **No** | CP only | stop words 太兇 |
| topic-dedup-check.mjs | Yes | **No** | All series | 沒被呼叫 |
| cp-dedup-queue.sh | Yes | **No** | CP queue | 只做 URL match |
| SP pipeline dedup | **No** | N/A | N/A | 完全不存在 |
| Cross-series SP↔CP dedup | **No** | N/A | N/A | 完全不存在 |

**三個核心失敗點：**

1. **工具沒接上** — `clawd-picks-prompt.md` Step 3 只寫「依 CONTRIBUTING.md 的防重複 SOP 執行」，但那只是教 AI 跑 `grep`，不是硬 gate。`sp-pipeline.sh` 完全沒有 dedup。
2. **Domain stop words 過度過濾** — `cp-dedup-similarity.py` 把 `claude`, `code` 列為 `DOMAIN_STOP_WORDS`，導致 "Claude Code Auto Mode" 這種高度特定的標題只剩 `auto` + `mode` 兩個 meaningful keyword，低於 `MIN_EN_OVERLAP_FOR_REJECT = 3` 門檻。
3. **無 cross-series check** — SP 和 CP pipeline 完全獨立，同一篇 tweet 可以各翻一次。

---

## Solution: Unified Dedup Gate

### Architecture Overview

```
                    ┌─────────────────────┐
                    │   dedup-gate.mjs     │  ← Single entry point
                    │  (Node.js, zero dep) │
                    └────────┬────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         Layer 1         Layer 2       Layer 3
        URL Match     Topic Similarity  Intra-Queue
      (normalized)    (cross-series)    (batch dedup)
```

**Key principle**: 一個 gate、所有 pipeline 共用、跨 series check。

### Layer 1: URL Dedup (Hard Block)

保留 `cp-dedup-guard.sh` 的 URL normalization 邏輯，但統一到 `dedup-gate.mjs`：

- Normalize URL (strip www, trailing slash, utm params)
- **X.com tweet ID extraction**: 從 URL 提取 tweet status ID，用 ID match 而不只是 full URL match
  - 解決：不同 URL 格式指向同一篇 tweet（e.g., `x.com` vs `twitter.com`, mobile URLs）
- **Known alias map**: anthropic.com/blog ↔ claude.com/blog 等已知 alias
- Match against ALL published articles (所有 series)

**Verdict**: URL match → **BLOCK** (exit code 1, pipeline 必須停止)

### Layer 2: Topic Similarity (Smart Block)

合併 `cp-dedup-similarity.py` 和 `topic-dedup-check.mjs` 的優點：

**修正 stop words 策略：**
- 不再完全移除 `claude`, `code` 等 domain words
- 改用 **compound token** 策略：`"claude code"` → `"claude-code"` 作為一個 token
- 常見 compound terms: `claude-code`, `agent-teams`, `auto-mode`, `vibe-coding`
- Domain stop words 只在 **standalone** 出現時降權，compound 裡保留全部權重

**修正 threshold：**
- 現有 `MIN_EN_OVERLAP_FOR_REJECT = 3` 太高 → 降至 **2** (搭配 compound tokens)
- `REJECT_THRESHOLD = 0.30` → 保持不變
- `FLAG_THRESHOLD = 0.18` → 保持不變

**Cross-series check：**
- 比對範圍 = ALL published zh-tw articles (SP + CP + SD + Lv)
- 不再只看同 series

**Verdict**:
- Score >= REJECT_THRESHOLD + overlap >= 2 → **BLOCK**
- Score >= FLAG_THRESHOLD → **WARN** (pipeline 印出警告但允許繼續，log 到 dedup-warnings.json)

### Layer 3: Intra-Queue Dedup (Batch)

CP pipeline 有時一次選多篇。目前 cp-dedup-guard.sh 只比對 candidate vs published，不比對 candidates vs candidates。

- 新增：queue 內 pairwise comparison
- 如果 queue 內兩篇 URL 相同或 topic similarity > REJECT_THRESHOLD → block 較晚加入的那篇

---

## Pipeline Integration

### CP Pipeline (clawd-picks-prompt.md)

在 Step 3（選擇推文）和 Step 4（取得 Ticket ID）之間，加入 **Step 3.5: Dedup Gate**：

```markdown
## Step 3.5: Dedup Gate（必須通過才能繼續）

選好推文後，**必須**跑 dedup gate：

\`\`\`bash
node scripts/dedup-gate.mjs \
  --url "SOURCE_URL" \
  --title "CANDIDATE_TITLE" \
  --tags "tag1,tag2" \
  --series CP
\`\`\`

- 🔴 BLOCK → 換一篇推文，這個 topic 已經有人寫了
- 🟡 WARN → 印出相似文章，自行判斷是否有足夠差異化角度
- 🟢 PASS → 繼續
```

### SP Pipeline (sp-pipeline.sh)

在 URL 確定後、翻譯開始前，加入 dedup gate call：

```bash
# After URL is determined, before translation
log_info "Running dedup gate..."
DEDUP_RESULT=$(node "$SCRIPT_DIR/dedup-gate.mjs" \
  --url "$SOURCE_URL" \
  --title "$TITLE" \
  --tags "$TAGS" \
  --series SP 2>&1) || true

if echo "$DEDUP_RESULT" | grep -q "BLOCK"; then
  log_error "Dedup gate blocked: $DEDUP_RESULT"
  exit 1
fi

if echo "$DEDUP_RESULT" | grep -q "WARN"; then
  log_warn "Dedup warning: $DEDUP_RESULT"
  # Continue but log
fi
```

### Post-Publish Validation (validate-posts.mjs)

新增 `--check-duplicates` flag：

- 掃描所有已發布文章，找出 URL 或 topic 重複
- 輸出 report（哪些文章組重複、similarity score）
- 整合到 CI — PR check 時自動跑

---

## Handle Existing Duplicates

### Deprecation Strategy

對每一組重複，保留品質較高者，deprecate 其餘：

| 組 | 保留 | Deprecate | 理由 |
|---|---|---|---|
| 1 | SP-127 | CP-250, CP-261 | SP 是 deep-dive 原文翻譯，品質 > CP tweet 翻譯 |
| 2 | CP-218 或 CP-235 | 另一篇 | 需比較品質，二選一 |
| 3 | SP-138 | CP-238 | SP 是 curated 翻譯 |
| 4 | SP-50 | CP-66 | SP 是 curated 翻譯 |
| 5 | CP-151 或 CP-156 | 另一篇 | 需比較品質，二選一 |
| 6 | SP-111 | CP-160 | SP 是 curated 翻譯 |
| 7 | SP-105 | SP-35 | SP-105 較新且更全面（需確認）|

**Deprecation 實作：**
```yaml
# Deprecated article frontmatter
status: "deprecated"
deprecatedReason: "Duplicate of SP-127 — same topic covered in more depth"
deprecatedBy: "SP-127"
```

Deprecated 文章不從 repo 刪除，但：
- 不出現在首頁文章列表
- 原 URL 保留（不 break backlinks）
- 頁面頂部顯示「本文已被更完整的版本取代」+ 連結到保留版

---

## Acceptance Criteria

### Gate Implementation
- [ ] `dedup-gate.mjs` 存在，支援 `--url`, `--title`, `--tags`, `--series` 參數
- [ ] Layer 1 (URL): 能擋住 CP-250 vs CP-261 (exact same URL)
- [ ] Layer 1 (URL): 能擋住 tweet ID match (e.g., x.com vs twitter.com 同一 tweet)
- [ ] Layer 2 (Topic): "Claude Code Auto Mode" SP-127 vs CP-250 → 至少 WARN
- [ ] Layer 2 (Topic): compound token "claude-code" 不被 stop words 吃掉
- [ ] Layer 3 (Intra-queue): 同一 queue 裡兩個相同 URL → block 第二個
- [ ] 跨 series check: SP 文章對 CP candidates 可見，反之亦然

### Pipeline Integration
- [ ] `clawd-picks-prompt.md` 有 Step 3.5 Dedup Gate
- [ ] `sp-pipeline.sh` 在翻譯前呼叫 dedup-gate
- [ ] 兩個 pipeline 的 BLOCK verdict 都會中止流程

### Validation
- [ ] `validate-posts.mjs --check-duplicates` 能掃出已知 7 組重複
- [ ] CI 整合（PR check 自動跑）

### Existing Duplicates
- [ ] 7 組重複文章已處理（deprecated or merged）
- [ ] Deprecated 文章有 redirect/notice 指向保留版

### Regression Test
- [ ] 用已知重複組跑 dedup-gate，確認全部 BLOCK 或 WARN

---

## Out of Scope

- Vector embedding (Gemini text-embedding-004) — 目前 keyword Jaccard + compound tokens 夠用，日後再考慮
- 自動 merge 重複文章的內容 — 手動決定保留哪篇就好
- 跨語言 dedup (zh-tw vs en) — en 版是 zh-tw 的翻譯，不算重複

## Dependencies

- Node.js (already available)
- 無新 dependencies — `dedup-gate.mjs` 用 `gray-matter` (已裝) + 原生 Node

## Implementation Order

1. **Phase 1 — 止血** (Builder task 1)
   - 實作 `dedup-gate.mjs` (consolidate existing scripts)
   - 接入 `clawd-picks-prompt.md` 和 `sp-pipeline.sh`

2. **Phase 2 — 清理** (Builder task 2)
   - 處理 7 組現有重複（deprecate）
   - 加 redirect notice 到 deprecated articles

3. **Phase 3 — 防線** (Builder task 3)
   - 整合到 `validate-posts.mjs`
   - CI check

## Notes

- `dedup-gate.mjs` 應該是 repo 內唯一的 dedup entry point。完成後可以 deprecate `cp-dedup-guard.sh`, `cp-dedup-similarity.py`, `cp-dedup-queue.sh`, `topic-dedup-check.mjs` — 但不急著刪，先確認新 gate 穩定。
- Clawd on VM 跑 CP pipeline 時也要能呼叫 `dedup-gate.mjs`，確認 VM 有 Node.js + gray-matter。
- 考慮加 `--dry-run` flag 方便測試。
