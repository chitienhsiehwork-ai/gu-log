## Context

gu-log 的文章庫已有大量歷史 emoji，直接對全庫做絕對掃描會讓既有文章全部失敗，也會迫使這次 PR 批次改寫許多 preservation-sensitive GP。另一方面，只在 writer prompt 寫一句禁令不夠可靠；GP-274 的愛心就是來源內容沿著翻譯流程進站的例子。

這個變更需要同時處理三個邊界：新內容必須被機器擋住、歷史內容不能讓規則無法上線、GP 忠實翻譯不能把 emoji 禁令誤判成 payload 遺失。

## Goals / Non-Goals

**Goals:**

- 對所有新增或修改的 post source line 預設禁止 emoji，並讓本機與 CI 使用同一套判定。
- 保留 gu-log 既有 kaomoji 品牌語彙，不把文字型顏文字誤判成 emoji。
- 讓明確授權的例外窄到指定檔案、指定 emoji 與指定內容行，而且可稽核。
- 讓 GP source translator 主動省略裝飾性 emoji；若 emoji 本身承載語意，改用自然文字保留意思。
- 移除 GP-274 中英文結尾的愛心，不藉此改寫其他正文。

**Non-Goals:**

- 不在本變更批次清理歷史文章庫的所有 emoji。
- 不禁止 kaomoji，也不移除現有「每篇至少一個 kaomoji」的品牌規則。
- 不把 repo 文件、程式輸出或 Codex UI 狀態圖示納入 article-content gate。
- 不提供可由 writer 自行開啟的整篇 `emojiAllowed` frontmatter 旗標。

## Decisions

### 使用 added-line ratchet，不建立大型 legacy baseline

共用 validator 先用現有 reader revision canonicalizer 取得 reader-visible post surface，再讀取其 added lines：pre-commit 比對 index 與 `HEAD`，CI 比對 PR base 與 head。新文章的所有內容都是 added lines；既有文章只有新寫或改過的行會被檢查。因此歷史內容不會讓 gate 首日全紅，但任何被改到的 emoji 行都必須清掉或取得明確例外。

這個 reader-visible surface 包含現行 reader revision SSOT 宣告的可見 frontmatter、完整 MDX body、MoguNote／ShroomDogNote 內容、讀者可見或無障礙可讀的 component 文字屬性、圖片替代文字與 code block。MDX import／export 與不會 render 的註解不納入。validator 不另抄一份 frontmatter key 清單；它使用 reader revision canonicalizer 的同一份定義。

相較於保存一份數百筆 legacy emoji baseline，diff ratchet 沒有會 drift 的大型快照，也自然形成 touch-to-clean 行為。相較於只比較每個檔案的 emoji 總數，它也不允許把舊 emoji 移到新句子來規避檢查。

### 本機與 CI 共用同一支 validator

`scripts/check-content-emoji.mjs` 擁有 Unicode 偵測、kaomoji 遮罩、allowlist schema 與 finding 格式。pre-commit 只呼叫 staged mode；CI 只提供精確 PR base。hook 與 workflow 不各自複製 regex 或例外邏輯。

偵測範圍包含具 emoji presentation 的 Unicode 序列、variation-selector emoji、旗幟、keycap、ZWJ 組合與常見心形 pictograph。validator 先用站內 canonical kaomoji detector 遮掉已辨識的 kaomoji span，再掃描剩餘文字。

### 例外採 exact occurrence allowlist

例外存放在 `quality/content-emoji-allowlist.json`。每筆紀錄綁定 repo-relative post path、emoji sequence、該 canonical 內容行的 SHA-256、最多出現次數、授權日期、理由，以及指向 `docs/shroomdog-editorial-feedback.md` 具體決策條目的 `approvalRef`。allowlist 沒有 glob，也不能只靠 ticketId 放行整篇。validator 會拒絕 schema 錯誤、缺少或無法解析的授權參照、超量，或已找不到對應內容行的 stale entry。

這個檔案只是把 ShroomDog 已明確做出的決定寫成 executable record；它不是 agent 可以自行創造授權的 escape hatch。

### GP 在 frozen translation 之前套用內容政策

source translator prompt 會明定：裝飾性 emoji 不進 `translation_mdx`；若符號承載可辨識意思，改用自然文字翻出；只有已提供的明確授權才保留 glyph。source reviewer 也使用相同邊界，避免把合規省略誤報成 fidelity loss。英文 sidecar prompt 與人工翻譯指南不得從原始英文復原未授權 emoji。

GP source translator 與 source reviewer 的 prompt contract 會 bump 版本，使 role-profile fingerprint 失效；舊 publish manifest 不能被新的 runtime 誤用。English sidecar 不屬於現行 GP runtime profile，因此不假稱它會改 manifest fingerprint；它的 emoji 邊界由 prompt rendering test、最終 content gate 與人工翻譯指南鎖住。GP canonical body projection 本身不做全域 emoji 正規化，因為 projection 的工作仍是證明 enrichment 沒改 frozen translation，而不是偷偷改正文。

### GP-274 只做使用者授權的最小正文修正

繁中與英文版各移除結尾愛心，其他文字與 glossary links 不動。既有 Tribunal 分數不因這個單一裝飾符號重跑；reader revision manifest 依現行 hook 重新產生。這次授權記入 editorial feedback corpus 與 PR 證據。

## Risks / Trade-offs

- [歷史文章仍可看到 emoji] → 以 non-retroactive ratchet 上線，避免一次重寫大量 GP；後續只要碰到相關行就會被迫清理。
- [Unicode emoji 邊界複雜] → 用 table-driven tests 鎖住心形、smiley、旗幟、keycap、ZWJ、文字符號與 kaomoji cases；偵測器只存在一份。
- [allowlist 被濫用] → 精確綁 path、glyph、line hash 與 count，並要求指向 feedback corpus 具體決策的 `approvalRef`；沒有整篇或 glob 放行。
- [GP reviewer 把省略 emoji 視為不忠實] → translator 與 source reviewer 同步更新 contract，並用 prompt rendering tests 鎖住新邊界。
- [diff base 不可解析時 gate 被跳過] → validator fail closed；CI 使用事件提供的 exact base SHA，pre-commit 使用 index 與 `HEAD`。

## Migration Plan

1. 先加入 validator、測試、空 allowlist 與本機／CI 接線，確認既有 corpus 不被 retroactive 掃描。
2. 更新 editorial／GP contract 與 prompts，再移除 GP-274 中英文愛心。
3. 跑 validator、Vitest、GP pipeline unit tests、post validation、format／lint 與 build。
4. 若需要 rollback，可一起 revert gate、prompt contract bump 與文章修正；不需要資料遷移。

## Open Questions

無。ShroomDog 已決定預設禁止 emoji，並保留逐次明確授權的例外。
