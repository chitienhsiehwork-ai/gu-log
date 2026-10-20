## ADDED Requirements

### Requirement: Tribunal SHALL NOT 重評內容沒變的未過關 GP

Tribunal 不會改寫 GP，所以 GP 沒過關後重評同一份內容不會帶來新資訊，只會重擲評審的骰子。`scripts/tribunal.sh` 在 GP 沒過關時 SHALL 把這次評審的讀者可見輸入指紋（zh-tw 與 English 檔的 reader revision）記在進度紀錄的 `FAILED` 項目。Daemon 的選文邏輯 SHALL 跳過指紋仍與目前內容相同的 `FAILED` 項目；只有讀者可見內容改變、Tribunal 版本改變，或操作者手動執行 `tribunal.sh`，該篇才再次被評。指紋無法計算時選文 SHALL 照舊進行，不得因此讓文章永久卡住。非 GP 的有界改寫與重試 SHALL 不受影響。

#### Scenario: 沒改過的 GP 不會被重新領取

- **WHEN** 一篇 GP 在 Tribunal 沒過關，之後內容沒有改動，只有分數寫回 frontmatter
- **THEN** daemon 的選文邏輯 SHALL 跳過它
- **AND** 它的 `topLevelAttempts` SHALL NOT 因 daemon 重跑而增加到 `EXHAUSTED`

#### Scenario: GP 修正後重新排隊

- **WHEN** 沒過關的 GP 的 zh-tw 或 English 正文、或讀者可見 frontmatter 被修改
- **THEN** daemon 的選文邏輯 SHALL 再次選到它
- **AND** `tribunal.sh` SHALL 把它的嘗試次數歸零、四位評審全部重評，不得沿用舊內容累積的次數直接變成 `EXHAUSTED`

#### Scenario: 非 GP 失敗不記指紋

- **WHEN** 一篇非 GP 文章在 Tribunal 沒過關
- **THEN** 進度紀錄 SHALL NOT 留下輸入指紋
- **AND** 它 SHALL 照既有的有界重試規則再被選取
