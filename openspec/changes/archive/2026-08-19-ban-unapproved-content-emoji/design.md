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

共用 validator 先用新的 shared reader-surface library 取得 reader-visible line records，再讀取其 added lines：pre-commit 比對 index 與 `HEAD`，CI 比對 PR base 與 head。每筆 record 含 canonical text、surface kind 與原始 source line，讓錯誤訊息與 allowlist line hash 都能回到具體位置。新文章的所有可見內容都是 added lines；既有文章只有新寫、搬移或改過的可見行會被檢查。因此歷史內容不會讓 gate 首日全紅，但任何被改到的 emoji 行都必須清掉或取得明確例外。

reader-surface library 擁有 reader-visible key 清單與 MDX 可見行 projection。這個 surface 包含現行 reader revision SSOT 宣告的可見 frontmatter、完整 MDX body、MoguNote／ShroomDogNote 內容、讀者可見或無障礙可讀的 component 文字屬性、圖片替代文字與 code block。library 透過 MDX node positions 與 ESTree program 排除 import／export 與確定不會 render 的 comment-only expression，保留真實 source span 供 added-line 判定。

小型 `reader-revision-core` 只擁有 frontmatter split、legacy frontmatter keys 與 canonicalizer；`build-reader-revision-manifest.mjs` 與 reader-surface 都匯入它。production manifest build 因此不載入 MDX policy parser，同時不改既有「raw body 也參與 revision hash」的 bytes；`--check` 必須證明 manifest 無全庫 churn。Emoji validator 使用 reader-surface 的 line projection，不在自身另抄解析規則。未來若要讓 reader revision 也排除 import／註解，應另做有意識的 revision migration，不夾帶在本規則裡。

相較於保存一份數百筆 legacy emoji baseline，diff ratchet 沒有會 drift 的大型快照，也自然形成 touch-to-clean 行為。相較於只比較每個檔案的 emoji 總數，它也不允許把舊 emoji 移到新句子來規避檢查。

### Dynamic MDX expression 採靜態邊界，無法解析就 fail closed

reader-surface parser 只解析不需執行 JavaScript 的 literal tree：一般 MDX 文字、quoted JSX attribute、直接 string literal、沒有插值的 template literal，以及只含 literal value 的 array／object。字串 value 與非 computed quoted string key 照常解碼並掃描 emoji；number、boolean 與 null 確定不會產生 emoji，直接忽略。walker 讓每個 literal 保留自己的 ESTree source span；只有 AST 缺少 position 時才保守退回外層 expression／attribute span。這既避免 escaped newline 把 rendered newline 誤當成另一條 source line，也不會因多行 prop 的安全行變更而掃到另一條未修改的歷史 emoji literal。

其他會影響讀者可見內容的 expression，包含 concatenation、identifier、function call、interpolation、tagged template 與 spread，不由 validator 執行或推演。parser 只保留該 expression 的 source line record；如果該行在本次 diff 被新增或修改，gate 以檔案與行號報錯，要求改成可靜態檢查的 literal。這個邊界只是純 static literal walker，不建立通用 JavaScript evaluator 或會逐漸膨脹的部分 interpreter。

因為判定仍先套用 added-line ratchet，未碰觸的歷史 dynamic expression 繼續 grandfathered；只要搬移或改寫該行，就必須改為可靜態解析的內容。MDX import、export、註解與 parser 已確認不會 render 的 node 維持排除，不會因這條規則誤擋。

Raw `style`／`script` element、inline `style`／`on*`／embedded-document attribute 與可執行 URL scheme 採同一個遇錯即停邊界。CSS 與 JavaScript escape 即使 source 沒有 Unicode glyph，仍可能在瀏覽器產生 emoji；validator 不建立半套 CSS／JavaScript evaluator，而是在新增或修改這類 executable markup 時要求移除。一般安全 URL 維持可用；教學文章若要展示 executable markup，照常使用 fenced code block，不會被當成執行內容。

### 本機與 CI 共用同一支 validator

`scripts/check-content-emoji.mjs` 擁有 Unicode 偵測、kaomoji overlap、allowlist schema 與 finding 格式。pre-commit 只呼叫 staged mode；CI 只提供精確 PR base。hook 與 workflow 不各自複製 regex 或例外邏輯。

偵測範圍包含具 emoji presentation 的 Unicode 序列、variation-selector emoji、旗幟、keycap、ZWJ 組合與常見心形 pictograph。validator 照常掃描整段文字，只在 canonical kaomoji span 內窄豁免會與 emoji regex 重疊的純文字心形；rocket、smiley、ZWJ 或其他 emoji 即使塞進 kaomoji 外殼仍會失敗。

### 例外採 exact occurrence allowlist

例外存放在 `quality/content-emoji-allowlist.json`。每筆紀錄綁定 repo-relative post path、原始 source line、emoji sequence、該 canonical 內容行的 SHA-256、最多出現次數、授權日期、理由，以及指向 `docs/shroomdog-editorial-feedback.md` 具體決策條目的 `approvalRef`。allowlist 沒有 glob，也不能只靠 ticketId 放行整篇。validator 會拒絕 schema 錯誤、缺少或無法解析的授權參照、超量，或已找不到對應位置與內容行的 stale entry。

這個檔案只是把 ShroomDog 已明確做出的保留決定寫成 executable record；它不是 agent 可以自行創造授權的 escape hatch。一般移除決策只留在 feedback prose 與 git history，不建立 validator 永遠不會使用的 `remove` marker。

### GP 在 frozen translation 之前套用內容政策

source translator prompt 會明定：裝飾性 emoji 不進 `translation_mdx`；若符號承載可辨識意思，改用自然文字翻出。source reviewer 也使用相同邊界，避免把合規省略誤報成 fidelity loss；英文 sidecar prompt 與人工翻譯指南同樣不直接復原任何 Unicode emoji 字形。這三個自動化角色都不接收 approval context，也不描述不可達的保留分支。

本變更明確不替 GP automated lane 實作 glyph 保留例外；自動 GP 與英文 sidecar 一律省略裝飾字形或把必要語意寫成文字。`editorial-charter` 的 exact allowlist 仍是 top-level `MAY` 能力，可供已實際接線的非 GP automated lane 使用，但不承諾每條 pipeline 都支援。這避免建立會在 canonical body projection 封存後破壞 publish manifest hash 的 post-processing lane。

GP source translator 與 source reviewer 的 prompt contract 會 bump 版本，使 role-profile fingerprint 失效；舊 publish manifest 不能被新的 runtime 誤用。English sidecar 不屬於現行 GP runtime profile，因此不假稱它會改 manifest fingerprint；它的 emoji 邊界由 prompt rendering test、最終 content gate 與人工翻譯指南鎖住。GP canonical body projection 本身不做全域 emoji 正規化，因為 projection 的工作仍是證明 enrichment 沒改 frozen translation，而不是偷偷改正文。

### GP-274 只做使用者授權的最小正文修正

繁中與英文版各移除結尾愛心，其他文字與 glossary links 不動。既有 Tribunal 分數不因這個單一裝飾符號重跑；reader revision manifest 依現行 hook 重新產生。這次 feedback 與實際修法記入 editorial corpus，移除本身由 git diff 留下可稽核證據。

## Risks / Trade-offs

- [歷史文章仍可看到 emoji] → 以 non-retroactive ratchet 上線，避免一次重寫大量 GP；後續只要碰到相關行就會被迫清理。
- [Unicode emoji 邊界複雜] → 用 table-driven tests 鎖住心形、smiley、旗幟、keycap、ZWJ、文字符號與 kaomoji cases；偵測器只存在一份。
- [allowlist 被濫用] → 精確綁 path、source line、glyph、line hash 與 count，並要求指向 feedback corpus 具體決策的 `approvalRef`；沒有整篇或 glob 放行。
- [GP reviewer 把省略 emoji 視為不忠實] → translator 與 source reviewer 同步更新 contract，並用 prompt rendering tests 鎖住新邊界。
- [diff base 不可解析時 gate 被跳過] → validator fail closed；CI 使用事件提供的 exact base SHA，pre-commit 使用 index 與 `HEAD`。

## Migration Plan

1. 先抽小型 reader-revision core 與 reader-surface library，並以 manifest freshness test 證明 reader revision bytes 不變。
2. 加入 validator、測試、空 allowlist 與本機／CI 接線，確認既有 corpus 不被 retroactive 掃描。
3. 更新 editorial／GP contract 與 prompts，再移除 GP-274 中英文愛心。
4. 跑 validator、Vitest、GP pipeline unit tests、post validation、format／lint 與 build。
5. 若需要 rollback，可一起 revert gate、prompt contract bump 與文章修正；不需要資料遷移。

## Open Questions

無。ShroomDog 已決定預設禁止 emoji，並保留逐次明確授權的例外。
