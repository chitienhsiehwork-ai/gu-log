## ADDED Requirements

### Requirement: Reader-visible article content MUST exclude unapproved emoji

gu-log 的 reader-visible article content SHALL 預設不包含 emoji。Kaomoji SHALL 視為獨立的文字型品牌語彙，不受此禁令影響。

只有 ShroomDog 對特定文章中的特定 emoji 做出明確授權時，該 occurrence 才 MAY 保留。授權 SHALL 以 repo 內可稽核、窄範圍的 executable record 保存，且 SHALL 指向 feedback corpus 的具體人類決策；writer SHALL NOT 以自行設定的整篇 frontmatter flag、glob、未記錄的推測或無法對照人類決策的理由文字取代授權。

pre-commit 與 CI SHALL 使用同一個 deterministic policy implementation，阻擋新文章或修改內容新增未授權 emoji。既有未修改的歷史 emoji MAY 透過 non-retroactive ratchet 暫時保留；此 grandfathering SHALL NOT 允許新增、搬移或重寫含 emoji 的內容行。

#### Scenario: New post contains an emoji

- **WHEN** 新增文章的 title、summary 或 body 包含未授權 emoji
- **THEN** pre-commit SHALL 阻擋該 commit
- **AND** CI SHALL 對同一內容得出相同失敗結果

#### Scenario: Reader-visible component surfaces are covered

- **WHEN** 新增 emoji 出現在 MoguNote、ShroomDogNote、其他 reader-visible component text／props、圖片替代文字或 code block
- **THEN** deterministic gate SHALL 將它視為 reader-visible article content
- **AND** MDX import／export 與不會 render 的註解 SHALL 不受此規則影響

#### Scenario: Kaomoji remains allowed

- **WHEN** 新增或修改的文章使用 canonical kaomoji detector 可辨識的文字型 kaomoji
- **THEN** emoji policy SHALL NOT 因該 kaomoji 失敗
- **AND** 既有 kaomoji 品牌規則 SHALL 維持有效

#### Scenario: User grants a narrow exception

- **WHEN** ShroomDog 明確授權某篇文章中的特定 emoji occurrence
- **AND** repo 記錄精確綁定該 post path、emoji、內容行、授權理由與 feedback corpus 決策參照
- **THEN** deterministic gate MAY 只放行該 occurrence
- **AND** SHALL NOT 放行同檔其他 emoji、其他文章或超出核准數量的 occurrence

#### Scenario: Untouched legacy post contains emoji

- **WHEN** 歷史文章含有 emoji
- **BUT** 該 emoji 所在內容行在目前變更中沒有新增、搬移或修改
- **THEN** ratchet gate SHALL NOT 阻擋不相關變更
- **AND** 未來修改該內容行時 SHALL 要求移除 emoji 或取得明確授權

#### Scenario: Local and CI results stay aligned

- **WHEN** 同一組 post changes 分別在 pre-commit 與 pull request CI 執行
- **THEN** 兩者 SHALL 使用同一個 emoji detector、kaomoji boundary 與 exception evaluator
- **AND** 任一環境無法解析比較基準時 SHALL fail closed
