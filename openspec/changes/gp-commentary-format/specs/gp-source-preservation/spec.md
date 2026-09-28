## MODIFIED Requirements

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
- **THEN** 它 SHALL 只寫入分數，SHALL NOT 進入評審與寫手的改寫迴圈，也 SHALL NOT 讓其他角色改寫正文
- **AND** GP 正文與來源距離章 SHALL 維持不變

#### Scenario: 明確要求改寫 GP

- **WHEN** 操作者對 GP 明確要求 Tribunal 改寫
- **THEN** 指令 SHALL 在呼叫任何評審或寫手之前失敗
- **AND** 錯誤訊息 SHALL 說明 GP 正文改了要經 gp-pipeline 重新蓋章
