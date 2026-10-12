# Design

## Context

- 動機見 proposal.md〈Why〉。
- `write.tmpl`、`review.tmpl`、`refine.tmpl` 對 GP、MP 各有專屬分支，其餘系列（SD、Lv）共用 `{{else}}` 分支；這條分支沿用 charter 之前的翻譯契約。模板裡沒有任何 Lv 專屬文字。
- 系列判斷散在幾個入口：
  - `run` 與 standalone `deploy` 用 `resolveSeries`：有檔案就看檔名，沒有就看 `--prefix`。
  - `write` 吃 `--prefix`。
  - `review`、`refine` 從 `--ticket-id` 推出系列，沒帶時預設是 `GP-PENDING`。
  - `ralph` 看 `--file` 的檔名；`credits` 目前不看系列。
- 寫作相關的步驟順序是 write → review → refine → post-fixer →（GP 專屬的 source-distance）→ credits → ralph → translate → deploy。`run` 已經有同類的 ingress 檢查可以參考，例如 `--from-step source-distance` 只接受 GP。
- `ralph` 遇到 GP 以外的系列會做三件事：跑會改正文的 post-fixer、讓 Tribunal 寫手可以改寫，最後把 `translatedBy.pipeline` 正規化成 pipeline 的署名。`credits` 會寫入 pipeline 署名與 `pipelineUrl`。
- 手寫 Lv 的評審是直接跑 `scripts/tribunal.sh`：Lv-18 這次就是這樣跑，背景 Tribunal daemon（`scripts/tribunal-quota-loop.sh`）也是。這支程式不碰 `translatedBy`，`CONTRIBUTING.md` 也規定 Lv 的署名角色是 `Author`。
- 2026-10-12 的 value review 有三位唱反調的審查員：
  - 一位判 BUILD-SMALLER：在入口擋下，再補路由說明與 Lv 版型小節。
  - 一位判 BUILD-SOMETHING-ELSE：做一條薄的 Lv 分支，加上 charter scenario 與 validate 規則。
  - 一位判照原提案 DON'T BUILD：模板和評審都只看得出「有沒有」，看不出「好不好」。
  - 三位都反對讓評審檢查版型。ShroomDog 選了第一種，也就是方案 A。

## Goals / Non-Goals

**Goals:**

- 讓錯的路走不通：pipeline 撰寫、改寫 Lv，或替 Lv 蓋 pipeline 署名的入口，一律在 ingress 擋下，沒有副作用。
- 讓對的路找得到：錯誤訊息、`SKILL.md`、`CONTRIBUTING.md` 都指向同一節 Lv 寫作流程。

**Non-Goals:**

- 不做 Lv 專屬 prompt 分支，不改模板內容。SD 還在用 `{{else}}` 分支。
- 評審不檢查版型，`validate-posts.mjs` 不加 Lv 格式規則，`editorial-charter` 也不加版型 scenario。
- SD 不擋。
- 既有 Lv 文章不改。

## Decisions

### 1. 在入口拒絕，而不是補一條 Lv 分支

這條路在 18 篇 Lv 裡只用過一次。版型沒有寫成文字的權威來源，手寫的 17 篇卻都有分層與測驗。要補分支就得同時改 write、review、refine 與 tribunal-writer。repo 又規定測試不得斷言 prompt 原句，所以只能靠真的跑模型來驗證，維護成本跟使用頻率不成比例。擋在入口最便宜，也直接防止重演。

替代方案：做完整的 Lv 自動化（方案 B），或只記錄決定（方案 C）。owner 兩個都沒選。

### 2. 拒絕的範圍是「會撰寫、改寫 Lv 正文，或替 Lv 蓋 pipeline 署名的步驟」

擋 write、review、refine、credits、ralph。post-fixer 與 source-distance 只在 `run` 裡、`ralph` 之前跑，跟著 `run` 的判斷一起擋。其他步驟照常開放：

- `fetch`、`eval`、`dedup`：寫設計稿時用得到。
- `counter`：手寫也要配號。
- `translate`：保留原文的署名，只記下翻譯用的模型；Lv-18 的英文版已經實測過。
- `deploy`

Lv 的 Tribunal 改走 `scripts/tribunal.sh`：四位評審相同，背景 daemon 本來就這樣跑。

`run` 的判斷是：系列是 Lv 時，只接受 `run --file <Lv 檔>` 從 `translate` 或 `deploy` 恢復，其他一律拒絕；沒指定起點視同從頭跑。沒有 Lv 檔的 `run --from-step deploy` 沒有東西可以發布，卻會先在工作目錄跑 credits 蓋署名，所以也擋。

替代方案：

- 讓 Lv 繼續用 `ralph`：它會跑 post-fixer、允許改寫，還會把手寫 Lv 的署名改成 pipeline 寫的，正好違反這條要求。
- 整個 `run` 對 Lv 都拒絕：會連帶擋掉 `run --file <Lv 檔> --from-step translate` 這條補英文版的恢復路徑，沒有必要。

### 3. 單一判斷、單一錯誤、說明文字從同一份清單產生

- 用一個函式判斷「pipeline 能撰寫的系列」（GP、MP、SD），再用一個建構函式產生拒絕錯誤，六個入口都呼叫同一組。
- 「目標檔是不是 Lv」也只寫一份：檔名系列（含 `levelup-`、`en-`）或 frontmatter 的 `ticketId`，任一個是 Lv 就算。`ralph`、`credits` 與 `review`／`refine` 的草稿檢查共用它，而且檢查的是實際會被讀寫的檔：`--work-dir` 跟 `--draft`、`--file` 不在同一個目錄時，模型讀的是工作目錄裡的草稿，`credits` 蓋章的也是工作目錄裡的 `final.mdx`。
- `review`、`refine` 除了看 `--ticket-id`，也看草稿的 `ticketId`。只看參數的話，漏帶 `--ticket-id` 就會落到預設的 `GP-PENDING`，Lv 草稿默默套用 GP 的規則。這裡只多擋 Lv，其他系列照舊以 `--ticket-id` 為準。
- 寫作指令 help text 與「缺 `--prefix`」錯誤訊息裡的系列清單，從同一個常數產生，不各自手寫。
- 這樣將來要開放或收回某個系列，只改一處，說明文字也不會跟行為對不上。

替代方案：每個指令各寫一段 `if prefix == "Lv"`。六處複製容易漂移。

### 4. 在 ingress 最前面拒絕，沿用 exit code 1

- 位置：系列與 `--from-step` 一解析出來就檢查，排在 yt-dlp 這類外部工具的 preflight、建立工作目錄與任何檔案寫入之前。不然在沒裝 yt-dlp 的機器上，`run <YouTube 網址> --prefix Lv` 會先拿到 exit 10；`write --prefix Lv` 也會先把工作目錄建出來。
- exit code：這屬於 ingress 參數驗證失敗，跟非 canonical prefix、prefix 與檔名不一致是同一類，不另開 exit code。
- 錯誤訊息比照既有慣例用英文，內容包含三件事：
  - pipeline 不撰寫 Lv；
  - 改看 `CONTRIBUTING.md` 的 Lv 寫作流程（設計稿＋固定版本寫手，Tribunal 用 `scripts/tribunal.sh`）；
  - Lv 仍可使用的步驟。

### 5. Lv 文件放 `CONTRIBUTING.md`，寫成指引而不是硬規則

`AGENTS.md` 把「寫／翻譯文章（GP/MP/SD/Lv）」路由到 `CONTRIBUTING.md`，那裡已經有 GP、MP、SD 的流程，唯獨缺 Lv。版型寫成「常見骨架」並附幾篇範本檔名，不寫成必須遵守的格式，原因有三：

- 既有語料本身不一致：有的用 `Floor N`，有的用「第 N 層」；Lv-08、Lv-09 沒有魔王關；有幾篇的測驗比層數少。
- `editorial-charter` 允許 Lv 自由安排結構。
- owner 沒有要求把版型升格成規則。

固定版本寫手的做法只指向各 runtime playbook，Tribunal 的跑法只指向 `docs/tribunal-runbook.md`，都不複製指令、旗標或 model ID。

替代方案有兩個：

- 放 `GU-LOG_WRITER_PROMPT.md`：那是寫作風格的權威來源，而且會整份嵌進 pipeline prompt，Lv 已經不走那裡。
- 放 charter：會把指引變成規則。

### 6. 模板不動

模板沒有 Lv 專屬內容，SD 仍需要 `{{else}}` 分支。清理模板不在這次範圍。

## Risks / Trade-offs

- [某個自動化流程其實會用 Lv 呼叫這些入口] → 實作時 grep repo 內所有呼叫點確認沒有。背景 Tribunal daemon 直接跑 `scripts/tribunal.sh`，不經過 `gp-pipeline ralph`，不受影響。
- [有人照舊習慣用 `gp-pipeline ralph` 評 Lv] → 錯誤訊息指向 `CONTRIBUTING.md` 的 Lv 流程，裡面寫明 Tribunal 用 `scripts/tribunal.sh`；舊文件在同一個 PR 改掉。
- [Tribunal 寫手不知道 Lv 骨架] → 評審沒過時，`scripts/tribunal.sh` 的寫手可能改寫 Lv，而它的 prompt 沒有 Lv 版型的說明，可能把分層或測驗改壞。這是手寫 Lv 一直都有的既有風險，這次不處理；之後要補的話，寫手 prompt 可以引用 `CONTRIBUTING.md` 的〈Lv 常見骨架〉。
- [owner 之後想要全自動的 Lv] → 拒絕集中在單一判斷，重開方案 B 時只要移除這個判斷並補上 Lv 契約。
- [Lv 骨架描述跟語料漂移] → 只寫常見形狀與範本檔名，不寫篇數、題數這類會過期的數字。
- [help text 測試變成斷言散文] → 測試只檢查從常數產生的系列清單，不比對整句說明。

## Migration Plan

不需要遷移，既有文章與資料都不動。要回退就 revert 這個 PR。
