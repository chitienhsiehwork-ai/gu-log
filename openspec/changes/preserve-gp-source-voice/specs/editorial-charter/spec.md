## MODIFIED Requirements

### Requirement: GP and MP body MUST be faithful translation

GP 與 MP 的 body SHALL 是忠實翻譯。下列 source-spine 限制只收窄 GP；MP 保留既有的 payload-preserving packaging 權限，不在本 change 改動 executable pipeline。

忠實翻譯 SHALL NOT 等於逐字翻譯。GP SHALL 預設保留 source spine：voice owner、第一／第二／第三人稱、論證順序、段落關係、語氣、情緒與自然停點。writer MAY 為自然繁中調整句法、切句、合句與局部段落邊界；writer SHALL NOT 因為 source 平淡、線性、不像 gu-log，或未達 persona／narrative rubric，就自由重排、摘要、重建骨架或改寫成另一篇 editorial。AI slop 只有在完整翻譯後，由獨立 reviewer 核准並透過 bounded patch contract 才 MAY 刪除。

MP body MAY 依既有 contract 重組講述順序、節奏、切塊與故事形狀，只要 payload、條件、caveat、證據與 source edge 完整保留。

對 GP body，「自然翻譯」只有一個權威邊界：

> 讓原作者用自然台灣中文說原本那篇文章，不替原作者重新寫一篇。

Source payload SHALL 包含 source 的主張、主張之間的關係、因果、強弱、成立條件、hedge、caveat、限制、數字、證據與結論。Source voice SHALL 包含誰在說話、人稱、語氣、情緒、幽默、敘事位置與作者刻意保留的平淡或停頓。

所有 gu-log 意見、吐槽、玩笑、外加類比與 commentary SHALL 進 MoguNote，SHALL NOT 塞進翻譯 body。gu-log references 與 glossary SHALL 作為 navigation layer 加在 source text 上，不得成為重寫 source prose 的理由。

#### Scenario: natural sentence-level changes preserve source spine

- **WHEN** source 句法逐字搬成中文會不自然
- **THEN** GP body MAY 切句、合句、調整語序或改用自然台灣中文
- **AS LONG AS** voice owner、人稱、主張、條件、語氣與段落關係仍可辨識為 source 本身

#### Scenario: first-person source does not become third-person editorial

- **WHEN** source 是作者用第一人稱講述自己的經驗與判斷
- **THEN** GP body SHALL 保留第一人稱
- **AND** SHALL NOT 改成第三人稱品牌旁白或「寫這篇文章的人」式轉述

#### Scenario: source structure remains the default

- **WHEN** source 的文章順序在繁中仍然可讀
- **THEN** GP body SHALL 保留原論證與敘事順序
- **AND** SHALL NOT 為了製造 story arc、core spark、spine candidate、hook 或 callback 而重建文章

#### Scenario: obvious non-payload slop may be removed

- **WHEN** source 含有空洞開場、同義反覆、模板式摘要或假深度結語
- **AND** 該文字不承載 payload、voice、情緒或刻意修辭
- **THEN** translator MAY 提出刪除 candidate，但初稿 SHALL 仍保留該文字
- **AND** 只有獨立 reviewer 以 source evidence 核准後，deterministic applicator 才 MAY 在明確邊界內刪除

#### Scenario: plain inventory remains source-aligned

- **WHEN** source 包含重複專名、機械 inventory 或低價值實作細節
- **THEN** GP body SHALL 保留其項目、關係與位置
- **AND** MAY 只為自然中文調整同一局部段落的句法，不得以低價值為由省略非 slop 材料
