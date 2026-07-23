## Why

現有 `gp-pipeline` 雖然能辨識 YouTube URL，但缺少 `yt-dlp` 時會靜默退回 generic HTML fetch，無字幕時也不會留下可審核的 metadata-only 結果；另一方面，`run --dry-run` 仍會寫文章與執行後續編輯階段，不能當成安全的候選預審。需要一條明確、零發布副作用的來源預審路徑，讓 ShroomDog 在啟動正式寫作前先確認來源完整性與重複風險。

## What Changes

- 新增明確的 `gp-pipeline candidate <youtube-url>` 預審指令，只接受單一 YouTube 影片，並只在 repo 外的 work directory 產生來源 capture 與 machine-readable manifest。
- 對 YouTube URL fail closed：只接受單一影片 URL、要求 `yt-dlp`，記錄真實 metadata、字幕 availability 與 provenance，不得靜默改走 generic HTML fetch。
- 字幕缺失、過短或來源超出安全上限時仍產生可審核 manifest，但標成不可進入寫作；metadata 欄位缺失時保留 `null`，不得用今天日期或其他推測值補齊。
- Candidate 預審只做 YouTube acquisition、來源完整性檢查與 deterministic video-ID dedup；不得呼叫 LLM、建立 MDX、配置 ticket、修改 counter／Git，或進入 write、review、refine、Ralph、translate、deploy。
- 補上 `yt-dlp` 的 doctor 診斷、hermetic fixtures 與副作用回歸測試。
- 保留目前「user 直接丟 URL 就跑完整 GP pipeline」的 trusted-owner 路由語意；只有明確執行 `candidate` 才進預審，但完整 `run` 收到 YouTube URL 時也必須在缺少 `yt-dlp` 時封閉失敗，不得擷取 JS shell。
- 公開 wish-pool、GitHub Issue Form、自動 promotion、audio ASR，以及摘要、文章角度、claims、系列推薦與 outline 生成不在本 change；先用實際預審需求驗證價值，避免建立第二套 queue SSOT 或讓不可信 transcript 進入具工具權限的 agentic LLM。

## Capabilities

### New Capabilities

- `youtube-candidate-preflight`: 定義零副作用的 YouTube 候選預審、availability/provenance manifest、fail-closed 邊界與 promotion 前的人類檢查點。

### Modified Capabilities

（無。）

## Impact

- `tools/gp-pipeline/cmd/gp-pipeline/`：新增 candidate command，擴充 doctor 與 CLI contract tests。
- `tools/gp-pipeline/internal/source/`：強化 YouTube URL validation、metadata／字幕 availability 與 deterministic fixtures。
- `scripts/dedup-gate.mjs` 與既有 dedup adapter：以 YouTube video ID 統一 watch／shorts／`youtu.be` URL，不啟動 editor／LLM path。
- `tools/gp-pipeline/SKILL.md`、`tools/gp-pipeline/README.md`：說明預審與正式 run 的明確分界。
- Runtime dependency：YouTube 預審要求可執行的 `yt-dlp`；缺少時以穩定錯誤碼與 manifest fail closed。
