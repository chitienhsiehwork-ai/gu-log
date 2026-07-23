# gu-log

> AI/Tech 翻譯 + 原創 blog。把英文好文翻成繁中（GP/MP），ShroomDog 自己的原創文（SD），入門教學（Lv）。附 Mogu 吐槽註解。每篇文章同時產出 zh-tw 和 en 版。
> Live: https://gu-log.vercel.app/

> **這份是 Tier-0：always-loaded 的憲法 + bootstrap + 路由表，所有 agent（Codex、Claude Code、Mogu…）共讀的中性 SSOT。** 細節規則住在 Tier-1 playbook（按身份）和 Tier-2 文件（按主題），本檔只留「永遠要記得的硬規則」+「該去哪讀全文」。Claude Code 專屬的工具細節在 `CLAUDE.md`。

## 🪪 開場第一件事：先確認自己是誰，再讀對應 playbook（Tier 1）

**Codex／Claude Code 的 SessionStart hook 應先注入 `env: agent_id=...` compact context 與 playbook pointer。若開場沒有這段 context、hook 顯示 unavailable，或 project hook 被停用／尚未信任，才明確帶自己的 runtime 手動跑 identity detection**（Codex：`./scripts/detect-env.sh --runtime codex`；Claude Code：`./scripts/detect-env.sh --runtime claude-code`），再讀對應的 playbook。不要依賴 tool subprocess 繼承 ambient runtime env：

| Instance | 跑在哪 | Playbook |
|---|---|---|
| **Local machine actors**（例：`m1-cdx` / `m1-cc`） | user 個人 Mac，互動式 iterate；machine prefix 讓 agent 可被直接 routing | [`playbooks/local-agent-playbook.md`](playbooks/local-agent-playbook.md) |
| **CCC** (Cloud Codex / Cloud Claude Code) | 網頁版，Linux sandbox，auto-branch | [`playbooks/CCC-playbook.md`](playbooks/CCC-playbook.md) |

沒搞清楚身份就動手 = 用錯 SOP（各 env 的 scope ceiling、merge policy、失敗處理都不一樣）。沒有例外，不能跳。Playbook 各自是 SSOT，定義各自的精神、scope ceiling、失敗處理、merge policy、品質 gate。**不要在這個檔案重複那些規則**，有要加規則就去編對應的 playbook 檔。

共通底線（兩邊都不能跳）：commit atomic（一個 commit 一件事）；commit 可追溯到執行的 model——把 model 名放進 `git config user.name`（例 `Claude Fable 5`、`Codex GPT-5.5`），因為 squash merge 的 co-author 取自 git author 身份、訊息尾端同 email 的 Co-Authored-By trailer 會被去重折疊成通用名；品質 gate 全保留（`pre-commit` / `pre-push` / `validate-posts.mjs` / tribunal 一個都不能關）；prod 炸或 main CI broken 立刻修（緊急事件無 scope 之分）；feature branch 完成後 **agent 自己開 PR + 盯 CI**、不留給 human（工具因 runtime 而異，Claude 見 `CLAUDE.md`、Codex 用 `gh`）；**gu-log 內容任務的完成定義是 production URL**——不停在 draft / PR / CI 綠 / preview，預設做到 merge → prod deploy → smoke test、回報可點 URL，只有關鍵內容 / 產品方向決策才停下問。

## 🗣️ 回覆語言：一律繁體中文（zh-tw）

**跟 user 對話一律台灣繁中，不管 user 用什麼語言（英文 / 簡中 / 日文 / 混雜）、就算只回「ok」也一樣**；發現自己跑成英文或簡中就立刻切回。台灣用語（軟體不是软件、程式不是程序）。**英文只留台灣工程師平常講話就會夾的**（identifier / 路徑 / 指令 / config key / model ID / UI label / 專有名詞，還有 user / prompt / commit 這種工程慣用詞）——其餘有現成中文講法的就用中文，別中英夾雜硬湊（晶晶體）：要講「拿一個換一個」，不要講「這手是 objective trade」。句子要像台灣人在講話，不要翻譯腔、不要生硬倒裝，代名詞誰是誰要講清楚。不確定中文怎麼講就先想清楚再寫，別先丟英文佔位。語氣跟 `GU-LOG_WRITER_PROMPT.md` 一致：直接、有梗、不官腔。

例外：commit / PR 文字照 repo 慣例（多數繁中）；code comment / 變數名 / 翻譯輸出照該檔案或任務指定語言（GP/MP 的 en 版當然英文）。

> repo 內所有 `.md` prose 也預設寫繁中（含 OpenSpec / design docs / tasks / runbook）。完整規則見 `CONTRIBUTING.md`〈📝 Markdown 文件語言：預設繁中〉。

## 🚫 絕對不准 `--no-verify`

永不准 `--no-verify` / `--no-gpg-sign`（或任何繞過 pre-commit / pre-push hook 的旗標）。**hook 失敗 = 修 code，或修 hook 本身**（hook 邏輯 / 環境壞了就修它，當成這個 PR 的一個 commit），不是跳過。唯一例外：user 逐次明確授權。

> Deterministic enforcement，不只靠自律：Claude Code 端有 PreToolUse hook 直接 deny；server-side CI（`ci-passed`）在 PR 上重跑 hook 檢查，擋髒 commit 進 main。

## 🧭 SSOT 紀律（摘要 — 全文見 `docs/agent-discipline.md`）

**每個事實只有一個家（SSOT）。動到有 SSOT 的東西時，預設責任是「維持單一真相來源」——不複製事實、發現 drift 當場收斂。** 權威端 = code（含 frontmatter、常數、config、Zod schema）或 openspec spec，**不是散文文件**；playbook / README / 這份 AGENTS.md / 註解 / task prompt 都是 derived view，對不上時散文服從 code/openspec。能判斷哪邊對就自己收 + 回報帶一句，只有「難判斷又是重要決定」才用 `AskUserQuestion` 問。完整四條操作規則、收斂自主姿態、為什麼用 prompt 而非只靠 lint → 見 [`docs/agent-discipline.md`](docs/agent-discipline.md)。

## 📐 寫 prompt / 規則：抓耐久原則（摘要 — 全文見 `docs/agent-discipline.md`）

verbose 散文比抽象規則 drift 得多。抄自真 SSOT 的具體值（event 名、套件名、計數、路徑、版本號）一律**指回 code / YAML**，散文只講 policy / 為什麼。審查用 Keep / Simplify / Drop，目標是少而通用、不易過期。全文見 [`docs/agent-discipline.md`](docs/agent-discipline.md)。

## 🛠️ 順手修 friction + 完全自主（摘要 — 全文見 `docs/agent-discipline.md`）

個人副業 repo，**velocity > stability**。任務過程撞到的所有 friction（環境、hook、lint、驗證器、frontmatter、過時文件）**通通是當前 agent 的責任，當場用 atomic commit 修掉，放進同一個 PR**——不甩給下一個 session、不回頭問 user「要不要順便修」。**最高原則：每個 agent 完全自主，CI 綠 + 改動 safe + 非 critical → 直接 merge，不為了確認而問。** 完整反例、例外（何時可拆 PR）、atomic commit 紀律 → 見 [`docs/agent-discipline.md`](docs/agent-discipline.md)。

## 🏷️ Branch name 是 ID，不是語意

Feature branch 名稱常由沒 gu-log 上下文的 LLM 自動生成，只能當 opaque identifier。**絕對不要從 branch name 推斷 user 想做什麼**——任務意圖永遠以對話內容為準。

## 🔀 Branch policy（2026-04-22 起：預設 feature branch + PR）

預設走 feature branch + PR（命名 `<type>/<scope>-<desc>`，例 `fix/tribunal-badge`）——PR 給清楚的 review surface、讓 Vercel preview 在 merge 前先跑、revert 不沾其他 commit。流程（拉 branch → commit → push + PR → 盯 CI → 綠了自 merge → 刪 branch）是標準動作，solo repo 自己 merge 不等人；branch / merge 細節依 runtime playbook。Tribunal / 自動化 pipeline 同樣走 branch + PR。

- **沒有「直推 `main`」這條路**：main 有 server-side branch protection，直推一律被拒（實測 403，連 doc typo 也一樣）。緊急修復（prod 炸 / main CI broken）走同一條 branch + PR + auto-merge 流——CI 綠了自動合，實務上跟直推一樣快，不要浪費時間嘗試繞過。
- **PR size discipline**：gu-log PR 不必為「讓 human 逐行看」刻意切小。review 主要由 agent 跑，human 看結論 / risk surface / CI / evidence。重點是 OpenSpec / tests / evidence / revertability 清楚，PR 大小本身不是問題。

## 🧭 主題路由表（要做某件事 → 先讀這份）

| 要做的事 | 先讀哪份文件 |
|---|---|
| **寫 / 翻譯文章（GP/MP/SD/Lv）、ticketId SOP、防重複、frontmatter schema、source evaluation、事實查核** | [`CONTRIBUTING.md`](CONTRIBUTING.md)（內容規則 SSOT） |
| **寫作風格（PTT 說故事風、Mogu 吐槽語氣、persona、術語處理、翻譯誠實性、GP/MP 翻譯鐵則、Sentence Signal、Style Guide）** | [`GU-LOG_WRITER_PROMPT.md`](GU-LOG_WRITER_PROMPT.md)（寫作風格 SSOT） |
| **品質門檻（兩層 floor/PASS gate）** | [`CONTRIBUTING.md`](CONTRIBUTING.md)〈🎯 兩層品質門檻〉 |
| **Tribunal（4-judge 評審、跑法、daemon、worker worktree）** | [`docs/tribunal-runbook.md`](docs/tribunal-runbook.md) |
| **GP/MP 自動翻譯 pipeline（`gp-pipeline` 用法、subcommand、exit code）** | [`tools/gp-pipeline/SKILL.md`](tools/gp-pipeline/SKILL.md) |
| **User 丟 URL → 預設寫 GP**（pipeline 用法 + 何時手動） | [`tools/gp-pipeline/SKILL.md`](tools/gp-pipeline/SKILL.md) + 下方〈URL = GP〉 |
| **Draft 來源 / Obsidian import** | [`OBSIDIAN_SETUP.md`](OBSIDIAN_SETUP.md) |
| **Dev / Build（tech stack、architecture、指令）** | [`docs/dev-reference.md`](docs/dev-reference.md) |
| **用 openspec 做事（跑 `/opsx:propose`、動到有 spec delta 的 change）** | [`.agents/openspec-sdlc.md`](.agents/openspec-sdlc.md)（端到端流程 SSOT：九階段 / 三角色 / 人類檢查點 / archive gate）— MUST 動手前先讀 |
| **OpenSpec spec / change（讀既有 spec、change 結構）** | [`openspec/`](openspec/) |
| **agent 跨領域行為規則（SSOT 紀律、verbosity-drift、順手修 friction 全文）** | [`docs/agent-discipline.md`](docs/agent-discipline.md) |
| **動手建機制前先審「該不該做」（對抗式 reviewer subagent、何時跑、不做就記成決策）** | [`docs/value-review-runbook.md`](docs/value-review-runbook.md) |
| **ShroomDog 修稿回饋 corpus** | [`docs/shroomdog-editorial-feedback.md`](docs/shroomdog-editorial-feedback.md) |

### 🔗 User 丟連結 = 要寫 GP（預設走 pipeline，不要手動寫）

**User 只丟 URL 時，預設意圖是寫 GP**，不要改猜成 summary / bookmark / about page。預設跑 `tools/gp-pipeline/gp-pipeline run <url>`（包辦 fetch → eval → dedup → write → review → refine → credits → ralph → deploy）；除非有明確 blocker，**手寫 GP 是 anti-pattern**。

完整用法 / flag / exit code / 何時手動 / 抓原文 fallback 見 [`tools/gp-pipeline/SKILL.md`](tools/gp-pipeline/SKILL.md)。不要用 `web_fetch` 摘要直接寫文，先抓完整 source（各 runtime 有自己的 fetch skill）。

## 文件架構（誰讀什麼）

`AGENTS.md` 只放 Tier-0 憲法 / bootstrap / 路由表；`CLAUDE.md` 補 Claude Code 專屬細節。Tier-1 = `playbooks/` 依 runtime 分流；Tier-2 = 主題 SSOT（`CONTRIBUTING.md`、`GU-LOG_WRITER_PROMPT.md`、`docs/agent-discipline.md`、`docs/dev-reference.md`、`docs/tribunal-runbook.md`、`tools/gp-pipeline/SKILL.md`…，逐項見上方路由表）。完整檔案樹是 repo layout 的副本、會 drift——要找檔用 `rg --files`，不在 Tier-0 常駐一棵樹。

操作這個 repo 的 agent：local machine actor（例如 `m1-cdx` / `m1-cc`）或 CCC 先讀本檔 → `detect-env.sh` → 對應 playbook → 按主題讀 Tier-2；Mogu（OpenClaw runtime）先讀 runtime-local `AGENTS.md`，再讀本 repo 的 `scripts/mogu-picks-prompt.md`。兩條路最後都指向 `CONTRIBUTING.md` 和 `GU-LOG_WRITER_PROMPT.md`。**改規則只改 SSOT 來源檔，不要在 Tier-0 或 task prompt 複製一份。**

## Quality: Vibe Scoring + Tribunal

品質管理用 4-judge tribunal（Vibe Scorer / Fact Checker / Librarian / Fresh Eyes）；任何新增或實質改寫文章都要跑、結果寫回 frontmatter。**不在 Tier-0 複述維度 / 分數門檻 / model 版本（複述 = drift 源）**——judge model SSOT = `.claude/agents/*.md` 的 `model:` frontmatter，評分標準 = `scripts/vibe-scoring-standard.md`，兩層門檻（floor ≥3 ship / PASS ≥8 上首頁）見 [`CONTRIBUTING.md`](CONTRIBUTING.md)〈🎯 兩層品質門檻〉，跑法 / daemon / worker worktree 見 [`docs/tribunal-runbook.md`](docs/tribunal-runbook.md)（特別是 worker worktree 不會跟 main 自動更新、要手動 sync 的雷）。
