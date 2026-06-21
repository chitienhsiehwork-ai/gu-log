# 證據：people glossary SSOT

日期：2026-05-07  
範圍：`migrate-tribunal-to-codex` / `glossary-identity-ssot`

## Glossary entries

`src/data/glossary.json` 已包含以下 `people` entries：

- Andrej Karpathy
- Simon Willison
- Boris Cherny

也包含 Andrej SP lane 需要的 concept entries：

- Agentic Engineering
- Software 3.0

## UI / Config 證據

`src/config/glossary.ts` 已把以下 terms 放進 first-class glossary ordering：

- `Agentic Engineering`
- `Software 3.0`
- `Andrej Karpathy`
- `Simon Willison`
- `Boris Cherny`

`src/pages/glossary.astro` 會把 `people` render 成 `人物`，並定義 `cat-people` styling。

## Review Notes

- Future gu-log posts 應該 cite 或 link 這些 entries，不要每篇都重新介紹同一批人物。
- Librarian 應該把 `Karpathy`、`Simon`、`simonw`、`Boris` 等 aliases 當成 identity linking hints。
