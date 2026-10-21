## Why

`src/data/post-versions.json` 依「碰過這篇文章的非 merge commit 數」算版本。PR 被 squash 之後，分支上的多個 commit 在 main 上只剩一個，main 的 `post-version-manifest` 檢查就會紅（#1135 出過事，靠 #1136 修回）。`scripts/gu-log-auto-merge-guard.sh` 判定只動文章的 PR 可以自動合併，最後卻一律 `--squash`；Tribunal publisher autopilot 也透過它合併文章 PR，所以它是真正會 squash 文章 PR 的地方。主 spec 的 Low-risk 情境也寫「使用 squash merge」，跟這條限制相反（#1164 第 9 節 P0）。

## What Changes

- Guard 合併動到 `src/content/posts/` 的 PR 時改用 merge commit；沒動到文章的 PR 維持 squash。
- Low-risk 情境拿掉「使用 squash merge」，merge method 改由新增的要求決定；「啟用 GitHub auto-merge」改成「合併」，對齊 guard 實際上直接用 `--match-head-commit` 合併、刻意不開 auto-merge 的做法。

## Capabilities

### Modified Capabilities
- `github-ai-automerge-guard`：Low-risk 情境不再寫死 squash；新增「依 PR 是否動到文章選 merge method」要求。

## Impact

- 程式：`scripts/gu-log-auto-merge-guard.sh`。
- 測試：`scripts/tests/test-auto-merge-guard.sh`（CI 透過 `tests/shell-regression-ownership.test.ts` 執行）。
- 文件：`playbooks/CCC-playbook.md`〈Merge method 選擇〉是給 agent 看的規則正本，`playbooks/local-agent-playbook.md` 補指標。
- 長期可評估讓 manifest 的計數不受 merge method 影響（例如只看 main 的 first-parent 歷史）；做到之後這條要求可以拿掉。
