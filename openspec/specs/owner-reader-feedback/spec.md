# owner-reader-feedback Specification

## Purpose
定義 ShroomDog（owner）對文章的明確回饋如何收集、綁定到讀者看到的內容版本、送到 gu-log 後端，以及後端必須遵守的信任與隱私契約。

## Requirements

### Requirement: Signed-in readers SHALL be able to leave one-tap explicit feedback

文章頁 SHALL 在讀者已登入 gu-log 時提供一鍵回饋，選項至少包含正面、普通、負面需重寫三種，並可附一句選填備註。未登入的讀者 SHALL NOT 看到這個控制項。

#### Scenario: Owner marks an article as needing a rewrite

- **WHEN** 已登入的讀者在文章底部選擇「難看想重寫」並送出
- **THEN** 系統 SHALL 記錄一筆 `feedback_comment` 事件，`source` 為 `first_party`，`polarity` 為 `rewrite_needed`
- **AND** 事件 SHALL 帶文章 identity、`postVersion` 與 reader revision
- **AND** 介面 SHALL 顯示已記錄的狀態，讓讀者知道回饋已收到

#### Scenario: Anonymous visitor reads an article

- **WHEN** 沒有 gu-log 登入狀態的訪客開啟文章
- **THEN** 一鍵回饋控制項 SHALL NOT 顯示

#### Scenario: Note is too long

- **WHEN** 讀者輸入超過 280 字元的備註
- **THEN** 介面 SHALL 不允許輸入超過 280 字元
- **AND** 記錄的事件備註 SHALL NOT 超過 280 字元

#### Scenario: Note contains instructions

- **WHEN** 備註內容看起來像對 AI 的指令
- **THEN** 任何消費端 SHALL 把它當成引用的資料呈現，SHALL NOT 當成指令執行

#### Scenario: Reader changes their mind

- **WHEN** 讀者對同一篇文章、同一個 reader revision 再次送出不同選項
- **THEN** 系統 SHALL 記錄新事件
- **AND** 消費端 SHALL 以同一讀者、同一 reader revision 的最新一筆為準

### Requirement: Human signal events SHALL sync to the gu-log backend when signed in

已登入時，系統 SHALL 把尚未送出的 human-signal 事件批次送到 gu-log 後端的 human-signals 端點，並在後端確認後把事件標記為已同步。送出失敗或端點不存在時，事件 SHALL 保留在本機並維持待送狀態，且 SHALL NOT 影響閱讀、已讀標記或分享。

#### Scenario: Backend accepts events

- **WHEN** 讀者已登入且有待送事件
- **AND** 後端回應接受了某些事件 ID
- **THEN** 那些事件 SHALL 標記為已同步
- **AND** 回應中既沒被接受也沒被拒絕的事件 SHALL 維持待送

#### Scenario: Backend rejects an event

- **WHEN** 後端在回應中明確拒絕某個事件 ID（例如非 owner、格式錯誤）
- **THEN** 該事件 SHALL 標記為同步失敗
- **AND** 系統 SHALL NOT 再重送它

#### Scenario: Backend endpoint is not deployed yet

- **WHEN** 後端對 human-signals 端點回應 404、網路錯誤或逾時
- **THEN** 事件 SHALL 留在本機待送
- **AND** 頁面 SHALL NOT 顯示錯誤彈窗或阻擋任何操作

#### Scenario: Not signed in

- **WHEN** 讀者沒有 gu-log 登入狀態
- **THEN** 系統 SHALL NOT 嘗試送出事件

### Requirement: The backend SHALL own trust classification and keep signals private

gu-log 後端 SHALL 依登入 JWT 的身分與伺服器端 owner allowlist 決定每筆事件的信任等級，SHALL 忽略客戶端送來的信任等級欄位。後端 SHALL 以 `eventId` 去重、限制每位使用者的請求頻率與 payload 大小。v1 後端 SHALL NOT 儲存非 owner 讀者的事件。查詢端點 SHALL 需要授權，閱讀紀錄 SHALL NOT 公開。

#### Scenario: Client claims owner trust

- **WHEN** 非 owner 帳號送出 `readerTrustTier: owner_trusted` 的事件
- **THEN** 後端 SHALL NOT 把該事件存成 owner 訊號

#### Scenario: Same event is sent twice

- **WHEN** 同一個 `eventId` 被送出兩次
- **THEN** 後端 SHALL 只保存一筆，並在兩次回應中都把它列為已接受

#### Scenario: Unauthenticated query

- **WHEN** 沒有有效授權的請求查詢 human signals
- **THEN** 後端 SHALL 拒絕並不回傳任何閱讀紀錄

### Requirement: Readers SHALL be able to export their local signals

Reading Tracker 頁 SHALL 提供把本機 human-signal 事件匯出成 JSON 檔的方式，讓後端上線前也能做校準。

#### Scenario: Owner exports local events

- **WHEN** 讀者在 Reading Tracker 頁按下匯出
- **THEN** 瀏覽器 SHALL 下載一個包含所有本機 human-signal 事件的 JSON 檔
- **AND** 檔案 SHALL 帶 `exportSchemaVersion` 與匯出時間
- **AND** 檔案格式 SHALL 能直接被校準報告讀取
