## Context

目前有兩條性質不同的發布路徑：

- 全新 PENDING 路徑會驗證暫存產物、配置新 ticket、改名、替換 frontmatter，再建置、提交與推送。
- 已配置號碼的路徑由 `run --from-step ... --file` 進入 `RunExisting`，保留既有 ticket 與檔名，只驗證、建置、加入索引、提交與推送。

Skill 把第二條誤導到第一條；Cobra help 又把全新文章路徑的異動寫在驗證前，形成兩種規格漂移。

## Goals / Non-Goals

**Goals:**

- 讓 operator 從文章狀態直接選到正確 lane。
- 讓 `deploy --help` 誠實描述異動前關卡與副作用。
- 用低成本契約測試鎖住關鍵恢復指令與必填 flags。
- 讓批准規則只存在既有 Tier-0／Tier-1 SSOT。

**Non-Goals:**

- 不改 deploy 執行行為或 counter schema。
- 不新增 alias 或推測式 filename parsing。
- 不讓獨立 deploy 接受既有正式檔；該能力已有 `run --from-step deploy`。

## Decisions

### Recovery 以 article state 分流

既有正式 zh-tw 缺英文對應檔時，從 `translate` 恢復，讓同一次 run 接著走既有檔發布；正式雙語檔只差發布時則直接從 `deploy` 恢復。兩者都透過 `run --file` 載入既有 ticket，不進入全新 counter 配號。

### 獨立 deploy 的 help 聚焦全新 PENDING

Long help 先列出所有異動前關卡，再列出 counter bump 之後的副作用。三個檔名欄位 flags 在說明中明示全新 PENDING 必填。`--dry-run` 說明它只做 CLI 輸入預檢、不跑 validator 或任何異動；`--skip-build`／`--skip-validate` 明示僅供測試，而且獨立指令會拒絕。

### Contract test 只鎖安全關鍵字串

測試讀取 Cobra help 與同 repo 的 `SKILL.md`，檢查兩條既有檔恢復指令、全新 deploy 必填 flags、異動前關卡在 counter bump 之前，以及舊的模糊恢復指令不再出現。測試不比對整份文案快照，讓一般措辭仍可調整。

### Approval policy 回到既有 SSOT

Skill 保留各 subcommand 副作用，批准、品質門檻與自主權只指向 `AGENTS.md` 及 `detect-env.sh` 選出的執行環境 playbook。這樣不會在 skill 內再養一份容易漂移的政策摘要。

## Risks / Trade-offs

- 契約測試依賴少數安全關鍵語句；文案修改時需同步測試，但範圍刻意很小。
- `run --from-step translate` 會在翻譯後繼續發布，與 recovery 完成定義一致；若 operator 只想產 sidecar，仍可明確使用 standalone `translate`，但不把它標成完整恢復路徑。

## Migration Plan

只修改 docs、help 與 tests，無資料 migration。若需回退，可單一 revert 恢復舊文案，不影響 runtime。
