# gp-source-preservation Specification

## Purpose

GP 整篇翻譯流程已於 2026-09-28 退役，理由與刪除範圍見 `openspec/changes/archive/2026-09-28-retire-gp-translation-pipeline/design.md`。本 capability 只保留兩件事：整篇翻譯流程維持退役的紀錄，以及 GP 在 Tribunal 與 ralph 只評分、不改寫正文的邊界：GP 的正文是 ShroomDog 認可過的版本（`gp-signature-picks`）。

## Requirements

### Requirement: GP rebuild prohibition MUST override generic editorial modes

GP 正文 SHALL NOT 進入 `restructure` 或 `rebuild`。任何通用 editorial mode capability 套用於 GP 時 SHALL 先服從本邊界；低 persona、narrative 或 vibe 分數 SHALL NOT 授權改寫 GP 正文。GP 的正文是 ShroomDog 指定升格時認可過的版本（升格時已通過 publish bar），背景精修 SHALL NOT 自行改動它，所以 Tribunal 的每個入口（`scripts/tribunal.sh` 與 `pnpm tribunal:run`）對 GP SHALL 只評分，SHALL NOT 呼叫寫手或其他會改寫正文的角色；明確要求改寫 GP 的旗標 SHALL 在呼叫任何評審或寫手之前被拒絕。要改 GP 的正文，SHALL 由人或 agent 依 ShroomDog 的指示修改，再跑 Tribunal。本邊界不依賴已退役的 GP 整篇翻譯流程。

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
- **AND** GP 正文 SHALL 維持不變

#### Scenario: 明確要求改寫 GP

- **WHEN** 操作者對 GP 明確要求 Tribunal 改寫
- **THEN** 指令 SHALL 在呼叫任何評審或寫手之前失敗
- **AND** 錯誤訊息 SHALL 說明 GP 正文要依 ShroomDog 的指示修改，改完再跑 Tribunal

### Requirement: Tribunal SHALL NOT 重評內容沒變的未過關 GP

Tribunal 不會改寫 GP，所以 GP 沒過關後重評同一份內容不會帶來新資訊，只會重擲評審的骰子。`scripts/tribunal.sh` 在 GP 沒過關時 SHALL 把這次評審的讀者可見輸入指紋（zh-tw 與 English 檔的 reader revision）記在進度紀錄的 `FAILED` 項目。Daemon 的選文邏輯 SHALL 跳過指紋仍與目前內容相同的 `FAILED` 項目；只有讀者可見內容改變、Tribunal 版本改變，或操作者手動執行 `tribunal.sh`，該篇才再次被評。指紋無法計算時選文 SHALL 照舊進行，不得因此讓文章永久卡住。非 GP 的有界改寫與重試 SHALL 不受影響。

#### Scenario: 沒改過的 GP 不會被重新領取

- **WHEN** 一篇 GP 在 Tribunal 沒過關，之後內容沒有改動，只有分數寫回 frontmatter
- **THEN** daemon 的選文邏輯 SHALL 跳過它
- **AND** 它的 `topLevelAttempts` SHALL NOT 因 daemon 重跑而增加到 `EXHAUSTED`

#### Scenario: GP 修正後重新排隊

- **WHEN** 沒過關的 GP 的 zh-tw 或 English 正文、或讀者可見 frontmatter 被修改
- **THEN** daemon 的選文邏輯 SHALL 再次選到它
- **AND** `tribunal.sh` SHALL 把它的嘗試次數歸零、四位評審全部重評，不得沿用舊內容累積的次數直接變成 `EXHAUSTED`

#### Scenario: 非 GP 失敗不記指紋

- **WHEN** 一篇非 GP 文章在 Tribunal 沒過關
- **THEN** 進度紀錄 SHALL NOT 留下輸入指紋
- **AND** 它 SHALL 照既有的有界重試規則再被選取

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
