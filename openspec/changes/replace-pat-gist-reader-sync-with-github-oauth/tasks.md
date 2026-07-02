# Tasks

## 0. Contract gate

- [ ] 0.1 定義 reader sync backend contract：API origin、auth 方式、remote storage 行為、錯誤碼、reauthorization URL。
- [ ] 0.2 backend endpoint 尚未部署或 mock 前，frontend SHALL NOT 移除 legacy PAT fallback；只能把它降級成 legacy / advanced path。

## 1. Sync architecture

- [ ] 1.1 確認 backend 可用 GitHub OAuth token 讀寫使用者的遠端閱讀紀錄。
- [ ] 1.2 新增或串接 Reader Tracker sync endpoints，前端只用 gu-log session 呼叫。
- [ ] 1.3 前端停止把手貼 token 當正常登入使用者的主要同步入口。

## 2. Permission and UX

- [ ] 2.1 OAuth 權限不足時顯示重新授權同步 CTA。
- [ ] 2.2 區分權限不足、登入過期、遠端服務失敗與 rate limit。
- [ ] 2.3 提供 legacy token 清理或轉換路徑。

## 3. Verification

- [ ] 3.1 已 GitHub 登入但未貼 token 的使用者可以同步。
- [ ] 3.2 權限不足時不顯示「請貼 PAT」作為主要路徑。
- [ ] 3.3 `openspec validate replace-pat-gist-reader-sync-with-github-oauth --strict` 通過。
