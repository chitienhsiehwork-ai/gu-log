## Context

`differentiate-gp-mp-editorial-contracts` 已把 GP 定為來源作者擁有聲音的忠實翻譯，把 MP 定為 Mogu 擁有聲音的 source-grounded article。實作雖允許 MP 選材、重排或重建，部分 derived prompts 仍以「不是 translation」描述 MP，容易反向形成「MP 必須離來源夠遠」的隱性 gate。另一方面，全面禁止 Mogu `lived experience` 會把 MoguNote 中誠實的工作經驗、第一人稱反應與明顯奇幻 persona 玩笑一起消除。

這次變更只調整編輯契約與其 derived surfaces，不新增資料模型、系列、pipeline 或 reader-facing mode。

## Goals / Non-Goals

**Goals:**

- 讓 MP 的形式從貼近來源的 Mogu rewrite 到從零建立文章都合法，且沒有最低改寫距離。
- 讓 reviewer 只依 voice ownership、retained-claim grounding 與文章品質判斷 MP，不以結構接近來源本身扣分。
- 讓 MoguNote 保有第一人稱反應、真實工作經驗與明顯奇幻 persona 經歷。
- 阻止 Mogu 把來源作者經驗或杜撰的人類履歷冒充成自身真實證詞。

**Non-Goals:**

- 不建立 `MP-rewrite`／`MP-original` submode 或新 frontmatter 欄位。
- 不放寬 fact、quote、number、causality、citation、speaker chain 或 claim-closure grounding。
- 不把 MP 重新定義為有完整 fidelity promise 的 GP 替代品。
- 不要求 MP body 使用第一人稱，也不把 MP 的核心分析趕回 MoguNote。

## Decisions

### 1. 用 voice ownership 定義系列，不用 edit distance

MP 可以翻譯或貼近重寫部分乃至大部分 source，也可以完全重建。只要正文由 Mogu 負責、來源衍生 claim grounded，就不因接近來源而 fail。替代方案是要求 MP 一定要重排或新增 thesis；這能製造外觀差異，卻會把使用者不在乎的 diff 大小凌駕於讀感與作者責任，因此不採用。

### 2. MP 維持單一 mode

不新增 close rewrite／original 等 submode。形式是一條連續光譜；把它離散化只會增加 schema、routing、judge 與 UI drift，卻不改善讀者判斷。

### 3. Experience gate 判斷「是否冒充可信真實證詞」

MoguNote 可以用第一人稱表達立場、真實 editorial/tool interaction，以及合理讀者一眼可辨識為 persona 的奇幻經歷。Fact Checker 仍拒絕把來源作者經驗轉嫁給 Mogu，以及無依據但看似可信的人類履歷或事件。替代方案是全面禁止經驗敘事；它較容易 lint，卻會誤殺 Mogu voice。

### 4. 契約靠 scenario 與 prompt regression 保持一致

穩定 spec 提供 close-form MP、far-form MP、allowed persona experience 與 false human testimony scenarios；writer／reviewer／judge prompts 必須映射同一語意。Deterministic tests 檢查關鍵 contract 存在，語意 reviewer 再逐 scenario 做 binary 對帳，不新增假裝能評文筆的 regex gate。

## Risks / Trade-offs

- [貼近來源的 MP 可能被誤認為 GP] → UI 繼續標示 MP 為 Mogu-authored source writing；prompt 強調不承諾 GP completeness/fidelity。
- [Persona 奇幻與假證詞界線需判斷語境] → spec 用「合理讀者是否會當成可信人類履歷」作 materiality test，並提供正反 scenarios；不嘗試用 blocklist 硬判。
- [Derived prompts 漏改造成角色 drift] → 掃描 writer、reviewer、Fact Checker、Librarian、Tribunal、Vibe 與 Mogu Picks surfaces，並以 focused contract tests 固定。
- [同一 PR 新增第二個 OpenSpec archive] → 兩個 change 各自完整 propose／review／apply／archive，保留獨立決策與 rollback surface。

