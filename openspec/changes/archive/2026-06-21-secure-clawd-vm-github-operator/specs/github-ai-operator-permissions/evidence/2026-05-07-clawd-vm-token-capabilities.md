# Evidence: clawd-vm GitHub token capabilities

Date: 2026-05-07  
Scope: `secure-clawd-vm-github-operator` / `github-ai-operator-permissions`

## Summary

- clawd-vm 上存在兩條 token lane：
  - gu-log selected-repo token：`/home/clawd/.config/github-tokens/gu-log-operator.token`
  - AI lab broad token：`/home/clawd/.config/github-tokens/shroomdog-ai-lab-operator.token`
- 兩個 token 檔案權限皆為 `600 clawd clawd`。
- gu-log token 可讀 `chitienhsiehwork-ai/gu-log` 與 `chitienhsiehwork-ai/gu-log-api`，其中 `gu-log-api` 是 user-approved scope expansion。
- gu-log token 可讀 Actions workflow metadata，但讀取 repo Actions secrets public key 與 variables 被 GitHub API 拒絕。
- AI lab broad token 可讀 `shroomdog-ai-lab` org，但讀取 private repo `chitienhsiehwork-ai/gu-log-api` 被拒，表示該 broad token 未跨入 gu-log owner lane。

## Evidence Commands

以下命令在 mac-cdx 透過 SSH 到 clawd-vm 執行，沒有輸出 token value 或 token prefix。

```text
host=clawd-vm
gu_log_token_file=600 clawd clawd 93
lab_token_file=600 clawd clawd 93
gu_log_repo=chitienhsiehwork-ai/gu-log
gu_log_api_repo=chitienhsiehwork-ai/gu-log-api
gu_log_workflows_total=5
gu_log_secrets_public_key=denied
gu_log_variables=denied
lab_org=shroomdog-ai-lab
lab_token_gu_log_api=denied
vm_git=## codex-openspec-codex-migration...origin/codex-openspec-codex-migration
```

## Review Notes

- `gu-log-api` scope expansion 不等於原本 gu-log-only wording；spec 已更新為「額外 selected repo MUST 有 explicit human approval 與 evidence」。
- 這份 evidence 只能證明 observed capability，不證明 GitHub UI permission summary 的每個 checkbox；UI summary 仍應保存在 human review 截圖或 issue comment 中。
- 不要在 OpenSpec、machine note、chat、或 repo 裡保存 token value。
