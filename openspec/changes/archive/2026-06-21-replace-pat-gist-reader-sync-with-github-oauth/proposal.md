# Proposal: 用 GitHub OAuth 取代 Reader Tracker 手貼 token 同步

## Why

Reader Tracker 現在已經要求使用者先用 GitHub 登入，卻又在同步閱讀紀錄時要求手貼 private token。這像是人已經進門了，櫃台又叫他回家拿另一把鑰匙，體感很蠢，也把安全責任推給讀者。

## What Changes

- 讓已完成 GitHub OAuth 登入的使用者，可以直接同步 Reader Tracker，不再把手貼 private token 當主要流程。
- 將閱讀紀錄同步改成由 gu-log backend 代理 GitHub 儲存操作，前端只使用 gu-log session。
- OAuth 權限不足時，顯示重新授權同步的路徑，而不是叫使用者建立 PAT。
- 保留舊 token fallback 的 migration / deprecation 規則，但不得讓它蓋過正常登入流程。

## Capabilities

### New Capabilities

- `github-oauth-reader-sync`：定義 Reader Tracker 透過 GitHub OAuth 做遠端同步的產品、權限與錯誤處理契約。

### Modified Capabilities

- 無。

## Impact

會影響 Reader Tracker 同步 UI、前端同步模組、GitHub OAuth backend、舊本機 token 清理策略，以及同步失敗時的提示文字。這個 change 不處理文章版本或 tribunal rewrite；那是後續 changes。

## Approval Meaning

批准這個 change 等於同意：已登入 GitHub OAuth 的讀者，Reader Tracker 正常同步路徑應改走 gu-log session + backend-mediated GitHub storage；手貼 PAT 只能是 legacy / diagnostic fallback。

不等於同意：文章版本 schema、stale read 判斷、或 tribunal rewrite 觸發規則。
