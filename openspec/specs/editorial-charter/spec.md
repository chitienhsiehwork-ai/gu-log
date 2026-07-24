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

GP 與 MP 的 body SHALL 是忠實翻譯。

忠實翻譯 SHALL NOT 等於逐字保留所有 inventory。writer MAY 重組敘事、刪掉不重要的專有名詞、合併重複材料，並翻成自然的 PTT 風繁中；前提是這樣做會讓 source idea 更清楚。

對 GP 與 MP body，「重組敘事」只有一個權威定義：

> 改 packaging，不改 payload。

Packaging MAY 包含講述順序、節奏、切塊、框架與故事形狀。Payload SHALL 包含 source 的主張、主張之間的關係、因果、強弱、成立條件、hedge、caveat、限制、數字、證據與結論。

所有 gu-log 意見、吐槽、玩笑、外加類比與 commentary SHALL 進 MoguNote，SHALL NOT 塞進翻譯 body。

#### Scenario: reordered source material preserves payload

- **WHEN** source 花三段鋪陳才進主點
- **AND** gu-log body 先丟主點，再回補脈絡
- **THEN** 這種改寫 SHALL 被允許，屬於重組敘事
- **AS LONG AS** source 的主張、條件、caveat 與關係仍然完整

#### Scenario: bullet wall becomes a mental model

- **WHEN** source 是一面 bullet 牆或乾巴巴 how-to
- **THEN** gu-log body MAY 把它翻成故事、mental model 或更順的說明弧線
- **AS LONG AS** body 保留 source 實際主張，以及那些主張在什麼條件下成立

#### Scenario: removing low-value inventory is allowed

- **WHEN** source 包含不重要專名、重複例子或低價值實作細節
- **THEN** gu-log body MAY 省略或壓縮那些細節
- **AS LONG AS** 省略不會刪掉會改變 source 意思的條件、caveat、證據邊界或主張

---

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
