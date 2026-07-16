# Mogu／GP／MP rebrand 切換 runbook

這份 runbook 涵蓋 OpenSpec archive 後的終審、合併前 producer fence，以及合併後外部切換。Repo 實作、spec sync 與 OpenSpec archive 必須先在同一個 PR 完成；人類檢查點②、producer fence、merge、線上 VM 與正式環境 smoke 都不是 archive 前的完成條件。

## 階段 A：離線終審關卡

以下條件全部成立前，不得合併、不得修改線上 VM：

1. 已 refresh `origin/main`、處理 branch drift，並在新 HEAD 重跑受影響驗證。
2. PR 的 required CI 全綠；taxonomy scanner、文章／glossary validation、translation pairs、完整 JS／TS 與 Go tests、Astro check／build 都通過。
3. uiux-auditor 已留下 dark／light、mobile／desktop 證據，涵蓋首頁、GP／MP 系列頁、GP／MP 徽章、MoguNote 與搜尋。
4. 已向 ShroomDog 呈現破壞性影響、回退、正式路由計畫與 model／harness／env signature，並取得人類檢查點②的明確批准。

若 workflow-path guard 使 agent 無法完成 merge approval，將該單一操作步驟交由 ShroomDog；這是操作授權限制，不是產品設計阻擋。

## 階段 B：合併前 producer fence

人類檢查點②批准後、合併前，唯一允許的線上 VM 變更是取得 producer fence。記錄 job identity、enabled state、active-run count、queue watermark 與時間；若產稿器已啟用，平順停用並等待 active run 歸零。不要停止整個 OpenClaw gateway。無法證明 fence 成立就不得合併。

在合併完成前，不得改 checkout、排程內容、identity SSOT 或正式 entrypoint，也不得恢復產稿器。

## 已接受的破壞性影響

- 已退役系列頁、文章與文章 API 識別直接回 404，不 redirect、不 alias。
- Reader Tracker 與 synced human-signal packet 以新 slug／pathname／version 重新識別；既有 read marks 不搬移。
- Giscus 使用 pathname mapping，舊討論串不自動接到新 URL。
- RSS item link 與 API URL 改用正式 pathname，client 可能把文章視為新 item。
- Feed／detail API 只提供 `schemaVersion: 2`；不保留 `version: 1` 或已退役 prefix／slug 的相容讀取。
- 舊 translation pipeline 與 entrypoint 已移除；外部產稿器必須在恢復前切到正式 `gp-pipeline`，不提供 wrapper。
- 這些都是 ShroomDog 已接受的一次性切換代價，不得用 compatibility shim 掩蓋。

## 本機 iOS prototype 稽核

2026-07-16 查證：`gu-log-ios` 目前是 parent workspace 明確 ignore 的本機 prototype，沒有 tracked files、獨立 Git history、remote 或已部署 consumer，因此不阻擋這個 PR。它仍假設已退役的 ticket／slug 識別；第一次準備發布前，必須先建立正式 repo、改讀 RSS／API schema v2 與正式 GP／MP 識別，並刪除所有已退役 fallback。

## 合併後切換順序

1. 合併 PR，保持產稿器停用，等待 Vercel 正式環境 deployment ready。
2. 在任何外部修改前，先記錄 scheduler job 定義、enabled state、entrypoint、相關 prompt／config 版本或 checksum，以及舊 checkout HEAD；證據存於受控的 operator 記錄，不把 secret 寫進 repo。
3. 從已合併的 `origin/main` 建立 blue／green fresh VM worktree。舊 checkout 即使 stale／dirty 也不 pull、reset 或清理；保留作回退證據。
4. 更新外部 identity SSOT：本機 machine note、VM `AGENTS.md`、Mogu Picks prompt／config 與相關 skills 使用 Mogu／GP／MP 公開識別。保留實際 Unix／host coordinate，不把 secret 或 machine mapping 寫回 tracked repo。
5. 只用 `openclaw cron` 更新排程器 job name／message；不直接編輯 SQLite 或 migrated JSON backup。Repo 外 writer prompt 與 enqueue path 一起切到正式 entrypoint。
6. 在 fresh checkout 執行 `tools/gp-pipeline/gp-pipeline doctor`，再各跑一次 GP／MP no-publish dry-run。輸出只能包含正式 pending ticket、slug 與 `MoguNote`，且 repo 必須維持 clean。
7. 產稿器仍保持停用，先完成正式環境 smoke：
   - `/gu-log-picks`、`/mogu-picks`、`/en/gu-log-picks`、`/en/mogu-picks` 都以 no-follow request 直接回 200，不能經 redirect。
   - 從 `quality/brand-taxonomy-post-migration.json` 各選一組 GP／MP zh-tw + en pair；正式文章與 `/api/posts/<newSlug>.json` 直接回 200。
   - 對同一 manifest entry 的已退役系列頁、文章與 `/api/posts/<oldSlug>.json` 做 no-follow request，全部直接回 404 且沒有 `Location` header。
   - RSS、搜尋與 feed／detail API 只輸出正式 ticket、slug、URL、schema。
8. **只有 no-publish canary 與 Vercel 正式環境 smoke 同時通過，才恢復產稿器。** 恢復後監看第一輪產物、branch、commit 與 queue state。
9. 在 #585 回報正式環境 URLs、破壞性行為、回退狀態、例外與 signature；接著回到 reliability roadmap，不把 rebrand 當成 Wave 1 完成。

## 回退

- 合併前失敗：不合併；修 branch 或 revert 對應 atomic commit。
- 合併後、恢復產稿器前失敗：產稿器保持停用，revert PR、等待舊正式環境恢復；舊 VM checkout 不動。
- 恢復後失敗：立刻平順停用產稿器、保留失敗產物與 logs，再 revert PR。還原已記錄的 scheduler target 與外部 prompt／config；任何切換後產生的 branch／queue item 先隔離，不得進入舊 contract。只有舊正式環境與舊 entrypoint dry-run 都通過後，才恢復排程器與產稿器。
- 任何回退都不能讓新舊 contract 同時產稿，也不能靠手改排程器 database、history 或 tracked manifest 偽造綠燈。

## 最終證據模板

```text
verdict: safe for final cutover review | needs fix | blocked
model: <exact model>
harness: <agent surface and version when available>
env: <detect-env signature>
branch/head/base: <branch> <head sha> <origin/main sha>
CI: <required checks URL/result>
UI: <dark/light + mobile/desktop evidence>
breaking impact: <accepted behaviors verified>
rollback: <fresh-worktree and producer-fence evidence>
production routes: <canonical 200 + retired direct 404 evidence>
#585 next: publishing fail-closed, #540, #546, Reader manifest
```
