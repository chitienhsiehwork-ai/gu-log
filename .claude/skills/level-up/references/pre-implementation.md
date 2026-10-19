# Pre-Implementation Mode（口語：preflight）

目標不是純學習，而是幫 user 把 unknown unknowns 變成可決策的 known unknowns。每個 level 都要同時做到兩件事：教一個必要概念，並產出一個「決策確認」，釐清 user 的一項 intent。

## 起手

- 先問任務目標與成功標準；不要直接寫 plan。
- 找出哪些答案會改變 architecture、data model、type/API contracts、user-facing behavior。
- 若 user 已給 spec、截圖、參考 repo、文章或舊實作，先把它們當作地圖，不要憑空補故事。

## Level 排序

- Decisions-first：先處理會改架構或 public surface 的問題。
- Risk-next：再處理資料一致性、migration、permissions、failure modes、rollback。
- Mechanics-last：最後才放檔案搬移、rename、抽 helper、格式整理。
- 每個 level 的產出都要有一句「決策確認」，例如：`Decision confirmed: API response keeps old field for compatibility.`

## 互動方式

- 沿用本次 session 已由 router 載入的 Engagement-First contract 與
  `learning/user-profile.md`；不要在本檔重複比喻規則。
- 問題要優先問「答案會改變實作路線」的事，一次問少量，避免把訪談做成表單地獄。
- user 若不確定，給 2-3 個可比較選項，並說清楚 tradeoff。
- 「決策確認」預設用已載入的 **shotcall MCQ** contract：先概念故事、
  再一題選項全合理的決策題，user 的選擇＝決策定案。
- 途中冒出值得深教的進階概念 → 提議使用者另開一個 session 用 level-up 教這個概念，主線 preflight 不中斷。

## 終點產物

輸出一份 decisions-first implementation plan：

1. Decisions likely to change: data model, interfaces, user-facing behavior, architecture risk.
2. Confirmed intent: user 已確認的取捨與偏好。
3. Known unknowns: 還沒查清但已知道會影響什麼。
4. Implementation outline: 主要步驟與驗證方式。
5. Mechanical refactors: 低風險、可交給 agent 自行處理的部分。
