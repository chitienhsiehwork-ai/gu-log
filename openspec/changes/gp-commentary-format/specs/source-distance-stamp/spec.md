## Purpose

定義來源距離章：用 Claude 配對導讀與原文的句子、由程式算出導讀離原文多近，擋下照原文順序逐句翻譯與重講過多原文的文章，並以綁內容指紋的章讓 pre-commit 與 CI 驗證。第一版只對有外部來源的 GP 強制。

## ADDED Requirements

### Requirement: 有外部來源的 GP SHALL 帶有效的來源距離章

來源距離章（下稱章）記錄一篇文章跟它的主要來源有多近。以下文章 SHALL 帶有效的章：`ticketId` 是 GP（含 `GP-PENDING`）、`status` 不是 `taken-down`、而且 `sourceUrl` 是外部來源的繁中檔與英文檔。`sourceUrl` 指向 gu-log 自己、示範用網域（例如 `example.com`），或 ShroomDog 自己的 ChatGPT 對話分享時，不算外部來源。第一版只對 GP 蓋章與驗章：非 GP 文章 SHALL NOT 帶章；MP 與其他系列要不要蓋章，由後續 change 決定。

章有效的條件是：章的 policy 版本等於目前的版本、verdict 是 PASS、用目前的正文與 `sourceUrl` 重算的內容指紋跟章上的相同、章上記錄的指標都在目前的門檻內。`scripts/validate-posts.mjs` SHALL 在 pre-commit 與 CI 用同一份實作驗章，任一條件不符就失敗，錯誤訊息 SHALL 指出要執行的蓋章指令。

任何會改到有章文章正文的路徑，包括寫作 pipeline、Tribunal、人工修改與全站的機械式修改，SHALL 在改完之後重新蓋章，沒過就不得收進 repo；沒有重新蓋章的修改會因為指紋過期被 validator 擋下。

#### Scenario: GP 缺章

- **WHEN** 一篇有外部來源、沒有下架的 GP 繁中檔或英文檔沒有 `sourceDistance`
- **THEN** pre-commit 與 CI 的驗證 SHALL 失敗
- **AND** 錯誤訊息 SHALL 指出 `gp-pipeline stamp --file <檔名>`

#### Scenario: 正文或來源改過之後章過期

- **WHEN** 有章的文章改了任何會進正文投影的文字，或改了 `sourceUrl`
- **THEN** 重算的指紋 SHALL 跟章不符，驗證 SHALL 失敗

#### Scenario: 不進投影的修改不影響章

- **WHEN** 有章的文章只改了其他 frontmatter 欄位（例如分數或摘要）、文字剛好就是一個 ticket 編號的站內文章連結、任何連結的網址，或機器插入的區塊
- **THEN** 章 SHALL 仍然有效

#### Scenario: 章的內容不合格

- **WHEN** 章的 policy 版本不是目前的版本、verdict 不是 PASS，或任一指標超過目前的門檻
- **THEN** 驗證 SHALL 失敗

#### Scenario: 不需要章的文章

- **WHEN** 文章是 GP-1 這類示範來源的 GP、下架文章，或非 GP 文章
- **THEN** 驗證 SHALL NOT 要求章
- **AND** 非 GP 文章帶了章時，驗證 SHALL 失敗

### Requirement: 章 SHALL 綁正文投影的指紋，只存會擋人的摘要

章存在文章 frontmatter 的 `sourceDistance`，SHALL 只記錄：policy 版本、verdict、內容指紋 `subjectSha256`（`sourceUrl` 加上正文投影的 SHA-256）、正規化原文的 `sourceSha256` 與原文 units、會擋人的指標、aligner 的 model（繁中檔）、蓋章日期、改寫輪數與這次蓋章的 aligner 呼叫次數，以及英文版因逐字檢查略過時的標記（繁中檔）。章 SHALL NOT 存逐句配對明細；完整的斷句、配對與計分證據留在 pipeline 的工作目錄。Frontmatter schema SHALL 接受這個選填欄位，欄位內容由 validator 驗證。文章頁、JSON 與 Markdown 輸出 SHALL NOT 顯示章。

正文投影 SHALL 依固定規則產生：排除 frontmatter、`import`／`export`、機器插入的區塊（例如延伸閱讀、失效連結註記）、圖片，以及連到站內文章、而且文字剛好就是一個 ticket 編號（例如 `GP-12`）的連結；其他連結（包括文字不只是 ticket 編號的站內連結）只取文字、不取網址；元件只取子節點的文字，`MoguNote` 與 `ShroomDogNote` 都算正文；fenced code 依固定規則判斷算文字還是程式碼，判斷為程式碼的區塊不進投影、也不計分。投影 SHALL 只依賴這篇文章自己的內容，SHALL NOT 查其他文章的標題、狀態或是否存在；投影 SHALL NOT 依賴 MDX 套件的輸出格式，並 SHALL 有固定指紋的回歸測試。

#### Scenario: 投影指紋固定

- **WHEN** 回歸測試對一份固定的合成 MDX 算正文投影的指紋
- **THEN** 結果 SHALL 等於測試寫死的值
- **AND** 投影規則或 MDX 套件的變動讓指紋改變時，測試 SHALL 失敗

#### Scenario: 包成站內連結的轉述照樣計分

- **WHEN** 導讀把轉述原文的文字包成站內文章連結，連結文字不只是一個 ticket 編號
- **THEN** 這段文字 SHALL 留在投影裡，照樣參與配對與計分
- **AND** 之後改這段連結文字 SHALL 讓章過期

#### Scenario: 被連結的文章改標題或被刪

- **GIVEN** 一篇帶有效章的 GP 連到另一篇站內文章
- **WHEN** 那篇被連結的文章改了標題、被下架或被刪除，GP 本身沒有改
- **THEN** GP 的章 SHALL 仍然有效

#### Scenario: 章不存配對明細

- **WHEN** pipeline 把章寫進 frontmatter
- **THEN** 章 SHALL NOT 含逐句配對
- **AND** 工作目錄 SHALL 保留每次配對與計分的證據

#### Scenario: 讀者看不到章

- **WHEN** 讀者開啟有章文章的頁面、JSON 或 Markdown 輸出
- **THEN** 輸出 SHALL NOT 含章的欄位

### Requirement: 原文與導讀 SHALL 以固定規則正規化與斷句

蓋章用的原文 SHALL 由固定規則從擷取結果產生：去掉擷取工具加上的標頭與標記，並依寫死的規則剪掉網站外框（例如導覽、分享鈕、作者簡介、相關文章與頁尾），SHALL NOT 靠人工逐篇決定。原文與導讀 SHALL 用同一套斷句規則：先依區塊（段落、標題、清單項、引言、表格列）切，再依中英文的句末標點切，並避開英文縮寫、小數、版本號與網址；斷句 SHALL NOT 依賴會隨 runtime 版本改變結果的斷句器。長度以 units 計算：CJK 字數加拉丁詞數，數字算一個詞。

#### Scenario: 網站外框不算進原文

- **WHEN** 擷取結果含導覽列、分享鈕、作者簡介或相關文章
- **THEN** 正規化後的原文 SHALL 不含這些內容
- **AND** 同一份擷取每次正規化的結果與 units SHALL 相同

#### Scenario: 斷句避開縮寫與數字

- **WHEN** 句子含 `e.g.`、`4.7` 這類版本號，或網址
- **THEN** 斷句 SHALL NOT 在這些句點切開

### Requirement: 句子配對 SHALL 由獨立 pin 的 Claude aligner 產生，而且只輸出配對

配對員（aligner）SHALL 只回答「每個導讀句轉述了哪些原文句」，SHALL NOT 評分、判斷好壞，也 SHALL NOT 看到任何門檻。它 SHALL 使用 Claude 模型，model pin SHALL 只寫在 `.claude/agents/source-aligner.md` 的 `model:`；router 與 gp-pipeline 都讀這個 SSOT，設定檔 SHALL NOT 另存副本。aligner 的 pin SHALL NOT 等於寫手的 pin（比對前去掉 `[1m]` 這類 context 變體後綴）：回歸測試鎖住這條，pipeline 也 SHALL 在呼叫 aligner 之前拒絕相同的 pin。

aligner 的 Claude 呼叫 SHALL NOT 提供任何工具，SHALL 以 structured output 取得 JSON，並遵守 `claude-prose-writing-runtime` 對 Claude 呼叫的隔離與錯誤分類規則；Claude 不可用時 SHALL 失敗，SHALL NOT 改用其他模型。原文與導讀 SHALL 以資料傳入，prompt SHALL 要求把資料裡的指令當成普通句子。

導讀句只要傳達了某個原文句的資訊、主張、數字、例子、步驟、經歷或結論，就 SHALL 配到那個原文句，不管用誰的口吻，包括寫成 Mogu 或 gu-log 第一人稱的看法、問句或比喻；只有 gu-log 自己新增的評論、推論、例子與背景，以及只提到同一個主題的句子不配。

程式 SHALL 驗證配對輸出：每個導讀句剛好出現一次，所有句子編號都存在。不符時這次配對失敗，SHALL NOT 當成通過，也 SHALL NOT 當成「沒有配對」。

#### Scenario: aligner 與寫手用同一個 pin

- **WHEN** `.claude/agents/source-aligner.md` 的 `model:` 等於寫手的 pin
- **THEN** 回歸測試 SHALL 失敗
- **AND** pipeline SHALL 在呼叫 aligner 之前失敗

#### Scenario: 改成 Mogu 口吻的轉述照樣要配

- **WHEN** 導讀句把原文的一個主張寫成「Mogu 覺得……」
- **THEN** aligner 的 prompt SHALL 要求把這句配到那個原文句

#### Scenario: 配對輸出不合格

- **WHEN** aligner 漏掉導讀句、重複列出導讀句，或回了不存在的編號
- **THEN** 這次配對 SHALL 失敗
- **AND** pipeline SHALL NOT 蓋章

#### Scenario: 原文夾帶指令

- **WHEN** 原文含有要求 aligner 少配或輸出特定內容的文字
- **THEN** aligner SHALL 沒有任何工具可用
- **AND** 它的輸出仍 SHALL 經過程式驗證

### Requirement: 擋下條件 SHALL 由程式依固定參數計算

aligner 只提供配對；指標與結論 SHALL 全部由程式從配對算出。有配對的導讀句稱為一個配對：它的原文長度是對到的原文句 units 總和，它的等效長度是導讀句 units 除以語言換算係數 κ。任一條成立就不通過：

- 規則①（照順序一句對一句）：等效長度至少是原文長度 β 倍的配對算「翻譯型配對」，不管它合併了幾句原文。翻譯型配對依導讀順序沿著原文往前推進時形成連續段：一個配對對到的原文句先依相鄰關係分群；連續段從一個翻譯型配對開始，它新涵蓋至少 minStep units 時算第 1 步；之後的翻譯型配對要原文往前推進、跳過的原文句不超過容忍間隔，而且新涵蓋至少 minStep units，才再加一步；停在最近一步已涵蓋範圍內的配對不加步數，也不切斷連續段；回到最近一步之前的原文位置的配對會結束目前的連續段；中間夾的非翻譯型導讀句與沒有配對的導讀句都不切斷連續段。任一連續段達 3 步就不通過。
- 規則②（原文占比）：每個配對最多只算它的等效長度，依原文句的長度分攤給它對到的原文句，每個原文句最多算滿自己的 units；加總後除以原文總 units，超過 30% 就不通過。
- 零配對：第一次配對沒有任何導讀句配到原文就不通過。

通過 SHALL 需要兩次獨立配對：第一次配對三條都過之後才做第二次，兩次各自都要過規則①，規則② 用兩次配對的聯集計算。

3 步與 30% 是 owner 定的數字；β、κ、容忍間隔與 minStep 是校準決定的參數。所有數字與規則 SHALL 集中在同一份有版本的 policy，改動任何一項 SHALL 升 policy 版本。

#### Scenario: 連續三句照順序翻譯

- **WHEN** 三個導讀句依序各自翻譯三個相鄰的原文句
- **THEN** 規則① SHALL 不通過

#### Scenario: 三句併一句照翻

- **WHEN** 一個導讀句把三句原文併成一句照翻，等效長度跟原文相當
- **THEN** 它 SHALL 算翻譯型配對
- **AND** SHALL NOT 因為合併了多句就被當成摘要

#### Scenario: 翻兩句夾一句吐槽

- **WHEN** 兩個翻譯型配對之間夾著一句沒有配對的評論，後面接著繼續照順序翻譯
- **THEN** 連續段 SHALL NOT 被這句評論切斷

#### Scenario: 一句總覽不吃掉占比

- **WHEN** 一個短的導讀句概括了原文的一大段
- **THEN** 它在規則② SHALL 只算它自身等效長度的原文量

#### Scenario: 重講太多原文

- **WHEN** 導讀重講的原文量超過原文總 units 的 30%
- **THEN** 規則② SHALL 不通過

#### Scenario: 零配對

- **WHEN** 第一次配對沒有任何導讀句配到原文
- **THEN** 結果 SHALL 是不通過

#### Scenario: 第二次配對沒過規則①

- **WHEN** 第一次配對全部通過，第二次獨立配對的規則① 不通過
- **THEN** 結果 SHALL 是不通過

#### Scenario: 計分測試使用合成資料

- **WHEN** 單元測試需要原文、導讀與配對
- **THEN** 它們 SHALL 是自寫的合成文字與手寫的配對
- **AND** 測試 SHALL NOT 呼叫模型，也 SHALL NOT 放第三方原文或已下架的譯文

### Requirement: 沒過 SHALL 自動改寫最多三輪，改寫看不到門檻

導讀沒過時，pipeline SHALL 把被標出的段落交回寫作流程的 refine 改寫，再重跑會改正文的 post-fixer、配對與計分；最多改寫三輪，第三輪之後仍沒過 SHALL 以 exit code 19 結束，SHALL NOT 發布或配置文章號碼，並保留每一輪的配對與計分證據。改寫的輸入 SHALL 只標出像翻譯的段落（連續段裡的導讀句、轉述最多的段落），SHALL NOT 含門檻、指標數字或計分規則。改寫 SHALL 保留主張的條件、語氣強弱與歸屬，SHALL NOT 把原作者的主張改寫成 Mogu 的看法，也 SHALL NOT 新增來源沒有的事實。改寫輪數與這次的 aligner 呼叫次數 SHALL 寫進章與證據。

零配對代表配對壞了或文章跟來源無關，改寫也修不好：pipeline SHALL 直接以 exit code 19 結束，SHALL NOT 進入改寫。

aligner 呼叫失敗或輸出不合格時，pipeline SHALL 依 Claude 的錯誤分類停下，SHALL NOT 把它當成通過、不通過或一輪改寫。

#### Scenario: 改寫一輪後通過

- **WHEN** 初稿沒過，改寫一輪之後兩次配對都通過
- **THEN** pipeline SHALL 蓋章並繼續後面的步驟
- **AND** 章 SHALL 記錄改寫輪數與這次的 aligner 呼叫次數

#### Scenario: 三輪改寫後仍沒過

- **WHEN** 第三輪改寫之後仍沒過
- **THEN** 指令 SHALL 以 exit code 19 結束
- **AND** SHALL NOT 部署，也 SHALL NOT 改動文章 counter
- **AND** 工作目錄 SHALL 保留每一輪的草稿、配對與計分證據

#### Scenario: 零配對不改寫

- **WHEN** 第一次配對沒有任何導讀句配到原文
- **THEN** 指令 SHALL 直接以 exit code 19 結束
- **AND** SHALL NOT 呼叫 refine 改寫

#### Scenario: 改寫 prompt 不含門檻

- **WHEN** pipeline 組裝改寫用的 prompt
- **THEN** prompt SHALL 只列出被標出的段落
- **AND** SHALL NOT 含門檻數字、指標數字或規則定義

#### Scenario: aligner 呼叫失敗

- **WHEN** aligner 因額度、登入或輸出不合格而失敗
- **THEN** pipeline SHALL 停下並回報錯誤，SHALL NOT 蓋章
- **AND** SHALL NOT 把這次失敗算成一輪改寫

### Requirement: 英文版 SHALL 通過逐字 n-gram 檢查

有外部來源的 GP 英文版 SHALL 在部署之前跟正規化原文做逐字比對：算出非引文文字的詞級 n-gram 有多少比例出現在原文，以及最長一段跟原文逐字相同的詞數，任一超過門檻就不通過。有標明的引文（blockquote 與引號內的文字）SHALL 豁免，但豁免的總詞數 SHALL 有上限，超過上限的部分照常計入。n、兩個門檻與引文上限 SHALL 放在同一份 policy。通過的英文版 SHALL 帶英文的章，驗法跟繁中相同：指紋、verdict 與指標。

英文版沒過時 SHALL NOT 部署，pipeline SHALL NOT 自動重翻，繁中版照既有規則繼續，run report SHALL 記錄英文版沒過。這時繁中檔的章 SHALL 記下「英文版因逐字檢查略過」的標記；CI 的翻譯配對檢查看到這個標記，SHALL 放行這篇缺少的英文檔。之後補上通過檢查的英文版時，pipeline 與 `stamp` SHALL 清掉這個標記。翻譯 prompt SHALL 要求不得把轉述還原成原文的措辭，只有標明的引文可以逐字。

#### Scenario: 英文版逐字照搬原文

- **WHEN** 英文版有一段沒標成引文的文字，跟原文連續逐字相同的詞數超過門檻
- **THEN** 檢查 SHALL 不通過
- **AND** 英文版 SHALL NOT 部署

#### Scenario: 標明的引文在上限內

- **WHEN** 英文版用 blockquote 或引號引用原文，引文總詞數在上限內
- **THEN** 檢查 SHALL NOT 因為這些引文不通過

#### Scenario: 引文超過上限

- **WHEN** 標明的引文總詞數超過上限
- **THEN** 超出上限的引文 SHALL 照常計入逐字比對

#### Scenario: 英文版沒過不重翻

- **WHEN** 英文版的檢查沒過
- **THEN** pipeline SHALL NOT 重新翻譯
- **AND** 繁中版 SHALL 照既有規則繼續部署，run report SHALL 記錄英文版沒過
- **AND** 繁中檔的章 SHALL 記下英文版因逐字檢查略過

#### Scenario: 略過英文版的 GP 通過翻譯配對檢查

- **WHEN** CI 的翻譯配對檢查以 strict 模式檢查一篇 Tribunal 通過、沒有英文檔的 GP
- **AND** 它的章記著英文版因逐字檢查略過
- **THEN** 檢查 SHALL 放行這篇
- **AND** 沒有這個標記、Tribunal 也通過的 GP 缺英文檔時，檢查 SHALL 照舊失敗

### Requirement: 手寫或人工修改的 GP SHALL 能用 `gp-pipeline stamp` 蓋章

`gp-pipeline stamp --file <文章檔>` SHALL 對一篇既有的 GP 文章做跟 pipeline 相同的檢查：繁中檔做兩次配對與計分，英文檔做逐字比對；通過就寫入章，SHALL NOT 改寫正文。原文依 `sourceUrl` 用既有的擷取規則取得，或由 `--source` 指定 repo 外的擷取檔；擷取結果 SHALL NOT 寫進 repo。沒過 SHALL 以 exit code 19 結束並印出被標出的段落，檔案 SHALL 維持不變。非 GP 或沒有外部來源的文章 SHALL 在 ingress 以 exit code 1 被拒絕。

#### Scenario: 手寫的 GP 通過

- **WHEN** 操作者對一篇手寫的 GP 繁中檔執行 `stamp --file`，檢查通過
- **THEN** 檔案 SHALL 只新增或更新 `sourceDistance`，正文 SHALL 不變

#### Scenario: 手寫的 GP 沒過

- **WHEN** 檢查沒過
- **THEN** 指令 SHALL 以 exit code 19 結束並印出被標出的段落
- **AND** 檔案 SHALL 維持不變

#### Scenario: 對不需要章的文章蓋章

- **WHEN** 操作者對 MP 文章或 GP-1 執行 `stamp --file`
- **THEN** 指令 SHALL 在 ingress 以 exit code 1 失敗，SHALL NOT 呼叫模型
