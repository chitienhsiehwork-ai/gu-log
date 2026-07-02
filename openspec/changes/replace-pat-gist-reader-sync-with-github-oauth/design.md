# Design: GitHub OAuth Reader Sync

## Current shape

Reader Tracker 的登入門已經認得 GitHub 使用者，但同步門還在期待另一把 private token。前端會先嘗試從登入資訊裡挖 GitHub token，挖不到就退回手貼 token。這讓正常使用者看起來像「登入了但沒用」。

## Proposed shape

前端只保留一個身分：gu-log session。同步時，前端呼叫 gu-log backend；backend 用使用者 OAuth 授權去讀寫遠端閱讀紀錄。

這樣讀者不用管理 GitHub token，也不會把同步能力跟一段貼在瀏覽器裡的秘密綁死。

## Backend contract

Reader Tracker frontend SHALL call the configured gu-log API origin, not a fake Astro-local endpoint. The contract should be explicit before frontend migration removes the old path:

- requests use the gu-log session, e.g. `Authorization: Bearer <gu-log-jwt>` or an equivalent session mechanism
- backend owns GitHub OAuth token storage / refresh
- if GitHub storage remains private Gist, backend OAuth must request the required `gist` permission
- missing permission returns a stable machine-readable error such as `GITHUB_SCOPE_MISSING`
- frontend uses that error to show reauthorization, not a PAT setup box

## Permission flow

如果登入時沒有同步需要的 GitHub 權限，Reader Tracker 應該顯示「重新授權同步」。它要像補一張門禁卡，不像叫讀者自己去 GitHub 後台挖一把萬用鑰匙。

## Legacy token handling

舊的本機 token 可以短期保留，避免現有讀者突然斷線。但它應該被標成 legacy，並且在使用者完成 OAuth sync 後可以清掉。

## Non-goals

- 不在這個 change 定義 read version schema。
- 不在這個 change 定義 tribunal rewrite 如何讓已讀失效。
- 不把 AI operator 的 GitHub token policy 混進讀者 OAuth。
