## 1. Spec

- [x] 1.1 Legacy wrapper 情境改成跟 canonical command 用同一套 provider／model 路由，拿掉寫死的 GPT-5.5。
- [x] 1.2 VibeScorer wrapper 要求補上只評分、不改動檔案，情境改成 `tribunal.sh --score-only --only-stage vibe`。

## 2. 文件

- [x] 2.1 AGENTS.md、README、CONTRIBUTING、tribunal-runbook 的 judge model SSOT 改指本 spec。
- [x] 2.2 `vibe-opus-scorer.md` 的 PIN 註解與 CCC playbook〈鐵則〉補上「寫手和 Vibe 評審同一代 Opus 只適用 Claude 路徑」。

## 3. Archive

- [x] 3.1 把 delta 同步進 `openspec/specs/codex-tribunal-runtime/`，change 移到 archive；同一個 PR 一起 commit。
