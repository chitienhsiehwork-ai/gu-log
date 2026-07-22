## 1. Recovery contract

- [x] 1.1 更新 skill，將既有正式文章缺英文對應檔與正式雙語檔發布，分別路由到正確的 `run --from-step` 指令
- [x] 1.2 將獨立 deploy 說明限縮為全新 PENDING 配號，列出完整必填 flags
- [x] 1.3 將批准規則改為指向 `AGENTS.md` 與偵測出的執行環境 playbook

## 2. CLI help

- [x] 2.1 修正 `deploy` Long help，先列異動前關卡，再列 counter、改名、建置與 git 副作用
- [x] 2.2 說清楚 `--dry-run` 與僅供測試 flags 的實際行為

## 3. Verification

- [x] 3.1 新增小型 help／skill 契約測試，鎖住恢復路由、必填 flags 與關卡順序
- [x] 3.2 跑 gp-pipeline Go tests、OpenSpec ownership 與 repo pre-commit gate
- [x] 3.3 完成獨立 correctness／safety review 與 simplify review
- [x] 3.4 Sync delta spec、archive change，確認 change validation 通過
