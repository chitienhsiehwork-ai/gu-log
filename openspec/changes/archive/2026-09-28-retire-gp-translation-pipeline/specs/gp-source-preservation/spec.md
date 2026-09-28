## ADDED Requirements

### Requirement: GP 整篇翻譯流程 SHALL 維持退役

本 capability 保留 GP 整篇翻譯流程的退役紀錄。gp-pipeline 不再提供來源整篇翻譯、來源保留 gate（來源審查與自然中文評審）、bounded correction、commentary enrichment 與正文投影守門，也不再產生或驗證對應的 publish manifest；`translator`、`sourceReviewer`、`corrector`、`commentary` 不再是 runtime 設定可以宣告或路由的角色。GP 整篇翻譯要先取得來源作者同意，見 `editorial-charter`。

日後要恢復整篇翻譯流程，提案 SHALL 以 delta 修改本 requirement，不得只改設定檔、旗標或 prompt 讓它回流。

#### Scenario: 以退役的翻譯步驟恢復 run

- **WHEN** 操作者以 `--prefix MP` 搭配 `--from-step source-translate`、`source-preservation`、`source-gate` 或 `enrich` 執行 `gp-pipeline run`
- **THEN** 指令 SHALL 以未知步驟的錯誤失敗
- **AND** SHALL NOT 抓取來源、呼叫模型或異動任何檔案

#### Scenario: 要求路由退役的翻譯角色

- **WHEN** 呼叫端要求 model router 解析 `translator`、`sourceReviewer`、`corrector`、`commentary`，或它們原本的別名（例如 `source-translator`、`source-reviewer`、`bounded-corrector`、`commentary-writer`）
- **THEN** router SHALL 以未知角色的錯誤失敗
- **AND** SHALL NOT 派送任何模型，也 SHALL NOT 因設定檔仍留有同名角色而放行

## MODIFIED Requirements

### Requirement: GP rebuild prohibition MUST override generic editorial modes

GP 正文 SHALL NOT 進入 `restructure` 或 `rebuild`。任何通用 editorial mode capability 套用於 GP 時 SHALL 先服從本邊界；低 persona、narrative 或 vibe 分數 SHALL NOT 授權改寫 GP 正文。本邊界不依賴已退役的 GP 整篇翻譯流程。

#### Scenario: generic rebuild proposal cannot capture GP

- **WHEN** 通用 editorial judge 將 GP 判為 structural fail
- **THEN** routing SHALL 拒絕 `restructure` 與 `rebuild`
- **AND** SHALL 保留既有 GP 正文

#### Scenario: low vibe score cannot trigger GP rebuild

- **WHEN** GP 的 persona、vibe 或 narrative judge 給出低分
- **THEN** pipeline SHALL NOT 觸發 `restructure`、`rebuild` 或全文 rewrite
- **AND** SHALL 將該分數視為不適用或 scorer calibration evidence

## REMOVED Requirements

### Requirement: GP body MUST preserve the source voice

**Reason**: 這條是 GP 整篇翻譯流程對譯文的保真契約（人稱、語氣、論證順序），由已退役的 source-translate 與來源審查執行。整篇翻譯已依 #1114 全數下架，GP 暫停收新文，流程程式一併刪除。

**Migration**: 暫停期間 GP 正文的編輯定義仍由 `editorial-charter` 的「GP body MUST be faithful translation」承接；導讀新格式 change（`gp-commentary-format`）會重新定義 GP 正文。沒有需要遷移的呼叫端。

### Requirement: GP body MAY remove only obvious non-payload slop

**Reason**: 贅文候選只存在於 source translator 的輸出，並由來源審查核准、deterministic applicator 刪除；三者都隨翻譯流程退役。

**Migration**: 無替代；GP 暫停中。

### Requirement: GP additions MUST be navigation or separated commentary

**Reason**: 這條規範的是翻譯凍結後的 enrichment 階段（commentary 候選、glossary 與站內連結 wrapper），該階段隨翻譯流程刪除。

**Migration**: gu-log 意見放進 `<MoguNote>` 的要求仍由 `editorial-charter` 的 GP 正文 requirement 承接；glossary 連結覆蓋由 `glossary-link-coverage` 規範。

### Requirement: Natural Taiwan Chinese MUST be a non-compensating publish gate

**Reason**: 這條是 GP 譯文發布前由獨立 vibe scorer 冷讀的 hard gate（`vibe-gate` prompt），只服務整篇翻譯流程。

**Migration**: 自然台灣中文仍是 `GU-LOG_WRITER_PROMPT.md` 與 Tribunal 評分的要求；導讀的發布 gate 由 `gp-commentary-format` 定義。這條情境裡來自 GP-273 事故的兩個反例（「銜尾蛇」「演算法動態」）目前只活在即將刪除的 deterministic 檢查與翻譯 prompt 裡，刪除後沒有 live SSOT；要不要把它們寫進 writer prompt 或評分標準，交給 `gp-commentary-format` 決定。

### Requirement: GP corrections MUST be evidence-bounded patches

**Reason**: bounded corrector、finding／patch schema 與 applicator 只服務翻譯流程的修正迴圈，隨之刪除。

**Migration**: 其中「低 vibe 分數不得觸發 GP 重建」的情境搬到本 capability 的「GP rebuild prohibition MUST override generic editorial modes」。

### Requirement: GP text roles MUST use independent models and contracts

**Reason**: translator、corrector、commentary 三個寫作步驟與 source reviewer、vibe scorer 兩個 gate 評審全部隨翻譯流程刪除，這條 requirement 已沒有對象。

**Migration**: 「把關角色不得與寫手共用 model」這條不變式不會消失：`gp-commentary-format` 會以「aligner 的 model pin 不得等於寫手 pin」重新寫回，並以測試鎖住。在那之前 gp-pipeline 沒有任何 GP gate 角色，GP 在 ingress 就被拒絕。

### Requirement: GP enrichment MUST preserve a canonical body projection

**Reason**: canonical body projection（`scripts/gp-body-projection.mjs`）只用來證明 enrichment 沒改到凍結的譯文，隨 enrichment 階段刪除。

**Migration**: 導讀的內容指紋需要自己的正文投影，由 `gp-commentary-format` 另行定義，不沿用這支 script。

### Requirement: GP publication MUST fail closed on source-preservation gates

**Reason**: `gp-publish-gate.json` manifest、角色 profile fingerprint 與 deploy／recovery 前的重驗都只服務翻譯流程。

**Migration**: 暫停期間 GP 不會走到發布：`gp-pipeline-publish-integrity` 要求所有 GP 寫作與發布入口在 ingress 就以「GP 暫停中」拒絕；pre-commit 與 CI 的下架棘輪另外擋下新增的 GP 文章。

### Requirement: Synthetic regression pair MUST calibrate source-preserving behavior

**Reason**: 這組合成 regression pair 是來源保留 gate 的校準 fixture，隨 `internal/preservation/` 與其 testdata 一起刪除。

**Migration**: 無替代；導讀的校準資料由 `gp-commentary-format` 另行定義。

### Requirement: GP translator MUST receive canonical glossary terminology

**Reason**: 注入術語 context 的對象是已刪除的 source translator，術語 context 也不再有 role-profile fingerprint 可綁。

**Migration**: 讀取 glossary 術語 context 的 `internal/terminology` 保留，`gp-commentary-format` 會把它接到寫手；所有 zh-tw 正文使用 canonical term 的要求仍由 `editorial-charter` 的「Chinese prose MUST use glossary canonical terminology」承接。

### Requirement: GP automated 譯文 MUST omit source emoji glyphs without losing payload

**Reason**: 這條大半在規範 source translator 與來源審查的 emoji 處理，兩者都已刪除。

**Migration**: 仍然有效的兩部分搬到 `editorial-charter` 的「Reader-visible article content MUST exclude unapproved emoji」：GP automated lane 不提供 glyph 保留例外，以及英文 sidecar 翻譯者不得復原來源 emoji 字形（英文 sidecar 同時服務 MP，prompt rendering test 保留）。
