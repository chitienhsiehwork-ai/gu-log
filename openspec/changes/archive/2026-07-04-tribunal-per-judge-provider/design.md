## Context

Tribunal provider 解析全部 funnel 進一個全域函式 `tribunal_llm_provider()`（`scripts/tribunal-helpers.sh:379`），它只看 `TRIBUNAL_FORCE_PROVIDER` env 與 PATH，忽略 `agent_name`。呼叫鏈裡 `agent_name` 早就一路傳到底，唯一忽略它的就是這個 provider 解析：

```
run_stage(agent_name)                       [tribunal.sh:711]
  ├─ tribunal_llm_model_id(agent_name)       [helpers:474]  ─┐
  ├─ tribunal_runner_label(agent_name)        [helpers:501]  ├─ 內部都呼叫 tribunal_llm_provider() (全域)
  └─ tribunal_llm_exec_watchdog(agent_name)   [tribunal.sh:846]
        └─ tribunal_llm_exec_raw(agent_name)  [helpers:605]  ┘
              ├─ claude → tribunal_claude_exec → tribunal_claude_agent_model(agent_name) 讀 .claude/*.md model:
              └─ codex  → tribunal_codex_exec(agent_name)
```

repo 現行設計刻意分離兩個 SSOT（`scripts/vibe-scoring-standard.md`〈Model 配置策略〉）：**`.codex/agents/*.toml` = Codex runtime SSOT**（全 `gpt-5.5`、被 `test-tribunal-safety-contract.sh:95` 鎖住），**`.claude/agents/*.md` = legacy rubric**，明文「不能拿來當 Codex runtime selector」。這個分離必須尊重。

## Goals / Non-Goals

**Goals**
- VibeScorer 在 mac/VPS（codex 可用）跑 Claude Opus 4.5；Librarian / FactChecker / FreshEyes 維持 Codex/GPT-5.5。
- 沒設 mixed provider 時，所有現有 caller（daemon、publisher、batch-runner、vibe-scorer.sh…）行為 byte-for-byte 不變。
- 記錄誠實：混 provider 後 frontmatter `scores.*.model` 與 progress ledger runner_label 各 judge 各自誠實。
- 收斂 `.claude` pin（opus-4-5）vs `.codex`/config 表（gpt-5.5）對 vibe runtime 的 SSOT 矛盾。

**Non-Goals**
- 不做 frontmatter-driven provider inference / provider DSL（一次需求不發明通用機制）。
- 不改 `.codex/agents/*.toml`、不改三個客觀 judge 的 `.claude/*.md`。
- 不讓 quota controller 管理 Claude quota（維持 gates Codex only，只補誠實 log/doc）。
- 不動 CCC 全 Claude fallback 行為。

## Decisions

### D1：新增 `tribunal_judge_provider(agent_name)`，硬編 vibe 特例（否決 frontmatter-driven）

resolver 語意：
```
tribunal_judge_provider(agent_name):
    if agent_name == "vibe-opus-scorer":  return "claude"   # 但仍受 availability + TRIBUNAL_FORCE_PROVIDER 約束
    else:                                  return tribunal_llm_provider()   # 委派全域，行為不變
```
**為什麼不 frontmatter-driven**：用 `.claude/*.md model:` 當 provider 依據會把 runtime SSOT（`.codex/*.toml`）與 rubric SSOT（`.claude/*.md`）綁回一起，破壞刻意的分離、撞 safety-contract 測試，日後 drift 更陰險（Codex second opinion 一致）。硬編單一特例符合 repo「velocity > stability、少而通用」；等第二個 judge 也要混搭時再抽成小 map。

### D2：availability 與 force-override 的優先序

`tribunal_judge_provider` 回傳的是**偏好**，最終仍過 availability：
- `TRIBUNAL_FORCE_PROVIDER` 設了 → 全域覆寫**所有** judge（含 vibe），保留 emergency / A-B test 能力，優先序最高。
- vibe 偏好 claude 但 claude binary 不在（極端 box）→ 落既有 availability fallback。
- 三個客觀 judge 偏好 codex 但 codex 不在（CCC）→ 既有 fallback 到 claude，讀各自 `.claude/*.md`。

### D3：watchdog quota / fallback 判斷改吃同一 resolver

`tribunal-helpers.sh:1040/1044` 的 watchdog 現用全域/force provider 判斷「這是不是 codex quota 用盡、要不要 Claude fallback」。per-judge 後**必須改用 `tribunal_judge_provider "$agent_name"`**，否則 VibeScorer 的 Claude 執行失敗會被誤判成 Codex quota 而觸發錯誤 fallback。這是本 change 最容易埋雷的整合點。

### D4：全域 label 改成 availability summary

`tribunal.sh:1129` 的 `TRIBUNAL_PROVIDER` 現在是「唯一 provider」，混 provider 後不誠實。改成「可用 provider summary」只做 preflight（至少一個 provider 在 PATH）＋粗略 log；每 stage 真實 provider 一律以 `actual_provider_file`（已存在的機制）為準寫入 ledger / frontmatter。

## Risks / Trade-offs

- **下游假設「一篇一 model」**：混 provider 後同一篇 `scores.*.model` 會出現 `claude-opus-4-5` 與 `codex-gpt-5.5-medium` 並存。這是**正確且更誠實**的，但 calibration / metrics 消費端若假設單一 model 需檢查（apply 階段驗證 EMA 是 dispatch→complete 整篇差值、不 per-model，故不受影響；但 doc 要講清楚）。
- **quota telemetry**：VibeScorer 移出 Codex → daemon 的 OpenAI 單篇成本 EMA 會下降，且 Claude quota 不受 controller 管。可接受，但 log/docs 誠實標「controller gates Codex only」。
- **成本轉移**：mac/VPS 每篇多一次 Claude Opus 4.5 呼叫（吃 Claude subscription quota）。這正是 owner 要的品味一致成本，非 bug。
- **測試更新面**：`test-tribunal-safety-contract.sh` 有斷言鎖 vibe 走 codex-gpt-5.5，本 change 必須同步改，否則 CI 紅。屬預期。
