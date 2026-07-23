## Context

`gp-pipeline` 已有通用 `fetch`、URL dedup 與完整 `run`，也有一個會用 `yt-dlp` 抓 metadata／英文 VTT 的 `FetchYouTube`。目前的危險縫隙是：缺 `yt-dlp` 時 YouTube URL 會落入 generic curl；字幕抓不到時 metadata 一併丟失；`run --dry-run` 則仍會執行會寫入文章的後續階段。YouTube transcript 又是不可信輸入，不適合在預審階段直接交給目前具有廣泛工具權限的 Codex／Claude provider。

這個 change 橫跨 CLI、source acquisition、dedup、doctor 與 agent-facing docs，因此用新 capability 定義共同的 side-effect boundary。主要操作者是 ShroomDog 與 coding agent；輸出是給人看完後再決定是否另行執行 canonical `run` 的證據包，不是半成品文章。

## Goals / Non-Goals

**Goals:**

- 提供明確、可重跑且不會發布的 YouTube `candidate` 預審路徑。
- 讓 YouTube acquisition fail closed，仍能保留 metadata-only failure evidence。
- 以 manifest 清楚揭露來源完整性、字幕 provenance、hash、限制與 video-ID dedup 結果。
- 用架構與回歸測試證明預審不會呼叫 LLM／editorial／publish stages，也不會修改 repo。

**Non-Goals:**

- 不產生摘要、文章角度、claims、系列推薦、outline 或 MDX。
- 不建立公開 wish-pool、第二套 queue 狀態、approval persistence 或自動 promotion。
- 不下載音訊做 ASR，也不自動 chunk 超長 transcript。
- 不改變 ShroomDog 直接交付 URL 時，既有完整 `gp-pipeline run` 的路由語意；只修正 YouTube dependency 缺失時的危險 fallback。
- Candidate v1 不接受 generic URL，因此不在這個 change 補齊 generic fetch 的 redirect／DNS-rebinding SSRF 防線；YouTube 只接受 allowlisted canonical hosts 與可解析的單一 video ID。

## Decisions

### 新增薄 `candidate` command，不重用 `run --dry-run`

`candidate <youtube-url>` 只編排 YouTube source capture、completeness 判定與 video-ID dedup，然後原子寫入 `candidate-manifest.json`。它不建立 `pipeline.State`，也不 import 或呼叫 Eval、Write、Review、Refine、Credits、Ralph、Translate、Deploy。這個獨立 entrypoint 比在 `run` 增加 `--stop-after` 更容易證明 side-effect boundary，也不會讓日後新增 step 意外越界。

替代方案是只用 SOP 串 `fetch --json` 與 `dedup`；它無法在 acquisition 部分失敗時可靠保留同一份 manifest，也很難用單一 end-to-end test 鎖住「永不發布」。另一個替代方案 `run --dry-run` 已明確否決，因為它仍會寫入 posts。

### Manifest 是 candidate 的唯一入口產物，capture 是其引用證據

Manifest 使用 versioned JSON schema，至少記錄 raw input URL、nullable canonical URL／video ID、source kind、真實 metadata nullable fields、availability、`writeEligible`、字幕 language／kind／coverage、warnings、source／raw VTT 路徑與 SHA-256、dedup verdict／matches，以及 stable failure code／retryable。所有檔案路徑都相對於 work directory，避免搬移後失效。

`candidate-manifest.json` 先寫同目錄暫存檔、`fsync`／close 後 rename；正常成功、metadata-only、缺 dependency、timeout 與分析失敗都盡量留下完整 failure manifest，不留下看似成功的半份 JSON。無效 URL 在已建立安全外部 workdir 時仍寫 manifest，canonical URL／video ID 保持 null；只有尚未建立可確認位於 repo 外且可寫的安全 workdir 時，才允許沒有 manifest，且不得改寫其他 fallback 位置。

`writeEligible` 只代表 source completeness 與 dedup gates 都允許進一步人工考慮，不代表已獲批准。任何 promotion 都是另一次明確的 `gp-pipeline run <url>`，不從 candidate artifact自動 resume。

CLI exit contract 與 manifest 分工如下：完整跑完預審（包含沒有字幕、字幕過短／超限等可審閱結果）回 0，呼叫端以 `writeEligible` 判斷；video-ID dedup BLOCK 回既有 13；dependency／acquisition 技術失敗回 10；輸入／workdir contract 錯誤回 1；逾時沿用 124。除 workdir 無法建立外，非 0 結果也必須留下 failure manifest。

### YouTube 使用 allowlist parser 與 structured partial result

YouTube URL 只接受 `youtube.com`／`www.youtube.com` 的單影片 watch／shorts 形式與 `youtu.be` short link，解析出一個 video ID 並 canonicalize；playlist-only、channel、搜尋、redirect、userinfo、非 allowlisted host 與 live collection 直接拒絕。所有 `yt-dlp` 呼叫加 `--no-playlist`，且 metadata 表示 live／upcoming 時不可進入寫作。

Source package 將 YouTube 結果從「成功檔案或 error」提升成 structured capture：metadata 成功後，即使字幕 unavailable／too short／too large，也回傳 manifest 所需的 partial evidence。缺失的 title、channel、upload date、duration 保留 null，不補今天或 `Untitled`。

字幕選擇順序固定為 manual captions 優先，再選 automatic captions；每層先依語言偏好，再穩定選第一個可用語言。實際 language 與 manual／auto provenance 必須進 manifest。保留 raw VTT，另產供人閱讀的 timestamped transcript；不得只保留移除時間軸的純文字。Limits 分階段執行：metadata duration gate 在下載字幕前；raw-byte gate 在讀取／解析 VTT 前；token estimate gate 只對通過 byte cap 的有界內容執行，並在任何 LLM 或進一步內容處理前停止超限來源。超限只留 manifest，不自動 chunk。

`yt-dlp` 缺失時共用的 YouTube routing 直接回 `dependency_missing`，不得落入 generic fetch；因此 candidate 與 canonical `run <youtube-url>` 都封閉失敗。Doctor 將 `yt-dlp` 列為 optional capability dependency：缺少它不使整體 doctor 失敗，但 JSON／human report 必須明示 YouTube candidate unavailable。

### 防重複以 YouTube video ID 為身份

URL parser 先把 watch、shorts 與 `youtu.be` 形式解析成同一 video ID。Dedup gate 的 URL identity normalization 同步加入 YouTube video ID，比對 candidate 與既有文章 frontmatter 的 `sourceUrl` SSOT 時不依賴原始 URL 字串形式；相同影片跨形式必須 BLOCK。Candidate 不啟動 title similarity，也不讓 LLM 覆寫結果。

### 預審完全不呼叫 LLM

本輪 manifest 不含摘要或價值判斷；這些欄位若沒有 citation-aware、no-tools provider 就會把不可信 transcript 送入目前的 `danger-full-access`／`bypassPermissions` agent。Candidate 只跑 deterministic acquisition 與 video-ID dedup，讓安全邊界可以由 import test、fake executable trap 與 repo snapshot test 證明。

未來若真有穩定使用量，再另提 change 加 no-tools structured-output adapter，並要求每個生成欄位引用 timestamp span；不能直接重用現有 agentic evaluator。

### Work directory 永遠位於 repo 外

沿用目前預設的 `$TMPDIR`，但 candidate 額外拒絕 repo root、本 repo 子目錄，以及解析 symlink 後落在 repo 內的 `--work-dir`。這避免「預審只寫 workdir」被誤用成 repo 修改。測試會在 fake repo 中建立完整前後 snapshot：HEAD／refs、Git index、所有 tracked 與既有 untracked 檔案的 path、content hash、mode，以及 untracked set；並讓 fake LLM／git／deploy commands 一被呼叫就失敗。

## Risks / Trade-offs

- [沒有自動摘要，candidate package 比 #185 原始想像精簡] → 先交付可信來源與 dedup evidence；等真實使用量證明值得，再設計受限 LLM 分析。
- [不同影片的 caption metadata 差異大] → 以 hermetic `yt-dlp` fixture 覆蓋 manual、auto、無字幕、短字幕、缺 metadata、live 與超限案例，manifest 保留 warnings 而非補猜測值。
- [Doctor 不把 `yt-dlp` 當全域 required，可能晚到執行時才阻擋] → doctor 明列 capability unavailable，YouTube candidate 與正式 fetch 都 fail closed；不讓不使用 YouTube 的一般 GP workflow 整體變紅。
- [Candidate v1 只能預審 YouTube] → 這是刻意的安全界線；generic source preflight 等 redirect revalidation 與 completeness contract 有獨立設計後再擴充。
- [Manifest schema 未來需演進] → 內含 `schemaVersion`，新增欄位採 backward-compatible；破壞性變更另提 spec delta。

## Migration Plan

1. 先新增 structured source result、YouTube fixtures 與 fail-closed routing，保留既有成功 capture 格式供完整 run 使用。
2. 新增 candidate command、manifest writer、video-ID dedup adapter 與完整 repo snapshot 副作用測試。
3. 更新 doctor、CLI help、README／skill，跑 Go、OpenSpec、repo hooks。
4. 無資料 migration；功能是 opt-in。回退時移除 candidate command 並 revert source result 擴充，既有正式文章與 counter 不受影響。

## Open Questions

（無；公開 intake 與 LLM 分析已明確延後，不作為本 change 的隱含待辦。）
