## Context

`scripts/tribunal.sh` 是部署中的 canonical per-article runner。GP／en-GP 依 source-preservation contract 強制 `ALLOW_REWRITE=0`，但有效 judge FAIL 目前仍走 generic `mark_article_failed()`：`topLevelAttempts` 加一、status=`FAILED`。quota loop 與 bounded batch selector 只略過 `PASS`／`EXHAUSTED`，因此未改變的 GP 會被重新派送，最後得到語意錯誤的 `EXHAUSTED`。

系統已有兩個適合重用的 primitive：

- progress ledger 與 `RC_PROGRESS_LOCK`，可原子更新 article/stage 狀態；
- `scripts/reader-revision-of-stdin.mjs`，只 hash reader-visible frontmatter 與 body，刻意排除 Tribunal scores 等 backend metadata。

此變更只修 #1098 的可採取行動性與重派語意。#1099 的 FactChecker source packet 會在下一個 atomic change 處理，避免把 evidence transport 與 scheduler state machine 綁成一個不可獨立 rollback 的 patch。

## Goals / Non-Goals

**Goals:**

- GP 在有效 judge FAIL 且 source-preservation policy 禁止自動修復時，只消耗一次 judge call，並進入可觀測的 `NEEDS_REVIEW`。
- 同一 Tribunal version、failed stage 與 reader revision 的案件不被 manual runner、quota loop 或 batch runner自動重派。
- 真正的 reader-visible 修改、Tribunal version bump 或明確 operator requeue 能重新開案。
- operational failure 仍可恢復；non-GP bounded rewrite/retry 完全保留。

**Non-Goals:**

- 不把 model、provider、prompt、rubric 或 source capture 組成泛用 input fingerprint。
- 不建立 source packet store，不改 FactChecker 的 evidence transport；該工作由 #1099 負責。
- 不把所有 `--no-rewrite` invocation 都視為內容終態；只有 GP source-preservation policy 適用。
- 不自動改寫、假造 PASS、降低 gate 或改變 publisher 的 PASS-only contract。

## Decisions

### 1. 使用明確的 policy transition，而非從 `ALLOW_REWRITE=0` 猜測

runner 會在辨識 GP／en-GP 時設定 `GP_SOURCE_PRESERVATION_NO_REWRITE=1`。只有「judge 已產生合法 FAIL」且此 policy flag 為真時，stage runner 才回傳 exit code `3`；main loop 隨即呼叫新的 `mark_article_needs_review()`。

`--score-only`、non-GP `--only-stage`、writer unavailable、malformed score、quota 與 runner error 不會因為剛好沒有 rewrite 而進入 `NEEDS_REVIEW`。這比單看 `ALLOW_REWRITE` 安全，也保留既有 operational retry。

### 2. 以 reader revision 綁定終態，不建立廣義 fingerprint protocol

`NEEDS_REVIEW` 記錄包含：

- `status: "NEEDS_REVIEW"`
- `failedStage`
- `terminalReason: "gp_source_preservation_no_rewrite"`
- `readerRevision`
- `tribunalVersion`
- `finishedAt`

未明確 requeue 時的 automatic-skip key 是 `(tribunalVersion, failedStage, readerRevision)`。reader revision 重用既有 canonicalization，所以 score/frontmatter provenance 的後端寫入不會假裝成修稿；model/provider 波動也不會變成免費重抽的理由。operator requeue 會留下獨立 audit 欄位，因此可以合法重開相同 key 一次。

另一方案是 hash 完整 post bytes、prompt、model 與 provider。這會讓 score 寫入或 routing 調整解除終態，並把 #1098 擴成跨 runtime protocol，因此不採用。

### 3. 所有 article-level terminal transition 在同一把 progress lock 內完成

runner 在任何 judge call 前先取得 reader revision snapshot；若計算失敗，runner 不呼叫 judge、不更動既有 terminal/FAIL evidence，並以可觀測的 operational rc 結束。`mark_article_needs_review()` 寫入前會重新計算 current revision，只有仍等於 pre-judge snapshot 時，才在 `RC_PROGRESS_LOCK` 下 compare-and-set article status、failed stage、reason、revision、version 與 timestamp，並保留 `topLevelAttempts` 原值。若內容在 judge 執行期間漂移，runner 不建立 `NEEDS_REVIEW`、不把舊判定綁到新內容，改走可恢復的 operational error；main loop 也不呼叫 `mark_article_failed()`。

`init_article_progress()` 在同一把鎖內處理既有 `NEEDS_REVIEW`：

- version 較舊：沿用既有 version reset；
- reader revision 相同：不變更 ledger，runner 在 judge 前退出 `3`；
- reader revision 不同：清空舊 stages 與 terminal fields、status 改 `PENDING`、attempts 歸零，再完整重評。

`--score-only` 是非 authoritative 診斷路徑，即使 GP 得到 schema-valid FAIL，也維持既有 rc `1`；它不得寫入 authoritative `NEEDS_REVIEW` 或回 rc `3`。這項排除由 `SCORE_ONLY` 明確判斷，不靠 progress path 猜測。

### 4. selector 依 revision 略過 `NEEDS_REVIEW`

quota loop 與 bounded batch runner 遇到 current-version `NEEDS_REVIEW` 時，使用共用 helper 比較 stored/current reader revision：

- 相同：跳過；
- 不同：列回 queue；
- post 讀取或 hash 失敗：fail closed，維持跳過並輸出可觀測 warning，避免再次白燒 judge。

這保證 merged correction 能自動重開，同時不要求 operator 先手動改 ledger。

### 5. 提供窄而可測的 operator requeue command

新增 `scripts/tribunal-requeue.sh <filename.mdx>`。它只接受 `src/content/posts` 內存在的 basename，要求 current-version status=`NEEDS_REVIEW`，在 `RC_PROGRESS_LOCK` 下把 article status 改為 `PENDING`、把 failed stage 改為 `pending`、保留既有 score evidence、增加 `requeueCount`，並記錄 timestamp 與固定 machine reason `operator_requeue`。下一次執行恰好獲得一次重新判斷機會；若同樣 FAIL，會再次回到 `NEEDS_REVIEW`。

不採用刪除整筆 progress entry，因為那會抹掉 audit evidence，也可能讓 operator 無法判斷重開原因。

### 6. exit code 與 consumer 契約

exit code `3` 表示 authoritative `NEEDS_REVIEW`：不是 PASS、不是 runtime failure，也不要求 supervisor drain。quota loop／batch runner 將其計為 manual-review terminal outcome並繼續其他文章。publisher 會讀取 current Tribunal version，只選 article-level status=`PASS` 且 stored version 不舊於 current version 的項目；`--status` 與 monitor snapshot 顯示 distinct count/reason。

## Risks / Trade-offs

- **[同內容重新抽樣可能得到不同 judge verdict]** → 不自動重抽；operator 若有新證據或 calibration 理由，可用明確 requeue，留下 audit count。
- **[16-byte 顯示用 reader revision 理論上可能碰撞]** → 既有 manifest 已以同一 truncated SHA-256 作 reader identity；此處重用同一 SSOT，且 key 同時綁定 version/stage。若未來 SSOT 加長，runtime 會自然沿用。
- **[selector hash helper 失敗造成案件暫停]** → fail closed 並警告；operator 可修環境後 requeue，不以模型呼叫掩蓋 deterministic tooling failure。
- **[judge 執行中內容被其他 actor 修改]** → terminal transition 前 compare pre-judge/current revision；不一致時不寫 `NEEDS_REVIEW`，以 operational error 收斂。
- **[新狀態成為安靜黑洞]** → publisher status、monitor snapshot 與 worker logs 必須呈現 `NEEDS_REVIEW` count、article 與 reason。
- **[舊 consumer 不懂 exit code 3]** → 同一 patch 更新 canonical quota loop、bounded batch runner 與 shell regression ownership；未知 consumer 仍看到 nonzero，不會誤當 PASS。

## Migration Plan

1. 先合併 spec、state transition、selectors、requeue command、observability 與 regressions。
2. 在 service 維持停止時，把 runtime checkout fast-forward 到含此變更的 main，執行 deterministic test suite 與 monitor smoke。
3. 以測試 progress ledger 對一篇 fixture 驗證 `FAIL → NEEDS_REVIEW → same-revision skip → explicit requeue`，以及 in-flight revision drift／hash failure 不呼叫或不終止錯誤內容；不得使用 production article 或模型 quota。
4. 只有既有 runbook 的 service gate 全部通過且沒有 operator stop boundary，才可依正常機制恢復；否則保留停止狀態。

Rollback 為 revert 此 change；ledger 中額外欄位對舊 jq consumer 向後相容。rollback 後 `NEEDS_REVIEW` 不會被舊 selector 視為 PASS，但可能重新入隊，因此 rollback 前應保持 service 停止或先轉換狀態。

## Open Questions

無。FactChecker source evidence 的 transport、hash 與 fail-closed contract 由下一個 #1099 change 決定，不在此變更暗中預設。
