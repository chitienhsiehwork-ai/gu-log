# Working tree 衛生與 agent 視野

狀態：`familiar`（情境判斷；決策明確，實作由 agent 執行）

## 證據

- 能辨識「archive 目錄對人是可發現性、對 agent 是同等權重的髒 context」，選擇 git rm + tag 而非留 archive。
- 選單一入口檔時偏好工具中立的 AGENTS.md，讓 CLAUDE.md 只做 `@AGENTS.md` 轉址；主動提出這個做法而非選單內選項。
- 對不確定是否仍需要的憑證（.env）選保留，不因整理慣性冒險刪除。
- 理解 path-scoped staging：共用 worktree 有他人半成品時不用 `git add -A`。

## 下一步

下次自己動手做一次：tag → 按路徑 git rm → git status 核對 staged → commit，不靠 agent。
