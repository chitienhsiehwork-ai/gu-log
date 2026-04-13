# TDD Pseudo Code — Reading Guide for ShroomDog

> 這份檔案是 bookmark，讓你隨時能回來讀 TDD pseudo code。
> Created: 2026-04-11 by CTO

## What is this?

Tribunal v2 的 TDD 測試規劃 — 用 pseudo code + 重度註解寫成，不是 runnable test。
每個檔案都是 teaching artifact：教你「什麼該測、什麼不該測、為什麼」。

## Snapshot

- **Branch**: `tribunal-v2-planning`
- **Commit**: (see git log for exact hash after this file is committed)
- **Date**: 2026-04-11

## Reading Order (建議)

1. **`README.md`** — 核心：test triage 分層哲學（該測 / 不該測 / 延後測）
2. **`pseudo/02-pass-bar.pseudo.ts`** — 最簡單，pure function，熱身
3. **`pseudo/01-writer-constraints.pseudo.ts`** — 核心概念：programmatic enforcement
4. **`pseudo/04-fact-corrector.pseudo.ts`** — 最複雜，mock layer 抉擇
5. 其他按順序讀

## Key Concepts You'll Learn

- **Test Triage**: 哪些 test 在 TDD 階段值得寫（deterministic logic），哪些等 impl 穩定後再寫（integration / LLM quality）
- **Mock Layer**: 什麼時候 mock LLM response vs mock HTTP adapter vs real LLM
- **Contract Test**: 怎麼測試 prompt 結構正確性（不需要真的呼叫 LLM）
- **Programmatic Enforcement**: 用 diff check 而非 prompt 來 enforce writer constraints

## Decisions Made

所有 design decisions 記錄在 `_decisions.md`，由 CTO 拍板 (2026-04-11)。
如果你看完有不同意的地方，隨時跟 CTO 討論 — decisions 可以改。

## File Structure

```
tests/tribunal-v2/
├── README.md                     ← test triage 哲學 (start here)
├── tdd-reading-guide.md          ← 你在讀的這個
├── _decisions.md                 ← MCQ 決策記錄
└── pseudo/
    ├── 01-writer-constraints     ← URL/heading/frontmatter diff check
    ├── 02-pass-bar               ← Stage 1 absolute + Stage 4 relative
    ├── 03-judge-schemas          ← Zod schema validation
    ├── 04-fact-corrector         ← Standing checklist + source URL
    ├── 05-stage-transitions      ← State machine + retry cap
    ├── 06-frontmatter            ← warnedByStage0 / stage4Scores
    ├── 07-banner-rendering       ← Astro component + XSS + a11y
    ├── 08-git-commit-format      ← Squash merge commit msg
    └── 09-luxury-token-audit     ← grep script test
```
