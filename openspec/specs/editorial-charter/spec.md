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

### Requirement: GP and MP body MUST NOT alter source payload

GP 與 MP body SHALL NOT 加入 source 沒有的事實、數字、結論、因果關係或主張強度。GP 與 MP body SHALL NOT 抹掉 source 的 hedge、caveat、限制或條件。GP 與 MP body SHALL NOT 軟化、反轉或磨掉 source 真正的刀口。

Source 的刀口 SHALL 在 body 裡活著。

#### Scenario: condition removal is distortion

- **WHEN** source 的主張是「在 small corpus 條件下，RAG 沒必要」
- **THEN** gu-log body SHALL NOT 改寫成「RAG 沒必要」
- **BECAUSE** 拿掉 small corpus 條件會改變 payload

#### Scenario: invented causality is distortion

- **WHEN** source 把 A 與 B 當成並列主張
- **THEN** gu-log body SHALL NOT 改寫成「因為 A，所以 B」
- **BECAUSE** 這是在憑空創造 source 沒有的因果關係

#### Scenario: caveat relocation must not strengthen the claim

- **WHEN** source 把重要 caveat 埋在註腳或後段
- **THEN** gu-log body MAY 為了清楚而移動那個 caveat
- **BUT** 不得把文章重組到讓主要主張讀起來比 source 支撐得更強

#### Scenario: source edge remains intact

- **WHEN** source 提出尖銳、批判或不舒服的主張
- **THEN** gu-log body SHALL 保留那個 edge
- **AND** 不得只為了讓文章比較安全或泛用就把它磨鈍

---

### Requirement: Translation boundary MUST be testable by author and self-check tests

GP 與 MP 翻譯 SHALL 使用以下原作者測試：

> 如果原作者讀 body，他會說「你把我講得更清楚了」，還是「你讓我說了我沒說過的話」？

前者 SHALL 可以接受；後者 SHALL 被視為扭曲，而且已經過線。

writer 與 reviewer SHALL 也使用以下自檢句：

> 我改的是「怎麼講」，還是「講了什麼」？

只改「怎麼講」SHALL 是重組敘事。碰到「講了什麼」SHALL 是 payload change，必須把材料移到 note、移除，或恢復 source fidelity。

#### Scenario: author test passes

- **WHEN** body 片段改了順序、節奏、例子或 phrasing
- **BUT** 合理的原作者會認得這是自己主張的更清楚版本
- **THEN** 該片段 SHALL 通過原作者測試

#### Scenario: author test fails

- **WHEN** body 片段讓 source 作者看起來主張了他沒講過的事實、結論、因果或信心水準
- **THEN** 該片段 SHALL fail 原作者測試
- **AND** writer SHALL 在發布前修正，或把 gu-log 外加材料移進 MoguNote

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

- GP = ShroomDog 選的外部好文，忠實翻譯並加 MoguNote commentary
- MP = Mogu 選的 tweet 或短 source，其他 body / note 邊界同 GP
- SD = ShroomDog 原創 essay，沒有 source fidelity 義務；ShroomDogNote 是 user 本人聲音
- Lv = 原創入門教學，類比扛概念；除了 Lv-guided-reading mode 必須 cite source ref 之外，沒有 source fidelity 義務

#### Scenario: GP identity is cited

- **WHEN** doc、prompt 或 judge 描述 GP
- **THEN** 它 SHALL 把 GP 描述為 ShroomDog-selected external good writing with faithful translation plus MoguNote commentary
- **AND** SHALL NOT 把 GP 描述成自由改寫

#### Scenario: MP identity is cited

- **WHEN** doc、prompt 或 judge 描述 MP
- **THEN** 它 SHALL 把 MP 描述為 Mogu-selected tweets or short-form sources
- **AND** SHALL 保留與 GP 相同的忠實 body 與 commentary-note 邊界

#### Scenario: SD identity is cited

- **WHEN** doc、prompt 或 judge 描述 SD
- **THEN** 它 SHALL 把 SD 描述為 ShroomDog 原創 essay
- **AND** SHALL 把 ShroomDogNote 視為 user 本人聲音，而不是 source commentary

#### Scenario: Lv identity is cited

- **WHEN** doc、prompt 或 judge 描述 Lv
- **THEN** 它 SHALL 預設把 Lv 描述為原創入門教學
- **AND** 當 Lv 在教一篇 source article 時，SHALL 區分 Lv-guided-reading mode

---

### Requirement: MOBA register MUST follow voice, not series

MOBA 味 SHALL 跟著聲音走，不跟著系列走。

Mogu、SD 與 Lv 的聲音 MAY 有 MOBA flavor。翻譯 body SHALL 保持素顏，SHALL NOT 因為系列或站內 persona 而沾上 MOBA flavor。

在作者優先北極星下，深 MOBA 詞，包含 Vainglory-specific terms，MAY 使用。On-site MOBA glossary 上線前，非顯而易見的深詞 SHALL 在當下自然解釋，或 SHALL 改用較廣、陌生同事能懂的概念。Glossary 上線後，每個非顯而易見的深詞 SHALL 能 link 到該站內 glossary。

類比本身 SHALL 扛住概念。讀者 SHOULD 只靠上下文就懂七八成，不必打開 glossary 才能理解論點。Glossary SHALL 是深詞安全網，不是把一整段塞滿 jargon 的許可證。

#### Scenario: translated body remains plain

- **WHEN** GP 或 MP body 翻譯 source claim
- **THEN** translated body SHALL 保持 plain
- **AND** SHALL NOT 加入 MOBA-flavored wording、玩笑或外加類比
- **AND** 這類 commentary SHALL 改放進 MoguNote

#### Scenario: Mogu voice may use MOBA flavor

- **WHEN** MoguNote、SD prose 或 Lv explanation 使用 MOBA 類比扛概念
- **THEN** 該類比 SHALL 被允許
- **AS LONG AS** 上下文能扛住概念，而且術語密度沒有破壞 coworker-reader floor

#### Scenario: deep terms remain readable before glossary launch

- **WHEN** on-site MOBA glossary 尚未上線
- **AND** note 或原創說明想使用非顯而易見的 MOBA / Vainglory-specific term
- **THEN** writer SHALL 在當下自然解釋該詞，或改用較廣的概念
- **AND** 文章 SHALL NOT 要求讀者靠外部搜尋才能理解論點

#### Scenario: deep terms require glossary support after launch

- **WHEN** on-site MOBA glossary 已上線
- **AND** note 或原創說明使用非顯而易見的 MOBA / Vainglory-specific term
- **THEN** 該詞 SHALL 可 link 到 on-site MOBA glossary
- **AND** 文章 SHALL NOT 依賴 glossary 作為讀懂論點的唯一方式

#### Scenario: excessive jargon violates the shareability floor

- **WHEN** 一段文字堆了多個深 MOBA term，導致 coworker reader 必須一直停下來查
- **THEN** 該段 SHALL 違反 shareability floor
- **EVEN IF** 每個詞技術上都有 glossary entry

---

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
