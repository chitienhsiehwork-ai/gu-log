## MODIFIED Requirements

### Requirement: Technical provenance MUST be grouped or disclosed after the editorial close

Translation pipeline、AI Tribunal scores 和 version history 等 technical provenance SHALL 維持 available，但 SHALL group 到 article body 後面的 low-weight 或 collapsible technical metadata area。已下架文章的墓碑頁不是文章頁，SHALL NOT 顯示 technical provenance，包含版本資訊與連到修改歷史的連結（見 `post-takedown`）。

#### Scenario: Reader finishes the article

- **GIVEN** reader 抵達 `.post-content` 結尾
- **WHEN** post metadata 與 tools render
- **THEN** page SHALL 先提供 editorially coherent close，例如 tags、source context 或 onward reading
- **AND** technical provenance SHALL NOT 以多個互不相關的 full-weight panels 打斷 article close

#### Scenario: Provenance-focused reader inspects metadata

- **GIVEN** reader 想看 Tribunal scores、translation pipeline 或 version history
- **WHEN** technical metadata section 被 collapsed 或 visually reduced
- **THEN** reader SHALL 能用 keyboard 和 pointer 開啟或檢查它
- **AND** content SHALL 保留同一份 underlying data 和 links

#### Scenario: Reader opens a taken-down post

- **GIVEN** 文章是 `status: taken-down`
- **WHEN** reader 開啟它的網址
- **THEN** 頁面 SHALL NOT 顯示 Tribunal scores、translation pipeline、版本資訊或修改歷史連結
