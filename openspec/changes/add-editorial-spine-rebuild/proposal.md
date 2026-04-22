## Why

Tribunal 現在很會把稿子拉到 publish-safe：抓 pronoun clarity、補 glossary links、修 source drift、糾正 identity linking、壓掉 AI 味。這些都重要，但它主要在做 **error correction**，不是 **narrative transformation**。

最近觀察幾篇 tribunal log（例如 SP-91、SP-95、SP-81）可以看到同一個 pattern：

- 開頭有 hook，結尾也有 callback
- 中段仍然被 judge 判成 linear feature documentation / listicle skeleton
- rewrite 後會更正確、更完整、更穩，但不一定更想讀、更想轉發

這代表現在 pipeline 缺的不是「再嚴一點的 QA」，而是**辨識 structural fail，並允許直接 rebuild 骨架**的編輯層。

另一個觀察是：真正能把普通文往神文推的，常常不是多一個比喻，而是抓到那個可以當全文 spine 的核心畫面。像「消防車澆多肉」這種畫面，如果只是段落裡的一句金句，它只是裝飾；如果它能統一開頭 hook、中段展開、結尾 worldview callback，它就不是花，是骨頭。

因此本 change 要把 tribunal / editorial loop 從「修錯」升級成「先判斷這篇應該怎麼長，再決定 polish / restructure / rebuild」。

## What Changes

### 新增 editorial triage：先分 `surface-fail` vs `structural-fail`

在現有 mechanical / factual QA 之外，新增一層 editorial triage，判斷稿件失敗原因屬於哪一種：

- `surface-fail`
  - pronoun clarity 違規
  - glossary / identity / links 缺漏
  - source fidelity / wording drift
  - phrase-level AI 味
- `structural-fail`
  - strip test 後骨架仍是 listicle / reference doc / linear report
  - 有資訊推進，沒有 tension 推進
  - 開頭和結尾能打，中段死亡
  - 比喻存在，但沒有變成 spine

`surface-fail` 走 rewrite / polish。`structural-fail` 不再只做局部修文，而是進 `restructure` 或 `rebuild`。

### 新增三種 editor mode：`polish` / `restructure` / `rebuild`

Tribunal-writer 或後續 editorial writer 不再只有單一 rewrite 模式，而是明確區分：

- `polish`
  - 保留原骨架
  - 修 clarity / links / fidelity / local phrasing
- `restructure`
  - 保留 thesis 與主要材料
  - 允許重排段落、改 section order、刪除 20–40% 冗段
  - 把 listicle / doc-flow 改成有 tension 的 explainer arc
- `rebuild`
  - 只保留 thesis、source truth、關鍵 evidence、少量高價值段落
  - 允許砍掉 30–50% 原文，重新長出新骨架
  - 適用於「原文能救的不是 phrasing，而是 framing」的情境

### 新增 `core spark` / `spine candidate` 輸出欄位

當 editorial judge 判稿時，不只輸出缺點，還要輸出：

- `coreSpark`
  - 這篇最值得放大的核心觀點 / 衝突 / punchline 是什麼
- `spineCandidate`
  - 哪個畫面、比喻、角色關係、反轉最適合當全文骨頭
- `recommendedForm`
  - 這篇最適合被改成哪種文：argument / explainer-with-arc / translation-with-thesis / journey / case study
- `cutMercilessly`
  - 哪些 section 應該直接砍，因為它們只是在稀釋主線

這讓 rewrite 不再是平均補洞，而是優先放大真正能讓文章變神的那個核心。

### 新增 metaphor-as-spine 準則

定義什麼叫「比喻是骨頭，不是裝飾」：

- 開頭：它能做 hook，而不只是好笑
- 中段：多個 section 能持續回扣同一個畫面，而不是每段換一個比喻
- 結尾：它能升級成 worldview / thesis，不只是 callback
- strip test：拿掉它之後，文章會失去主線，而不是只失去一個亮點

以「消防車澆多肉」為例：

- 如果它只是在某段吐槽 AI overkill，它只是花
- 如果它能統一全文在談「尺度感失靈」「工具火力過剩」「問題很小，系統卻過度動員」，那它就是 spine

### 新 capability：`editorial-spine-rebuild`

新增一個 capability，定義：

- 何時一篇稿子應該從 rewrite 升級成 restructure / rebuild
- 何時比喻 / 畫面可視為 spine candidate
- writer 在 `rebuild` 模式下可以改動的範圍（重排、刪減、章節重命名、callback 重建）
- 哪些東西不能動（facts、frontmatter truth、source thesis fidelity）

### 被排除的項目

- **取代現有 mechanical QA**：不取代。clarity / glossary / identity / links 仍然要存在，甚至應該更前移到 pre-lint。
- **要求每篇文章都走 story form**：不做。目標不是把所有文章都寫成同一種腔，而是讓每篇找到最適合自己的強形態。
- **要求每篇都必須有比喻 spine**：不做。有些文章的 spine 可能是論點、衝突、角色關係或結構反轉，不一定是比喻。
- **直接改 scoring bar**：這不是第一步。先做 triage + mode split，再討論 bar 調整。

## Impact

### Affected specs

- `editorial-spine-rebuild`（新 capability）
- 可能會影響既有 tribunal / vibe scoring spec 的 editorial 部分，但本 proposal 先不直接改現有 spec，避免 scope 爆炸

### Affected code / prompts

若之後實作，預期會碰：

- tribunal editorial judge prompt（新增 triage、coreSpark、spineCandidate）
- tribunal-writer prompt（新增 `polish` / `restructure` / `rebuild` mode）
- pass-bar / orchestration（新增 structural-fail 分流）
- 可能新增 pre-lint 階段，把 pronoun / glossary / identity 這種 deterministic 問題前移

### Expected outcome

這個 change 的目標不是把文章變得更安全，而是把 pipeline 從「把 6.5 分修到 8 分」往前推，開始有能力把「骨架普通的文章」重建成真的有抓力的文章。

一句話：

不是把每段都修得更好，而是更早辨識「哪一條主線值得活下來」，然後讓其他東西都為它服務。
