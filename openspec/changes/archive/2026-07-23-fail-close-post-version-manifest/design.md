# Design: Post version manifest generator fail closed

## Current behavior

`scripts/build-version-manifest.mjs` 先呼叫 `git rev-parse --is-shallow-repository`。
這個 probe 失敗時，程式會繼續執行；後續 history 計算若失敗，頂層 catch 會改寫
`src/data/post-versions.json` 為空物件並 exit 0。這把「確認 shallow」與「Git 根本
不可用」混成同一種可忽略狀態。

## Decision table

| 狀態 | 是否寫檔 | exit code |
|---|---:|---:|
| Git 明確回報 shallow | 否 | 0 |
| Git 明確回報 non-shallow，history 計算成功 | 視內容或 `--check` 而定 | 0 或 stale check 的非零值 |
| shallow probe 執行失敗或回傳無效值 | 否 | 非零 |
| Git executable 不可用、metadata 缺失或損壞 | 否 | 非零 |
| 任一 history command 失敗 | 否 | 非零 |

`--check` 只改變成功算出 expected manifest 後的比較行為，不得攔截或降級
operational failure。

## Implementation shape

把流程切成三段：

1. 嚴格 probe repository 狀態，只接受 Git 的明確 `true` / `false`。
2. 在記憶體內完成所有 history 查詢與 manifest 組裝；任何錯誤直接往上拋。
3. 非 `--check` 模式才把完整 JSON 寫入同目錄暫存檔，再 rename 到正式路徑。

同目錄 rename 可避免跨 filesystem 問題，並確保成功替換前正式檔案保持不變。
暫存檔名稱要能避免平行程序互撞；失敗時應 best-effort 清掉暫存檔，但清理失敗
不得遮蔽原始錯誤。

## Test strategy

使用 synthetic repositories 固定下列路徑；除 prebuild integration 外，每個案例都
parameterize 一般模式與 `--check`：

- real shallow clone：sentinel manifest 不變、exit 0；
- 缺 Git metadata：sentinel 不變、non-zero；
- PATH 中找不到 Git executable：sentinel 不變、non-zero；
- 注入 history command failure：sentinel 不變、non-zero；
- shallow probe 回傳 `true` / `false` 以外值：sentinel 不變、non-zero；
- full-history 正常重生與 `--check` freshness 行為維持不變。

另以實際 `package.json` prebuild 驗證 operational failure 會傳播成 non-zero，
而確認 shallow 仍可繼續執行後續 generator。測試不得只 mock 頂層函式，避免漏掉
child process exit code 與檔案保護契約。

## Compatibility and rollout

這是 fail-closed bug fix，不需要資料 migration。Vercel 的 shallow clone 仍走明確
例外；full-history CI 與本機環境照常重生。若某個環境原本靠吞掉 Git 錯誤成功，
部署會轉紅並暴露根因，這正是預期行為。
