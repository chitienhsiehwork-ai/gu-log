## Context

Tribunal pipeline 有兩套實作：legacy shell（`tribunal-all-claude.sh`）和 v2 TypeScript（`pipeline.ts`）。兩套都會跑 4 個 judge stage（vibe / factCheck / freshEyes / librarian），但分數只寫進各自的 progress JSON，從未寫回 MDX frontmatter。

渲染端已就位：`config.ts` 有完整的 scores Zod schema（四個 judge 各自的維度 + composite score + date + model），`AiJudgeScore.astro` 讀 `post.data.scores` 渲染 badge。`frontmatter-scores.mjs` 和 `score-helpers.sh` 的 `write_score_to_frontmatter()` 也已實作完成——差的只是 tribunal pipeline 裡的呼叫。

## Goals / Non-Goals

**Goals:**
- Tribunal judge PASS 後，分數自動寫入 MDX frontmatter 的 `scores:` 區塊
- 每個 judge 獨立寫入（累進式），不等全部 pass 才寫
- 同時更新 en-* 對應檔（`write_score_to_frontmatter` 已處理）
- 兩套 pipeline（shell + v2）都要修

**Non-Goals:**
- 不改 scores Zod schema（已經夠用）
- 不改 `AiJudgeScore.astro` 渲染邏輯
- 不改 progress JSON 的寫入邏輯（保留現有追蹤機制）
- 不處理 tribunal queue 排序問題（另一個 issue #142）

## Decisions

### 1. 累進寫入 vs 一次寫入

**選擇：累進寫入（每個 judge pass 就寫一次）**

理由：
- 中途失敗的文章也能看到已完成的分數（例如 vibe pass 但 factCheck fail，讀者至少看到 vibe 分數）
- `write_score_to_frontmatter` 已經是 per-judge 設計（接受 judge key + score JSON）
- 一次寫入要等 4 stage 全過才寫，等候時間長且失敗時什麼都看不到

### 2. Judge key mapping

Shell pipeline 的 stage name 和 frontmatter key 不同：

| Stage validate name | Frontmatter key |
|---|---|
| `vibe-scorer` | `vibe` |
| `fact-checker` | `factCheck` |
| `fresh-eyes` | `freshEyes` |
| `librarian` | `librarian` |

**選擇：在 `tribunal-all-claude.sh` 的 `run_stage()` 函式裡加 mapping**

用 associative array 或 case statement，在 PASS 路徑裡把 validate name 轉成 frontmatter key 再呼叫 `write_score_to_frontmatter`。

### 3. Score JSON 格式對齊

`write_score_to_frontmatter` 期望的 JSON 結構需要跟 Zod schema 對齊：
- 必填：各維度分數（0-10 整數）、`score`（composite）、`date`（ISO string）
- 選填：`model`（model label string）

Judge output 的 JSON 已經包含維度分數，需要在寫入前補上 `date` 和 `model`。

### 4. V2 Pipeline 整合方式

V2 的 `pipeline.ts` 已經有 `config.io.updateFrontmatter()` 呼叫（用於 stage0 warnings 和 stage3 dupCheck）。

**選擇：在每個 judge stage 的 pass 路徑加一次 `updateFrontmatter` 呼叫**

需要把 judge output 轉換成 `scores.<judgeKey>` 格式，包含維度分數 + composite + date + model。用 deep merge 確保不覆蓋其他 judge 已寫入的分數。

## Risks / Trade-offs

**[Race condition] 兩套 pipeline 同時跑同一篇文章** → 低風險。實務上不會同時跑，且 `frontmatter-scores.mjs` 是 per-judge 寫入（讀取現有 scores → merge → 寫回），不會互相覆蓋不同 judge 的分數。

**[重複寫入] Crash resume 後重跑已 pass 的 stage** → `tribunal-all-claude.sh` L256 已有 skip 邏輯（`already PASS, skipping`），不會重跑。V2 也有類似機制。所以不會重複寫入。

**[Schema mismatch] Judge output JSON 結構跟 Zod 不合** → 在寫入前做一次 reshape，確保欄位名稱和型別跟 schema 對齊。`frontmatter-scores.mjs` 已有驗證邏輯。
