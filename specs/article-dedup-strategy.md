# Article Dedup Strategy（已取代）

> 狀態：Superseded。這是 2026-04-08 的一次性提案入口，不是現行 dedup contract。

原提案描述的工具、pipeline 路徑與驗收清單已由後續實作和 OpenSpec 取代。為避免散文再次變成第二份 SSOT，本檔不再維護舊 command、行號或實作快照；需要歷史內容時請查 git history。

現行權威來源：

- Dedup policy：[`openspec/specs/dedup-policy/spec.md`](../openspec/specs/dedup-policy/spec.md)
- Taxonomy 與 normalization：[`openspec/specs/dedup-taxonomy/spec.md`](../openspec/specs/dedup-taxonomy/spec.md)
- Evaluation harness：[`openspec/specs/dedup-eval-harness/spec.md`](../openspec/specs/dedup-eval-harness/spec.md)
- CLI gate：[`scripts/dedup-gate.mjs`](../scripts/dedup-gate.mjs)
- GP pipeline integration：[`tools/gp-pipeline/internal/dedup/`](../tools/gp-pipeline/internal/dedup/)

若 code 與 OpenSpec 不一致，依 repo 的 SSOT 紀律處理，不要從這份 superseded stub 推導現行行為。
