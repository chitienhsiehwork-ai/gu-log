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
| `clean-diff` | 1 | `simon-vs-systematicls-agentic-engineering.yaml` |

## Level E 已完成

Level E（`add-librarian-dupcheck`）已把本 harness 接上 tribunal v2：

- `v2-factlib-judge` 新增 `dupCheck` 評分維度（0-10），rubric：10 clean-diff / 8 正確識別 /
  5 邊界 / 2 誤判。Pass bar `dupCheck >= 8`，跟 fact / library 兩個 composite 獨立，無補償。
- Judge 在工作時會讀本目錄下四類各 1 筆 YAML 當 few-shot 範例。
- `scripts/eval-dedup-harness.mjs --run` 對每筆 fixture 呼叫 judge，算 per-category
  precision + recall，輸出 markdown report 到 `scores/dedup-eval-YYYYMMDD-HHMMSS.md`。
- 詳見 `openspec/specs/librarian-dupcheck/spec.md`。

Level F（`add-semantic-dedup-gate-layers`，pre-publish gate）會再加一層檢查。
