# 文章 deprecated 與去重設計（已取代）

> **狀態：已取代。** 這是 2026-04-03 針對 Issue #57 與 MP-239／GP-157 的一次性提案，不是現行的去重規則或文章狀態合約。

原提案裡的 frontmatter、處理路徑、分數門檻和實作清單，都已經被後來的實作取代。要追當時怎麼決定的請看 git 歷史；現在驗收不能沿用這份舊快照。

現行權威來源：

- 去重正式規則：[`dedup-policy`](../openspec/specs/dedup-policy/spec.md) 與 [`dedup-taxonomy`](../openspec/specs/dedup-taxonomy/spec.md)
- 去重執行入口：[`scripts/dedup-gate.mjs`](../scripts/dedup-gate.mjs)
- 文章狀態 schema：[`src/content.config.ts`](../src/content.config.ts)
- 發布中、deprecated、退役文章的行為：[`src/utils/post-status.ts`](../src/utils/post-status.ts)
