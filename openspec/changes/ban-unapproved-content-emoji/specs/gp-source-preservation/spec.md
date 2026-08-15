## ADDED Requirements

### Requirement: GP 譯文 MUST omit unapproved source emoji without losing payload

GP 來源翻譯 SHALL 在譯文封存之前套用 gu-log 的 emoji policy。來源中的裝飾性表情圖示 SHALL 預設省略；該字形的省略 SHALL NOT 單獨視為來源完整性或 voice-preservation failure。

如果表情圖示在原句中承載可辨識的語意、態度或操作資訊，翻譯者 SHALL 用自然文字保留該意思，不得只刪字形而讓原文資訊消失。只有 ShroomDog 對指定文章與 occurrence 做出明確授權時，翻譯者 MAY 保留原字形。

來源翻譯者、來源審查者與英文 sidecar 翻譯者 SHALL 共享這個 policy boundary。來源翻譯者或來源審查者的 prompt contract 改變 SHALL 更新 GP runtime profile fingerprint，使舊 publish manifest 失效。英文 sidecar 不屬於該 runtime profile，其規則 SHALL 由 prompt rendering test 與最終內容 gate 驗證。Canonical body projection SHALL 繼續封存已套用規則的譯文，不得在正文投影階段偷偷移除表情圖示。

#### Scenario: Decorative source emoji is omitted

- **WHEN** source 在已完整表達意思的句尾附加裝飾性表情圖示
- **AND** 沒有 ShroomDog 的明確保留授權
- **THEN** GP 譯文 SHALL 保留句子內容並省略該字形
- **AND** 來源審查者 SHALL NOT 只因字形省略而判定忠實度或完整性失敗

#### Scenario: Meaningful source emoji becomes natural text

- **WHEN** source 以表情圖示表達正文尚未寫出的語意、反應或操作
- **THEN** 翻譯者 SHALL 用自然繁中把該意思寫出來
- **AND** SHALL NOT 只刪除字形而遺失原文資訊

#### Scenario: Explicitly approved source emoji is preserved

- **WHEN** ShroomDog 明確授權保留指定 GP occurrence
- **AND** executable exception record 精確符合該文章與內容行
- **THEN** 來源譯文與英文 sidecar MAY 保留該字形
- **AND** 其他未授權表情圖示仍 SHALL 被禁止

#### Scenario: Prompt contract change invalidates stale manifests

- **WHEN** GP runtime 更新翻譯者或來源審查者的表情圖示規則與 prompt contract
- **THEN** 執行角色設定指紋 SHALL 改變
- **AND** deploy SHALL 拒絕沿用舊 runtime profile 的 publish-gate manifest

#### Scenario: English sidecar does not restore source emoji

- **WHEN** 英文 sidecar 翻譯者遇到原始英文中的未授權表情圖示
- **THEN** sidecar prompt SHALL 要求省略裝飾性字形，或用自然文字保留其必要語意
- **AND** prompt rendering test 與最終內容 gate SHALL 阻止未授權字形被復原

#### Scenario: Projection seals the already-compliant translation

- **WHEN** 表情圖示規則已在來源翻譯階段套用
- **THEN** canonical body projection SHALL 封存該譯文的實際 bytes
- **AND** SHALL NOT 把表情圖示移除實作成 enrichment-time normalization
