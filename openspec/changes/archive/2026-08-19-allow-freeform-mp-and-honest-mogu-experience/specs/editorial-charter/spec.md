## MODIFIED Requirements

### Requirement: MP body MUST be Mogu-authored and source-grounded

MP body SHALL 是 Mogu 消化單一主要來源後寫出的文章，正文聲音 owner SHALL 是 Mogu。MP SHALL 被允許貼近來源翻譯／改寫並加入自己的味道，也 SHALL 被允許選材、刪減、重排、綜合、反駁、改換敘事形狀或從頭重建論證。MP SHALL NOT 有最低改寫幅度，且 SHALL NOT 只因完整覆蓋來源、保留來源順序、未完整覆蓋來源、改變來源順序、貼近或遠離原作者文筆而 fail。貼近來源的 MP SHALL NOT 因此取得 GP 的完整翻譯 fidelity 承諾。

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
- **AND** 它 SHALL NOT 因形式接近 GP 而取得完整覆蓋、順序 fidelity 或來源作者 voice preservation 的系列承諾

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

### Requirement: MP grounding MUST preserve claim closure and attribution

MP SHALL 被允許完全省略一個來源主張；一旦保留來源衍生的 claim，正文 SHALL 一併保留所有控制該 claim 的 speaker、條件、hedge、caveat、證據範圍與信心水準。MP SHALL NOT 捏造事實、引文、數字、因果或來源歸因。Mogu 新增的可查證 premise SHALL 有可追溯證據；Mogu 的推論 SHALL 明確屬於 Mogu，不得掛回來源作者名下。

MoguNote SHALL 被允許用 Mogu 第一人稱表達反應與立場、描述實際發生的 editorial／tool interaction，或描述合理讀者可清楚辨識為虛構的奇幻 persona 經歷。MoguNote 與其他 reader-visible prose SHALL NOT 把來源作者的經歷轉移給 Mogu，也 SHALL NOT 杜撰合理讀者可能信以為真的人類工作、旅行、關係、購買或其他生平與證言。

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

- **WHEN** MoguNote 用第一人稱描述實際發生的 editorial／tool interaction，或清楚到不會被當成人類事實的奇幻 persona 經歷
- **THEN** writer、reviewer、Fact Checker 與 scoring SHALL 允許該內容
- **AND** SHALL NOT 只因 Mogu 使用第一人稱或 persona 敘事而判 fail

#### Scenario: plausible human biography remains disallowed

- **WHEN** MoguNote 或其他 reader-visible prose 聲稱 Mogu 曾任職、旅行、戀愛、購買或經歷其他合理讀者可能信以為真的人類事件
- **AND** 該事件不是實際發生的 editorial／tool interaction
- **THEN** 該內容 SHALL fail 誠實性邊界
- **AND** 明顯奇幻 persona 的許可 SHALL NOT 用來替可信的人類假履歷開脫

#### Scenario: explicit Mogu inference is allowed

- **WHEN** MP 使用可追溯的 source premise，並清楚標示後續結論是 Mogu 的推論
- **THEN** 該推論 SHALL 被允許留在 MP body
- **AND** reviewer SHALL NOT 只因結論不是來源作者的 thesis 而判 fail
