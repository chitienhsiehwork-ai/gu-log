## Context

本機 repo 已有一批未提交的 sp-pipeline Codex migration diff，但使用者指出真正要接手的是 clawd-vm gu-log stash。已確認 VM 上相關 stash 如下：

- `stash@{1}`：`WIP sp-pipeline codex-only migration - needs naming/fake cleanup`
- `stash@{2}`：`WIP tribunal v4 codex runner and librarian packet - needs vibe-scorer fix`
- `stash@{2}^3`：包含 untracked `scripts/tribunal.sh` 與 `scripts/tribunal-librarian-packet.py`

這代表 migration 的 source of truth 是 VM stash，本機 dirty diff 只能作為 reconcile 參考。

## Goals / Non-Goals

**Goals:**

- 將 VM stash 轉成 reviewable branch/worktree，保留原作者脈絡。
- 統一 sp-pipeline 與 tribunal runtime 到 `codex exec --model gpt-5.5`。
- 保留 clean output capture，避免 CLI logs 污染文章或 judge JSON。
- 讓 librarian 在審稿時看到 deterministic old-post evidence，優先要求 citation 與新 POV。
- 建立人物 glossary SSOT，讓文章不要每次重新介紹 Andrej、Simon、Boris。

**Non-Goals:**

- 不在規格 commit 內直接改正式文章。
- 不直接 pop stash 到 `main`。
- 不以本機 dirty diff 覆蓋 VM stash。
- 不處理 clawd-vm GitHub token 權限；那屬於 `secure-clawd-vm-github-operator`。

## Decisions

### 1. VM stash 是 migration baseline

**Decision:** 實作時先在 VM 或本機建立 disposable branch/worktree，從 `stash@{1}` 與 `stash@{2}` materialize 工作，再與本機必要改動 reconcile。

**Rejected alternative:** 直接從本機 dirty diff 繼續。  
**Reason:** 會重做 Iris/Clawd 已經完成的工作，也可能丟掉 stash 內的 librarian packet 與 runner wrapper 設計。

### 2. Canonical tribunal entrypoint becomes `scripts/tribunal.sh`

**Decision:** 採用 `scripts/tribunal.sh` 作為 canonical runner；`scripts/tribunal-all-claude.sh` 只保留 compatibility wrapper。

**Rejected alternative:** 繼續改舊檔名。  
**Reason:** 舊檔名會讓 runtime 語意持續卡在 Claude，後續維護容易誤判。

### 3. Codex output capture is mandatory

**Decision:** sp-pipeline 與 tribunal 的 Codex runner MUST 使用可靠 output capture。若可用，優先用 `codex exec -o <tmp>`；否則必須有等效 extractor / score file protocol。

**Rejected alternative:** 直接信任 stdout。  
**Reason:** Codex CLI 可能輸出 banner、skill warning、log line；文章和 JSON 都不能靠「看起來應該乾淨」當資料格式。

### 4. Librarian gets deterministic evidence first

**Decision:** `tribunal-librarian-packet.py` 先掃 glossary、internal links、similar old posts、same source，讓 librarian 以 packet 為主，再 targeted read 3-6 篇舊文。

**Rejected alternative:** 叫 LLM 每次全庫搜尋。  
**Reason:** 成本高、不穩定，也容易漏掉該 cite 的舊文。

## Risks / Trade-offs

- **stash index drift** → 實作前用 stash subject 與 commit id 雙重確認。
- **wrapper 指向 missing file** → materialize `stash@{2}^3` 的 untracked files 後才改 wrapper。
- **judge 自報 model 不可靠** → frontmatter model 由 runner 寫入 `gpt-5.5`，不信 judge 自述。
- **librarian 過度阻擋新文** → policy 要求「similar + new POV + citation」即可通過，不把相似題材直接退稿。
- **本機 dirty diff 污染 migration** → 實作 branch 只 cherry-pick 明確需要的本機修正。

## Migration Plan

1. 建立 implementation branch/worktree。
2. 從 clawd-vm 匯出或 materialize `stash@{1}` 與 `stash@{2}`。
3. 先 commit OpenSpec artifacts。
4. 再照 tasks 分批套 sp-pipeline、tribunal、librarian、glossary。
5. 跑 unit tests、single-stage tribunal smoke、Andrej SP draft smoke。
6. 若 runner 出問題，保留舊 wrapper 可快速回退到先前手動流程。

## Open Questions

- `codex exec -o` 在 clawd-vm 安裝版本是否可用；若不可用，實作時改用 score file protocol / tolerant extractor。
- `tribunal.sh` 的 `--sandbox danger-full-access` 是否在 VM runner 上保留，或改成更小權限。
