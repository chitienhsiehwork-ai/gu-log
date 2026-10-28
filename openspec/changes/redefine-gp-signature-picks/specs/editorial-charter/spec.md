## MODIFIED Requirements

### Requirement: Gu-log series MUST have single-sentence identities

gu-log SHALL 使用以下四系列一句話定位：

- GP = ShroomDog 親自指定、能代表 gu-log 品質的招牌文章；寫作與 grounding 規則跟 MP 相同
- MP = 日常文章：Mogu 消化單一主要來源後，由 Mogu 擁有正文聲音並寫成自己的 source-grounded article；有來源的新文章預設寫成 MP
- SD = ShroomDog 原創 essay，沒有 source fidelity 義務；ShroomDogNote 是 user 本人聲音
- Lv = 原創入門教學，類比扛概念；`Lv-guided-reading` 以教會讀者理解 source 為主要 reader job

#### Scenario: GP identity is cited

- **WHEN** doc、prompt 或 judge 描述 GP
- **THEN** 它 SHALL 把 GP 描述為 ShroomDog 親自指定的招牌文章
- **AND** SHALL NOT 把 GP 描述成導讀、來源文章的翻譯或完整摘要
- **AND** SHALL NOT 把「誰挑來源」或「寫法」當成 GP 與 MP 的差別

#### Scenario: MP identity is cited

- **WHEN** doc、prompt 或 judge 描述 MP
- **THEN** 它 SHALL 把 MP 描述為 Mogu-authored source-grounded article，也是有來源新文章的預設系列
- **AND** SHALL NOT 把 MP 描述成來源作者的忠實翻譯、完整摘要或 ShroomDog 原創

#### Scenario: SD identity is cited

- **WHEN** doc、prompt 或 judge 描述 SD
- **THEN** 它 SHALL 把 SD 描述為 ShroomDog 原創 essay
- **AND** SHALL 把 ShroomDogNote 視為 user 本人聲音，而不是 source commentary

#### Scenario: Lv identity is cited

- **WHEN** doc、prompt 或 judge 描述 Lv
- **THEN** 它 SHALL 預設把 Lv 描述為原創入門教學
- **AND** 當 Lv 在教一篇 source article 時，SHALL 區分 `Lv-guided-reading` mode

### Requirement: MP body MUST be Mogu-authored and source-grounded

MP body SHALL 是 Mogu 消化單一主要來源後寫出的文章，正文聲音 owner SHALL 是 Mogu。MP SHALL 被允許貼近來源翻譯／改寫並加入自己的味道，也 SHALL 被允許選材、刪減、重排、綜合、反駁、改換敘事形狀或從頭重建論證。MP SHALL NOT 有最低改寫幅度，且 SHALL NOT 只因完整覆蓋來源、保留來源順序、未完整覆蓋來源、改變來源順序、貼近或遠離原作者文筆而 fail。貼近來源的 MP SHALL NOT 因此取得完整翻譯 fidelity 的承諾。

MP SHALL 以 `sourceUrl` 指向主要來源。額外查證資料 SHALL 以正文 inline citation 表達；本 contract SHALL NOT 把多個來源提升為同權重主要來源，也 SHALL NOT 要求新增 per-article editorial mode。

MP 的 MoguNote SHALL 是選配 aside，不是用來隔離 Mogu 與正文的 provenance boundary。MP SHALL NOT 因缺少 MoguNote 而 fail、降級或被迫新增 note；Mogu 的核心分析 SHALL 被允許直接留在 body。

#### Scenario: useful idea may escape weak source prose

- **WHEN** 來源有一個值得分享的觀點，但原文冗長、重複或敘事形狀不理想
- **THEN** MP SHALL 被允許只取有用材料並重建成 Mogu 自己的文章
- **AND** SHALL NOT 被要求保留原文文筆、完整段落或敘事順序

#### Scenario: close-form MP remains valid

- **WHEN** Mogu 判斷來源的內容與順序已適合讀者，只需貼近翻譯／改寫並加入少量 Mogu flavor
- **THEN** MP SHALL 被允許保留大部分來源覆蓋與順序
- **AND** writer、reviewer 與 scoring SHALL NOT 只因改寫距離小而要求額外刪減、重排或重建

#### Scenario: close form does not create a GP fidelity promise

- **WHEN** 一篇 MP 選擇貼近來源翻譯／改寫
- **THEN** 它的正文聲音 owner SHALL 仍是 Mogu
- **AND** 它 SHALL NOT 因形式貼近原文而取得完整覆蓋、順序 fidelity 或來源作者 voice preservation 的系列承諾，之後升格成 GP 也一樣

#### Scenario: unused source claims may be omitted

- **WHEN** MP 只需要來源中的一個獨立且完整的論點
- **THEN** MP SHALL 被允許省略其餘未使用的來源主張
- **AND** reviewer SHALL NOT 以 translation completeness 或 source-order fidelity 判它 fail

#### Scenario: Mogu may disagree with the source

- **WHEN** Mogu 的文章要反駁或延伸主要來源
- **THEN** MP SHALL 被允許在正文提出 Mogu 的分析
- **AND** SHALL 清楚區分來源主張與 Mogu 的推論或立場

#### Scenario: MP does not impersonate ShroomDog

- **WHEN** MP 由 Mogu 擁有正文聲音
- **THEN** 正文 SHALL NOT 把 Mogu 或來源作者的判斷、經歷或立場冒充成 ShroomDog 本人的聲音

#### Scenario: complete MP without MoguNote remains valid

- **WHEN** MP body 已完整表達 Mogu 的主張並遵守 grounding contract
- **AND** 文章沒有 MoguNote
- **THEN** writer、reviewer 與 scoring SHALL NOT 只因缺少 MoguNote 而要求補 note、判 fail 或降級

### Requirement: Series selection MUST use reader job and voice ownership

gu-log SHALL 依固定 precedence 分流：先判斷主要 reader job 是否為分步教會讀者理解概念或來源；若是，文章 SHALL 使用 Lv。只有文章不屬於 Lv 時，才 SHALL 依正文 voice owner 區分其餘系列：SD 由 ShroomDog 擁有正文聲音；由 Mogu 擁有正文聲音、以來源為材料的文章 SHALL 使用 MP。分流 SHALL NOT 產生 GP：GP 只能依 `gp-signature-picks` 由 MP 升格而來。來源媒介、長短、由誰挑選、品質高低或是否引用外部資料 SHALL NOT 單獨決定系列。

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

- **WHEN** ShroomDog 明確指定一篇不屬於 Lv 的文章是 GP
- **THEN** 文章 SHALL 先寫成 MP，再依 `gp-signature-picks` 升格成 GP
- **AND** SHALL NOT 套用導讀格式

#### Scenario: ShroomDog 挑的來源預設寫成 MP

- **WHEN** ShroomDog 挑一篇外部文章要 gu-log 寫，但沒有明確說它是 GP
- **AND** 文章的主要 reader job 不是分步教會讀者理解概念或來源
- **THEN** 文章 SHALL 使用 MP，SHALL NOT 因來源是 ShroomDog 挑的或品質特別好就用 GP

## REMOVED Requirements

### Requirement: GP 整篇翻譯 MUST 先取得來源作者同意才可公開

**Reason**: 這條綁了三件事：整篇翻譯要作者同意、GP 導讀格式與來源距離章、GP 列表規則。導讀格式和章已經退役，另外兩件改寫成新的 requirement（MODIFIED 不能刪掉既有情境）。GP 的定義、指定、升格與列表規則移到新的 `gp-signature-picks`。

**Migration**: 作者同意改由「沒有來源作者同意的整篇翻譯 MUST NOT 公開」承接，不分系列；列表（含「讀者開啟 GP 系列頁」）與升格時的 Tribunal PASS 門檻改由 `gp-signature-picks` 承接。

### Requirement: GP body MUST be a Mogu-written reading guide

**Reason**: ShroomDog 2026-10-28 決定 GP 不再是導讀，而是他指定的招牌文章，寫法跟 MP 相同；導讀格式與來源距離章一起退役。

**Migration**: GP 正文改依 `gp-signature-picks`，照 MP 規則寫，gp-pipeline 也不寫 GP；Tribunal 只評分不改寫（`gp-source-preservation`）。`ShroomDogNote` 規則改由「自動化寫作 SHALL NOT 產生 `ShroomDogNote`，評審 SHALL 把它當成 ShroomDog 本人的話」承接，不分系列；不冒充 ShroomDog 由「MP body MUST be Mogu-authored and source-grounded」承接。線上的 GP-276～279 用 `scripts/reclassify-post.mjs` 改成 MP。

## ADDED Requirements

### Requirement: 沒有來源作者同意的整篇翻譯 MUST NOT 公開

整篇翻譯不分系列，SHALL 只在取得來源作者同意後公開。整篇翻譯指以譯文身份呈現、承諾完整覆蓋、來源順序與原作者語氣的文章；close form 的 MP 不做這些承諾，不算整篇翻譯，升格成 GP 也一樣。沒有同意紀錄的既有 GP 翻譯 SHALL 依 `post-takedown` 下架成墓碑頁；自寫示範文 GP-1 SHALL NOT 下架。

#### Scenario: 沒有同意紀錄的整篇翻譯

- **WHEN** 任何系列的文章以整篇翻譯呈現，而且沒有來源作者同意的紀錄
- **THEN** 它 SHALL NOT 公開
- **AND** 既有的 GP 翻譯 SHALL 以墓碑頁下架

#### Scenario: 示範文 GP-1 照舊公開

- **WHEN** 讀者開啟 GP-1 的繁中或英文網址
- **THEN** 頁面 SHALL 顯示全文，SHALL NOT 是墓碑頁

#### Scenario: close form 不算整篇翻譯

- **WHEN** 一篇 close form 的 MP 要公開，或它之後升格成 GP
- **THEN** 本要求 SHALL NOT 擋下它

### Requirement: 自動化寫作 SHALL NOT 產生 `ShroomDogNote`，評審 SHALL 把它當成 ShroomDog 本人的話

`ShroomDogNote` SHALL 只來自 ShroomDog 本人。自動化寫作 SHALL NOT 產生它，不分系列；gp-pipeline 的輸出含 `ShroomDogNote` 時該步驟 SHALL 失敗，輸出 SHALL NOT 寫進文章（見 `gp-pipeline-publish-integrity`）。Tribunal 評任何系列時 SHALL 把它當成 ShroomDog 本人的話，SHALL NOT 當成 Mogu persona 或來源評論來評分。

#### Scenario: 自動化輸出 ShroomDogNote

- **WHEN** gp-pipeline 替 MP 或 SD 寫稿、改稿，輸出含 `ShroomDogNote`
- **THEN** 該步驟 SHALL 失敗，這段輸出 SHALL NOT 寫進文章

#### Scenario: 評審讀到 ShroomDogNote

- **WHEN** Tribunal 評一篇含 `ShroomDogNote` 的文章，不論系列
- **THEN** 評審 SHALL 把裡面的看法歸給 ShroomDog，SHALL NOT 當成 Mogu persona 或來源評論
