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
- **THEN** 文章 SHALL 先以 MP 上線，再依 `gp-signature-picks` 升格成 GP
- **AND** SHALL NOT 套用導讀格式

#### Scenario: ShroomDog 挑的來源預設寫成 MP

- **WHEN** ShroomDog 挑一篇外部文章要 gu-log 寫，但沒有明確說它是 GP
- **AND** 文章的主要 reader job 不是分步教會讀者理解概念或來源
- **THEN** 文章 SHALL 使用 MP，SHALL NOT 因來源是 ShroomDog 挑的或品質特別好就用 GP

### Requirement: Lv MUST support original and guided-reading modes

Lv SHALL 支援兩種編輯 mode：

- `Lv-original`
- `Lv-guided-reading`

`Lv-original` SHALL 從零教一個概念，沒有 source fidelity 義務。在此 mode 中，gu-log MAY 使用原創說明、類比與深 MOBA reference，只要它們能幫忙扛住概念。

`Lv-guided-reading` SHALL 用 Lv 拆解一篇又長又難或很密的 source article。在此 mode 中，文章 SHALL 在開頭 cite source ref，讓 coworker-floor reader 想追原文時一眼看得到。

Lv-guided-reading 的讀者任務是分步學會這篇 source：它是在「教」，不是翻譯，也不是 MP 或 GP 那種由 Mogu 以來源為材料、寫成自己主張的文章。它 MAY 只挑有用的一塊、簡化並大幅重組；它 SHALL NOT 被要求 cover 整篇 source。

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

### Requirement: MOBA register MUST follow voice, not series

MOBA 味 SHALL 跟著聲音走，不跟著系列走。Mogu 擁有聲音的 GP 與 MP body、MoguNote，以及 SD、Lv SHALL 被允許使用 MOBA flavor。直接引用的來源原話仍屬於來源作者，SHALL 保持素顏，不得因站內 persona 沾上外加 MOBA flavor。

在作者優先北極星下，深 MOBA 詞，包含 Vainglory-specific terms，SHALL 被允許使用。On-site MOBA glossary 上線前，非顯而易見的深詞 SHALL 在當下自然解釋，或 SHALL 改用較廣、陌生同事能懂的概念。Glossary 上線後，每個非顯而易見的深詞 SHALL 能 link 到該站內 glossary。

類比本身 SHALL 扛住概念。讀者 SHALL 能只靠上下文理解主要論點；Glossary SHALL 是深詞安全網，不是把一整段塞滿 jargon 的許可證。

#### Scenario: translated body remains plain

- **WHEN** 文章翻譯並直接引用來源的原話
- **THEN** 引文的譯文 SHALL 保持 plain
- **AND** SHALL NOT 加入 MOBA-flavored wording、玩笑或外加類比
- **AND** Mogu 的吐槽與類比 SHALL 放在引文之外

#### Scenario: Mogu voice may use MOBA flavor

- **WHEN** GP 或 MP body 使用 Mogu 的類比、幽默或 MOBA flavor 建立自己的論點
- **THEN** 該寫法 SHALL 被允許
- **AND** SHALL NOT 因它出現在 body 而非 MoguNote 就判 commentary separation fail
- **AND** factual premise 與來源歸因仍 SHALL 遵守 MP grounding contract，GP 適用同一套規則

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

### Requirement: Reader-visible article content MUST exclude unapproved emoji

gu-log 的 reader-visible article content SHALL 預設不包含 emoji。Kaomoji SHALL 視為獨立的文字型品牌語彙，不受此禁令影響。

只有 ShroomDog 對特定文章的特定 emoji 明確核准時，該文章才 MAY 保留那個 emoji。核准 SHALL 記成檢查腳本裡的一筆短紀錄（文章路徑、emoji、理由）；writer SHALL NOT 自行加紀錄，也 SHALL NOT 用 frontmatter flag 或 glob 放行。

gp-pipeline 的自動化流程 SHALL NOT 提供保留 emoji 的例外。gp-pipeline 的英文 sidecar 翻譯者 SHALL 省略裝飾性字形，字形承載的必要語意 SHALL 改用自然文字表達，SHALL NOT 保留或依來源復原任何 Unicode emoji 字形。

pre-commit 與 CI SHALL 使用同一支檢查腳本，檢查 `src/content/posts/` 下新增或修改的行。沒有動到的舊行 SHALL NOT 被追溯阻擋。

#### Scenario: New post contains an emoji

- **WHEN** 新增文章的任何一行包含未核准的 emoji
- **THEN** pre-commit SHALL 阻擋該 commit，並回報路徑、行號與 emoji
- **AND** CI SHALL 對同一內容得出相同失敗結果

#### Scenario: Reader-visible component surfaces are covered

- **WHEN** 新增的 emoji 出現在 frontmatter、MoguNote、ShroomDogNote 或其他 component、圖片替代文字或 code block
- **THEN** 檢查腳本 SHALL 一樣擋下，不需要先判斷那一行讀者看不看得到

#### Scenario: Kaomoji remains allowed

- **WHEN** 新增或修改的文章使用文字型 kaomoji
- **THEN** emoji 檢查 SHALL NOT 因該 kaomoji 失敗
- **AND** 塞進 kaomoji 外殼的 emoji 仍 SHALL 被阻擋

#### Scenario: User grants a narrow exception

- **WHEN** ShroomDog 明確核准某篇文章保留某個 emoji
- **AND** 檢查腳本記有該文章路徑、emoji 與理由
- **THEN** 檢查腳本 SHALL 放行該文章裡的這個 emoji
- **AND** SHALL NOT 放行同篇其他 emoji 或其他文章

#### Scenario: Untouched legacy post contains emoji

- **WHEN** 歷史文章含有 emoji
- **BUT** 該行在目前變更中沒有新增或修改
- **THEN** 檢查腳本 SHALL NOT 阻擋這次變更
- **AND** 之後修改該行時 SHALL 要求移除 emoji 或取得核准
- **AND** 只改檔名、內容不變的文章 SHALL 視為沒有新增行（改 slug 不必先清舊 emoji）

#### Scenario: Local and CI results stay aligned

- **WHEN** 同一組文章變更分別在 pre-commit 與 pull request CI 檢查
- **THEN** 兩者 SHALL 執行同一支檢查腳本
- **AND** 無法取得比較基準時 SHALL 失敗，不得當成通過

#### Scenario: 英文 sidecar 不復原來源 emoji

- **WHEN** gp-pipeline 的英文 sidecar 翻譯者遇到原始來源或 zh-tw 正文脈絡中的表情圖示
- **THEN** sidecar prompt SHALL 要求省略裝飾性字形，或用自然文字保留其必要語意
- **AND** SHALL NOT 依來源或推測直接復原任何字形
- **AND** 最終內容檢查 SHALL 阻止未核准字形進站

## REMOVED Requirements

### Requirement: GP 整篇翻譯 MUST 先取得來源作者同意才可公開

**Reason**: 這條綁了作者同意、GP 導讀格式與來源距離章、GP 列表三件事。導讀格式和章已退役，另外兩件改寫成新的 requirement（MODIFIED 不能刪既有情境）。

**Migration**: 作者同意改由「沒有來源作者同意的整篇翻譯 MUST NOT 公開」承接，不分系列；GP 的定義、升格門檻與列表（含「讀者開啟 GP 系列頁」）移到 `gp-signature-picks`。

### Requirement: GP body MUST be a Mogu-written reading guide

**Reason**: ShroomDog 2026-10-28 決定 GP 不再是導讀，而是他指定的招牌文章，寫法跟 MP 相同；導讀格式與來源距離章一起退役。

**Migration**: GP 正文改依 `gp-signature-picks`，照 MP 規則寫；Tribunal 只評分不改寫（`gp-source-preservation`）。`ShroomDogNote` 規則改由下方 ADDED 的那條承接，不分系列；不冒充 ShroomDog 由「MP body MUST be Mogu-authored and source-grounded」承接。線上的 GP-276～279 改成 MP。

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

`ShroomDogNote` SHALL 只來自 ShroomDog 本人。自動化寫作 SHALL NOT 產生它，不分系列（gp-pipeline 的擋法見 `gp-pipeline-publish-integrity`）。Tribunal 評任何系列時 SHALL 把它當成 ShroomDog 本人的話，SHALL NOT 當成 Mogu persona 或來源評論來評分。

#### Scenario: 自動化輸出 ShroomDogNote

- **WHEN** gp-pipeline 替 MP 或 SD 寫稿、改稿，輸出含 `ShroomDogNote`
- **THEN** 該步驟 SHALL 失敗，這段輸出 SHALL NOT 寫進文章

#### Scenario: 評審讀到 ShroomDogNote

- **WHEN** Tribunal 評一篇含 `ShroomDogNote` 的文章，不論系列
- **THEN** 評審 SHALL 把裡面的看法歸給 ShroomDog，SHALL NOT 當成 Mogu persona 或來源評論
