# Proposal: Tribunal 重寫後讓舊已讀退場

## Why

Tribunal 會把文章重寫成更好的版本，但 Reader Tracker 目前沒有辦法知道「你讀過的是舊稿」。如果重寫後還顯示完全已讀，讀者看到的是安靜的謊話。

## What Changes

- 定義 tribunal rewrite 與 Reader Tracker stale read 的連動語義。
- 只有 reader-visible content 被改到時，才應讓 read-relevant revision 變更。
- 純分數、評審紀錄、後台 metadata 不應吵讀者重讀。
- 明確區分 tribunal runtime version、judge score version、文章 reader-facing revision。

## Capabilities

### New Capabilities

- `tribunal-reader-staleness`：定義 tribunal 改寫文章後，何時應讓 Reader Tracker 視為新版。

### Modified Capabilities

- 無。

## Impact

會影響 tribunal rewrite/publish flow、文章版本產生邏輯、Reader Tracker stale 判斷。這個 change 依賴 `add-version-aware-reader-state`：Reader Tracker 必須已能保存 read revision，tribunal rewrite 才能讓舊 read record 變成 stale read。

## Approval Meaning

批准這個 change 等於同意：tribunal 改到 reader-visible content 時，文章的 reader-facing revision 必須變更，舊 read record 應顯示為 stale read。

不等於同意：把 tribunal runtime version、judge score、模型名稱、score-only metadata 當作文章版本。
