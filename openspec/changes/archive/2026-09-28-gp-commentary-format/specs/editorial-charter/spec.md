## MODIFIED Requirements

### Requirement: Lv MUST support original and guided-reading modes

Lv SHALL 支援兩種編輯 mode：

- `Lv-original`
- `Lv-guided-reading`

`Lv-original` SHALL 從零教一個概念，沒有 source fidelity 義務。在此 mode 中，gu-log MAY 使用原創說明、類比與深 MOBA reference，只要它們能幫忙扛住概念。

`Lv-guided-reading` SHALL 用 Lv 拆解一篇又長又難或很密的 source article。在此 mode 中，文章 SHALL 在開頭 cite source ref，讓 coworker-floor reader 想追原文時一眼看得到。

Lv-guided-reading 的讀者任務是分步學會這篇 source：它是在「教」，不是翻譯，也不是 GP 導讀（GP 帶讀者知道這篇值不值得讀、gu-log 怎麼看，再回原文讀）。它 MAY 只挑有用的一塊、簡化並大幅重組；它 SHALL NOT 被要求 cover 整篇 source。

#### Scenario: Lv-original has no source fidelity obligation

- **WHEN** Lv article 沒有依附特定 source，而是從零教概念
- **THEN** 文章 SHALL 被視為 `Lv-original`
- **AND** 它 MAY 自由使用原創類比、例子、MOBA reference 與說明結構

#### Scenario: Lv-guided-reading cites source at the opening

- **WHEN** Lv article 是在拆一篇特定長文或難文
- **THEN** 文章 SHALL 被視為 `Lv-guided-reading`
- **AND** 開頭 SHALL cite source ref
- **AND** source ref SHALL 早到讀者不用找半天就能追原文

#### Scenario: Lv-guided-reading may select useful material only

- **WHEN** Lv-guided-reading 發現 source 只有其中一塊對 gu-log 讀者有用
- **THEN** 它 MAY 只教那一塊
- **AND** 不必摘要或翻譯整篇 source

#### Scenario: Lv-guided-reading does not distort attributed claims

- **WHEN** Lv-guided-reading 轉述 source 說了什麼
- **THEN** 那句話 SHALL 保留 source 意思
- **AND** 不得因為 Lv 可以大幅重組，就扭曲掛在人家名下的 claim

#### Scenario: Lv-guided-reading labels gu-log extensions

- **WHEN** Lv-guided-reading 加上 user 的延伸、Mogu 的類比或 gu-log 自己的 commentary
- **THEN** 文章 SHALL 清楚標出邊界
- **AND** 不得把延伸講得像 source 自己的 claim

---

### Requirement: Gu-log series MUST have single-sentence identities

gu-log SHALL 使用以下四系列一句話定位：

- GP = ShroomDog 精選導讀：ShroomDog 挑的外部好文，由 Mogu 用自己的話講重點、加上 gu-log 的看法，再帶讀者回原文
- MP = Mogu 消化單一主要來源後，由 Mogu 擁有正文聲音並寫成自己的 source-grounded article
- SD = ShroomDog 原創 essay，沒有 source fidelity 義務；ShroomDogNote 是 user 本人聲音
- Lv = 原創入門教學，類比扛概念；`Lv-guided-reading` 以教會讀者理解 source 為主要 reader job

#### Scenario: GP identity is cited

- **WHEN** doc、prompt 或 judge 描述 GP
- **THEN** 它 SHALL 把 GP 描述為 ShroomDog 挑選來源、由 Mogu 撰寫的導讀
- **AND** SHALL NOT 把 GP 描述成來源文章的翻譯或完整摘要

#### Scenario: MP identity is cited

- **WHEN** doc、prompt 或 judge 描述 MP
- **THEN** 它 SHALL 把 MP 描述為 Mogu-authored source-grounded article
- **AND** SHALL NOT 把 MP 描述成來源作者的忠實翻譯、完整摘要或 ShroomDog 原創

#### Scenario: SD identity is cited

- **WHEN** doc、prompt 或 judge 描述 SD
- **THEN** 它 SHALL 把 SD 描述為 ShroomDog 原創 essay
- **AND** SHALL 把 ShroomDogNote 視為 user 本人聲音，而不是 source commentary

#### Scenario: Lv identity is cited

- **WHEN** doc、prompt 或 judge 描述 Lv
- **THEN** 它 SHALL 預設把 Lv 描述為原創入門教學
- **AND** 當 Lv 在教一篇 source article 時，SHALL 區分 `Lv-guided-reading` mode

### Requirement: MOBA register MUST follow voice, not series

MOBA 味 SHALL 跟著聲音走，不跟著系列走。Mogu 擁有聲音的 GP 導讀、MP body 與 MoguNote，以及 SD、Lv SHALL 被允許使用 MOBA flavor。直接引用的來源原話仍屬於來源作者，SHALL 保持素顏，不得因站內 persona 沾上外加 MOBA flavor。

在作者優先北極星下，深 MOBA 詞，包含 Vainglory-specific terms，SHALL 被允許使用。On-site MOBA glossary 上線前，非顯而易見的深詞 SHALL 在當下自然解釋，或 SHALL 改用較廣、陌生同事能懂的概念。Glossary 上線後，每個非顯而易見的深詞 SHALL 能 link 到該站內 glossary。

類比本身 SHALL 扛住概念。讀者 SHALL 能只靠上下文理解主要論點；Glossary SHALL 是深詞安全網，不是把一整段塞滿 jargon 的許可證。

#### Scenario: translated body remains plain

- **WHEN** 文章翻譯並直接引用來源的原話
- **THEN** 引文的譯文 SHALL 保持 plain
- **AND** SHALL NOT 加入 MOBA-flavored wording、玩笑或外加類比
- **AND** Mogu 的吐槽與類比 SHALL 放在引文之外

#### Scenario: Mogu voice may use MOBA flavor

- **WHEN** GP 導讀或 MP body 使用 Mogu 的類比、幽默或 MOBA flavor 建立自己的論點
- **THEN** 該寫法 SHALL 被允許
- **AND** SHALL NOT 因它出現在 body 而非 MoguNote 就判 commentary separation fail
- **AND** factual premise 與來源歸因仍 SHALL 遵守 MP grounding contract，GP 導讀適用同一套規則

#### Scenario: deep terms remain readable before glossary launch

- **WHEN** on-site MOBA glossary 尚未上線
- **AND** Mogu voice、SD prose 或 Lv explanation 使用非顯而易見的 MOBA / Vainglory-specific term
- **THEN** writer SHALL 在當下自然解釋該詞，或改用較廣的概念
- **AND** 文章 SHALL NOT 要求讀者靠外部搜尋才能理解論點

#### Scenario: deep terms require glossary support after launch

- **WHEN** on-site MOBA glossary 已上線
- **AND** Mogu voice、SD prose 或 Lv explanation 使用非顯而易見的 MOBA / Vainglory-specific term
- **THEN** 該詞 SHALL 可 link 到 on-site MOBA glossary
- **AND** 文章 SHALL NOT 依賴 glossary 作為讀懂論點的唯一方式

#### Scenario: excessive jargon violates the shareability floor

- **WHEN** 一段文字堆了多個深 MOBA term，導致 coworker reader 必須一直停下來查
- **THEN** 該段 SHALL 違反 shareability floor
- **AND** glossary entry 的存在 SHALL NOT 抵銷這個違規

### Requirement: Series selection MUST use reader job and voice ownership

gu-log SHALL 依固定 precedence 分流：先判斷主要 reader job 是否為分步教會讀者理解概念或來源；若是，文章 SHALL 使用 Lv。只有文章不屬於 Lv 時，才 SHALL 依正文 voice owner 與來源由誰挑選區分其餘系列：SD 由 ShroomDog 擁有正文聲音；GP 與 MP 都由 Mogu 擁有正文聲音，GP 是 ShroomDog 挑選來源、帶讀者看重點與 gu-log 的看法再回原文的導讀，MP 是 Mogu 以來源為材料、提出自己主張的文章。來源媒介、長短或是否引用外部資料 SHALL NOT 單獨決定系列。

#### Scenario: teaching a source routes to Lv

- **WHEN** 文章主要承諾是分步教會讀者理解一篇 source 或概念
- **THEN** 文章 SHALL 使用 Lv 或 `Lv-guided-reading`
- **AND** SHALL NOT 只因 Mogu 會大幅重組來源就自動使用 MP

#### Scenario: Mogu thesis routes to MP

- **WHEN** 文章主要承諾是提出 Mogu 自己的主張，來源作為材料與證據
- **AND** 文章的主要 reader job 不是分步教會讀者理解概念或來源
- **THEN** 文章 SHALL 使用 MP
- **AND** SHALL NOT 因來源是長文、tweet 或 thread 而改變 voice-owner contract

#### Scenario: ShroomDog voice remains SD

- **WHEN** 正文的判斷與經歷屬於 ShroomDog 本人
- **AND** 文章的主要 reader job 不是分步教會讀者理解概念或來源
- **THEN** 文章 SHALL 使用 SD
- **AND** SHALL NOT 因引用外部來源而改成 MP

#### Scenario: ShroomDog-authored tutorial still routes to Lv

- **WHEN** ShroomDog 以自己的聲音撰寫文章
- **AND** 主要 reader job 是分步教會讀者理解概念或來源
- **THEN** 文章 SHALL 使用 Lv
- **AND** SHALL NOT 只因 voice owner 是 ShroomDog 而改用 SD

#### Scenario: ShroomDog-picked source routes to GP

- **WHEN** ShroomDog 挑選一篇外部文章，要 gu-log 帶讀者看重點與 gu-log 的看法
- **AND** 文章的主要 reader job 不是分步教會讀者理解概念或來源
- **THEN** 文章 SHALL 使用 GP
- **AND** SHALL 遵守 GP 導讀格式，並帶 `source-distance-stamp` 定義的來源距離章

### Requirement: GP 整篇翻譯 MUST 先取得來源作者同意才可公開

GP 整篇翻譯屬於改作，SHALL 只在取得來源作者對整篇翻譯的同意之後公開；gp-pipeline 目前不提供整篇翻譯流程（見 `gp-source-preservation` 的退役紀錄）。沒有同意紀錄的既有 GP 翻譯 SHALL 依 `post-takedown` 下架成墓碑頁。

GP SHALL 以 ShroomDog 精選導讀的格式發布（見「GP body MUST be a Mogu-written reading guide」）。有外部來源的 GP 文章 SHALL 帶有效的來源距離章（見 `source-distance-stamp`）；pre-commit 與 CI 以章把關，SHALL NOT 再因為系列是 GP 就擋下新文章。

GP 系列頁與首頁的 GP 區塊 SHALL 只列出公開的 GP 導讀；沒有任何公開導讀時，SHALL 顯示中性的空狀態，不宣稱 GP 暫停或改版中。自寫示範文 GP-1 不是第三方文章的翻譯，SHALL NOT 被下架，也 SHALL NOT 列在 GP 系列頁與首頁。

本要求 SHALL NOT 限制 MP、SD 或 Lv 的寫作與發布。

#### Scenario: 新 GP 草稿

- **WHEN** 一個變更新增有外部來源的 `GP-PENDING` 或 `GP-N` 文章，但文章沒有有效的來源距離章
- **THEN** pre-commit 與 CI SHALL 失敗
- **AND** 診斷 SHALL 指出要用 gp-pipeline 產生導讀或重新蓋章

#### Scenario: 帶有效章的 GP 導讀

- **WHEN** 一個變更新增 GP 導讀與它的英文版，兩個檔案都帶有效的來源距離章
- **THEN** pre-commit 與 CI SHALL NOT 因為系列是 GP 而失敗

#### Scenario: 既有 GP 翻譯沒有同意紀錄

- **WHEN** 一篇既有 GP 翻譯沒有來源作者同意的紀錄
- **THEN** 它 SHALL 以墓碑頁下架

#### Scenario: 讀者開啟 GP 系列頁

- **WHEN** 讀者開啟 `/gu-log-picks` 或 `/en/gu-log-picks`
- **THEN** 頁面 SHALL 回 200，只列出公開的 GP 導讀
- **AND** 頁面 SHALL NOT 列出墓碑或 GP-1
- **AND** 沒有公開導讀時，頁面 SHALL 顯示中性的空狀態，SHALL NOT 宣稱 GP 暫停或改版中

#### Scenario: 其他系列不受影響

- **WHEN** 一個變更新增或修改 MP、SD 或 Lv 文章
- **THEN** 本要求 SHALL NOT 擋下該變更

## REMOVED Requirements

### Requirement: GP body MUST be faithful translation

**Reason**: GP 不再是整篇翻譯。整篇翻譯的 GP 已依 `post-takedown` 全數下架，翻譯流程也已退役；GP 改成 Mogu 撰寫的導讀，這條要求保留來源作者聲音、論證順序與完整覆蓋的忠實翻譯契約，正好跟導讀的目標相反。它的情境全部以翻譯為前提，OpenSpec 不允許 MODIFIED 刪情境，所以整條移除、以新名稱重新定義 GP 正文。

**Migration**: GP 正文改由「GP body MUST be a Mogu-written reading guide」定義；主張的條件、歸屬與不得捏造沿用 MP 的 claim closure 規則；GP 距離原文多近由 `source-distance-stamp` 的章判定。沒有需要遷移的文章：所有整篇翻譯的 GP 都已是墓碑，GP-1 是自寫示範文。

## ADDED Requirements

### Requirement: GP body MUST be a Mogu-written reading guide

GP 正文 SHALL 是 Mogu 為 ShroomDog 挑選的單一主要來源寫的導讀：讀者任務是知道這篇來源有什麼值得看、gu-log 怎麼看，然後回去讀原文。正文聲音 owner SHALL 是 Mogu。ShroomDog 本人的看法 SHALL 只放在 `ShroomDogNote`，內容 SHALL 來自 ShroomDog 本人；自動化 SHALL NOT 產生或代寫 `ShroomDogNote`。

GP 導讀 SHALL 包含：開頭交代來源與值得讀的理由；用 Mogu 自己的話講重點；gu-log 的評論或看法；結尾帶讀者回原文。GP 導讀 SHALL NOT 翻譯整段原文、照原文順序一句對一句轉述，或重講過多原文；這三件事由 `source-distance-stamp` 的章判定，writer 與 reviewer SHALL NOT 另訂門檻。標題與摘要 SHALL 由 Mogu 自己寫，SHALL NOT 直譯原文標題。

GP 保留的來源主張 SHALL 遵守「MP grounding MUST preserve claim closure and attribution」的 claim closure 與歸屬規則，導讀對來源主旨的描述 SHALL NOT 扭曲原意。MoguNote 是選配 aside，Mogu 的核心看法 MAY 直接寫在正文。

Tribunal SHALL 以 MP 的評分規則評 GP 導讀，只有兩個差異：GP 正文只評分、不改寫（見 `gp-source-preservation`）；`ShroomDogNote` 視為 ShroomDog 本人的聲音，不當成 Mogu persona 評分。

#### Scenario: 導讀帶讀者回原文

- **WHEN** pipeline 組裝 GP 的 write 或 refine prompt
- **THEN** prompt SHALL 要求開頭交代來源與值得讀的理由
- **AND** prompt SHALL 要求結尾帶讀者回原文

#### Scenario: 照順序轉述不算導讀

- **WHEN** 草稿照原文順序一句一句轉述，或重講了原文大部分內容
- **THEN** 來源距離章 SHALL 判定不通過
- **AND** writer SHALL 改寫成重點加上 gu-log 的看法，SHALL NOT 只換字

#### Scenario: 來源主張不改掛到 Mogu 名下

- **WHEN** 導讀轉述來源作者的主張
- **THEN** 讀者 SHALL 看得出那是來源作者的主張，條件、hedge 與信心水準 SHALL 保留
- **AND** SHALL NOT 改寫成 Mogu 或 gu-log 自己的看法，gu-log 的推論也 SHALL NOT 掛到原作者名下

#### Scenario: 自動化輸出 ShroomDogNote

- **WHEN** 寫作或改寫步驟的輸出含 `ShroomDogNote`
- **THEN** 該步驟 SHALL 失敗
- **AND** 這段輸出 SHALL NOT 寫進文章

#### Scenario: Tribunal 評 GP 導讀

- **WHEN** Tribunal 評一篇 GP 導讀
- **THEN** 評審 SHALL 套用 MP 的評分規則
- **AND** SHALL NOT 以翻譯完整度、來源順序或來源作者聲音的保真度評分
- **AND** SHALL NOT 改寫正文
