## Why

Tribunal 跑完 judge 評分後，分數只寫進 progress JSON（`ralph-progress.json` / `tribunal-progress.json`），**沒有寫回文章的 frontmatter**。頁面上的 `AiJudgeScore.astro` 元件讀 `post.data.scores` 來渲染 tribunal badge，但 scores 永遠是空的——所以讀者看不到分數徽章。寫入工具（`frontmatter-scores.mjs`）和渲染管線都已就位，只差中間的整合呼叫。

## What Changes

- **Legacy shell pipeline**（`tribunal-all-claude.sh`）：在每個 judge stage PASS 後呼叫 `write_score_to_frontmatter`，把分數寫入 MDX frontmatter
- **Tribunal v2 TypeScript pipeline**（`pipeline.ts`）：在 judge stage pass 後呼叫 `config.io.updateFrontmatter()` 寫入 scores 物件
- **Judge key 對應表**：建立 stage name → frontmatter key 的 mapping（`fact-checker` → `factCheck`、`fresh-eyes` → `freshEyes`、`vibe-scorer` → `vibe`、`librarian` → `librarian`）
- **Score 累進寫入**：每個 judge 過了就寫一次，不是等全部過了才寫——中途失敗的文章也能看到已完成的分數

## Capabilities

### New Capabilities
- `tribunal-score-persistence`: 定義 tribunal pipeline 何時、如何把 judge 分數寫入 post frontmatter，包含 key mapping、累進寫入行為、和 model label 記錄

### Modified Capabilities
- `extended-post-frontmatter`: scores 欄位的 schema 已存在但從未被 pipeline 填入；需確認 schema 與實際寫入格式一致

## Impact

- `scripts/tribunal-all-claude.sh` — 加入 `write_score_to_frontmatter` 呼叫
- `scripts/score-helpers.sh` — 可能需要調整 judge key mapping 函式
- `scripts/frontmatter-scores.mjs` — 確認與現有 Zod schema 相容
- `src/lib/tribunal-v2/pipeline.ts` — 加入 scores 寫入邏輯
- `src/content/config.ts` — 確認 scores schema 結構（應該已經有了）
- `src/components/AiJudgeScore.astro` — 不需改動（已就位）
