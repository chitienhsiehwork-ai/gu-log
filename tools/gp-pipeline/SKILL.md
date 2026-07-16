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
- `SP`、`CP`、`sp-`、`cp-` 與舊 pipeline 路徑都已退役；遇到它們應明確失敗，不得靜默轉換。

## 預設用法

使用者提供 URL 時，除非有明確 blocker，跑完整 pipeline：

```bash
tools/gp-pipeline/gp-pipeline run '<url>' --prefix GP
```

Mogu Picks：

```bash
tools/gp-pipeline/gp-pipeline run '<url>' --prefix MP
```

常用控制：

```bash
# 不 deploy；不配置正式 ticket
tools/gp-pipeline/gp-pipeline run '<url>' --prefix GP --dry-run

# 已確認 evaluator 的 false negative；仍會跑 dedup
tools/gp-pipeline/gp-pipeline run '<url>' --prefix GP --force

# 已人工確認是 dedup false positive 才可使用
tools/gp-pipeline/gp-pipeline run '<url>' --prefix GP --skip-dedup

# 從既有文章恢復
tools/gp-pipeline/gp-pipeline run --file gp-259-example.mdx --from-step review --prefix GP
```

`run` 依序執行 fetch → eval → dedup → write → review → refine → credits → ralph → deploy。內容任務的完成定義仍以 repo playbook 為準，不因單一 subcommand 成功而縮水。

## 可組合 subcommands

| 目的 | 指令 |
|---|---|
| 檢查依賴 | `gp-pipeline doctor` |
| 抓完整來源 | `gp-pipeline fetch <url>` |
| 評估來源 | `gp-pipeline eval --source <file>` |
| 檢查重複 | `gp-pipeline dedup --url <url> --title <title> --series GP` |
| 起草 | `gp-pipeline write --source <file> --prefix GP --ticket-id GP-PENDING` |
| 審稿／精修 | `gp-pipeline review --draft <file>`、`gp-pipeline refine --draft <file> --review <file>` |
| 跑 tribunal | `gp-pipeline ralph --file <gp-NNN-*.mdx>` |
| 看下一個號碼 | `gp-pipeline counter next --prefix GP` |
| 原子配置號碼 | `gp-pipeline counter bump --prefix GP` |
| 恢復 deploy | `gp-pipeline deploy --active-file <gp-pending-*.mdx> --prefix GP ...` |
| 查看 run 狀態 | `gp-pipeline status` |

若在 shell 外直接呼叫，以上表格中的 `gp-pipeline` 代表完整路徑 `tools/gp-pipeline/gp-pipeline`。

## Side effects 與批准邊界

- `fetch`、`eval`、`dedup`、`write`、`review`、`refine`、`credits`、`status` 與 `counter next` 不配置正式 ticket。
- `counter bump` 會原子修改 `scripts/article-counter.json`；通常只應由 deploy 呼叫。
- `ralph` 會修改指定文章的 frontmatter／內容。
- `deploy` 會配置 ticket、rename pending 檔、validate、build、commit、push。
- `--dry-run` 停在 deploy 前；不得用它假裝完成發布。
- `--skip-validate`、`--skip-build`、`--skip-push` 只供受控測試或恢復情境，不能繞過 repo 品質門檻。

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
2. 從 log 找最後成功 step，再用 `--work-dir` 搭配 `--from-step` 恢復；不要重新配置 ticket。
3. source validation 失敗時，修完整 source capture，不要拿 preview 摘要硬寫。
4. counter、ticket prefix 或 pending filename 遇到非 GP／MP canonical 值時，修呼叫端與資料；不要加 alias。
5. provider quota 或外部 runtime 問題依 repo playbook 處理；Tribunal VM 等環境座標不是 taxonomy compatibility surface。

實際 flags 與預設值以 `gp-pipeline <subcommand> --help` 為準；counter schema、frontmatter 與 OpenSpec 才是資料契約 SSOT。
