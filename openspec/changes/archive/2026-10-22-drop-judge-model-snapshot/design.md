# Design

## spec 不寫具體 model ID

model 值會隨 runtime 換代，第一條 requirement 已經寫清楚值從哪裡讀（`.codex/agents/<role>.toml`、VM profile、Claude 備援讀 `.claude/agents/*.md`）。情境只要求 wrapper 跟 canonical command 走同一套路由，換 model 時就不用回頭改 spec。

## 只對齊現況，不動 wrapper 去留

`vibe-scorer.sh`、`tribunal-all-claude.sh` 要不要退役是 #1164 第 2 節另一條 P1 的事，這裡只把情境改成跟現在的 wrapper 一致，不新增或拿掉 wrapper。

## 「寫手和 Vibe 評審同一代 Opus」不寫進 spec

這條是 Claude 路徑的 calibration policy，寫在 `vibe-opus-scorer.md` 的 PIN 註解與 CCC playbook〈鐵則〉，那邊補一句「只適用 Claude 路徑」。本 spec 管的是 provider／model 怎麼解析，不收這條 policy。
