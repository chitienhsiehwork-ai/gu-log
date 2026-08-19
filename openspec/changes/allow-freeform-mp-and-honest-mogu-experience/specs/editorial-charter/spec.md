## MODIFIED Requirements

### Requirement: MP body MUST be Mogu-authored and source-grounded

MP body SHALL 是 Mogu 消化單一主要來源後寫出的文章，正文聲音 owner SHALL 是 Mogu。MP SHALL 沒有最低改寫距離：Mogu SHALL 被允許貼近來源翻譯或重寫、保留來源的大致覆蓋與順序，也 SHALL 被允許選材、刪減、重排、綜合、反駁、改換敘事形狀或重建論證。Writer、reviewer 與 scoring SHALL NOT 只因 MP 接近來源、遠離來源、完整覆蓋來源、未完整覆蓋來源、保留來源順序、改變來源順序或未模仿原作者文筆而判它 fail。

MP SHALL 以 `sourceUrl` 指向主要來源。額外查證資料 SHALL 以正文 inline citation 表達；本 contract SHALL NOT 把多個來源提升為同權重主要來源，也 SHALL NOT 要求新增 per-article editorial mode。MP 即使採貼近來源的形式，也 SHALL NOT 因此取得 GP 的完整 translation fidelity promise；系列身份仍 SHALL 由正文 voice owner 決定。

MP 的 MoguNote SHALL 是選配 aside，不是用來隔離 Mogu 與正文的 provenance boundary。MP SHALL NOT 因缺少 MoguNote 而 fail、降級或被迫新增 note；Mogu 的核心分析 SHALL 被允許直接留在 body。

#### Scenario: close-form MP remains valid

- **WHEN** Mogu 選擇貼近來源翻譯或重寫，並保留來源大致覆蓋與順序
- **AND** 正文聲音由 Mogu 擁有且 retained claims 遵守 grounding contract
- **THEN** 文章 SHALL 仍是有效 MP
- **AND** writer、reviewer 與 scoring SHALL NOT 為了讓它看起來更不像 GP 而強迫重排、刪減或增加 Mogu flavor

#### Scenario: useful idea may escape weak source prose

- **WHEN** 來源有一個值得分享的觀點，但原文冗長、重複或敘事形狀不理想
- **THEN** MP SHALL 被允許只取有用材料並重建成 Mogu 自己的文章
- **AND** SHALL NOT 被要求保留原文文筆、完整段落或敘事順序

#### Scenario: unused source claims may be omitted

- **WHEN** MP 只需要來源中的一個獨立且完整的論點
- **THEN** MP SHALL 被允許省略其餘未使用的來源主張
- **AND** reviewer SHALL NOT 以 translation completeness 或 source-order fidelity 判它 fail

#### Scenario: close form does not create a GP fidelity promise

- **WHEN** MP 選擇完整覆蓋來源或大致保留來源順序
- **THEN** retained source claims 仍 SHALL 遵守 MP grounding contract
- **AND** reviewer SHALL NOT 因形式接近來源就把整篇改用 GP translation completeness 或 source-order fidelity gate 評分

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

### Requirement: MP grounding MUST preserve claim closure and attribution

MP SHALL 被允許完全省略一個來源主張；一旦保留來源衍生的 claim，正文 SHALL 一併保留所有控制該 claim 的 speaker、條件、hedge、caveat、證據範圍與信心水準。MP SHALL NOT 捏造事實、引文、數字、因果或來源歸因。Mogu 新增的可查證 premise SHALL 有可追溯證據；Mogu 的推論 SHALL 明確屬於 Mogu，不得掛回來源作者名下。

MoguNote SHALL 被允許讓 Mogu 以第一人稱表達反應、立場、實際發生的 editorial／tool interaction，以及合理讀者一眼可辨識為 persona 的奇幻經歷。Mogu SHALL NOT 把來源作者的經驗改寫成自己做過，也 SHALL NOT 杜撰會被合理讀者理解為真實證詞的人類履歷或事件。這個 experience boundary SHALL 適用於所有 reader-visible prose；明顯奇幻 persona 經歷的許可 SHALL 只由 MoguNote 的清楚 speaker boundary 承接。

#### Scenario: controlling caveat follows a retained claim

- **WHEN** source 只在 small corpus 條件下主張 RAG 沒必要
- **AND** MP 保留這個主張
- **THEN** MP SHALL 同時保留 small corpus 條件
- **AND** SHALL NOT 以自由刪減為由寫成「RAG 沒必要」

#### Scenario: observation does not become proof

- **WHEN** source 描述沒有 control group 的短期觀察
- **THEN** MP SHALL NOT 把它改寫成已證明的因果關係
- **AND** SHALL 保留觀察範圍與不確定性

#### Scenario: speaker chain remains correct

- **WHEN** 主要來源 A 引述研究者 B 的發現
- **THEN** MP SHALL 將該發現正確歸因給 B
- **AND** SHALL NOT 改寫成 A 親自發現或證明該結果

#### Scenario: Mogu does not inherit source-author experience

- **WHEN** source 作者描述自己跑過一個實驗或帶過一個團隊
- **THEN** MP SHALL NOT 改寫成 Mogu 親自做過同一件事
- **AND** 在 body、title、summary、MoguNote、caption 或其他 reader-visible prose 中都 SHALL 適用此限制

#### Scenario: honest MoguNote first-person experience remains valid

- **WHEN** MoguNote 以第一人稱描述實際發生的 editorial／tool interaction，或使用合理讀者一眼可辨識為 persona 的奇幻經歷
- **THEN** 該敘事 SHALL 被允許
- **AND** reviewer SHALL NOT 只因它是 Mogu 第一人稱 experience 而判 fabricated lived experience

#### Scenario: plausible human biography remains disallowed

- **WHEN** Mogu 在 reader-visible prose 聲稱自己有一段無依據、但合理讀者可能當成真實證詞的人類工作、旅行、關係、消費或生活經歷
- **THEN** Fact Checker 與 reviewer SHALL 判定該 claim 不符合 experience boundary
- **AND** writer SHALL 移除、改成誠實的推論／立場，或改成一眼可辨識的 MoguNote persona fiction

#### Scenario: explicit Mogu inference is allowed

- **WHEN** MP 使用可追溯的 source premise，並清楚標示後續結論是 Mogu 的推論
- **THEN** 該推論 SHALL 被允許留在 MP body
- **AND** reviewer SHALL NOT 只因結論不是來源作者的 thesis 而判 fail
