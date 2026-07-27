## ADDED Requirements

### Requirement: 控制器依視窗消耗線調節派送

控制器 SHALL 用「依視窗已經過時間計算的消耗線」評估兩個正式額度視窗。每個視窗的實際已用百分比由剩餘百分比推導；理想已用百分比依設定視窗已經過的比例與保留底線以上的可用額度推導，再加上設定的突發容許量，得到允許已用百分比。

#### Scenario: 兩個視窗都沒有超前允許消耗線

- **WHEN** 兩個視窗的資料完整，且實際已用百分比都沒有超過各自的允許消耗線
- **THEN** 控制器 SHALL 回傳 `pacing` 模式與設定的最小冷卻時間
- **AND** 控制器 SHALL 建議設定的工作行程數，最終上限仍受獨立的執行環境自動縮放約束

#### Scenario: 一個視窗明顯超前允許消耗線

- **WHEN** 一個視窗的實際已用百分比超過允許消耗線
- **AND** 允許消耗線追上目前用量所需時間超過設定的最小冷卻時間
- **THEN** 控制器 SHALL 建議零個新工作行程
- **AND** 控制器 SHALL 回傳追平欠額，並把該視窗標為約束來源

#### Scenario: 欠額沒超過最小派送間隔

- **WHEN** 一個視窗超前允許消耗線，但追平欠額沒有超過設定的最小冷卻時間
- **THEN** 控制器 SHALL 維持 `pacing` 模式與設定的最小冷卻時間
- **AND** 控制器 MAY 把超前的視窗顯示為診斷用約束遙測

### Requirement: 控制器採用較保守的欠額等待

控制器 SHALL 分別計算短週期與每週額度視窗的欠額。兩個視窗都要求停止派送時，控制器 SHALL 選擇較長的欠額，並把對應視窗標為約束來源。

#### Scenario: 每週欠額比短週期欠額長

- **WHEN** 兩個視窗都超前各自的允許消耗線
- **AND** 每週追平欠額比短週期追平欠額長
- **THEN** 控制器 SHALL 回傳每週欠額
- **AND** `binding_constraint` SHALL 指向每週視窗

#### Scenario: 短週期欠額與每週欠額相等

- **WHEN** 兩個視窗需要相同的追平欠額
- **THEN** 控制器 SHALL 只回傳一次該欠額
- **AND** 控制器 SHALL 以固定規則選擇約束來源

### Requirement: 控制器維持設定的額度保留底線

控制器 SHALL 在任一正式額度視窗的剩餘百分比小於或等於設定的保留底線時停止開新工作行程。控制器 SHALL 回報 `floor_stop`、建議零個工作行程，並保留約束視窗的重設欠額；常駐程式則依有上限的複查間隔重讀即時額度。

#### Scenario: 一個視窗到達保留底線

- **WHEN** 短週期視窗小於或等於設定的保留底線，而每週視窗高於保留底線
- **THEN** 控制器 SHALL 回傳 `floor_stop` 與零個建議工作行程
- **AND** 短週期視窗 SHALL 是約束來源

#### Scenario: 兩個視窗都到達保留底線

- **WHEN** 兩個視窗都小於或等於設定的保留底線
- **THEN** 控制器 SHALL 回傳 `floor_stop` 與零個建議工作行程
- **AND** 控制器 SHALL 以較長的重設欠額作為保守等待遙測

#### Scenario: 常駐程式處理長保留底線欠額

- **WHEN** 控制器回傳的保留底線欠額長於設定的即時複查間隔
- **THEN** 常駐程式 SHALL 在可觀測資料保留完整欠額
- **AND** 常駐程式 SHALL 最晚在設定的複查間隔後重讀即時額度

### Requirement: 控制器不以執行中工作與單篇成本作為派送閘門

控制器 SHALL NOT 在計算消耗欠額、保留底線狀態、冷卻時間或建議工作行程數時，從額度讀值扣除 `active_workers * ARTICLE_COST_PCT` 或任何單篇成本指數移動平均。執行中工作數與校準後的單篇成本 MAY 保留為生命週期及遙測資料。

#### Scenario: 相同額度讀值搭配不同執行中工作數

- **WHEN** 兩次控制器決策收到相同額度讀值與設定，但執行中工作數不同
- **THEN** 兩次決策 SHALL 回傳相同冷卻時間、工作行程建議、約束來源與模式

#### Scenario: 相同額度讀值搭配不同單篇成本估計

- **WHEN** 兩次控制器決策收到相同額度讀值與設定，但 `ARTICLE_COST_PCT` 不同
- **THEN** 兩次決策 SHALL 回傳相同派送決策
- **AND** 不同的單篇成本 MAY 只出現在遙測

#### Scenario: 校準觀測到較大的單篇差值

- **WHEN** 單篇成本校準依有效生命週期樣本更新指數移動平均
- **THEN** 後續歷史與狀態 MAY 顯示更新後的估計
- **AND** 該更新 SHALL NOT 改變額度閘門

### Requirement: 額度資料不可用時控制器安全降級

封閉迴路節奏 SHALL 要求兩個正式額度視窗都有完整的剩餘百分比與正數重設資料。用量監測失敗、正式來源資料缺少、必要欄位無法解析，或重設時間不是正數時，控制器 SHALL 回傳 `fallback`、600 秒冷卻時間、一個建議工作行程，且沒有約束來源。

#### Scenario: 正式重設欄位缺少

- **WHEN** 用量監測回報兩個剩餘百分比，但缺少一個必要重設欄位
- **THEN** 控制器 SHALL 回傳 `600|1|none|fallback`
- **AND** 控制器 SHALL NOT 把未知視窗當成全額可用

#### Scenario: 用量監測呼叫失敗

- **WHEN** 用量監測不存在、無法執行或以失敗狀態結束
- **THEN** 控制器 SHALL 回傳 `fallback`
- **AND** 常駐程式 SHALL 暫停新派送，直到降級重試週期

#### Scenario: 單次診斷收到不可用資料

- **WHEN** `--controller-once` 收到不可用的正式額度資料
- **THEN** 它 SHALL 印出與正式控制器相同的降級決策
- **AND** 它 SHALL 在沒有認領或派送文章的情況下結束

### Requirement: 系統保存如實的控制器遙測

舊模式以外，常駐程式 SHALL 對主迴圈的 `tick`、`dispatch`、`complete` 生命週期事件盡力追加逐行 JSON 歷史；狀態路徑可寫時，每次成功的主迴圈決策後 SHALL 覆寫控制器狀態。歷史與狀態 SHALL 記錄實際額度讀值、決策、約束來源、模式與僅供遙測的單篇成本估計。歷史追加失敗 SHALL 產生警告，不得靜默改變派送決策。

#### Scenario: 主迴圈控制器決策成功

- **WHEN** 常駐程式完成封閉迴路控制器決策
- **THEN** 它 SHALL 追加一筆包含實測視窗與回傳決策的 `tick` 歷史
- **AND** 它 SHALL 以目前模式、冷卻時間、建議工作行程、約束來源、單篇成本遙測與時間戳更新控制器狀態

#### Scenario: 文章生命週期完成

- **WHEN** 常駐程式在舊模式以外派送並完成文章
- **THEN** 它 SHALL 追加對應的 `dispatch` 與 `complete` 歷史事件
- **AND** 事件 SHALL 保留當下實際生效的控制器模式與單篇成本遙測

#### Scenario: 常駐程式帶著既有歷史啟動

- **WHEN** 常駐程式啟動時額度歷史已存在
- **THEN** 它 SHALL 移除早於設定保留期間且可解析的紀錄
- **AND** 它 SHALL 保留較新的紀錄供校準與稽核

#### Scenario: 單次診斷執行

- **WHEN** operator 執行 `--controller-once`
- **THEN** 指令 SHALL 回傳決策，且不要求歷史或狀態副作用

### Requirement: 系統從有效歷史校準單篇成本遙測

舊模式以外，常駐程式 SHALL 只在保留歷史中有足夠有效的單工作行程「派送到完成」額度差值後，校準單篇成本遙測。常駐程式 SHALL 依正式執行環境設定平滑並限制估計；校準後的估計 SHALL 維持不參與閘門。

#### Scenario: 歷史沒有足夠有效樣本

- **WHEN** 保留歷史的有效單工作行程差值少於必要數量
- **THEN** 校準 SHALL 保留目前單篇成本遙測值

#### Scenario: 歷史有足夠有效樣本

- **WHEN** 保留歷史至少有必要數量的正數單工作行程「派送到完成」差值
- **THEN** 校準 SHALL 以設定且有界的指數移動平均更新單篇成本遙測
- **AND** 控制器的消耗線決策 SHALL 不依賴該值

#### Scenario: 多工作行程樣本噪音過高

- **WHEN** 一組生命週期紀錄回報超過一個建議工作行程
- **THEN** 校準 SHALL 從單篇成本估計排除該組紀錄

### Requirement: 控制器執行設定的額外用量安全閥

控制器 SHALL 在額外用量已啟用且有正數預算上限時，比較已用與上限的比例及設定的安全門檻。比例超過門檻時 SHALL 回傳 `extra_limit`、設定的最大冷卻時間、零個建議工作行程，並以 `extra_limit` 作為約束來源。停用或不可用的額外用量資料 SHALL NOT 限制正常消耗線節奏。

#### Scenario: 額外用量超過設定門檻

- **WHEN** 額外用量已啟用且上限為正數
- **AND** 已用與上限的比例高於設定門檻
- **THEN** 控制器 SHALL 回傳 `extra_limit` 與零個建議工作行程
- **AND** 額外用量安全閥 SHALL 優先於消耗線節奏

#### Scenario: 額外用量已停用

- **WHEN** 額外用量未啟用
- **THEN** 控制器 SHALL 略過額外用量比例閘門
- **AND** 正常額度視窗評估 SHALL 繼續

#### Scenario: 額外用量沒有正數上限

- **WHEN** 額外用量已啟用，但預算上限為零或不可用
- **THEN** 控制器 SHALL NOT 除以該值或進入 `extra_limit`
- **AND** 正常額度視窗評估 SHALL 繼續

### Requirement: 系統保留明示的舊模式降級

系統 SHALL 支援 `--legacy-quota` 作為明示的 operator 降級。舊模式 SHALL 依設定的額度保留底線使用二元執行／停止行為，且 SHALL NOT 寫入封閉迴路額度歷史、控制器狀態或單篇成本校準。未設定該旗標時，用量監測錯誤 SHALL 留在封閉迴路 `fallback`，並在後續派送週期重試。

#### Scenario: Operator 啟用舊模式

- **WHEN** 常駐程式以 `--legacy-quota` 啟動
- **THEN** 它 SHALL 使用舊版二元保留底線決策，而不是消耗線節奏
- **AND** 它 SHALL NOT 寫入封閉迴路歷史、控制器狀態或校準

#### Scenario: 封閉迴路監測錯誤

- **WHEN** 用量監測失敗，且 `--legacy-quota` 未啟用
- **THEN** 常駐程式 SHALL 進入封閉迴路 `fallback`
- **AND** 它 SHALL 在後續派送週期重試用量監測

## REMOVED Requirements

### Requirement: Controller SHALL compute cooldown from dual ideal-consumption curves

**Reason**: 這條用 `ARTICLE_COST_PCT / rate` 計算逐篇冷卻時間，與現行視窗消耗欠額政策相反。

**Migration**: 改由「控制器依視窗消耗線調節派送」與「控制器採用較保守的欠額等待」定義雙視窗決策。

### Requirement: Controller SHALL account for in-flight quota commitment

**Reason**: `active_workers * ARTICLE_COST_PCT` 可能重複扣除已反映的消耗，也無法替即將派送或尚未反映的完成工作提供可靠保留量。

**Migration**: 執行中工作數與單篇成本估計只保留為遙測；若未來需要硬保留，另開包含樣本時間戳與消耗帳本的 change。

### Requirement: Controller SHALL handle inactive quota windows

**Reason**: 把缺少、過期或無法解析的重設資料當成滿額視窗，會在資訊不足時全速派送，不符合正式環境的安全降級行為。

**Migration**: 正式視窗資料不完整時改進入 `fallback`，不得略過未知視窗。

### Requirement: Controller SHALL take the more conservative of two curves

**Reason**: 舊 requirement 比較的是逐篇冷卻時間，不是現行兩個視窗的消耗欠額。

**Migration**: 改由「控制器採用較保守的欠額等待」定義較長的追平欠額與固定約束來源。

### Requirement: Controller SHALL naturally stop at quota floor

**Reason**: 舊 requirement 把保留底線寫死為常數快照，並用 `MAX_COOLDOWN` 代替現行重設欠額與有上限的即時複查。

**Migration**: 改由「控制器維持設定的額度保留底線」定義設定底線、零工作行程停止、重設欠額與複查。

### Requirement: Controller SHALL accelerate near window refresh

**Reason**: 舊 requirement 的加速來自逐篇成本／速率公式；現行控制器只判斷實際用量是否超前依時間計算的允許消耗線。

**Migration**: 接近重設時，已經過比例與追平欠額由消耗線 requirements 統一定義，不保留另一套加速公式。

### Requirement: Controller SHALL self-calibrate article cost from history

**Reason**: 舊 requirement 宣稱校準會調整下一次冷卻時間，與正式環境「僅供遙測」政策衝突，且寫死過時的冷啟動數值。

**Migration**: 改由「系統從有效歷史校準單篇成本遙測」保留指數移動平均的可觀測性，但禁止它影響閘門。

### Requirement: System SHALL log every quota reading to quota-history.jsonl

**Reason**: 正式環境是在常駐程式主迴圈生命週期寫入 `tick`、`dispatch`、`complete`，不是每次純 `controller_tick` 或 `--controller-once` 都有副作用。

**Migration**: 改由「系統保存如實的控制器遙測」對齊實際生命週期與盡力寫入的失敗語意。

### Requirement: System SHALL write controller state for observability

**Reason**: 舊文字把所有控制器呼叫都描述成狀態寫入，沒有區分主迴圈與純診斷單次執行。

**Migration**: 改由「系統保存如實的控制器遙測」定義主迴圈決策狀態與單次診斷邊界。

### Requirement: Controller SHALL enforce extra-usage safety valve

**Reason**: 舊 requirement 寫死特定來源與 80% 門檻快照，已不是正式的可設定政策。

**Migration**: 改由「控制器執行設定的額外用量安全閥」依實際啟用狀態、正數上限與設定門檻判斷。

### Requirement: System SHALL preserve legacy fallback

**Reason**: 舊 requirement 寫死過時保留底線，且沒有清楚區分明示舊模式與封閉迴路監測錯誤降級。

**Migration**: 改由「系統保留明示的舊模式降級」定義設定底線、遙測副作用邊界與封閉迴路重試。
