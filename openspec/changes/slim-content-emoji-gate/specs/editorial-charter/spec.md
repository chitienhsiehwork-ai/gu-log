# Spec Delta

## MODIFIED Requirements

### Requirement: Reader-visible article content MUST exclude unapproved emoji

gu-log 的 reader-visible article content SHALL 預設不包含 emoji。Kaomoji SHALL 視為獨立的文字型品牌語彙，不受此禁令影響。

只有 ShroomDog 對特定文章的特定 emoji 明確核准時，該文章才 MAY 保留那個 emoji。核准 SHALL 記成檢查腳本裡的一筆短紀錄（文章路徑、emoji、理由）；writer SHALL NOT 自行加紀錄，也 SHALL NOT 用 frontmatter flag 或 glob 放行。

GP 的 automated lane SHALL NOT 提供保留 emoji 的例外。gp-pipeline 的英文 sidecar 翻譯者 SHALL 省略裝飾性字形，字形承載的必要語意 SHALL 改用自然文字表達，SHALL NOT 保留或依來源復原任何 Unicode emoji 字形。

pre-commit 與 CI SHALL 使用同一支檢查腳本，檢查 `src/content/posts/` 下新增或修改的行。沒有動到的舊行 SHALL NOT 被追溯阻擋。

#### Scenario: New post contains an emoji

- **WHEN** 新增文章的任何一行包含未核准的 emoji
- **THEN** pre-commit SHALL 阻擋該 commit，並回報路徑、行號與 emoji
- **AND** CI SHALL 對同一內容得出相同失敗結果

#### Scenario: Reader-visible component surfaces are covered

- **WHEN** 新增的 emoji 出現在 frontmatter、MoguNote、ShroomDogNote 或其他 component、圖片替代文字或 code block
- **THEN** 檢查腳本 SHALL 一樣擋下，不需要先判斷那一行讀者看不看得到

#### Scenario: Kaomoji remains allowed

- **WHEN** 新增或修改的文章使用文字型 kaomoji
- **THEN** emoji 檢查 SHALL NOT 因該 kaomoji 失敗
- **AND** 塞進 kaomoji 外殼的 emoji 仍 SHALL 被阻擋

#### Scenario: User grants a narrow exception

- **WHEN** ShroomDog 明確核准某篇文章保留某個 emoji
- **AND** 檢查腳本記有該文章路徑、emoji 與理由
- **THEN** 檢查腳本 SHALL 放行該文章裡的這個 emoji
- **AND** SHALL NOT 放行同篇其他 emoji 或其他文章

#### Scenario: Untouched legacy post contains emoji

- **WHEN** 歷史文章含有 emoji
- **BUT** 該行在目前變更中沒有新增或修改
- **THEN** 檢查腳本 SHALL NOT 阻擋這次變更
- **AND** 之後修改該行時 SHALL 要求移除 emoji 或取得核准

#### Scenario: Local and CI results stay aligned

- **WHEN** 同一組文章變更分別在 pre-commit 與 pull request CI 檢查
- **THEN** 兩者 SHALL 執行同一支檢查腳本
- **AND** 無法取得比較基準時 SHALL 失敗，不得當成通過

#### Scenario: 英文 sidecar 不復原來源 emoji

- **WHEN** gp-pipeline 的英文 sidecar 翻譯者遇到原始來源或 zh-tw 正文脈絡中的表情圖示
- **THEN** sidecar prompt SHALL 要求省略裝飾性字形，或用自然文字保留其必要語意
- **AND** SHALL NOT 依來源或推測直接復原任何字形
- **AND** 最終內容檢查 SHALL 阻止未核准字形進站
