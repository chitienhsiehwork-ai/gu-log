## MODIFIED Requirements

### Requirement: TOC MUST be useful navigation with lower visual weight than the article

文章目錄 SHALL 對長文維持可用，但桌面版與手機版的目錄呈現 SHALL 避免使用和主要文章內容、來源卡片或中繼資料面板一樣重的卡片語法。

#### Scenario: 桌面版讀者進入文章

- **GIVEN** 桌面版視窗寬到足以顯示側欄目錄
- **WHEN** 讀者初次抵達文章頁，且文章標頭仍在主要閱讀區
- **THEN** 桌面版目錄 SHALL 維持隱藏且不可互動
- **AND** 首個視窗 SHALL 以文章標題、來源與開頭正文為主
- **WHEN** 讀者向下捲動，使文章標頭滑出目錄的固定 top 偏移
- **THEN** 桌面版目錄 SHALL 顯示並開始提供段落導覽
- **AND** 作用中段落 SHALL 可辨識
- **AND** 目錄 SHALL 比文章標題與正文有更低的視覺重量

#### Scenario: 桌面版讀者回到文章標頭

- **GIVEN** 桌面版目錄已因讀者進入正文而顯示
- **WHEN** 讀者捲回文章標頭
- **THEN** 桌面版目錄 SHALL 再次隱藏
- **AND** 隱藏的目錄連結 SHALL NOT 接收指標或鍵盤互動

#### Scenario: 桌面版讀者直接開啟或還原文章中段位置

- **GIVEN** 桌面版讀者透過標題雜湊、重新載入後的捲動位置還原或前後頁快取進入文章中段
- **WHEN** 頁面完成目前視窗的位置還原
- **THEN** 桌面版目錄狀態 SHALL 依目前文章標頭幾何位置重新計算
- **AND** 若文章標頭已滑出目錄的固定 top 偏移，桌面版目錄 SHALL 顯示
- **AND** 作用中段落 SHALL 對應目前閱讀位置

#### Scenario: 視窗跨過桌面版斷點或讓文章標頭重新排版

- **GIVEN** 文章頁已載入
- **WHEN** 視窗縮放跨過桌面版斷點，或文字重新排版改變文章標頭高度
- **THEN** 目錄可見性 SHALL 依最新視窗與標頭幾何位置重新計算
- **AND** 手機版展開狀態 SHALL NOT 被桌面版顯示狀態覆寫

#### Scenario: 桌面版讀者偏好減少動態效果

- **GIVEN** 桌面版讀者啟用 `prefers-reduced-motion: reduce`
- **WHEN** 桌面版目錄在隱藏與顯示狀態間切換
- **THEN** 狀態切換 SHALL NOT 使用顯示過場或位移動畫

#### Scenario: 手機版讀者快速抵達正文

- **GIVEN** 手機版視窗
- **WHEN** 讀者開啟文章
- **THEN** 若段落標題存在，目錄 SHALL 容易被發現
- **AND** 目錄 SHALL NOT 在正文開頭前消耗不成比例的首屏高度
- **AND** 收合的手機版目錄 SHALL NOT 顯示裝飾性垂直線
- **AND** 展開的手機版目錄 MAY 在項目旁使用 1px 中性編組線，但該線 SHALL NOT 穿過展開控制標頭
- **AND** 手機版目錄 SHALL NOT 使用強調色導引線或作用中連結側邊標籤
