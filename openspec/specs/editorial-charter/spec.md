# editorial-charter Specification

## Purpose

定義 gu-log 的 editorial north star、系列身份、翻譯忠實邊界、Lv 模式與 startup routing，讓所有內容角色共享同一套可測試的寫作憲章。
## Requirements
### Requirement: gu-log editorial charter MUST define the north star

gu-log 的編輯北極星 SHALL 是「作者優先、陌生讀者為底線」。

主要讀者 SHALL 是未來的 user 本人。最低讀者底線 SHALL 是：user 可以直接把 gu-log 連結丟給朋友或同事，用來解釋一個有用或好玩的想法，而不需要逼對方翻原文、也不需要逼對方讀難懂英文。

編輯成功 SHALL 同時滿足兩件事：

- 幾個月後 user 重讀自己的文章，還是讀得爽
- user 願意丟 gu-log 連結給人，而不是丟英文原文連結

觸及數、流量、audience growth SHALL 只是 bonus，不是計分板。

#### Scenario: traffic is not the scoreboard

- **WHEN** 一篇文章流量普通
- **BUT** user 幾個月後重讀仍然讀得爽
- **AND** user 願意用這篇 gu-log 連結向朋友或同事解釋那個想法
- **THEN** 這篇文章 SHALL 被視為符合編輯北極星
- **AND** 不得只因為流量或 audience growth 低，就把它判成編輯失敗

#### Scenario: shareability floor uses the coworker reader

- **WHEN** judge、writer 或 reviewer 評估文章是否過陌生讀者底線
- **THEN** 評估對象 SHALL 是 user 真的可能丟連結給他的那個同事
- **AND** 那個同事 SHALL 被假設為技術沾邊、讀中文、不一定懂 MOBA，但不討厭文章有一點好玩

#### Scenario: Fresh Eyes protects the floor, not the ceiling

- **WHEN** Fresh Eyes 或同等陌生讀者 judge 評估文章
- **THEN** 它 SHALL 守可分享下限：同事會不會直接關掉、會不會迷路、會不會被逼回去讀英文原文
- **AND** 它 SHALL NOT 因為文章太個人化、太好玩、作者味太重就 fail
- **AND** 它 SHALL 保留作者把文章寫得比泛用技術解釋更有記憶點的特權

---

### Requirement: Lv MUST support original and guided-reading modes

Lv SHALL 支援兩種編輯 mode：

- `Lv-original`
- `Lv-guided-reading`

`Lv-original` SHALL 從零教一個概念，沒有 source fidelity 義務。在此 mode 中，gu-log MAY 使用原創說明、類比與深 MOBA reference，只要它們能幫忙扛住概念。

`Lv-guided-reading` SHALL 用 Lv 拆解一篇又長又難或很密的 source article。在此 mode 中，文章 SHALL 在開頭 cite source ref，讓 coworker-floor reader 想追原文時一眼看得到。

Lv-guided-reading SHALL 落在 SD 與 GP 中間：它是在「教」這篇 source，不是在翻譯它。它 MAY 只挑有用的一塊、簡化並大幅重組；它 SHALL NOT 被要求 cover 整篇 source。

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
- **AND** 不得因為 Lv 比 GP 自由，就扭曲掛在人家名下的 claim

#### Scenario: Lv-guided-reading labels gu-log extensions

- **WHEN** Lv-guided-reading 加上 user 的延伸、Mogu 的類比或 gu-log 自己的 commentary
- **THEN** 文章 SHALL 清楚標出邊界
- **AND** 不得把延伸講得像 source 自己的 claim

---

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

#### Scenario: translated body remains plain

- **WHEN** GP body 翻譯 source claim
- **THEN** translated body SHALL 保持 plain
- **AND** SHALL NOT 加入 MOBA-flavored wording、玩笑或外加類比
- **AND** 這類 commentary SHALL 改放進 MoguNote

#### Scenario: Mogu voice may use MOBA flavor

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

### Requirement: Editorial charter MUST be part of startup routing for editorial work

任何 agent 只要處理 gu-log 內容、內容規則、writer prompt、judge prompt 或 editorial workflow，SHALL 在 startup routing 讀 editorial charter。

routing SHALL 接上既有環境偵測與 playbook 入口，而不是靠記憶：

- `scripts/detect-env.sh` 負責辨識 worker environment
- 對應的 local machine actor 或 CCC playbook 負責把 editorial work 指到 charter
- change archive 前，active path 是 `openspec/changes/add-editorial-charter/specs/editorial-charter/spec.md`
- archive 後，stable path 是 `openspec/specs/editorial-charter/spec.md`

#### Scenario: Local machine actor starts editorial work

- **WHEN** local machine actor 開始寫文、修文、改內容規則、writer prompt、judge prompt 或 editorial workflow
- **THEN** local machine actor startup route SHALL 包含閱讀 editorial charter
- **AND** archive 前 SHALL 使用 active change path，archive 後 SHALL 使用 stable spec path

#### Scenario: CCC starts editorial work

- **WHEN** CCC 開始寫文、修文、改內容規則、writer prompt、judge prompt 或 editorial workflow
- **THEN** CCC startup route SHALL 包含閱讀 editorial charter
- **AND** SHALL NOT 依賴 duplicated prompt text 作為 source of truth

### Requirement: Chinese prose MUST use glossary canonical terminology

當 glossary entry 以 `forbiddenZhTw` 明確宣告禁用譯名時，zh-tw 文章 SHALL 使用該 entry 的 canonical `term`，或使用不混淆概念的自然改寫。Writer 與 translator SHALL NOT 使用該清單中的直譯或舊譯名。沒有宣告 `forbiddenZhTw` 的 glossary entry 不受此要求限制。

Glossary terminology normalization SHALL 只改變「怎麼稱呼同一個概念」，不得藉此改變 source payload、voice、語氣或論證關係。每篇第一次安全出現的 canonical term SHALL 依 glossary link coverage contract 連到對應 anchor。

#### Scenario: AI agent keeps the canonical English term

- **WHEN** zh-tw 文章描述能使用工具並自主執行任務的 AI agent
- **AND** glossary 的 canonical term 是 `Agent`
- **THEN** 正文 SHALL 使用 `Agent`
- **AND** SHALL NOT 使用該 glossary entry 明確禁用的中文譯名

#### Scenario: terminology normalization preserves source meaning

- **WHEN** translator 把同一概念的禁用舊譯名換成 canonical term
- **THEN** 它 SHALL 保留 source 的人稱、主張、語氣與句子關係
- **AND** SHALL NOT 把術語修正擴張成自由重寫

#### Scenario: related but different concept is rewritten accurately

- **WHEN** source 使用 `proxy`、法律代表或其他並非 AI agent 的概念
- **THEN** writer SHALL 使用符合該脈絡的自然詞
- **AND** SHALL NOT 為了套用 `Agent` glossary 而把不同概念誤標成 `Agent`
- **AND** 技術中介或轉發比喻 MAY 使用獨立的 `Proxy` glossary term

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

### Requirement: Series selection MUST use reader job and voice ownership

gu-log SHALL 依固定 precedence 分流：先判斷主要 reader job 是否為分步教會讀者理解概念或來源；若是，文章 SHALL 使用 Lv。只有文章不屬於 Lv 時，才 SHALL 依正文 voice owner 區分其餘系列：GP 由來源作者擁有正文聲音；MP 由 Mogu 擁有正文聲音；SD 由 ShroomDog 擁有正文聲音。來源媒介、長短或是否引用外部資料 SHALL NOT 單獨決定系列。

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

### Requirement: Reader-visible article content MUST exclude unapproved emoji

gu-log 的 reader-visible article content SHALL 預設不包含 emoji。Kaomoji SHALL 視為獨立的文字型品牌語彙，不受此禁令影響。

只有 ShroomDog 對特定文章中的特定 emoji 做出明確授權時，該 occurrence 才 MAY 保留。授權 SHALL 以 repo 內可稽核、窄範圍的 executable record 保存，且 SHALL 指向 feedback corpus 的具體人類決策；writer SHALL NOT 以自行設定的整篇 frontmatter flag、glob、未記錄的推測或無法對照人類決策的理由文字取代授權。

這是 top-level editorial `MAY` 能力，不代表每條 automated pipeline 都 SHALL 支援 glyph 保留例外。已接上 exact allowlist 的非 GP automated lane MAY 使用此能力；沒有接線的 lane SHALL 明確維持預設禁用，不得假稱存在不可達的例外流程。GP automated lane 的邊界由 `gp-source-preservation` spec 定義。

pre-commit 與 CI SHALL 使用同一個 deterministic policy implementation，阻擋新文章或修改內容新增未授權 emoji。既有未修改的歷史 emoji MAY 透過 non-retroactive ratchet 暫時保留；此 grandfathering SHALL NOT 允許新增、搬移或重寫含 emoji 的內容行。

#### Scenario: New post contains an emoji

- **WHEN** 新增文章的 title、summary 或 body 包含未授權 emoji
- **THEN** pre-commit SHALL 阻擋該 commit
- **AND** CI SHALL 對同一內容得出相同失敗結果

#### Scenario: Reader-visible component surfaces are covered

- **WHEN** 新增 emoji 出現在 MoguNote、ShroomDogNote、其他 reader-visible component text／props、圖片替代文字或 code block
- **THEN** deterministic gate SHALL 將它視為 reader-visible article content
- **AND** 純靜態陣列／物件 value 與非 computed quoted string key SHALL 被掃描，數字、布林值與 null SHALL 可正常使用
- **AND** 每個靜態字串 SHALL 使用自己的 ESTree source span；只有 AST 缺少 position 時才 MAY 保守退回外層運算式 span
- **AND** 無法靜態解析的新增讀者可見運算式 SHALL 遇錯即停
- **AND** 新增或修改的 raw `style`／`script` element、inline `style` attribute 或 `on*` event handler attribute SHALL 遇錯即停，避免 CSS／JavaScript escape 在 source 不含 Unicode glyph 時仍產生讀者可見 emoji
- **AND** fenced code block 內的 `style`／`script` 範例 SHALL 維持可用
- **AND** MDX import／export 與 ESTree 確認完全不會顯示的純註解運算式 SHALL 不受此規則影響
- **AND** 註解後仍有運算結果的混合節點 SHALL NOT 被當成純註解

#### Scenario: Kaomoji remains allowed

- **WHEN** 新增或修改的文章使用 canonical kaomoji detector 可辨識的文字型 kaomoji
- **THEN** emoji policy SHALL NOT 因該 kaomoji 失敗
- **AND** 只有 kaomoji 內與 emoji 偵測器重疊的標準文字型符號 MAY 被窄豁免
- **AND** 塞進 kaomoji 外殼的笑臉、旗幟、按鍵或 ZWJ emoji 仍 SHALL 被阻擋
- **AND** 既有 kaomoji 品牌規則 SHALL 維持有效

#### Scenario: User grants a narrow exception

- **WHEN** ShroomDog 明確授權某篇文章中的特定 emoji occurrence
- **AND** repo 記錄精確綁定該 post path、emoji、內容行、授權理由與 feedback corpus 決策參照
- **THEN** deterministic gate MAY 只放行該 occurrence
- **AND** SHALL NOT 放行同檔其他 emoji、其他文章或超出核准數量的 occurrence
- **AND** 此 `MAY` SHALL NOT 被解讀成每條 automated pipeline 都必須實作保留例外

#### Scenario: Untouched legacy post contains emoji

- **WHEN** 歷史文章含有 emoji
- **BUT** 該 emoji 所在內容行在目前變更中沒有新增、搬移或修改
- **THEN** ratchet gate SHALL NOT 阻擋不相關變更
- **AND** 未來修改該內容行時 SHALL 要求移除 emoji 或取得明確授權

#### Scenario: Local and CI results stay aligned

- **WHEN** 同一組 post changes 分別在 pre-commit 與 pull request CI 執行
- **THEN** 兩者 SHALL 使用同一個 emoji detector、kaomoji boundary 與 exception evaluator
- **AND** 任一環境無法解析比較基準時 SHALL fail closed
