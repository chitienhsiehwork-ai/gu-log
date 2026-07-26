## Context

gu-log 已經有很多機制層規格：frontmatter schema（`src/content/config.ts`）、Tribunal judge prompts（`.claude/agents/*.md`）、reader state、rewrite loop、評分維度、publish bar（`src/utils/tribunal-scores.ts`）。這些都回答「怎麼做」。

但「為什麼做、寫給誰、怎樣算贏」這層沒有家。它散在 `CONTRIBUTING.md`、`GU-LOG_WRITER_PROMPT.md`、`playbooks/*.md`、judge prompt 與 agent note 之間。每份單看都合理，合在一起卻會 drift——其中最痛的一條就是「GP / MP 到底是忠實翻譯，還是改寫成比較好懂的版本」，不同文件給的答案不一致，writer 與 judge 各自解讀，produce 出語氣不穩的稿子。

本 change 把這層抽成獨立的 `editorial-charter` capability。它不取代任何既有機制，而是站在它們之上，當所有後續規則要服從的北極星。design 這份檔記錄的是：為了做出這份 charter，實際在哪些地方有分岔、選了哪條、否決了哪條、以及為什麼。

## Goals / Non-Goals

**Goals:**

- 給 gu-log 的編輯哲學一個 first-principles 的單一家，讓散在各文件的說法降級成指向它的 derived view。
- 把「忠實翻譯 vs 重組敘事」收斂成一句可引用、可被 judge 與 writer 重複套用的權威定義，外加一個人類可手動跑的測試。
- 把 Lv 的隱性雙重身份（原創教學 / 長文導讀）顯性化成兩個具名 mode。
- 定義 MOBA register 的歸屬規則（跟聲音走，不跟系列走），保住 user 的差異化 POV 又不破壞可分享下限。
- 把 charter 接進既有開場 routing，讓它不是又一份沒人讀的散文。

**Non-Goals:**

- 不實作 on-site MOBA glossary section；它要另開 capability。
- 不調整 Fresh Eyes scoring code 或 publish bar / Tribunal PASS bar——那些屬於各自的 mechanism change。
- 不在本 change 內再次 rename GP / MP / SD / Lv / Mogu；品牌收斂由 `rebrand-mogu-gp-mp-taxonomy` change 負責（tasks 2.5）。
- 不在本 change 內重寫 `CONTRIBUTING.md` / `GU-LOG_WRITER_PROMPT.md` / playbook 的 operational rules；只補 stable charter pointer，並把衝突的 first-principles 重述降級成 derived view（tasks 2.x）。

## Decisions

**D1. Charter 做成新的 openspec capability，不直接寫進 writer prompt。**
把北極星寫成 `editorial-charter` spec，而不是在 `GU-LOG_WRITER_PROMPT.md` 開一節。*考慮過的替代方案：* 直接在 writer prompt 加「編輯哲學」段落——**否決**，因為那會讓 first-principles 又變成某份散文裡的一段，跟現在的 drift 同一種病。openspec capability 有 archive、stable path 與 routing 入口，可以被 enforce 成「動內容前必讀」，散文段落做不到這件事。

**D2. translate-vs-rewrite 收斂成單點權威「改 packaging，不改 payload」+ 原作者測試。**
GP / MP body 的忠實邊界只留一句權威定義，再配一個人類可跑的 author test（「原作者讀了會說『你把我講得更清楚』，還是『你讓我說了我沒說過的話』」）與自檢句（「我改的是怎麼講，還是講了什麼」）。*考慮過的替代方案：* 逐系列、逐情境列 do / don't 清單——**否決**，因為清單正是 drift 的來源（`CONTRIBUTING.md` 跟 `GU-LOG_WRITER_PROMPT.md` 各列一份、各自漂）。單句權威加可重複的測試，讓 judge 與 writer 有一個判準，而不是背兩份會分岔的清單。

**D3. Lv 拆成 `Lv-original` 與 `Lv-guided-reading` 兩個具名 mode。**
Lv 不再是「只做原創入門教學」的單一隱性身份。*考慮過的替代方案：* 維持單一身份，遇到長文導讀就當原創寫——**否決**，因為 user 明說有時要用 Lv 拆一篇又臭又長的 source，那時讀者該能一眼看到原文 ref。把導讀變成具名 mode、開頭強制 cite ref，比「偷偷把導讀當原創寫、又沒標來源」誠實，也讓 source fidelity 義務在兩個 mode 之間有清楚界線。

**D4. MOBA register 跟 voice 走，不跟 series 走；深詞用 glossary 當安全網 + 上下文自扛。**
Mogu / SD / Lv 的聲音可以有 MOBA flavor，翻譯 body 永遠素顏。深詞（含 Vainglory-specific terms）可以用，但上下文本身要扛得住概念；on-site MOBA glossary 上線前要就地自解或不用，上線後每個非顯而易見的深詞要能 link 到 glossary。*考慮過的替代方案 A：* 全面禁 MOBA——**否決**，那等於砍掉 user 的獨特 POV、丟掉 gu-log 的差異化。*考慮過的替代方案 B：* note 裡 MOBA 隨便堆——**否決**，違反 coworker shareability floor（user 想丟連結的同事不一定懂 MOBA）。折衷成「當下可讀 + 未來 glossary 安全網 + 過量 jargon 視為破壞下限」。Glossary section 本 change 不做（non-goal）。

**D5. Charter = policy 層，`add-editorial-spine-rebuild` = mechanism 層，衝突時 charter 先決定方向。**
charter 定義「寫給誰、怎樣算贏、忠實邊界在哪」；spine-rebuild 定義「一篇稿子骨架不好時怎麼修」。*理由：* 機制可以有很多種，方向只能有一個；先用 charter 定方向，再讓 spine / rebuild 機制服從，才不會出現「為了過某個修稿機制而違反北極星」的本末倒置。

**D6. Routing 走 `scripts/detect-env.sh` + playbook，不靠記憶，也不複製 charter 摘要。**
agent 動內容前必讀 charter，路徑由環境偵測 + 對應 playbook 指過去；archive 前用 active change path，archive 後用 stable spec path，spec 內雙寫兩條。*考慮過的替代方案：* 在每個 agent prompt 裡複製一份 charter 摘要——**否決**，複製就是製造下一個 drift。指向單一 spec path 才符合 SSOT 紀律。

## Risks / Trade-offs

- **「改 packaging，不改 payload」是判斷線，不是 lint 抓得到的硬規則。** 有主觀漂移的風險。→ 緩解：author test 與自檢句給了可重複的程序，Fact Checker 的 sourceBoundary / commentarySeparation gate 也在守 payload 不被竄改；判準從「背清單」變成「跑一個測試」，比純散文好稽核。
- **兩個 Lv mode 增加分類負擔**（這篇到底是 original 還是 guided-reading？）。→ 緩解：用「有沒有在拆一篇特定 source」+ 開頭有沒有 cite ref 當可操作的判別點，邊界清楚。
- **on-site MOBA glossary 還沒蓋（non-goal）。** 在它存在前，深詞沒有安全網。→ 緩解：glossary 上線前，writer 要嘛把 MOBA 詞停在淺層、要嘛當場自解；glossary 另開 capability。
- **Charter 住在 active change path 直到 archive。** routing 連結會在 archive 時換 path，有 stale link 風險。→ 緩解：spec 明文雙寫 active 與 stable 兩條 path，並寫清楚 archive 是切換點。
- **Meta-SSOT 風險：charter restate 了也住在 `CONTRIBUTING.md` / `GU-LOG_WRITER_PROMPT.md` 的系列 identity。** 若不把那些降級成 derived view，本 change 自己就製造了新 drift。→ 緩解：tasks 2.x 明確要求 archive 後把那些散文段落改成指向 charter 的 derived view，不是再抄一份。

## Migration Plan

無 code、無 data migration——這是一份 spec / doc capability。採用步驟：(1) 把 `CONTRIBUTING.md` / `GU-LOG_WRITER_PROMPT.md` / playbook 相關段落降級成指向 stable charter path 的 derived view（tasks 2.x）；(2) 在 playbook 開場路徑接上 charter 入口（tasks 3.x）；(3) sync 並 archive 本 change，讓 `openspec/specs/editorial-charter/spec.md` 與所有 pointer 在同一個 PR 內一起生效。Rollback = revert 本 change；不影響任何 post、不需重跑任何 scoring。

## 延後處理

- **品牌名已由獨立 change 收斂。** `rebrand-mogu-gp-mp-taxonomy` 將 persona 與 automation identity 統一為 Mogu，並把 GP / MP 定為 storage、UI 與 writer contract 的正式系列名；本 change 只消費該結果。
- **on-site MOBA glossary section 的具體設計延後。** 本 change 只定義可立即遵守的前置行為與 glossary 上線後的 policy，不實作 glossary。
- **OpenSpec CLI 已恢復。** 本 change 在 archive 前必須用 installed CLI 跑過 strict validation（tasks 5.1）。
