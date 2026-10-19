# glossary-browsing Specification

## Purpose

定義讀者瀏覽與落地 gu-log 詞彙表的方式：每種語言一頁、詞條預設精簡並可就地展開、從錨點進來時目標詞條直接展開、分類篩選從詞條資料產生，讓詞彙表好掃讀，又不弄壞文章裡既有的錨點連結。

## Requirements

### Requirement: 詞彙表 SHALL 維持每種語言一頁

所有詞條，不論分類（包含人物），SHALL 都放在 `/glossary`（繁中）與 `/en/glossary`（英文）各一頁，並 SHALL 可以用 `/glossary#<錨點>`、`/en/glossary#<錨點>` 直接到達。系統 SHALL NOT 依分類或單一詞條把詞條移到其他網址。

#### Scenario: 人物詞條留在同一頁

- **WHEN** 讀者開啟 `/glossary#andrej-karpathy`
- **THEN** 瀏覽器 SHALL 停在 `/glossary`，並顯示 Andrej Karpathy 這個詞條

#### Scenario: 新分類不產生新網址

- **WHEN** 詞條資料新增一個使用新分類的詞條
- **THEN** 這個詞條 SHALL 出現在同一頁
- **AND** 系統 SHALL NOT 為這個分類新增路由

### Requirement: 詞條 SHALL 預設精簡並可就地展開

每個詞條預設 SHALL 顯示名稱、英文名（與名稱不同時）、分類 label 與定義的開頭摘要；完整定義、MoguNote、外部連結、Thread、相關詞條與文章 SHALL 先收起來，讀者展開後在原地顯示，SHALL NOT 需要離開頁面。展開控制 SHALL 可用鍵盤操作；有 JavaScript 時，展開控制 SHALL 向輔助技術回報展開狀態，並 SHALL 能把展開的詞條收起，包含從錨點展開的詞條。

#### Scenario: 瀏覽時看到精簡詞條

- **WHEN** 讀者開啟不帶錨點的 `/glossary`
- **THEN** 每個詞條 SHALL 顯示名稱、分類 label 與定義摘要
- **AND** 詞條展開前 SHALL NOT 顯示 MoguNote

#### Scenario: 展開與收起一個詞條

- **WHEN** 讀者用滑鼠、觸控或鍵盤啟動某個詞條的展開控制
- **THEN** 該詞條的完整定義、MoguNote、外部連結、相關詞條與文章 SHALL 在原地出現，展開控制 SHALL 回報已展開的狀態
- **AND** 再啟動一次同一個控制時，該詞條 SHALL 收起

#### Scenario: 沒有 JavaScript 時仍可展開

- **WHEN** 讀者的瀏覽器沒有執行 JavaScript
- **THEN** 讀者 SHALL 仍能展開任一詞條看到完整內容

### Requirement: 從錨點進來的詞條 SHALL 直接展開

讀者以 `/glossary#<錨點>` 或 `/en/glossary#<錨點>` 開啟頁面，或在頁內點到另一個詞條的錨點（例如相關詞條）時，目標詞條 SHALL 已經展開並捲到可見位置，讀者 SHALL NOT 需要再點一次才看到完整內容。沒有 JavaScript 時，從網址錨點進來的目標詞條 SHALL 同樣展開。目標詞條被目前的分類篩選藏起來時，頁面 SHALL 先切回「全部」。

#### Scenario: 從文章點進詞條

- **WHEN** 讀者在文章裡點 `[Elixir](/glossary#elixir)`
- **THEN** `/glossary` 開啟時 Elixir SHALL 已展開並位於可見位置，包含它的 MoguNote

#### Scenario: 點相關詞條

- **WHEN** 讀者在已展開的詞條裡點一個相關詞條連結
- **THEN** 目標詞條 SHALL 展開並捲到可見位置

#### Scenario: 篩選中點到被藏起來的詞條

- **WHEN** 讀者選了「人物」篩選，並在展開的人物詞條裡點一個不屬於人物的相關詞條
- **THEN** 篩選 SHALL 切回「全部」
- **AND** 目標詞條 SHALL 展開並位於可見位置

### Requirement: 分類篩選 SHALL 從詞條資料產生並有雙語 label

篩選按鈕 SHALL 依詞條資料實際使用的分類產生，另加一個「全部」；沒有詞條的分類 SHALL NOT 出現按鈕。資料用到的每個分類 SHALL 有繁中與英文 label，詞條的分類標籤 SHALL 顯示該語言的 label，SHALL NOT 顯示原始分類 id。資料用到沒有 label 的分類時，測試 SHALL 失敗。

#### Scenario: 每個分類都篩得到

- **WHEN** 詞條資料有使用 `products` 與 `models` 的詞條
- **THEN** 兩頁 SHALL 都有對應的篩選按鈕，按下後只顯示該分類的詞條
- **AND** 繁中頁的分類標籤 SHALL 顯示中文 label

#### Scenario: 沒有詞條的分類

- **WHEN** 沒有任何詞條使用某個已定義 label 的分類
- **THEN** 頁面 SHALL NOT 顯示這個分類的篩選按鈕

#### Scenario: 新分類缺 label

- **WHEN** `src/data/glossary.json` 出現一個沒有 label 的分類
- **THEN** 測試 SHALL 失敗，並指出這個分類

### Requirement: 中英文詞彙表 SHALL 行為一致

`/glossary` 與 `/en/glossary` SHALL 由同一份頁面結構產生。詞條順序、分類篩選、精簡與展開、錨點的行為 SHALL 一致；兩頁只有文字語言不同。英文頁 SHALL 使用英文定義、英文 MoguNote 與英文 label，詞條裡的文章連結 SHALL 指向英文版文章並顯示英文版標題。

#### Scenario: 英文頁從錨點展開

- **WHEN** 讀者開啟 `/en/glossary#andrej-karpathy`
- **THEN** Andrej Karpathy SHALL 以英文定義與英文 MoguNote 展開
- **AND** 它的分類標籤 SHALL 顯示英文 label

#### Scenario: 英文頁的文章連結

- **WHEN** 讀者在 `/en/glossary` 展開一個有文章連結的詞條，例如 Kubernetes
- **THEN** 文章連結 SHALL 指向英文版文章，並顯示英文版的標題
