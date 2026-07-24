## ADDED Requirements

### Requirement: Article pages MUST use a scoped editorial typography layer

Post pages SHALL 在 `.post`、`.post-header` 和/或 `.post-content` 下定義 article-specific typography 與 prose rhythm，而不是只依賴 global `h1`、`h2` 和 `p` rules。

這一層 SHALL 保留 non-article surfaces 目前的 UI typography，同時讓 article headings、section spacing、blockquotes、notes，以及 code / prompt examples 擁有 reading-oriented hierarchy。

#### Scenario: Article heading scale is scoped to posts

- **GIVEN** site render 一個 post page 和一個 non-post page
- **WHEN** article heading styles 被修改
- **THEN** post H1 與 `.post-content` headings SHALL 套用 editorial scale
- **AND** index cards、navigation、tools，以及其他 non-post UI SHALL NOT 意外繼承 article-only heading scale

#### Scenario: Scoped measurement uses article body selectors

- **GIVEN** agent 驗證 article typography
- **WHEN** agent 量測 H2 或 paragraph styling
- **THEN** agent SHALL 量測 `.post-content h2` 和 `.post-content p`
- **AND** 當 unscoped selectors 可能 match 到 TOC、source citation 或 metadata text 時，agent SHALL NOT 使用 unscoped `h2` 或 `p` values

#### Scenario: Body text is tuned by rhythm, not blind enlargement

- **GIVEN** `.post-content p` 已經是可讀的 size
- **WHEN** implementation 改善 prose readability
- **THEN** implementation SHALL 調整 line-height、margins、measure、heading contrast、lists、quotes 和 note density
- **AND** implementation SHALL NOT 把 body font-size inflation 視為唯一必要修正

---

### Requirement: First screen MUST prioritize the article over administrative metadata

Post page 的首屏 SHALL 讓 title 與 article lead 成為主要 reading path。Ticket/date/category/source/TOC/status metadata MAY 出現在上方附近，但它們的 visual weight SHALL 低於 article title 與 lead。

#### Scenario: Reader lands on a source-based post

- **GIVEN** reader 開啟一篇 GP 或 MP post
- **WHEN** first viewport render
- **THEN** title SHALL 是 dominant element
- **AND** essential metadata SHALL 容易掃讀
- **AND** source attribution SHALL 維持 discoverable
- **AND** source attribution、TOC 和 status panels SHALL NOT 集體壓過 first viewport 中的 article lead

#### Scenario: Source attribution remains accessible after hierarchy changes

- **GIVEN** source citation 被 restyle 或移動
- **WHEN** reader 想檢查 original source
- **THEN** source link SHALL 在 post page 中維持 visible 或清楚可抵達
- **AND** source link SHALL 保留 link semantics、target 與 rel safety

#### Scenario: Source attribution uses an editorial provenance row

- **GIVEN** source attribution 位於 mobile article header
- **WHEN** citation 與 TOC 一起出現在首屏
- **THEN** citation SHALL 使用 typography、spacing、icon 與 underline 保持可辨識
- **AND** citation SHALL 維持 inline row，而不是獨立的 filled surface container
- **AND** citation SHALL NOT 使用 container border、rounded card radius 或 decorative left rail

---

### Requirement: TOC MUST be useful navigation with lower visual weight than the article

Table of contents SHALL 對 long articles 維持 available，但 desktop 與 mobile TOC presentation SHALL 避免使用和 primary article content、source cards 或 metadata panels 一樣重的 card grammar。

#### Scenario: Desktop reader uses TOC

- **GIVEN** desktop viewport 寬到足以顯示 TOC sidebar
- **WHEN** reader scroll 一篇 long article
- **THEN** TOC SHALL 維持 navigation 可用
- **AND** active section SHALL 可辨識
- **AND** TOC SHALL 比 post title 與 article body 有更低的 visual prominence

#### Scenario: Mobile reader reaches content quickly

- **GIVEN** mobile viewport
- **WHEN** reader 開啟 post
- **THEN** 若 headings 存在，TOC SHALL 可被 discover
- **AND** TOC SHALL NOT 在 article lead 前消耗不成比例的 first-screen height
- **AND** collapsed mobile TOC SHALL NOT 顯示 decorative vertical rail
- **AND** expanded mobile TOC MAY 在 entries 旁使用 1px 中性 grouping rule，但該線 SHALL NOT 穿過 disclosure header
- **AND** mobile TOC SHALL NOT 使用 accent-colored rail 或 active-link side-tab

---

### Requirement: Technical provenance MUST be grouped or disclosed after the editorial close

Translation pipeline、AI Tribunal scores 和 version history 等 technical provenance SHALL 維持 available，但 SHALL group 到 article body 後面的 low-weight 或 collapsible technical metadata area。

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

---

### Requirement: Reader tools MUST be organized as a coherent bottom action area

Read status、sharing、login CTA、related articles、series navigation、prev/next navigation 和 comments SHALL 被整理成支援 post completion 的形式，而不是看起來像一疊互不相干的 dashboard widgets。

Version history SHALL 繼續與 technical provenance metadata grouped 在一起，而不是和 reader action controls 放在一起。

#### Scenario: Post has all optional bottom modules

- **GIVEN** post 有 scores、tags、translation info、read tracking、share buttons、login CTA、related articles、prev/next nav、comments 和 version info
- **WHEN** reader 抵達 post footer area
- **THEN** related modules SHALL 依目的 grouped
- **AND** action controls SHALL 在視覺上和 provenance metadata 區分開
- **AND** onward navigation SHALL 在視覺上和 comments 區分開
- **AND** combined footer SHALL NOT 讀起來像一整面連續 dashboard wall
- **AND** related、series 與 chronological navigation SHALL 使用中性 divider、文字層級與留白形成 editorial rows
- **AND** onward navigation SHALL NOT 使用 filled surface containers、rounded card chrome、ticket-colored side rails 或位移 hover

#### Scenario: Optional modules are absent

- **GIVEN** post 缺少一個或多個 optional modules
- **WHEN** footer render
- **THEN** remaining groups SHALL 維持 stable spacing 與 hierarchy
- **AND** absent modules SHALL NOT 留下 awkward gaps 或 duplicate separators

---

### Requirement: Editorial presentation changes MUST be visually verified across themes and viewports

此 capability 的任何 implementation SHALL 在兩個 supported themes，以及 desktop 與 mobile article viewports 上完成驗證。

#### Scenario: Implementation is ready for review

- **GIVEN** implementation 修改 post typography、first-screen hierarchy、TOC presentation 或 bottom tool organization
- **WHEN** PR 準備進入 review
- **THEN** PR SHALL include dark Dracula desktop、light Solarized desktop、dark Dracula mobile 和 light Solarized mobile 的 verification
- **AND** PR SHALL include `.post-content h2` 與 `.post-content p` 的 scoped selector measurements
- **AND** PR SHALL confirm PR1 image work 與 artifact work 不在 patch 範圍內
