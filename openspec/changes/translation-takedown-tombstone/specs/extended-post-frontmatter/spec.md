## MODIFIED Requirements

### Requirement: Frontmatter 必填欄位

每篇未下架 post 的 frontmatter SHALL 有以下必填欄位：`sourceType`、`temporalType`、`authorCanonical`、`authorType`、`clusterIds`。Zod schema SHALL 在 build 階段驗證這些欄位的存在與型別。已下架（`status: taken-down`）的 post SHALL 改依 `post-takedown` 的墓碑欄位範圍驗證，SHALL NOT 要求、也 SHALL NOT 接受這些欄位。

**型別規範**：

- `sourceType`：enum of `'primary' | 'derivative' | 'commentary'`
- `temporalType`：enum of `'event' | 'evergreen' | 'hybrid'`
- `authorCanonical`：非空字串
- `authorType`：enum of `'individual' | 'org' | 'proxy'`
- `clusterIds`：字串陣列，允許為空陣列 `[]`

#### Scenario: 缺必填欄位的 post build 失敗

- **WHEN** 未下架 post 的 frontmatter 缺少 `sourceType`
- **THEN** Zod schema 驗證 SHALL 失敗
- **AND** `pnpm run build` SHALL 回報 error 並指出缺欄位的 post 路徑

#### Scenario: enum 值不合法 build 失敗

- **WHEN** post 的 `temporalType` 值為 `"news"`（不在 enum 列表）
- **THEN** Zod schema 驗證 SHALL 失敗
- **AND** 錯誤訊息 SHALL 指出合法值 `event | evergreen | hybrid`

#### Scenario: clusterIds 允許空陣列

- **WHEN** 一篇獨立 standalone post 的 `clusterIds = []`
- **THEN** Zod schema 驗證 SHALL 通過
- **AND** 此 post 代表「目前未納入任何 cluster」

#### Scenario: 下架 post 不帶 taxonomy 欄位

- **WHEN** 一篇 `status: taken-down` 的 post 只有墓碑欄位，沒有 `sourceType` 等欄位
- **THEN** Zod schema 驗證 SHALL 通過
- **AND** 若它帶了 `sourceType` 等墓碑範圍外的欄位，驗證 SHALL 失敗
