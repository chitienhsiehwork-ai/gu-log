
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
