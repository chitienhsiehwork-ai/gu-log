## MODIFIED Requirements

### Requirement: GP text roles MUST use independent models and contracts

GP translator、bounded corrector 與 commentary 會產生或改寫 GP 讀者可見文字，SHALL 依 `claude-prose-writing-runtime` 使用 Claude 寫手 pin。Source reviewer 與 vibe scorer 是判定這些文字能否發布的 gate 角色，SHALL 使用與每一個寫作角色都不同的 model。每個角色 SHALL 各自使用只包含該角色責任的 prompt 與輸出 schema；任何角色 SHALL NOT 取得另一角色的 hidden reasoning。寫作角色共用同一個 Claude pin 時，隔離 SHALL 由各自獨立的 prompt／schema、獨立呼叫，以及 deterministic patch 與 projection 驗證維持。Pipeline SHALL NOT 因 provider failure 而把任務靜默改派給另一個 provider、model 或角色。

#### Scenario: translator cannot optimize for its own vibe rubric

- **WHEN** translator 產出 source-aligned 繁中正文
- **THEN** translator prompt SHALL NOT 包含 persona、narrative、callback、MoguNote density 或 vibe score optimization 指令
- **AND** vibe scorer SHALL 使用與所有寫作角色不同的 model 與獨立 cold-read prompt

#### Scenario: corrector only returns bounded patches

- **WHEN** corrector 收到一組已核准 review findings
- **THEN** corrector SHALL 使用 Claude 寫手 pin，prompt SHALL 只包含 source、translation 與已核准 findings
- **AND** 輸出 SHALL 只能包含符合 patch schema 的局部修改
- **AND** SHALL NOT 輸出完整重寫文章

#### Scenario: gate role cannot share a writing model

- **WHEN** 設定讓 source reviewer 或 vibe scorer 使用與任一寫作角色相同的 model
- **THEN** GP role profile 載入 SHALL 在任何 GP 文字變動前失敗
- **AND** SHALL NOT 以部分設定繼續執行

#### Scenario: unavailable role fails closed

- **WHEN** 任一必要角色的指定 model 不可用、runner error 或 provenance 無法驗證
- **THEN** pipeline SHALL 保留 failure evidence 並停止該次 publish
- **AND** SHALL NOT 靜默換成其他 provider、model 或角色
