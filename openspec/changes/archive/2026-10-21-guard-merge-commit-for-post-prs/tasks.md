## 1. 實作

- [x] 1.1 `scripts/gu-log-auto-merge-guard.sh` 在 `HAS_POST_CHANGE=1` 時用 `--merge`，其他 PR 維持 `--squash`。
- [x] 1.2 `scripts/tests/test-auto-merge-guard.sh` 用假的 `gh` 錄下實際參數：文章 PR 用 `--merge`、沒動到文章的 PR 用 `--squash`、被拒的 PR 不呼叫 `gh pr merge`。

## 2. 文件

- [x] 2.1 `playbooks/CCC-playbook.md`〈Merge method 選擇〉維持規則正本，`playbooks/local-agent-playbook.md` 的共用清單補一行指過去。

## 3. Archive

- [x] 3.1 把 delta 同步進 `openspec/specs/github-ai-automerge-guard/`，change 移到 archive；同一個 PR 一起 commit。
