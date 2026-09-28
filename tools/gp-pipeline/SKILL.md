# gp-pipeline

gu-log 依來源寫作的 pipeline，GP 導讀、MP、SD、Lv 共用。唯一入口是：

```bash
tools/gp-pipeline/gp-pipeline <subcommand>
```

wrapper 會在需要時把 Go CLI 編譯到忽略版控的 `bin/`。repo 不保留第二套 shell pipeline、舊命令或預編譯 binary。

## Taxonomy 契約

- `GP` = Gu-log Picks（ShroomDog 精選導讀），檔名以 `gp-` 開頭：Mogu 替 ShroomDog 挑的單一來源寫導讀，發布前要蓋來源距離章（見下）。整篇翻譯流程已退役。
- `MP` = Mogu Picks，Mogu 消化單一主要來源後寫成自己的 source-grounded article，檔名以 `mp-` 開頭。
- 原創文章仍使用 `SD`，入門教學仍使用 `Lv`（新檔 `lv-`，既有文章沿用 `levelup-`）。
- 寫作與審稿階段使用 `<PREFIX>-PENDING`；只有 deploy 才配置正式流水號。
- 非 canonical prefix、slug 與舊 pipeline 路徑都已退役；遇到它們應明確失敗，不得靜默轉換。

## 預設用法

> **GP 是 ShroomDog 精選導讀，不是翻譯。** 內容契約以 [`editorial-charter` spec](../../openspec/specs/editorial-charter/spec.md) 為準；user 要 GP 時怎麼做，照 [`CONTRIBUTING.md`](../../CONTRIBUTING.md)〈新增 GP 導讀（GP）〉。GP 跟 MP 走同一條 `write → review → refine`，prompt 換成導讀契約；寫手輸出含 `ShroomDogNote` 就讓該步驟失敗（exit 14），`ShroomDogNote` 只能由 ShroomDog 手加。GP 的 refine（含來源距離的改寫）產出後，要先過 pre-commit 會跑的繁中內容檢查（晶晶體、AI 腔、代名詞）：沒過就把檢查結果交回 refine 修，修到上限還沒過就 exit 14（被抓的若是專有名詞，要先跟 ShroomDog 定好可接受英文的邊界，不要翻掉）；配對前會再驗一次，所以沒過檢查的正文不會被配對或蓋章（例如從 source-distance 恢復的舊草稿），不用等蓋完章才被 pre-commit 擋下重配。refine 之後 GP 多兩步：
>
> - `post-fixer`：kaomoji、glossary 連結與延伸閱讀直接改工作目錄的 `final.mdx`，章才涵蓋得到這些改動。
> - `source-distance`：pin 住的 Claude aligner 配對導讀句與原文句，由程式計分；過了才把章（frontmatter 的 `sourceDistance`）寫進 `final.mdx`。沒過就只把標出的段落交回 refine 改寫、再跑一次 post-fixer；零配對或改寫到上限還沒過就 exit 19：不部署、不動 counter，每輪證據留在工作目錄。
>
> 之後的 credits、ralph、translate 與 deploy 都不改正文：`ralph` 對 GP 只評分，不改寫也不再跑 post-fixer；英文版翻完要過逐字檢查，沒過就丟掉英文版、繁中章記 `englishSkipped: verbatim`，繁中照常部署。手寫的 GP，或 ShroomDog 加了 `ShroomDogNote`、任何人工或機械修改過正文的 GP，用 `stamp --file` 重新蓋章。規則、門檻與章的欄位以 `source-distance-stamp` spec 與 `scripts/lib/source-distance.mjs` 為準，本檔不抄數字。

沒有檔案可以判斷系列時，`run`、`counter`、`write` 一定要帶 `--prefix`，沒有預設值；沒帶就在 ingress 以 exit 1 結束並列出可用系列。帶 `--file`（`run`）或 `--active-file`（standalone `deploy`）時以檔名系列為準（`gp-`、`mp-`、`sd-`、`lv-`、既有 Lv 的 `levelup-`）；明確帶的 `--prefix` 跟檔名對不上就在 ingress 失敗。

使用者明確要求把 URL 寫成／發布為某個系列，或在 `AGENTS.md` 的 URL intake 後明確叫 agent 繼續時，除非有明確 blocker，用 user 選的系列跑完整 pipeline：

```bash
tools/gp-pipeline/gp-pipeline run '<url>' --prefix GP   # ShroomDog 精選導讀
tools/gp-pipeline/gp-pipeline run '<url>' --prefix MP   # Mogu Picks
```

寫作步驟一律使用 Claude 模型，規則見 openspec `claude-prose-writing-runtime`；VM runtime
的 model routing 由 `config/llm-pipeline.json` 控制。model、effort 或 quota threshold
升級時只改 config（Claude 模型改 `.claude/agents/tribunal-writer.md` 的 pin）與
contract tests，不在 skill 複製快照。來源距離的 aligner 也用 Claude，pin 在
`.claude/agents/source-aligner.md`；跟寫手 pin 相同時，pipeline 在呼叫前就失敗。

MP 可貼近來源翻譯／改寫、保留大部分覆蓋與順序並加入 Mogu flavor，也可選材、省略、重排、綜合、反駁或從頭重建文章。MP 沒有最低改寫幅度；不得只因太近或太遠要求重寫。close-form MP 仍由 Mogu 擁有正文聲音，不因貼近來源就承諾完整覆蓋、來源順序或原作者 voice fidelity。兩種距離共用同一個 MP contract，不新增子模式、schema 或 pipeline。一旦保留 source-derived claim，必須保留其 speaker、條件、hedge、controlling caveat、證據範圍與信心強度；不得捏造 facts、quotes、numbers、causality 或歸因。MoguNote 選配，核心分析直接放 body；MoguNote 可用第一人稱寫反應／立場、實際發生的 editorial／tool interaction 或明顯奇幻 persona，但不得挪用來源作者經歷或杜撰看似真實的人類履歷。

只預審一支 YouTube 影片、讓人先看來源完整性與重複證據：

```bash
tools/gp-pipeline/gp-pipeline candidate '<youtube-url>'
```

`candidate` 需要 `yt-dlp`，只在解析後位於 repo 外的工作目錄寫入
`candidate-manifest.json`、原始 VTT、保留時間戳的逐字稿，以及來源完整時的
source capture。它不呼叫 LLM、不建立 MDX、不配置 ticket、不修改 counter／Git，
也不執行 Eval、Write、Review、Refine、Credits、Ralph、Translate 或 Deploy。
`writeEligible: true` 仍不是核准；人工確認後要另跑標準 `run <youtube-url> --prefix <系列>`，系列依 `editorial-charter` 選定。

常用控制：

```bash
# 不 deploy；不配置正式 ticket
tools/gp-pipeline/gp-pipeline run '<url>' --prefix MP --dry-run

# 已確認 evaluator 的 false negative；仍會跑 dedup
tools/gp-pipeline/gp-pipeline run '<url>' --prefix MP --force

# 已人工確認是 dedup false positive 才可使用
tools/gp-pipeline/gp-pipeline run '<url>' --prefix MP --skip-dedup

# 從既有 workdir 的某個 step 恢復；系列以 --file 的檔名為準，不必再帶 --prefix
tools/gp-pipeline/gp-pipeline --work-dir <original-work-dir> run \
  --from-step refine --file <existing-zh-filename>.mdx --dry-run

# GP 在 source-distance 中斷（例如 aligner 失敗）：用原本的 workdir 重新配對與計分，不重寫草稿
tools/gp-pipeline/gp-pipeline --work-dir <original-work-dir> run \
  --from-step source-distance --prefix GP
```

流程順序是 fetch → eval → dedup → `write` → `review` → `refine` →（GP：post-fixer → source-distance）→ credits → ralph → translate（GP 接英文逐字檢查）→ deploy，四個系列共用，不另建 pipeline 或 editorial mode。`translate` 只在 Tribunal 通過後產生 en sidecar；未通過時 zh-tw 單獨發布。內容任務的完成定義仍以 repo playbook 為準，不因單一 subcommand 成功而縮水。

## 可組合 subcommands

| 目的 | 指令 |
|---|---|
| 檢查依賴 | `gp-pipeline doctor` |
| 僅預審單一 YouTube 影片 | `gp-pipeline candidate <youtube-url>` |
| 抓完整來源 | `gp-pipeline fetch <url>` |
| 評估來源 | `gp-pipeline eval --source <file>` |
| 檢查重複 | `gp-pipeline dedup --url <url> --title <title> --series <PREFIX>` |
| 起草 | `gp-pipeline write --source <file> --prefix <PREFIX> --ticket-id <PREFIX>-PENDING`；`--prefix` 必填 |
| 審稿／精修 | `gp-pipeline review --draft <file> --ticket-id MP-PENDING`、`gp-pipeline refine --draft <file> --review <file> --ticket-id MP-PENDING`；`--ticket-id` 的系列決定用哪一套 checklist／prompt，預設 GP-PENDING，審其他系列要明確帶 |
| 跑 tribunal | `gp-pipeline ralph --file <post>.mdx`；系列看檔名（含 `levelup-` 與 `en-` 檔），GP 固定 `--no-rewrite`、只評分 |
| 補 en sidecar | `gp-pipeline translate --file <mp-NNN-*.mdx>`（tribunal 通過後才跑；只寫新 en 檔，不 commit／push；GP 會先過英文逐字檢查） |
| 看下一個號碼 | `gp-pipeline counter next --prefix <PREFIX>` |
| 原子配置號碼 | `gp-pipeline counter bump --prefix <PREFIX>`；`--prefix` 必填 |
| 恢復既有文章 | `gp-pipeline --work-dir <original> run --from-step <step> --file <existing>.mdx`；系列以檔名為準，step 見 `run --help` |
| 全新 PENDING article 配號並發布 | `gp-pipeline deploy --active-file <mp-pending-*.mdx> --date-stamp <YYYYMMDD> --author-slug <author> --title-slug <title>`；系列以檔名為準 |
| 替既有 GP 蓋來源距離章 | `gp-pipeline stamp --file <gp-post>.mdx [--source <repo 外的擷取檔>]`；手寫或改過正文的 GP 用，只寫章、不改正文 |
| 查看 run 狀態 | `gp-pipeline status` |

若在 shell 外直接呼叫，以上表格中的 `gp-pipeline` 代表完整路徑 `tools/gp-pipeline/gp-pipeline`。

既有正式文章一律走 `run --file`，保留原有 ticket 與檔名；standalone `deploy` 只處理尚未配號的全新 PENDING article。

## Side effects 與政策 SSOT

- `fetch`、`eval`、`dedup`、`write`／`review`／`refine`、`credits`、`status` 與 `counter next` 不配置正式 ticket。
- `candidate` 只寫 repo 外的預審工作目錄；無字幕、過短／超限、live／upcoming
  等可審閱結果回 0，但 `writeEligible` 會是 false。video-ID dedup BLOCK 回 13，
  `yt-dlp`／擷取技術失敗回 10，輸入／workdir 錯誤回 1，逾時回 124。
- `candidate --work-dir` 是既存的外部 parent；每次執行都會在底下建立新的
  `0700` private leaf。若 parent 是 repo root、repo 子目錄，或 symlink 解析後
  落在 repo 內，會在擷取前拒絕，且不會改寫 fallback 位置來硬留 manifest。
- YouTube 的 canonical `run` 同樣要求 `yt-dlp`；缺少時不得 fallback 到 generic HTML。
- `counter bump` 會原子修改 `scripts/article-counter.json`；通常只應由 deploy 呼叫。
- `ralph` 對非 GP 可依 Tribunal 契約改寫；GP 固定 no-rewrite，只寫分數，不能更動正文（正文一改，章就失效）。
- `stamp` 只寫 frontmatter 的 `sourceDistance`，不改正文；原文擷取留在 repo 外的工作目錄。沒過或零配對以 exit 19 結束並印出標出的段落，檔案不變。
- `translate` 只寫一個新的 en- sidecar 檔，不 commit、不 push。
- standalone `deploy` 會為全新 PENDING article 配置 ticket、rename pending 檔、validate、build、commit、push；`--date-stamp`、`--author-slug`、`--title-slug` 都是必填輸入。有外部來源的 GP 要帶有效的來源距離章，validator 才會放行。
- standalone `deploy --dry-run` 只做 CLI 輸入預檢，不跑 validator，也不做 counter、檔案、build 或 git 異動；不得用它假裝完成發布。
- `run --dry-run` 會跑完 translate、保留產生的 en sidecar 與 report，然後停在 deploy 前；不配置 ticket、不 validate/build，也不 commit/push。`--skip-validate`、`--skip-build`、`--skip-push` 是 testing-only flags；standalone deploy 正常執行不支援前兩者，standalone dry-run 也不會執行它們所對應的階段。

批准、自主權與品質門檻以 repo 的 `AGENTS.md` 為 Tier-0 SSOT。先用 `./scripts/detect-env.sh --runtime <codex|claude-code>` 確認身份，再遵守它選出的 runtime playbook；本 skill 不另行定義批准規則。

## Exit code

完整清單看 `tools/gp-pipeline/gp-pipeline run --help`，`stamp` 自己的 exit code 看 `stamp --help`。以 code 為準（`cmd/gp-pipeline` 的 `exitCodeFor` 與 `internal/pipeline` 的 `NewStepError`）；清單只放在 help，這裡不另抄一份。

JSON 模式可供自動化讀取：

```bash
tools/gp-pipeline/gp-pipeline --json run '<url>' --prefix MP
```

## 故障處理

1. 先跑 `gp-pipeline doctor`，確認 `node`、`pnpm`、`git` 與必要 provider 可用。
2. 從 `pipeline-status.json` 與 work dir 的產物找最後成功 step，再用**原本的** `--work-dir` 搭配 `--from-step` 恢復；不要重新配置 ticket。
3. source validation 失敗時，修完整 source capture，不要拿 preview 摘要硬寫。
4. counter、ticket prefix 或 pending filename 遇到非 canonical 值時，修呼叫端與資料；不要加 alias。
5. provider preflight 失敗會留下 `<role>-failure.json` 與 run 狀態；修好原 provider 後從安全 recovery point 重跑，不得改用別的 provider 無聲代打。
6. provider quota 或外部 runtime 問題依 repo playbook 處理；Tribunal VM 等環境座標不是 taxonomy compatibility surface。

實際 flags 與預設值以 `gp-pipeline <subcommand> --help` 為準；counter schema、frontmatter 與 OpenSpec 才是資料契約 SSOT。
