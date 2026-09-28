# gp-pipeline

gu-log 的 MP／SD／Lv source-grounded writing pipeline（GP 暫停中）。唯一入口是：

```bash
tools/gp-pipeline/gp-pipeline <subcommand>
```

wrapper 會在需要時把 Go CLI 編譯到忽略版控的 `bin/`。repo 不保留第二套 shell pipeline、舊命令或預編譯 binary。

## Taxonomy 契約

- `GP` = Gu-log Picks，檔名以 `gp-` 開頭；整篇翻譯流程已退役，GP 暫停中，導讀格式另案（見下）。
- `MP` = Mogu Picks，Mogu 消化單一主要來源後寫成自己的 source-grounded article，檔名以 `mp-` 開頭。
- 原創文章仍使用 `SD`，入門教學仍使用 `Lv`（新檔 `lv-`，既有文章沿用 `levelup-`）。
- 寫作與審稿階段使用 `<PREFIX>-PENDING`；只有 deploy 才配置正式流水號。
- 非 canonical prefix、slug 與舊 pipeline 路徑都已退役；遇到它們應明確失敗，不得靜默轉換。

## 預設用法

> **GP 暫停中，導讀格式另案。** 整篇翻譯要先取得來源作者同意，以 [`editorial-charter` spec](../../openspec/specs/editorial-charter/spec.md) 為準；GP 整篇翻譯流程已從 pipeline 刪除。`run` 與 standalone `deploy` 處理 GP、`counter bump` 的 GP，以及 `write`／`review`／`refine` 收到 GP，都會在 ingress 以 exit 1「GP 暫停中」結束，不建工作目錄、不呼叫模型。使用者要求寫成 GP 時先說明暫停；要不要改寫成別的系列由 user 依 `editorial-charter` 決定，agent 不自行換系列。`ralph` 仍可替既有 GP 文章評分，固定不改寫。

`--prefix` 預設仍是 GP，所以沒帶 `--file` 的 `run` 一定要明確指定系列。帶 `--file`（`run`）或 `--active-file`（standalone `deploy`）時以檔名系列為準（`gp-`、`mp-`、`sd-`、`lv-`、既有 Lv 的 `levelup-`）；明確帶的 `--prefix` 跟檔名對不上就在 ingress 失敗。

使用者明確要求把 URL 寫成／發布為某個系列，或在 `AGENTS.md` 的 URL intake 後明確叫 agent 繼續時，除非有明確 blocker，跑完整 pipeline（以 Mogu Picks 為例）：

```bash
tools/gp-pipeline/gp-pipeline run '<url>' --prefix MP
```

寫作步驟一律使用 Claude 模型，規則見 openspec `claude-prose-writing-runtime`；VM runtime
的 model routing 由 `config/llm-pipeline.json` 控制。model、effort 或 quota threshold
升級時只改 config（Claude 模型改 `.claude/agents/tribunal-writer.md` 的 pin）與
contract tests，不在 skill 複製快照。

MP 可貼近來源翻譯／改寫、保留大部分覆蓋與順序並加入 Mogu flavor，也可選材、省略、重排、綜合、反駁或從頭重建文章。MP 沒有最低改寫幅度；不得只因太近或太遠要求重寫。close-form MP 仍由 Mogu 擁有正文聲音，不取得 GP 的完整覆蓋、來源順序或原作者 voice fidelity 承諾。兩種距離共用同一個 MP contract，不新增子模式、schema 或 pipeline。一旦保留 source-derived claim，必須保留其 speaker、條件、hedge、controlling caveat、證據範圍與信心強度；不得捏造 facts、quotes、numbers、causality 或歸因。MoguNote 選配，核心分析直接放 body；MoguNote 可用第一人稱寫反應／立場、實際發生的 editorial／tool interaction 或明顯奇幻 persona，但不得挪用來源作者經歷或杜撰看似真實的人類履歷。

只預審一支 YouTube 影片、讓人先看來源完整性與重複證據：

```bash
tools/gp-pipeline/gp-pipeline candidate '<youtube-url>'
```

`candidate` 需要 `yt-dlp`，只在解析後位於 repo 外的工作目錄寫入
`candidate-manifest.json`、原始 VTT、保留時間戳的逐字稿，以及來源完整時的
source capture。它不呼叫 LLM、不建立 MDX、不配置 ticket、不修改 counter／Git，
也不執行 Eval、Write、Review、Refine、Credits、Ralph、Translate 或 Deploy。
`writeEligible: true` 仍不是核准；人工確認後要另跑標準 `run <youtube-url> --prefix <系列>`，系列依 `editorial-charter` 選定（GP 暫停中，會在 ingress 被拒絕）。

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
```

流程順序是 fetch → eval → dedup → `write` → `review` → `refine` → credits → ralph → translate → deploy，MP、SD、Lv 共用，不另建 pipeline 或 editorial mode。`translate` 只在 Tribunal 通過後產生 en sidecar；未通過時 zh-tw 單獨發布。內容任務的完成定義仍以 repo playbook 為準，不因單一 subcommand 成功而縮水。

## 可組合 subcommands

| 目的 | 指令 |
|---|---|
| 檢查依賴 | `gp-pipeline doctor` |
| 僅預審單一 YouTube 影片 | `gp-pipeline candidate <youtube-url>` |
| 抓完整來源 | `gp-pipeline fetch <url>` |
| 評估來源 | `gp-pipeline eval --source <file>` |
| 檢查重複 | `gp-pipeline dedup --url <url> --title <title> --series <PREFIX>` |
| 起草 | `gp-pipeline write --source <file> --prefix MP --ticket-id MP-PENDING`；GP 暫停中 |
| 審稿／精修 | `gp-pipeline review --draft <file> --ticket-id MP-PENDING`、`gp-pipeline refine --draft <file> --review <file> --ticket-id MP-PENDING`；`--ticket-id` 預設是 GP-PENDING，會被暫停擋下 |
| 跑 tribunal | `gp-pipeline ralph --file <post>.mdx`；系列看檔名（含 `levelup-` 與 `en-` 檔），GP 固定 `--no-rewrite` |
| 補 en sidecar | `gp-pipeline translate --file <mp-NNN-*.mdx>`（tribunal 通過後才跑；只寫新 en 檔，不 commit／push） |
| 看下一個號碼 | `gp-pipeline counter next --prefix <PREFIX>` |
| 原子配置號碼 | `gp-pipeline counter bump --prefix <MP\|SD\|Lv>`；GP 暫停中 |
| 恢復既有文章 | `gp-pipeline --work-dir <original> run --from-step <step> --file <existing>.mdx`；系列以檔名為準，step 見 `run --help` |
| 全新 PENDING article 配號並發布 | `gp-pipeline deploy --active-file <mp-pending-*.mdx> --date-stamp <YYYYMMDD> --author-slug <author> --title-slug <title>`；系列以檔名為準 |
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
- `ralph` 對非 GP 可依 Tribunal 契約改寫；GP 固定 no-rewrite，只寫分數，不能更動正文。
- `translate` 只寫一個新的 en- sidecar 檔，不 commit、不 push。
- standalone `deploy` 會為全新 PENDING article 配置 ticket、rename pending 檔、validate、build、commit、push；`--date-stamp`、`--author-slug`、`--title-slug` 都是必填輸入。GP pending 檔在任何槽位檢查與 mutation 前就被暫停擋下。
- standalone `deploy --dry-run` 只做 CLI 輸入預檢，不跑 validator，也不做 counter、檔案、build 或 git 異動；不得用它假裝完成發布。
- `run --dry-run` 會跑完 translate、保留產生的 en sidecar 與 report，然後停在 deploy 前；不配置 ticket、不 validate/build，也不 commit/push。`--skip-validate`、`--skip-build`、`--skip-push` 是 testing-only flags；standalone deploy 正常執行不支援前兩者，standalone dry-run 也不會執行它們所對應的階段。

批准、自主權與品質門檻以 repo 的 `AGENTS.md` 為 Tier-0 SSOT。先用 `./scripts/detect-env.sh --runtime <codex|claude-code>` 確認身份，再遵守它選出的 runtime playbook；本 skill 不另行定義批准規則。

## Exit code

以 code 為準（`cmd/gp-pipeline` 的 `exitCodeFor` 與 `internal/pipeline` 的 `NewStepError`），此表是導覽：

| Code | 意義 |
|---:|---|
| 0 | 成功 |
| 1 | 一般錯誤，含 ingress 拒絕：非 canonical prefix、`--prefix` 與檔名系列不一致、GP 暫停中（錯誤訊息含「GP 暫停中」） |
| 2 | eval 兩位評審意見分歧（split）；確認後用 `--force` 覆寫 |
| 10 | fetch 失敗，或 YouTube 來源缺少 `yt-dlp` |
| 11 | source capture 不完整 |
| 12 | evaluator 判定 SKIP |
| 13 | dedup BLOCK |
| 14 | eval、write、review、refine 或 translate 步驟失敗 |
| 16 | deploy：validate-posts 拒絕 |
| 17 | deploy：`pnpm run build` 失敗 |
| 18 | deploy：`git push` 失敗 |
| 124 | timeout |

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
