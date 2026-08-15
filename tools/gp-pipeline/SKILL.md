# gp-pipeline

gu-log 的 GP／MP 文章 pipeline。唯一入口是：

```bash
tools/gp-pipeline/gp-pipeline <subcommand>
```

wrapper 會在需要時把 Go CLI 編譯到忽略版控的 `bin/`。repo 不保留第二套 shell pipeline、舊命令或預編譯 binary。

## Taxonomy 契約

- `GP` = Gu-log Picks，檔名以 `gp-` 開頭。
- `MP` = Mogu Picks，檔名以 `mp-` 開頭。
- 原創文章仍使用 `SD`，入門教學仍使用 `Lv`。
- 寫作與審稿階段使用 `<PREFIX>-PENDING`；只有 deploy 才配置正式流水號。
- 非 canonical prefix、slug 與舊 pipeline 路徑都已退役；遇到它們應明確失敗，不得靜默轉換。

## 預設用法

使用者明確要求把 URL 寫成／發布為 GP，或在 `AGENTS.md` 的 URL intake 後明確叫 agent 繼續時，除非有明確 blocker，跑完整 pipeline：

```bash
tools/gp-pipeline/gp-pipeline run '<url>' --prefix GP
```

GP 的 production model routing 由 `config/llm-pipeline.json` 控制；runtime 必須
具備完整、互不混用的 translator、source reviewer、corrector、commentary 與
natural-zh vibe scorer profile，且所有 provider preflight 都通過才可開始。
未設定完整 profile 的 runtime 可以做 fetch／eval／dedup 或處理非 GP，但不得
fallback 到 legacy GP flow 發布。model、effort 或 quota threshold 升級時只改
config 與 contract tests，不在 skill 複製快照。

Mogu Picks：

```bash
tools/gp-pipeline/gp-pipeline run '<url>' --prefix MP
```

只預審一支 YouTube 影片、讓人先看來源完整性與重複證據：

```bash
tools/gp-pipeline/gp-pipeline candidate '<youtube-url>'
```

`candidate` 需要 `yt-dlp`，只在解析後位於 repo 外的工作目錄寫入
`candidate-manifest.json`、原始 VTT、保留時間戳的逐字稿，以及來源完整時的
source capture。它不呼叫 LLM、不建立 MDX、不配置 ticket、不修改 counter／Git，
也不執行 Eval、Write、Review、Refine、Credits、Ralph、Translate 或 Deploy。
`writeEligible: true` 仍不是核准；人工確認後要另跑標準 `run <youtube-url>`。

常用控制：

```bash
# 不 deploy；不配置正式 ticket
tools/gp-pipeline/gp-pipeline run '<url>' --prefix GP --dry-run

# 已確認 evaluator 的 false negative；仍會跑 dedup
tools/gp-pipeline/gp-pipeline run '<url>' --prefix GP --force

# 從既有 GP workdir 的 source-preservation 階段恢復；沿用同一份完整 source 與 artifacts
tools/gp-pipeline/gp-pipeline --json --work-dir <original-work-dir> run \
  --from-step source-preservation --file <existing-zh-filename>.mdx --dry-run

# 已人工確認是 dedup false positive 才可使用
tools/gp-pipeline/gp-pipeline run '<url>' --prefix GP --skip-dedup

# 從 enrichment 後恢復；缺少或 stale 的 gate manifest 會直接失敗
tools/gp-pipeline/gp-pipeline --work-dir <original-work-dir> run \
  --file gp-259-example.mdx --from-step enrich --prefix GP

# 舊 GP flow 只做同 workdir 的 shadow comparison；永遠 dry-run、永遠不 deploy
tools/gp-pipeline/gp-pipeline run '<url>' --prefix GP --legacy-shadow
```

production GP 的順序是 fetch → eval → dedup → `source-translate` → `source-preservation`（source reviewer + natural-zh gate + bounded correction，並在通過後做 projection-protected enrichment）→ credits → ralph／Tribunal `--no-rewrite` → translate → deploy。`translate` 只在 Tribunal 通過後產生 en sidecar；未通過時 zh-tw 仍可在 fresh hard-gate manifest 約束下發布。內容任務的完成定義仍以 repo playbook 為準，不因單一 subcommand 成功而縮水。

## 可組合 subcommands

| 目的 | 指令 |
|---|---|
| 檢查依賴 | `gp-pipeline doctor` |
| 僅預審單一 YouTube 影片 | `gp-pipeline candidate <youtube-url>` |
| 抓完整來源 | `gp-pipeline fetch <url>` |
| 評估來源 | `gp-pipeline eval --source <file>` |
| 檢查重複 | `gp-pipeline dedup --url <url> --title <title> --series GP` |
| 非 GP 起草 | `gp-pipeline write --source <file> --prefix MP --ticket-id MP-PENDING` |
| 非 GP 審稿／精修 | `gp-pipeline review --draft <file>`、`gp-pipeline refine --draft <file> --review <file>`；GP 不接受這些 aliases |
| 跑 tribunal | `gp-pipeline ralph --file <gp-NNN-*.mdx>`；GP 固定 `--no-rewrite` |
| 補 en sidecar | `gp-pipeline translate --file <gp-NNN-*.mdx>`（tribunal 通過後才跑；只寫新 en 檔，不 commit／push） |
| 看下一個號碼 | `gp-pipeline counter next --prefix GP` |
| 原子配置號碼 | `gp-pipeline counter bump --prefix GP` |
| GP recovery | `gp-pipeline --work-dir <original> run --from-step <step> --file <existing>.mdx`；step 可為 `source-preservation`、`enrich`、`ralph`、`translate` 或 `deploy`，每個點都重驗 source/body freshness |
| 全新 GP PENDING article 配號並發布 | `gp-pipeline --work-dir <original> deploy --active-file <gp-pending-*.mdx> --prefix GP --date-stamp <YYYYMMDD> --author-slug <author> --title-slug <title>` |
| 查看 run 狀態 | `gp-pipeline status` |

若在 shell 外直接呼叫，以上表格中的 `gp-pipeline` 代表完整路徑 `tools/gp-pipeline/gp-pipeline`。

既有正式文章一律走 `run --file`，保留原有 ticket 與檔名；standalone `deploy` 只處理尚未配號的全新 PENDING article。GP 的 `--file`、`--from-step` 與 standalone deploy 都必須搭配原始 `--work-dir`；另建 workdir、只複製 MDX，或沿用不同 body/source 的 verdict 都會 fail closed。

## Side effects 與政策 SSOT

- `fetch`、`eval`、`dedup`、非 GP `write`／`review`／`refine`、`credits`、`status` 與 `counter next` 不配置正式 ticket。
- `candidate` 只寫 repo 外的預審工作目錄；無字幕、過短／超限、live／upcoming
  等可審閱結果回 0，但 `writeEligible` 會是 false。video-ID dedup BLOCK 回 13，
  `yt-dlp`／擷取技術失敗回 10，輸入／workdir 錯誤回 1，逾時回 124。
- `candidate --work-dir` 是既存的外部 parent；每次執行都會在底下建立新的
  `0700` private leaf。若 parent 是 repo root、repo 子目錄，或 symlink 解析後
  落在 repo 內，會在擷取前拒絕，且不會改寫 fallback 位置來硬留 manifest。
- YouTube 的 canonical `run` 同樣要求 `yt-dlp`；缺少時不得 fallback 到 generic HTML。
- `counter bump` 會原子修改 `scripts/article-counter.json`；通常只應由 deploy 呼叫。
- `ralph` 對非 GP 可依 Tribunal 契約改寫；GP 固定 no-rewrite，只能寫入分數／provenance 等 frontmatter，不能更動 canonical body。
- `translate` 只寫一個新的 en- sidecar 檔，不 commit、不 push。
- standalone `deploy` 會為全新 PENDING article 配置 ticket、rename pending 檔、validate、build、commit、push；`--date-stamp`、`--author-slug`、`--title-slug` 都是必填輸入。GP 另須 `--work-dir` 內的完整 source 與 fresh `gp-publish-gate.json`，且在任何 mutation 前重驗。
- standalone `deploy --dry-run` 只做 CLI 輸入預檢，不跑 validator，也不做 counter、檔案、build 或 git 異動；不得用它假裝完成發布。
- `run --dry-run` 會跑完 translate、保留產生的 en sidecar 與 report，然後停在 deploy 前；不配置 ticket、不 validate/build，也不 commit/push。`--skip-validate`、`--skip-build`、`--skip-push` 是 testing-only flags；standalone deploy 正常執行不支援前兩者，standalone dry-run 也不會執行它們所對應的階段。

批准、自主權與品質門檻以 repo 的 `AGENTS.md` 為 Tier-0 SSOT。先用 `./scripts/detect-env.sh --runtime <codex|claude-code>` 確認身份，再遵守它選出的 runtime playbook；本 skill 不另行定義批准規則。

## Exit code

| Code | 意義 |
|---:|---|
| 0 | 成功；eval split decision 也可能回 0，須讀輸出 |
| 1 | 一般錯誤 |
| 2 | CLI 用法錯誤 |
| 10 | fetch 失敗 |
| 11 | source capture 不完整 |
| 12 | evaluator 判定 SKIP |
| 13 | dedup BLOCK |
| 14 | write 失敗 |
| 15 | review 失敗 |
| 16 | refine 失敗 |
| 17 | tribunal 失敗 |
| 18 | deploy 失敗 |
| 124 | timeout |

JSON 模式可供自動化讀取：

```bash
tools/gp-pipeline/gp-pipeline --json run '<url>' --prefix GP
```

## 故障處理

1. 先跑 `gp-pipeline doctor`，確認 `node`、`pnpm`、`git` 與必要 provider 可用。
2. 從 `pipeline-status.json` 與 role artifacts 找最後成功 step，再用**原本的** `--work-dir` 搭配 `--from-step` 恢復；不要重新配置 ticket，也不要把 verdict 複製到另一個 workdir。
3. source validation 失敗時，修完整 source capture，不要拿 preview 摘要硬寫。
4. counter、ticket prefix 或 pending filename 遇到非 GP／MP canonical 值時，修呼叫端與資料；不要加 alias。
5. GP provider preflight、執行或 output contract 失敗時保留 failure artifact／state，修好原 provider 後從安全 recovery point 重跑；不得由另一角色無聲代打。
6. provider quota 或外部 runtime 問題依 repo playbook 處理；Tribunal VM 等環境座標不是 taxonomy compatibility surface。

實際 flags 與預設值以 `gp-pipeline <subcommand> --help` 為準；counter schema、frontmatter 與 OpenSpec 才是資料契約 SSOT。
