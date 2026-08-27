## Why

FactChecker 會把 reader-visible `summary` 的事實錯誤判為失敗，但部署版隔離寫手交易會拒絕任何 frontmatter 變更；因此寫手即使正確修好摘要，候選仍被丟棄，下一輪只能重評相同錯誤並耗盡嘗試。SD-31 已在正式 daemon 重現這條 deterministic deadlock。

## What Changes

- 只在 FactChecker 的失敗後改寫交易，允許雙語候選成對替換既有單行 `summary` 字串純量；沒有 English sidecar 時允許單語摘要修正。其他 judge 與 final-build repair 維持整份 frontmatter 不可變。
- 除 `summary` 值外，frontmatter 的欄位、順序、格式與位元必須完全不變；新增、刪除、搬移、非單行字串、partial bilingual 變更或任何其他 drift 一律封閉失敗。
- 保留候選目錄、regular-file、大小、provenance、cheap validation、CAS、journal、rollback 與 restart recovery 邊界；capture／apply／CAS rollback 共用 stage policy，crash recovery 繼續依 journal 的完整 bytes／identity 中立收斂。允許的摘要修正仍須由下一輪 FactChecker 重新評分，不能直接視為通過。
- 加入可執行回歸，證明合法的雙語摘要修正可 capture／apply／rollback，所有受保護 frontmatter 與不安全 YAML 仍被拒絕，且修正後的重評讀到新摘要。
- 收斂 shell runner、Codex／legacy writer contract 與操作文件對 summary 權限的描述，避免 prompt 與 executable gate 再次漂移。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `tribunal-24-7-operations`：部署版 FactChecker 改寫必須能安全修復讀者可見摘要，同時維持雙語原子交易與其他 frontmatter 的 fail-closed 邊界。

## Impact

影響 `scripts/tribunal.sh` 的 stage-scoped writer transaction、`scripts/score-helpers.sh` 的候選 helper 介面、`scripts/tribunal-post-pair-snapshot.py` 的 frontmatter capture/apply 驗證、writer role contract、Tribunal 回歸測試與 runbook。沒有新依賴，不改 judge 分數門檻、一般內容 pipeline、v2 runtime 或 production 發佈權限。
