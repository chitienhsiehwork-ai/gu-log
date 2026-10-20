# Design — reject-git-history-rewrite（決策紀錄）

> **這是決策紀錄，不是實作。** 目的是下次有人想改寫 git 歷史時，不必從頭再分析一次。`post-takedown` 裡的 living requirement 是絆線，這份檔案是絆線指向的理由。

## 起因

gu-log 不再公開全文翻譯：舊 GP 下架成墓碑頁，`sources/` 與測試資料裡的原文副本也清出 HEAD。但 repo 是公開的，git 歷史仍保留每篇文章的舊版全文翻譯和原文副本；文章頁的「查看修改歷史」也連得到舊版。#1111 提議用 `git filter-repo` 這類工具改寫歷史、force-push，再請 GitHub 清掉舊快照。

## 決定：不改寫歷史

2026-10-20 決定不做，理由：

1. **無法回頭**：改寫後所有 commit SHA 都換掉，做錯了沒有退路。
2. **會弄壞所有進行中的工作**：每個 clone、branch、open PR、worktree（包括 Tribunal worker 的 worktree）都會失效，要逐一重建；平行工作的 agent 很多，代價很高。
3. **還是抹不乾淨**：舊 commit 可能還能用 SHA 網址看到，要另外請 GitHub support 清；fork、別人的 clone、Vercel 的歷史部署也不在我們能清的範圍。做完仍無法保證「再也看不到」，卻已經付了全部代價。
4. **風險低**：2026-09-26 已判斷，作者要求下架時，通常針對的是看得到的檔案；網站上的墓碑頁與 HEAD 清理已經處理這部分。
5. **依賴歷史的 manifest 要重算**：`src/data/post-versions.json` 等由 git 歷史產生的資料都會變動，連帶影響文章版本號。

## 被否決的做法

- `git filter-repo` 改寫全部歷史 + force-push + 請 GitHub support 清快取（#1111 原提案）。
- 先清光 open PR／branch 再改寫（#1111 的前提）：只降低第 2 點的代價，第 1、3 點不變。

## 什麼時候重新評估

**原作者實際要求移除**，而且要求的內容只存在於 git 歷史（HEAD 與網站都已經沒有）時，再針對那份內容重新評估。屆時要修改 `post-takedown` 的對應 requirement，並說明上面的理由為什麼不再成立。
