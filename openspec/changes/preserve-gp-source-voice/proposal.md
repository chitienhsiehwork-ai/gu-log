## Why

GP 的價值應該是讓讀者讀到原作者，而不是看 AI 把原文重寫成另一篇 gu-log essay。GP-273 已證明現行 pipeline 會把一份自然、忠實的第一人稱翻譯，經過 write、refine 與追分 rewrite 後，變成第三人稱、比喻密集、語感生硬的 AI 文章，且品質系統仍給出高分。

## What Changes

- **BREAKING**：GP 正文從「可重組成 story-driven article」改為 source-preserving translation；預設保留原文的 voice owner、person、論證順序、段落關係與停頓方式。
- AI 只可從正文移除可明確辨識、且不承載 payload 的 AI slop，例如空洞開場、重複摘要、假深度收尾與無資訊轉場；不得因為覺得原文不夠精彩而重寫。
- GP 可新增的 editorial material 僅限導航層：gu-log 內部 references、glossary links，以及與翻譯正文清楚分隔的 MoguNote。
- glossary 與 references 只能加連結或短而必要的辨識資訊，不得藉機改寫周圍句子、補一段 explainer 或改變作者 voice。
- 自然中文成為 publish gate。罕見比喻、LLM 直譯詞與沒有讀者語意的合成詞，即使字典上可解釋，也不得因「有畫面」而保留。
- GP 的 review/refine 從自由全文 rewrite 改為有明確 issue、source evidence 與局部 patch boundary 的修正。
- Translator、bounded corrector 與 vibe scorer SHALL 使用不同 model、不同 prompt 與不同輸出 contract，避免同一套 taste loop 同時生成、修正並替自己背書；實際 model ID 由 pipeline config 管理。
- GP 與 SD／Lv 分流；`restructure`／`rebuild` 不得預設套用於 GP。
- GP-273 的直譯稿與上線稿成為 regression fixture，用來驗證 pipeline 不會把 source voice 洗掉。

## Capabilities

### New Capabilities

- `gp-source-preservation`: 定義 GP 翻譯正文可刪、可加、可修與不可改的邊界，以及 pipeline 必須保護的 source voice invariants。

### Modified Capabilities

- `editorial-charter`: 收窄 GP 的「重組敘事」權限；GP 預設跟隨 source spine，不再允許為追求 gu-log narrative 而自由改 packaging。

## Impact

- `tools/gp-pipeline` 的 stage architecture、prompt 與 publish gate。
- `config/llm-pipeline.json` 的 GP role routing，新增 translator、corrector 與獨立 vibe scorer 三種角色。
- `GU-LOG_WRITER_PROMPT.md`、`CONTRIBUTING.md`、Tribunal writer／judge contracts 與 vibe calibration。
- 既有 `add-editorial-spine-rebuild` change 必須明確排除 GP，避免兩份 spec 對 GP rewrite 權限互相衝突。
- GP regression fixtures 與 pipeline contract tests。
