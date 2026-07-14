# Implementation Understanding Loop

這是 `level-up` 的 implementation mode 總覽。它把任務切成 pre / during / post 三段，用來暴露 unknowns、保留決策脈絡、確認 user 在 merge/push 前真的理解關鍵改動。

## 何時觸發

- 陌生 codebase、陌生技術、長任務、多 agent 接力。
- 會改 data model、type/API contracts、architecture、user-facing behavior。
- guardrail / SSOT / prompt / skill / workflow 這類會改變 agent 行為的檔案。
- user 明確要求 implementation plan、decision review、post-implementation note、merge-readiness quiz。

## 何時不要

- typo、純格式化、機械 rename、低風險小 patch。
- user 已明確要求只做狹窄修補，且沒有架構或使用者可見決策。
- 已有清楚 spec、diff 很小、review 不需要額外理解材料。

## 共同原則

- **Decisions-first, mechanics-last**：先放 user 最可能想改或想審的決策，機械性重構沉底。
- Pre 示例：`Write an implementation plan, but lead with the decisions most likely to change: data model, type/API contracts, and user-facing behavior.`
- Post 示例：`Write a post-implementation note, but lead with design choices, data model, interfaces, and user-facing behavior; bury mechanical refactoring at the bottom.`
- HTML 是可選輸出，不是預設義務；只有 user 明確要求或內容真的需要視覺結構時才用。

## 三段如何串起來

- **Pre**：把 unknown unknowns 變成可決策的 known unknowns，產出 decisions-first implementation plan。
- **During**：如果偏離 plan、做保守假設、或遇到會影響 review 的決策，記在既有 PR body / report / handoff note；長任務或多 agent 接力才開獨立 notes。
- **Post**：用 during 的決策紀錄加上 diff 當素材，產出 decisions-first 理解報告與 quiz。

## 路由

口語觸發詞（user 的慣用叫法）：**preflight** ＝ pre-implementation，**debrief** ＝ post-implementation。

- Pre-implementation coaching（「preflight」「run preflight」）：讀 `pre-implementation.md`。
- Post-implementation understanding 或 merge/push 前 quiz（「debrief」「debrief time」）：讀 `post-implementation.md`。
- during notes 是一般 implementation 行為，不是純教學；只在需要形成 post quiz 素材時拉進來。
