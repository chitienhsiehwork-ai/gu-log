---
name: trim
description: Hunt and cut no-ops from a skill / prompt / agent-instruction file using fresh-eyes sub-agents. Use when the user wants to simplify, trim, declutter, or shrink a skill or prompt, or asks "is this prompt bloated", "remove the no-ops", "this skill is too verbose". Spawns one skeptic sub-agent per target file that runs the no-op test line by line (delete it — does the agent's behavior change? no → cut) and returns a punch list of candidate cuts; the main agent reviews and applies via PR, never silently. Named `trim` to not collide with the built-in `/simplify` (which trims CODE, not prompt prose).
---

# trim

砍掉 skill / prompt / agent-instruction 檔裡的 **no-op**——那些不管刪不刪、都不會改變 agent 行為的句子。原則（no-op test vs drift、典型 no-op 長相）是 `docs/agent-discipline.md` §📐 的 SSOT，**這裡不複述**，只定義怎麼用 sub-agent 系統化地跑。

## 何時用 / 不用

- **用**：user 說某個 skill/prompt 太肥、要精簡、要 declutter；或剛寫完一個 skill 想自我審查；或定期掃 `.claude/skills/*`。
- **不用**：改 **code** 的精簡 → 內建 `/simplify`。文章散文 → tribunal。這把刀只對 **agent 指令類散文**（SKILL.md、playbook、prompt、CLAUDE.md/AGENTS.md 這種）。

## Workflow

1. **定目標**。User 指定哪個檔 / 哪個 skill；沒指就問或掃整個 `.claude/skills/`。一個目標檔 = 一個 sub-agent。
2. **Fan-out skeptic sub-agents**（`Agent` tool，`general-purpose` 或 `Explore` 皆可；無 model-pin 需求所以不必走 script）。每個 sub-agent 拿**一個檔 + 下面的 brief**，**零 parent context**——它不該知道每行「為什麼在那」，才測得出哪行其實是空話。多檔就一個 message 多個 Agent call 並行。
3. **收 punch list**，自己過一遍（sub-agent 會誤殺 load-bearing 行——尤其專案特有事實、指回 SSOT 的值）。
4. **改動走 PR**，逐項列「砍什麼 / 為什麼是 no-op / 省多少」，**絕不靜默亂砍**。爭議行留著、標記、問 user。

## 交給每個 sub-agent 的 brief（逐字給，別加 parent context）

> 你是審稿 skeptic。這個檔是 agent 指令（skill / prompt / playbook）。**預設每一行都是 no-op，要它自己證明 load-bearing。** 逐行 / 逐段分類：
>
> - **CUT — no-op**：刪掉 agent 行為不會變的句子。典型 = agent 預設本來就會做的事（「要 thorough」「commit 要詳細」「實作要好讀」「仔細思考」「注意 edge case」）、客套、把通用 best-practice 再講一遍。
> - **CUT — drift**：把抄自別處 SSOT 的具體值（計數、路徑、版本、event 名、套件名）留在散文裡的——該指回來源、不留第二份。
> - **KEEP — load-bearing**：刪了 agent 行為**會變**的才留。專案特有事實、非顯而易見的 policy、具體指令 / 旗標 / 路徑、明確的反例與 gotcha、改變預設行為的指示。
>
> 判準只有一條：**「刪掉這行，agent 輸出會不會變？」** 不變就 CUT。不確定就標 UNSURE 別亂砍。
>
> 回傳每個 candidate：被引用的原文（一句或一段）+ verdict（CUT-noop / CUT-drift / KEEP / UNSURE）+ 一句理由 + 粗估省下 token。最後給「原檔約 N 行 → 砍後約 M 行」。

## 鐵規

- **Sub-agent 是 recommender，不是 committer**——它回報 candidate，砍不砍主 agent 決定。
- **寧可漏砍別誤殺**：load-bearing 行被砍會讓 skill 壞掉、比留個 no-op 嚴重得多。UNSURE 一律留。
- **吃自己狗糧**：這份 SKILL.md 本身也該過 no-op test。
