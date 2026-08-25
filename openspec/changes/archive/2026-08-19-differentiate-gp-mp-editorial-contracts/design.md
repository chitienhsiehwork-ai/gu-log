## Context

目前有三個彼此衝突的真相：stable editorial charter 把 GP 與 MP 都當忠實翻譯；非 GP pipeline 已讓 MP 走 `write → review → refine → Tribunal rewrite`；公開 UI 又用「翻譯自／原文出處／翻譯 pipeline」描述 MP。結果是 generator、judge、讀者與實際 corpus 對 MP 的責任歸屬理解不同。

本 change 採用 voice owner 作為主邊界：GP 正文是來源作者在說話；MP 正文是 Mogu 在說話。來源仍是 MP 的事實基礎，不是由 Mogu 任意冒充的素材庫。

三個獨立 value review 都建議縮小實作：沿用既有非 GP pipeline，不建立新的 rewrite framework、prefix 或內容 schema。審查唯一分歧是是否同時新增阻擋發布的 `mp-grounding` manifest；這會改變全站 publish policy 與 artifact lifecycle，超出本次「先試新的 GP／MP 定義」的授權範圍。

## Goals / Non-Goals

**Goals:**

- 讓規格、writer、reviewer、judge、UI 與測試共享同一個 GP／MP contract。
- GP 保留完整 translation fidelity；MP 可依文章需要貼近來源或自由重建，沒有最低改寫幅度。
- 讓 MP 的自由以 claim closure、正確歸因與可查證性為硬邊界。
- 讓 MoguNote 能以 Mogu 第一人稱描述實際發生的 editorial／tool interaction 或明顯奇幻的 persona 經歷，同時阻止挪用來源作者經歷與看似真實的人類假履歷。
- 以一篇「觀點好但原文文筆不理想」的單一來源文章作為 MP acceptance case。
- 保持現有 ticket、route、counter、`sourceUrl` 與 pipeline routing。

**Non-Goals:**

- 不新增 `mp-pipeline`、第五個系列、editorial mode 或 per-article mode frontmatter。
- 不把貼近來源的 MP 與自由重建的 MP 拆成子模式，也不規定最低改寫比例。
- 不在第一版開放多個同權重主要來源；額外查證資料仍以 inline citation 表達。
- 不 mass rewrite 既有 MP，也不倒填新的驗證狀態。
- 不修改現行 Tribunal best-effort publish policy，亦不新增 manifest／hash lifecycle。
- 不要求 MP body 使用第一人稱，也不把 MoguNote 的 persona 許可擴張成杜撰看似真實的人類生平或證言。

## Decisions

### 1. 先按 reader job，再按 voice owner 分流

文章若主要在分步教會讀者理解一個概念或一篇來源，使用 Lv。其他文章再看正文聲音的 owner：來源作者是 GP、Mogu 是 MP、ShroomDog 是 SD。這能避免 MP 與 `Lv-guided-reading` 因同樣可大幅重組來源而失去邊界。

替代方案是只按來源長短分流。這會讓同一個主張因來源媒介不同而換系列，也無法說明 MP 與 Lv 對讀者的承諾，因此不採用。

### 2. MP 沒有最低改寫幅度，事實邊界以 claim closure 為單位

MP 可保留來源覆蓋與順序、貼近翻譯／改寫，也可完全省略一個來源主張或從頭重建文章；接近或遠離來源本身都不是品質判準。貼近來源的 MP 仍由 Mogu 擁有正文聲音，不自動取得 GP 的完整翻譯 fidelity 承諾。一旦保留來源主張，就必須保留會控制它的 speaker、條件、hedge、caveat、證據範圍與信心水準。Mogu 可提出自己的推論或反對意見，但不得把它掛回來源作者名下。

這比「完整覆蓋來源」更符合 Mogu 寫自己文章的目的，也比只寫「不得捏造」更能防止 cherry-pick、觀察變因果、benchmark 變 production 等常見失真。

### 3. 重用既有 MP 路徑，只改 prompt contract 與判準

GP 繼續走 `source-translate → source-preservation`；MP 繼續走既有 `write → review → refine → Tribunal rewrite`。`write`、`review`、`refine` data 會攜帶 series prefix，讓 template 只對 MP 套用 source-grounded 規則，不改 SD／Lv 行為。

Fact Checker 將 GP 的 completeness／order fidelity 與 MP 的 grounding／attribution 拆開；Librarian 只要求 MP 使用的 claims 可回溯，不因省略未使用材料扣分；Tribunal Writer 不再把 MP 的 Mogu 核心分析趕進 MoguNote。

替代方案是建立 `mp-grounding/v1` hard gate。它需要新的 sealed artifact、content hash、deploy validation 與 failure policy，屬於獨立的發布安全 change；本 change 會以 semantic fixtures 固定應判錯的案例，但不假裝已建立這套不可補償的發布 gate。

### 4. MP 公開標示採「來源材料／依來源撰寫」

MP 不標示為「翻譯自」或「原文出處」，也不假裝成無來源的 original。zh-TW 使用「來源材料」與「Mogu 依來源撰寫」；English 使用 `Source material` 與 `Written by Mogu from the source`。technical details 使用三種內容模式：GP translation、MP source-grounded writing、SD／Lv writing。

既有 MP 也使用中性來源標示，因為它不宣稱每篇都採自由重建，更不宣稱通過新 gate；只修正錯誤的 translation identity。

### 5. MoguNote 在 GP 是 provenance boundary，在 MP 是選配的第一人稱 persona surface

GP 的 Mogu commentary 必須與來源作者正文隔離。MP 正文本來就是 Mogu voice，核心分析可直接寫在 body；MoguNote 只能作為選配的側註，不得為了形式或 scoring 強迫文章出現「Mogu 裡面的 Mogu」。MoguNote 可用第一人稱表達反應與立場、描述實際發生的 editorial／tool interaction，或講一眼可辨識的奇幻 persona 經歷；它不得把來源作者的實驗、團隊或人生事件改成 Mogu 親歷，也不得杜撰合理讀者可能信以為真的人類工作、旅行、關係、購買或其他生平證言。

### 6. 收掉重複的通用 editorial-mode 提案

`add-editorial-spine-rebuild` 的核心需求是讓好觀點脫離死骨架；MP 的 voice-owner contract 已直接提供這個自由。新的定義保留 strip test 與「可重建骨架」的原則，但不採用正好三個 mode、固定刪減比例或所有 judge 強制新增 schema 欄位。舊 proposal 應以 superseded 理由收束，避免兩個 active change 同時規範相同 surface。

## Risks / Trade-offs

- **[MP 自由選材被濫用成 cherry-pick]** → prompt、judge 與 fixtures 明訂 claim closure；省略整個 claim 可以，保留 claim 卻刪 controlling caveat 必須 fail。
- **[Mogu persona 被誤解為可杜撰可信的人類生平]** → writer／reviewer／Fact Checker 明分三層：實際發生的 editorial／tool interaction 可寫，明顯奇幻 persona 可寫，挪用來源作者經歷或看似真實的人類假履歷必須 fail；既有 pronoun lint 繼續阻止 MP body 冒充 ShroomDog。
- **[現有 Tribunal FAIL 仍可能 best-effort publish]** → 本 change 不宣稱提供新的發布安全保證；若要不可補償的 grounding gate，另開 change 設計 artifact lifecycle 與 deploy ordering。
- **[舊 MP 品質不一，統一新 label 可能過度宣稱]** → UI 使用中性「來源材料／依來源撰寫」，不顯示新規則已驗證；不回溯改文。
- **[MP 與 Lv／SD 邊界變模糊]** → 先用 reader job 分 Lv，再用 voice owner 分 MP／SD；source 是否存在或長短不是唯一分類條件。
- **[中英文 UI 漂移]** → 以配對 render test／snapshot 檢查首頁、系列頁、文章頁及 technical details。

## Migration Plan

1. 先更新 stable contract 的 delta spec、writer／judge 派生文件與 semantic tests。
2. 同步 zh-TW／English reader labels，不改既有 URL、frontmatter 或 counter。
3. 以 deterministic prompt／routing fixtures 驗證 MP 可貼近來源或只保留一個完整論點並重建文章；錯誤 speaker、遺失 controlling caveat、挪用來源經歷、可信的人類假履歷與新造因果則由 correctness reviewer 逐 scenario 做 binary Tier-2 對帳。本 change 不以 nondeterministic LLM run 冒充新的 publish gate。
4. 對 reader-visible copy 做雙語與雙 theme UI QA。
5. 不 mass rewrite 既有 MP；新文與日後實質修改的 MP 採新 contract。

Rollback 只需回復 prompts、judge rules 與 UI copy；沒有資料 migration 或 schema rollback。

## Open Questions

無。GP／MP 定義已由 user 明確拍板；`mp-grounding` publish gate 刻意留給獨立 change。
