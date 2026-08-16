## ADDED Requirements

### Requirement: GP body MUST be faithful translation

GP body SHALL 讓來源作者以自然台灣中文說原本那篇文章。忠實翻譯 SHALL NOT 等於逐字翻譯；writer SHALL 保留 source 的 voice owner、人稱、論證順序、段落關係、主張強弱、條件、hedge、caveat、限制、證據、語氣、情緒與自然停點。writer SHALL 被允許為自然繁中調整句法、切句、合句與局部段落邊界，但 SHALL NOT 因為 source 平淡、線性或不像 gu-log 而摘要、自由重排、重建骨架或改寫成另一篇 editorial。

所有 gu-log 意見、吐槽、玩笑、外加類比與 commentary SHALL 進 MoguNote，SHALL NOT 塞進 GP body。gu-log references 與 glossary SHALL 只作為 navigation layer，不得成為重寫 source prose 的理由。

#### Scenario: natural sentence-level changes preserve source spine

- **WHEN** source 句法逐字搬成中文會不自然
- **THEN** GP body SHALL 被允許切句、合句、調整語序或改用自然台灣中文
- **AND** voice owner、人稱、主張、條件、語氣與段落關係 SHALL 仍可辨識為 source 本身

#### Scenario: first-person source does not become third-person editorial

- **WHEN** source 是作者用第一人稱講述自己的經驗與判斷
- **THEN** GP body SHALL 保留第一人稱
- **AND** SHALL NOT 改成第三人稱品牌旁白或「寫這篇文章的人」式轉述

#### Scenario: source structure remains the default

- **WHEN** source 的文章順序在繁中仍然可讀
- **THEN** GP body SHALL 保留原論證與敘事順序
- **AND** SHALL NOT 為了製造 story arc、hook、spine 或 callback 而重建文章

#### Scenario: plain inventory remains source-aligned

- **WHEN** source 包含重複專名、機械 inventory 或低價值實作細節
- **THEN** GP body SHALL 保留其項目、關係與位置
- **AND** SHALL NOT 以低價值為由省略非 slop 材料

#### Scenario: GP author test rejects invented meaning

- **WHEN** GP body 讓 source 作者看起來主張了他沒講過的事實、結論、因果或信心水準
- **THEN** 該片段 SHALL fail 原作者測試
- **AND** writer SHALL 在發布前恢復 source fidelity，或把 gu-log 外加材料移進 MoguNote

### Requirement: MP body MUST be Mogu-authored and source-grounded

MP body SHALL 是 Mogu 消化單一主要來源後寫出的文章，正文聲音 owner SHALL 是 Mogu。MP SHALL 被允許選材、刪減、重排、綜合、反駁、改換敘事形狀或重建論證，且 SHALL NOT 因未完整覆蓋來源、未保留來源順序或未模仿原作者文筆而 fail。

MP SHALL 以 `sourceUrl` 指向主要來源。額外查證資料 SHALL 以正文 inline citation 表達；本 contract SHALL NOT 把多個來源提升為同權重主要來源，也 SHALL NOT 要求新增 per-article editorial mode。

#### Scenario: useful idea may escape weak source prose

- **WHEN** 來源有一個值得分享的觀點，但原文冗長、重複或敘事形狀不理想
- **THEN** MP SHALL 被允許只取有用材料並重建成 Mogu 自己的文章
- **AND** SHALL NOT 被要求保留原文文筆、完整段落或敘事順序

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

### Requirement: MP grounding MUST preserve claim closure and attribution

MP SHALL 被允許完全省略一個來源主張；一旦保留來源衍生的 claim，正文 SHALL 一併保留所有控制該 claim 的 speaker、條件、hedge、caveat、證據範圍與信心水準。MP SHALL NOT 捏造事實、引文、數字、因果、來源歸因或 Mogu 的親身經驗。Mogu 新增的可查證 premise SHALL 有可追溯證據；Mogu 的推論 SHALL 明確屬於 Mogu，不得掛回來源作者名下。

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

#### Scenario: Mogu voice does not license invented lived experience

- **WHEN** source 作者描述自己跑過一個實驗或帶過一個團隊
- **THEN** MP SHALL NOT 改寫成 Mogu 親自做過同一件事
- **AND** 在 body、title、summary、MoguNote、caption 或其他 reader-visible prose 中都 SHALL 適用此限制

#### Scenario: explicit Mogu inference is allowed

- **WHEN** MP 使用可追溯的 source premise，並清楚標示後續結論是 Mogu 的推論
- **THEN** 該推論 SHALL 被允許留在 MP body
- **AND** reviewer SHALL NOT 只因結論不是來源作者的 thesis 而判 fail

### Requirement: Series selection MUST use reader job and voice ownership

gu-log SHALL 先以主要 reader job 判斷 Lv，再以正文 voice owner 區分其餘系列：GP 由來源作者擁有正文聲音；MP 由 Mogu 擁有正文聲音；SD 由 ShroomDog 擁有正文聲音。來源媒介、長短或是否引用外部資料 SHALL NOT 單獨決定系列。

#### Scenario: teaching a source routes to Lv

- **WHEN** 文章主要承諾是分步教會讀者理解一篇 source 或概念
- **THEN** 文章 SHALL 使用 Lv 或 `Lv-guided-reading`
- **AND** SHALL NOT 只因 Mogu 會大幅重組來源就自動使用 MP

#### Scenario: Mogu thesis routes to MP

- **WHEN** 文章主要承諾是提出 Mogu 自己的主張，來源作為材料與證據
- **THEN** 文章 SHALL 使用 MP
- **AND** SHALL NOT 因來源是長文、tweet 或 thread 而改變 voice-owner contract

#### Scenario: ShroomDog voice remains SD

- **WHEN** 正文的判斷與經歷屬於 ShroomDog 本人
- **THEN** 文章 SHALL 使用 SD
- **AND** SHALL NOT 因引用外部來源而改成 MP

## MODIFIED Requirements

### Requirement: Gu-log series MUST have single-sentence identities

gu-log SHALL 使用以下四系列一句話定位：

- GP = ShroomDog 選的外部好文，由來源作者擁有正文聲音，忠實翻譯並加 MoguNote commentary
- MP = Mogu 消化單一主要來源後，由 Mogu 擁有正文聲音並寫成自己的 source-grounded article
- SD = ShroomDog 原創 essay，沒有 source fidelity 義務；ShroomDogNote 是 user 本人聲音
- Lv = 原創入門教學，類比扛概念；`Lv-guided-reading` 以教會讀者理解 source 為主要 reader job

#### Scenario: GP identity is cited

- **WHEN** doc、prompt 或 judge 描述 GP
- **THEN** 它 SHALL 把 GP 描述為 ShroomDog-selected external good writing with faithful translation plus MoguNote commentary
- **AND** SHALL NOT 把 GP 描述成自由改寫

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

MOBA 味 SHALL 跟著聲音走，不跟著系列走。Mogu 擁有聲音的 MP body 與 MoguNote、SD、Lv SHALL 被允許使用 MOBA flavor；來源作者擁有聲音的 GP body SHALL 保持素顏，不得因站內 persona 沾上外加 MOBA flavor。

在作者優先北極星下，深 MOBA 詞，包含 Vainglory-specific terms，SHALL 被允許使用。On-site MOBA glossary 上線前，非顯而易見的深詞 SHALL 在當下自然解釋，或 SHALL 改用較廣、陌生同事能懂的概念。Glossary 上線後，每個非顯而易見的深詞 SHALL 能 link 到該站內 glossary。

類比本身 SHALL 扛住概念。讀者 SHALL 能只靠上下文理解主要論點；Glossary SHALL 是深詞安全網，不是把一整段塞滿 jargon 的許可證。

#### Scenario: GP translated body remains plain

- **WHEN** GP body 翻譯 source claim
- **THEN** translated body SHALL 保持 plain
- **AND** SHALL NOT 加入 MOBA-flavored wording、玩笑或外加類比
- **AND** 這類 commentary SHALL 改放進 MoguNote

#### Scenario: MP body may use Mogu flavor

- **WHEN** MP body 使用 Mogu 的類比、幽默或 MOBA flavor 建立自己的論點
- **THEN** 該寫法 SHALL 被允許
- **AND** SHALL NOT 因它出現在 body 而非 MoguNote 就判 commentary separation fail
- **AND** factual premise 與來源歸因仍 SHALL 遵守 MP grounding contract

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

## REMOVED Requirements

### Requirement: GP and MP body MUST be faithful translation

**Reason**: GP 保留忠實翻譯；MP 改由 Mogu 擁有正文聲音並按 claim-level grounding 寫自己的文章。舊 requirement 把兩種互斥責任綁在一起。

**Migration**: 由 `GP body MUST be faithful translation`、`MP body MUST be Mogu-authored and source-grounded` 與 `MP grounding MUST preserve claim closure and attribution` 取代。

### Requirement: GP and MP body MUST NOT alter source payload

**Reason**: 完整 payload preservation 仍適用 GP，但會否定 MP 已獲准的選材、反駁與重建權；MP 改以 retained-claim closure 為邊界。

**Migration**: GP 的 payload 限制併入新的 GP requirement；MP 的事實、caveat 與歸因限制移入 MP grounding requirement。

### Requirement: Translation boundary MUST be testable by author and self-check tests

**Reason**: 原作者測試仍適用 GP；MP 正文允許提出 Mogu 自己的 thesis，不能再用「是否仍是原作者那篇文章」判完整文章。

**Migration**: GP 原作者測試併入新的 GP requirement；MP 改用 claim closure、speaker attribution、evidence traceability 與 invented-experience fixtures。
