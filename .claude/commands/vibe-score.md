---
description: 用正式的 Tribunal runner 只跑 Vibe 評審（score-only，不改文章、不寫 frontmatter、不 commit）
argument-hint: <post-filename.mdx>
---

這個指令只是 `scripts/tribunal.sh` 的薄包裝：評分規則、維度、pass bar 和輸出格式都由 runner 與評審合約決定，這裡不另寫一份，也不要自己讀文章打分。

在 repo 根目錄跑：

```bash
out="$(mktemp)"
TRIBUNAL_SCORE_OUTPUT="$out" bash scripts/tribunal.sh --score-only --only-stage vibe "$ARGUMENTS"
cat "$out"
```

跑完回報 runner 的結果：exit code、log 裡的 composite 與 PASS／FAIL，以及最後印出的 JSON 裡評審給的分數和理由。runner 失敗就照實回報錯誤，不要改用 session model 自己打分。

要把分數寫回 frontmatter 或跑完整四審，改跑 `bash scripts/tribunal.sh <file>`，跑法見 `docs/tribunal-runbook.md`。
