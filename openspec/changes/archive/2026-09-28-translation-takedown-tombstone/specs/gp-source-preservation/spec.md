## RENAMED Requirements

- FROM: `### Requirement: GP-273 MUST calibrate source-preserving behavior`
- TO: `### Requirement: Synthetic regression pair MUST calibrate source-preserving behavior`

## MODIFIED Requirements

### Requirement: Synthetic regression pair MUST calibrate source-preserving behavior

Pipeline tests SHALL 使用一組自寫的合成 regression pair：一篇第一人稱的合成來源、它的自然第一人稱直譯稿，以及一份仿照 GP-273 舊事故寫成的第三人稱改寫稿。這組 fixture SHALL NOT 使用第三方文章原文或已依 `post-takedown` 下架的 gu-log 譯文。評估 SHALL 驗證系統偏好保留第一人稱直譯稿，並拒絕將改寫稿的額外比喻、第三人稱視角、重複結語與品牌化 framing 視為品質提升。

#### Scenario: regression prefers the direct translation

- **WHEN** evaluator 比較合成來源的 source-aligned first-person translation 與 rewritten version
- **THEN** source-preservation gate SHALL 接受前者作為較符合 GP contract 的版本
- **AND** SHALL flag 後者的 voice-owner change、unsupported packaging 與不自然用語
