## 1. YouTube 來源契約

- [ ] 1.1 新增允許清單內的單一影片 URL 解析與標準化，拒絕只含播放清單、頻道、重新導向、使用者資訊、非核准主機與直播集合，所有 `yt-dlp` 呼叫固定 `--no-playlist`
- [ ] 1.2 將 YouTube 擷取改成結構化部分結果，讓 candidate 與 canonical run 缺 `yt-dlp` 時都封閉失敗，且 metadata 缺欄位不補推測值
- [ ] 1.3 實作固定的人工／自動字幕選擇、語言與來源類型、原始 VTT／保留時間戳的逐字稿證據與集中上限
- [ ] 1.4 為缺少相依工具、只有 metadata、無字幕、過短／超限、正在直播／尚未開播與擷取失敗，建立穩定的可用性與是否可重試契約

## 2. 僅供審閱的候選預審指令

- [ ] 2.1 新增有版本的候選清單 model、產物相對路徑／SHA-256 與同目錄原子寫入器
- [ ] 2.2 新增只接受單一 YouTube 影片的 `gp-pipeline candidate <youtube-url>`，只編排來源擷取、完整性與影片 ID 防重複檢查
- [ ] 2.3 驗證候選預審工作目錄解析符號連結後位於 repo 外；安全外部目錄尚未建立時不得 fallback 寫 manifest，並拒絕過期 URL／影片 ID／來源雜湊的靜默復用
- [ ] 2.4 以程式邊界與陷阱測試保證候選預審不引用／呼叫 LLM、Eval、Write、Review、Refine、Credits、Ralph、Translate、Deploy、git、計數器或文章異動

## 3. 診斷與操作者契約

- [ ] 3.1 在 doctor 的人類可讀／JSON 報告加入選用的 `yt-dlp` 能力狀態，不讓缺少它破壞無關流程的健康狀態
- [ ] 3.2 更新根指令／候選預審 help、`tools/gp-pipeline/README.md` 與 `tools/gp-pipeline/SKILL.md`，說清僅供審閱的產物、相依工具、副作用與核准後另跑標準 `run`

## 4. 封閉環境驗證

- [ ] 4.1 新增假的 `yt-dlp` 測試資料，覆蓋人工＋自動、多語言、無字幕、過短、超限、缺 metadata、直播、無效 URL 與找不到執行檔
- [ ] 4.2 新增清單原子性、結束碼、穩定失敗、雜湊、過期產物、跨 URL 形式的影片 ID 防重複 PASS／BLOCK 與逾時／中斷測試
- [ ] 4.3 新增端到端異動測試，比對候選預審前後 HEAD／refs、Git index、所有 tracked 與既有 untracked 檔案的 path／content hash／mode、untracked set，且假的 LLM／git／發布執行檔被呼叫即失敗
- [ ] 4.4 跑 gp-pipeline 全套 Go tests、CLI help 契約、OpenSpec validation 與 repo pre-commit／pre-push 關卡

## 5. 審查與封存

- [ ] 5.1 完成獨立正確性／安全性審查與簡化審查，修完所有阻擋問題
- [ ] 5.2 同步 `youtube-candidate-preflight` delta spec、封存 change，確認 OpenSpec ownership／archive 關卡通過
