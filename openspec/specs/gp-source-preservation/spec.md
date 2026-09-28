# gp-source-preservation Specification

## Purpose

GP 整篇翻譯流程已於 2026-09-28 退役，理由與刪除範圍見 `openspec/changes/archive/2026-09-28-retire-gp-translation-pipeline/design.md`。本 capability 只保留兩件事：整篇翻譯流程維持退役的紀錄，以及 GP 在 Tribunal 與 ralph 只評分、不改寫正文的邊界。

## Requirements

### Requirement: GP rebuild prohibition MUST override generic editorial modes

GP 正文 SHALL NOT 進入 `restructure` 或 `rebuild`。任何通用 editorial mode capability 套用於 GP 時 SHALL 先服從本邊界；低 persona、narrative 或 vibe 分數 SHALL NOT 授權改寫 GP 正文。GP 正文一改就要重新蓋來源距離章，而只有 gp-pipeline 的導讀流程與 `stamp` 指令會蓋章（見 `source-distance-stamp`），所以 Tribunal 的每個入口（`scripts/tribunal.sh` 與 `pnpm tribunal:run`）以及 gp-pipeline 的 `ralph` 對 GP SHALL 只評分，SHALL NOT 呼叫寫手或其他會改寫正文的角色；明確要求改寫 GP 的旗標 SHALL 在呼叫任何評審或寫手之前被拒絕。本邊界不依賴已退役的 GP 整篇翻譯流程。

#### Scenario: generic rebuild proposal cannot capture GP

- **WHEN** 通用 editorial judge 將 GP 判為 structural fail
- **THEN** routing SHALL 拒絕 `restructure` 與 `rebuild`
- **AND** SHALL 保留既有 GP 正文

#### Scenario: low vibe score cannot trigger GP rebuild

- **WHEN** GP 的 persona、vibe 或 narrative judge 給出低分
- **THEN** pipeline SHALL NOT 觸發 `restructure`、`rebuild` 或全文 rewrite
- **AND** SHALL 將該分數視為不適用或 scorer calibration evidence

#### Scenario: Tribunal v2 評 GP

- **WHEN** `pnpm tribunal:run` 評一篇 GP，而且有評審沒過
- **THEN** 它 SHALL 只寫入分數，SHALL NOT 進入評審與寫手的改寫迴圈，也 SHALL NOT 讓其他會改動文章檔的角色（例如事實修正或加連結的 Librarian）執行
- **AND** GP 正文與來源距離章 SHALL 維持不變

#### Scenario: 明確要求改寫 GP

- **WHEN** 操作者對 GP 明確要求 Tribunal 改寫
- **THEN** 指令 SHALL 在呼叫任何評審或寫手之前失敗
- **AND** 錯誤訊息 SHALL 說明 GP 正文改了要經 gp-pipeline 重新蓋章

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
