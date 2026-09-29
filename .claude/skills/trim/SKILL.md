---
name: trim
description: 精簡 skill、prompt、playbook、AGENTS.md／CLAUDE.md 等 agent 指令：刪掉沒作用的句子，把難讀的句子改寫成白話。程式碼改用 `/simplify`。
disable-model-invocation: true
---

# trim

刪掉 agent 指令裡沒作用的句子，把難讀的句子改寫成白話。判斷標準見同資料夾的
`noop-brief.md`。

## 流程

1. 每個目標檔開一個新的唯讀子 agent，用目前 runtime 內建的 subagent；
   Codex 使用可用的 multi-agent tool。子 agent 不帶目前的對話，只給它
   `noop-brief.md` 和目標檔這兩個路徑，讓它自己讀。
2. 收回建議，理由相同的合成一項，由主 agent 決定採用哪些。
3. 改動走 PR，逐項寫出刪了或改寫了什麼、為什麼、約省幾行；拿不準的先保留，在 PR
   裡問使用者。

## 邊界

- 寧可漏砍，也別刪掉會改變行為的規則；標 `UNSURE` 的一律保留。
- 改寫只換說法，行為維持原樣。
