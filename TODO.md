
## SQAA — 待研究
- [ ] **翻譯品質自動評估**：目前幾乎沒校稿。可能方向：
  - AI-based review（用另一個 model 校稿？但 cost 高）
  - BLEU/METEOR score（需要 reference translation，不適用）
  - 讀者回報機制（Giscus 留言？）
  - 人工抽樣 spot-check（最實際但最慢）
  - 待定，先記錄不急

- [ ] **LLM-as-Judge 翻譯品質系統**（ShroomDog 2026-02-12 提出）
  - Step 1: 人工校稿 3-5 篇作為 golden standard（human scores）
  - Step 2: 建 LLM judge backend，三個 metrics：
    1. Rewrite Quality（忠實度 + 在地化）
    2. Readability（趣味性、PTT 風格）
    3. ClawdNote Quality（吐槽品質、技術深度）
  - Step 3: 每篇新文自動跑 LLM judge，分數明確標示 human vs LLM
  - 放在 SQAA Dashboard Backend 裡（Level 9-10）

## Vibe Scoring — 待定

- [ ] **Reference-doc 類 post 的 pass bar 例外？**（2026-04-22 SP-175 rewrite 觀察後 flag）
  - SP-175 是「官方 best practice cheat sheet」題材，rewrite 4 輪後綜合分卡在 7（persona 7 / clawdNote 8 / vibe 7 / clarity 9 / narrative 7，FAIL），離 pass bar 差一口氣
  - Scorer 原話：「strip test 把 Monday 框架拿掉後剩下三件必知 + 五階梯 + 三 infra + UI default——仍是 release notes 骨架」— 材料本身就是 reference，narrative wrapper 救到一半
  - 選項：
    1. 接受 reference-doc 類有 7-ceiling，在 `scripts/vibe-scoring-standard.md` 加例外條款（例：「工具 migration / best-practice 類文章 pass bar 降為 composite ≥ 7 且至少一維 ≥ 8」）
    2. 堅持 8+，砍 SP-175 的 effort 五階或 infra 三件（有 reader-value 損失）
    3. 維持現狀讓它 FAIL，當作 decorative-trap 的教材留著
  - 待 ShroomDog prod 讀完 SP-175 iter-4 之後決定方向
