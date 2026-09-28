# gp-source-preservation Specification

## Purpose

定義 GP 忠實翻譯的來源保留契約：正文保留原作者的聲音、人稱與論證順序，只允許有來源證據的局部修正與隔離的導航／MoguNote enrichment，並在所有 source-preservation gate 通過前封閉發布。

## Requirements

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
