## Why

gu-log 改成「導讀＋評論」後，舊 GP 已下架成墓碑頁，原文副本也清出 HEAD。但公開 repo 的 git 歷史還留著舊版全文翻譯與原文副本。#1111 保留了「用 `git filter-repo` 改寫歷史、徹底抹掉」這個選項。

2026-10-20 的判斷是**不做**：改寫歷史無法回頭，會讓所有 clone、branch、PR、worktree 一起失效；GitHub 的快取與 Vercel 的部署歷史也抹不乾淨，做完仍不能保證「再也看不到」。2026-09-26 已評估風險低：作者要求下架時，通常針對的是看得到的檔案。完整理由與重新評估條件見 `design.md`。

這個 change 把決定寫成 living requirement，之後有人再提改寫歷史，會先撞到這條規則和這份紀錄，不用重吵一次。

## What Changes

- 修改 `post-takedown` 的「公開 repo 的 HEAD SHALL NOT 保留下架譯文與未授權的第三方原文全文」：原本只寫「改寫 git 歷史不在本要求範圍內」，改成明確規定下架與原文清理 SHALL NOT 以改寫 git 歷史達成，並寫出重新評估的觸發條件。
- `design.md` 保留被否決的做法、理由與重開條件。
- 不改任何程式碼、驗證器或 CI。

## Capabilities

### Modified Capabilities
- `post-takedown`：HEAD 清理要求補上「不改寫 git 歷史」的決定與重新評估條件。

## Impact

- Spec：`openspec/specs/post-takedown/spec.md`（archive 時同步）。
- 決策紀錄：`openspec/changes/archive/<date>-reject-git-history-rewrite/design.md`。
- 關閉 #1111（not planned）。
