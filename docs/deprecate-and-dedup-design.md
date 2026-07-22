# Deprecate & Dedup Design（已取代）

> **Status:** Superseded。這是 2026-04-03 針對 Issue #57 與 MP-239／GP-157 的一次性提案，不是現行 dedup 或 post-status contract。

原提案中的 frontmatter、pipeline 路徑、score gate 與 implementation checklist 已被後續實作取代。需要追查當時決策時請讀 git history；目前驗收不得沿用本檔的歷史快照。

現行權威來源：

- Dedup contract 與 runtime 路由：[`specs/article-dedup-strategy.md`](../specs/article-dedup-strategy.md)
- Post status schema：[`src/content.config.ts`](../src/content.config.ts)
- Published／deprecated／retired 行為：[`src/utils/post-status.ts`](../src/utils/post-status.ts)
