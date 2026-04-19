# tribunal/fixtures/

gu-log 重複文章判定系統的 eval harness —— 已知答案的題庫。

## 用途

1. **評估用**：跑 `node scripts/eval-dedub-harness.mjs` → 系統對照 `expectedClass` 算 per-category precision + recall
2. **Few-shot 範例**：Level E Librarian `dupCheck` 提示會從本目錄挑幾筆當範例

詳細規格見 `openspec/specs/dedup-eval-harness/spec.md`。

## 目錄結構

依 `expectedClass` 分子目錄：

- `hard-dup/` — 同事件不同來源，應 BLOCK
- `soft-dup/` — 主題重疊角度有差，應 WARN + cross-link
- `intentional-series/` — 顯式聲明的系列，應 allow
- `clean-diff/` — 主題類似但有獨立貢獻，應 allow

## Fixture YAML schema

每筆 fixture 必含：

- `inputPost`: `{ slug, frontmatter, contentSnapshot }`
- `corpusSnapshot`: `[{ slug, frontmatter, contentSnapshot }, ...]`
- `expectedClass`: `hard-dup | soft-dup | intentional-series | clean-diff`
- `expectedAction`: `BLOCK | WARN | allow`
- `humanReasoning`: 多行字串
- `sourceRef`: git commit hash / PR 編號 / 決議日期

`contentSnapshot` 長度建議 200-400 字（title + summary + lead paragraph），不收全文。

## 凍結原則

- Fixture 一旦 commit **SHALL NOT** 被 Ralph Loop / tribunal 修改
- 人類發現答案有誤 → 允許修正，commit message 以 `fix(fixture):` 開頭
- 新增 fixture → `feat(fixture):` 開頭
- 刪除過時 fixture → `chore(fixture):` 開頭

## 當前狀態

| 分類 | 筆數 | 備註 |
|---|---|---|
| `hard-dup` | 1 | `mythos-techcrunch.yaml` |
| `soft-dup` | 1 | `gemma-4-dual-post.yaml` |
| `intentional-series` | 1 | `ecc-series.yaml` |
| `clean-diff` | 0 | **TODO: Level E 開始前補齊** |

## Level E 展望

Level E（`add-librarian-dupcheck`）會把本 harness 接入 tribunal：

- Librarian 新增 `dupCheck` 評分維度，讀 `tribunal/fixtures/**/*.yaml` 中的 3-5 筆當 few-shot 範例
- `scripts/eval-dedup-harness.mjs` 擴充 evaluator 邏輯，對每筆 fixture 呼叫 Librarian → 比對 `expectedClass` → 算 per-category precision + recall
- clean-diff 那筆 fixture 要在 Level E 開始前補齊（spec R6 明定）
