## ADDED Requirements

### Requirement: 首頁顯示 ShroomDog 人工策展區

繁中與英文首頁 SHALL 在既有 Gu-log Picks 之前顯示 `ShroomDog’s Choice`，並以頁面語言說明這是 ShroomDog 親自讀過、排序且願意署名背書的選文。區塊 SHALL NOT 顯示 `SD` 圓章或把 `SD` 當成策展識別，避免與 `ShroomDog Original` ticket prefix 混淆。

#### Scenario: 繁中首頁顯示策展承諾

- **WHEN** 讀者開啟繁中首頁
- **THEN** `ShroomDog’s Choice` SHALL 出現在 Gu-log Picks 之前
- **AND** 第一篇 SHALL 標示 `主廚首選`
- **AND** 區塊 SHALL NOT 顯示 `SD` 策展圓章

#### Scenario: 英文首頁顯示對應承諾

- **WHEN** 讀者開啟英文首頁
- **THEN** 同一策展區 SHALL 使用英文承諾文案
- **AND** 第一篇 SHALL 標示 `Chef’s Pick`

### Requirement: 一份有序清單驅動雙語策展

系統 SHALL 以單一有序 ticketId 清單作為策展 SSOT。繁中與英文首頁 SHALL 依目前語言解析同一批 ticketId，並保留清單中的人工順序；設定有重複 ticketId 時 validation SHALL 失敗。若某語言缺少 sidecar 或該語言項目不合資格，兩個首頁的實際顯示篇數 MAY 不同，但系統 MUST NOT 維護第二份語言專屬菜單或自動補位。

#### Scenario: 雙語使用同一排序

- **WHEN** 清單依序包含三個同時有繁中與英文版本的 ticketId
- **THEN** 兩個首頁 SHALL 各自顯示該語言的三篇文章
- **AND** 兩個首頁的 ticketId 次序 SHALL 與中央清單相同

#### Scenario: 重複選文設定失敗

- **WHEN** 中央清單重複包含同一 ticketId
- **THEN** validation SHALL 失敗並指出重複值

### Requirement: 策展資格採保守公開門檻

策展 resolver SHALL 只回傳目前語言存在、有效狀態為 `published`、`isBelowPublishBar()` 為 false，且繁中 canonical entry 與目前語言 entry 都未標記 `unlisted` 的文章。此 publish-bar 判斷 SHALL 沿用現有首頁語意，讓尚未評分的 grandfathered 舊文保持合格。缺少或不合資格的清單項目 SHALL 被略過，系統 MUST NOT 自動補入未經選定的文章。

#### Scenario: Published 且合格的文章入選

- **WHEN** 清單文章在目前語言存在、有效狀態為 `published`、`isBelowPublishBar()` 為 false 且未標記 `unlisted`
- **THEN** resolver SHALL 依人工順序回傳該文章

#### Scenario: 未評分舊文保持合格

- **WHEN** 清單文章沒有真 tribunal 分數且其餘資格皆成立
- **THEN** `isBelowPublishBar()` SHALL 為 false
- **AND** resolver SHALL 保留該 grandfathered 文章

#### Scenario: Retired 或 deprecated 文章排除

- **WHEN** 清單文章的有效狀態為 `retired` 或 `deprecated`
- **THEN** resolver SHALL 排除該文章
- **AND** SHALL NOT 以其他文章補位

#### Scenario: Unlisted 英文 sidecar 排除

- **WHEN** 某英文文章對應的繁中 canonical entry 標記 `unlisted: true`
- **THEN** 英文策展 resolver SHALL 排除該文章

#### Scenario: 低於 publish bar 的文章排除

- **WHEN** 清單文章有真 tribunal 分數且低於完整 publish bar
- **THEN** resolver SHALL 排除該文章

#### Scenario: 缺少目前語言版本安全略過

- **WHEN** 清單 ticketId 沒有目前語言的文章 entry
- **THEN** resolver SHALL 略過該項目並保留其餘項目的相對順序
- **AND** SHALL NOT 以其他語言或其他 ticketId 代替

### Requirement: 策展版型維持單層且可適應 viewport

策展區 SHALL 使用單一較俐落的圓角外框、留白與分隔線建立內容階層，不得以多層巢狀卡片、重陰影或大面積漸層模擬深度。所有文章連結 SHALL 可用鍵盤操作，且區塊 SHALL 在 dark／light theme 與 390px 寬 viewport 下無水平溢位。

#### Scenario: Mobile 首頁無水平溢位

- **WHEN** 策展區在 390px 寬 viewport 渲染
- **THEN** 所有文字與文章連結 SHALL 留在 viewport 內
- **AND** 項目 SHALL 依 responsive layout 排列而不產生水平捲動

#### Scenario: 主題切換保持可讀

- **WHEN** 首頁在 dark 或 light theme 渲染
- **THEN** 策展區文字、邊界與互動狀態 SHALL 保持可辨識
