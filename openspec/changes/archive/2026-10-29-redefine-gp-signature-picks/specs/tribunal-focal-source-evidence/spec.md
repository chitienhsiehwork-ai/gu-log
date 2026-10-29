## REMOVED Requirements

### Requirement: GP／MP FactChecker SHALL 取得 harness 驗證的完整 focal source

**Reason**: 這條的情境「GP 與 MP 仍按不同的 editorial contract 評分」要求 FactChecker 用完整覆蓋、順序與 speaker voice 評 GP，那是 2026-09 已退役的整篇翻譯契約；GP 改成 ShroomDog 指定的招牌文章後，寫作與 grounding 規則跟 MP 完全相同（`gp-signature-picks`）。OpenSpec 不允許在 MODIFIED 裡刪掉這個情境，所以整條換成新名稱。

**Migration**: 改由「GP 與 MP 的 FactChecker SHALL 取得 harness 驗證的完整 focal source，並用同一套 editorial contract 評分」承接：完整 focal source preflight、manifest 與 SD／Lv 不跳過維度的規則照舊；GP 改用跟 MP 相同的 retained-claim closure 與歸因規則評分。

## ADDED Requirements

### Requirement: GP 與 MP 的 FactChecker SHALL 取得 harness 驗證的完整 focal source，並用同一套 editorial contract 評分

GP／MP 的 FactChecker 每次實際啟動前，harness SHALL 提供通過來源型別完整性驗證的完整 focal source 與 provenance manifest，SHALL NOT 要求 judge 自行連網擷取，亦 SHALL NOT 用 preview、摘要或記憶代替來源全文。GP 與 MP SHALL 用同一套 editorial contract 評分。其他系列 SHALL 繼續接受既有 FactChecker 評分，不因沒有 GP／MP focal source 而被跳過。

#### Scenario: 無網路 judge 收到完整 X 來源

- **WHEN** repo-owned adapter 從 X Article 或 self-thread fixture 擷取完整 focal body
- **THEN** network-disabled FactChecker SHALL 能從 harness 指定的資料檔讀到全文與全部 continuation
- **AND** manifest SHALL 記錄來源 identity、adapter provenance、完整性驗證、bytes 與 SHA-256
- **AND** 不得只提供 focal tweet 或 Article preview

#### Scenario: 一般網頁與 YouTube 保留來源型別契約

- **WHEN** focal URL 指向一般文章或受支援 YouTube 單影片
- **THEN** harness SHALL 使用既有 canonical adapter 與完整性 validator
- **AND** 一般頁面 SHALL 提供完整抽取內容，YouTube SHALL 提供既有契約要求的完整逐字稿
- **AND** YouTube 無字幕或不支援來源 SHALL NOT fallback 成 HTML shell

#### Scenario: GP 與 MP 按同一套 editorial contract 評分

- **WHEN** FactChecker 讀到 GP 或 MP 的完整 focal source
- **THEN** GP 與 MP SHALL 都按 retained-claim closure 與歸因判定，不因選材、重排或 Mogu voice 本身失敗
- **AND** SHALL NOT 以完整覆蓋、來源順序或來源作者 speaker voice 的保真度評 GP

#### Scenario: 原創與教學文章沒有 claim-free 例外

- **WHEN** SD 或 Lv 文章進入 Tribunal
- **THEN** FactChecker SHALL 仍執行既有全部維度
- **AND** 不得因未套用 GP／MP focal-source preflight 而跳過 accuracy 或其他維度
