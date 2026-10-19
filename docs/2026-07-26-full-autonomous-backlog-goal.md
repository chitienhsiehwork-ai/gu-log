# 目標：清空 gu-log 的 safe-autonomous backlog，全部收尾到正式環境

## 任務

把 gu-log 當下所有「不需要 ShroomDog 做產品、品牌、編輯方向或權限決策，而且能靠現有 SSOT、測試、CI 與正式環境證據客觀驗收」的工作做完。

不要只照這份文件的 launch-time 數字硬跑。起跑時先建立一份 fresh launch manifest，範圍是當下已存在的 GitHub / OpenSpec / repo / 正式環境 工作，以及下方指定 audit surfaces 的客觀輸出。執行期間只把新出現的 P0、由本 目標 造成的 回歸問題、或完成 launch manifest 所必需的 dependency 納入；其他起跑後才出現、彼此獨立的非 P0 bug、maintenance、issue、feature 或 content idea，一律只記進 #585 的下一輪 queue，避免 目標 變成永不結束的 moving target。需要 human decision 的項目，要完成能自主做的調查、rebase、驗證或 option framing，留下單一清楚 checkpoint，然後繼續下一項，不要讓整條 目標 卡住。

真正完成的終點是：

1. live safe-autonomous queue 已清空；
2. 所有能 ship 的改動都已 merge、deploy，並通過正式環境 smoke test；
3. tracking issue #585 已更新成 current-state dashboard；
4. 剩下的每一項都已完成 autonomous prework，而且確實只剩具體 human decision。若仍有 safe-autonomous 項目被外部阻礙卡住，目標只能 pause，不能 COMPLETE。

## Launch-time baseline（只作為漂移偵測，不是 SSOT）

2026-07-26 起跑前的 fresh snapshot：

- `origin/main`: `731b02e1092b50286cfbf18f2516a37066ef3920`
- open issues: 17
- open PRs: 3，皆為 draft（#738、#691、#579）
- active zh-tw posts missing an English sidecar: 26
- active OpenSpec changes: 1（`add-editorial-spine-rebuild`，只有 proposal / spec，0 tasks）
- Codex weekly remaining: 97%
- Claude weekly remaining: 90%
- #585 body 仍停在 `main @ da8c80ff`，因此已知需要重新對帳
- 最新 Nightly run `30146630166` 的 `coverage-ratchet → Run stable Playwright tests with coverage` 失敗；較新的 main Fast Gate / CodeQL / post-deploy smoke 全綠，尚不能判定是目前的回歸問題或舊 SHA flake

執行 agent MUST 在開始時重跑所有 discovery command；上面任何數字或 SHA 對不上時，以 live state 為準並更新 #585，不得硬把 repo 拉回快照。

## Bootstrap 與 SSOT

開始任何修改前：

1. 讀 `AGENTS.md`，跑 `./scripts/detect-env.sh --runtime codex`，讀偵測結果對應的 Tier-1 playbook。
2. 確認 runtime 符合 `package.json#engines` 的 Node 範圍；版本 SSOT 不在本文件重複。目前 system Node 是 26，不受支援；本機已驗證 `npx --yes --package=node@22 --call 'node --version && pnpm --version'` 會提供 Node `v22.23.1` + pnpm `10.29.3`，測試、build 與 `git commit`（讓 hooks 也吃到 Node 22）都從這個 ephemeral shell 執行。若 runner 失效，記 外部阻礙；不改 system Node、系統權限，也不得用 Node 26 的 timeout 當 repo bug。
3. 讀 `docs/agent-discipline.md` 與當前工作主題的 Tier-2 SSOT。
4. 內容／翻譯工作先讀：
   - `openspec/specs/editorial-charter/spec.md`
   - `CONTRIBUTING.md`
   - `GU-LOG_WRITER_PROMPT.md`
   - `docs/shroomdog-editorial-feedback.md` 的近期相關條目
   - `tools/gp-pipeline/SKILL.md`
5. OpenSpec 工作先讀 `.agents/openspec-sdlc.md`；不得跨過 human checkpoint。
6. 建新機制或 reader-facing interaction 前，依 `docs/value-review-runbook.md` 做 value review。
7. 使用 repo 已安裝的 `backlog-sweep`、`quota`、`uiux-auditor`、OpenSpec 與其他相關 skills；不要手動複製它們已經定義的流程。
8. 對 `node`、`pnpm`、`gh`、`vercel`、`openspec`、`codexbar`、Playwright 與 gp-pipeline 做 exact command / version / read-only auth preflight。缺少 binary、GitHub / Vercel auth、exact-tree inspection 能力或 pinned prose owner invocation 時，記 外部阻礙；不自行安裝、登入、改權限或替換工具。

## Safe-autonomous 的判定

一項工作只有同時符合以下條件才可自行實作與 merge：

- 需求與成功條件能從現行 code、stable OpenSpec、既有 issue acceptance criteria、測試或已拍板的 user feedback 得出。
- 不需要替 ShroomDog 選產品方向、內容主題、品牌 taste、公開時機、權限範圍或長期投資順序。
- 可以寫出會先失敗、修完會通過的 回歸測試，或有同等強度的 deterministic verification。
- side effect 僅限本 repo、此 repo 的 GitHub issues / PRs、既有 Vercel gu-log project 與 canonical 正式環境 alias。
- 能遵守 feature branch、品質 gate、CI、exact-tree deployment 與 正式環境 smoke 的完整交付定義。

以下不算 safe-autonomous：

- credentials、secret rotation、billing、付費升級、帳號權限、DNS 或第三方 access scope；
- force-push、破壞性 Git、刪除未確認資料、改寫 remote history；
- 新系列、首頁內容排序、品牌 voice、正式發布時機、長期 feature 投資順序；
- glossary / accepted-English boundary 等由 ShroomDog owner-pin 的語感決策；
- 只有「看起來可以更好」但沒有 issue、使用者 evidence、失敗 invariant 或可驗證價值的 cleanup；
- sibling repo、VM 或個人環境的 mutation。若 live incident 指向這些系統，先留下 evidence-backed 阻礙，不自行擴 scope。

Reader-facing 視覺／互動若明顯是 taste call，先做到 evidence / options + 一個具體問題；只有 user 或既有 acceptance criteria 已選定 prototype 方向時，才做到 bounded prototype + preview，且不自行 merge。若只是既有設計契約的客觀 bugfix，且 dual-theme、mobile、accessibility、fresh-eyes audit 與 CI 全過，依 playbook 自行 merge。

## 授權與硬邊界

### 已授權

- 在 repo 內建立 `codex/<scope>` feature branches。
- 修改與 safe-autonomous 項目直接相關的 repo files。
- atomic commit、push、開 PR、處理 review / CI、CI 綠後 merge。
- 更新 #585 與相關 issue / PR 的 current-state evidence。
- 對「已由 正式環境 evidence 證明完成」或「明確 duplicate」的 issue 留證據後 close。
- 使用既有 Vercel project 建 preview、檢查 deployment、在 exact-tree contract 成立後完成 正式環境 release / alias 與 smoke test。
- 若 Vercel free-tier rate limit 暫時阻擋，轉做其他 safe 項目；額度恢復後重試，不用空 commit 製造 deployment。

### 未授權

- `--no-verify`、`--no-gpg-sign` 或任何繞過 hook / CI 的做法。
- force-push、hard reset、discard 他人修改、刪 remote branch、改寫已發布 commit。
- 改 secrets、billing、account permission、DNS、sibling repos，或「已授權」清單以外的 external system / data。
- 替 human-decision 項目拍板或把 prototype 當正式方向 merge。
- 為了清空數字而關閉沒有完成證據的 issue。

### Codex commit identity

每個 Codex commit 前確認：

```bash
git config user.name "Codex GPT-5.6-Sol (Ultra)"
git config user.email "codex@openai.com"
```

若 commit message 使用 co-author trailer，Codex trailer MUST 精確為：

```text
Co-authored-by: Codex GPT-5.6-Sol (Ultra) <codex@openai.com>
```

不得再寫成泛稱 `Codex GPT-5`，也不得漏掉 effort level。

## Fresh discovery

起跑、每一個 wave 結束、以及宣告完成前都要重跑：

```bash
git fetch origin main
git status --short --branch
git rev-parse origin/main
node -p "process.version"
gh issue list --state open --limit 200
gh pr list --state open --limit 100
gh issue view 585
openspec list --json
node scripts/check-translation-pairs.mjs
rg 'TRIBUNAL_VERSION=' scripts/tribunal*.sh
codexbar usage --provider both --source cli
```

並檢查：

- main CI / nightly 是否有新 回歸問題；
- Vercel canonical 正式環境 是否健康、目前 artifact 是否對應最新已發布 tree；
- repo 是否有 deterministic validator、security gate、manifest freshness 或 build failure；
- open PR 是否有可客觀解除的 behind / conflict / transient provider 阻礙；
- issue / PR / OpenSpec 之間的 dependency 是否已變動。

不要用 branch name 猜任務。每條 branch / PR 都要讀 body、diff、comments、checks 與目前 base。

Fresh discovery 完成後，立即在 #585 留一則 immutable launch manifest comment，至少包含：

- `goal_started_at`、exact `origin/main` SHA、canonical 正式環境 deployment / tree；
- 每個項目的穩定 ID、來源 URL / file、分類（safe-autonomous / 暫時性阻礙 / human decision / noise）、falsifiable success criterion、dependency；
- UI audit 的固定 candidate inventory、產生它的 discovery query、caller / theme / surface 範圍；
- launch-time issue / PR / OpenSpec / translation-pair counts；
- 執行期間納入新項目的三種合法理由：new P0、目標造成的回歸問題、launch 項目的必要 dependency。

Manifest 的可枚舉 universe 固定為：

- 起跑當下所有 open GitHub issues / PRs，以及 #585 body / comments；
- `openspec list --json` 的 active changes，加上本文件 P3 / P5 已列出的 stable-spec drift；
- latest main Fast Gate、CodeQL、Nightly、post-deploy smoke 與 canonical Vercel deployment；
- `check-translation-pairs`、Tribunal version scan、`validate:posts`、Astro check、dependency / security、manifest freshness 與 taxonomy / spec-ownership 的輸出；
- UI 只掃一次 `src/components/**/*.{astro,css,ts,js}` 與 `src/styles/**/*.css` 的 literal color / theme-token candidates，將 exact query、完整 candidate list、caller 與 no-change / patch 判準寫進 manifest 後 freeze。

除 new P0、目標造成的回歸問題與 manifest dependency 外，不再另跑無界 TODO / branch / historical-content 掃描擴大本目標。

後續可以在新 comments 更新狀態，但不得改寫 launch manifest 來掩蓋漏項。最後 sweep 只對帳這份 manifest、三種合法新增項與其中派生的 fixed inventory；起跑後新增的獨立 idea 留給下一輪。

## 執行順序

### P0：正式環境與 main 健康

任何正式環境回歸問題、main CI breakage、security gate failure 或 canonical deployment drift 都立即升到最高優先。先 forward-fix 到正式環境，再回來做 backlog。

起跑時先對最新 Nightly failure 做 current-main 重現與根因判定：

- fresh-read failed run、artifact、log 與當時 SHA；
- 在 current main 重跑同一個 stable Playwright coverage surface；
- 若能重現，補回歸測試 / forward-fix 並走完正式環境收尾；
- 若不能重現，查明是 flaky test、coverage baseline drift、runner failure 或已被後續 commit 修正，留下可重跑 evidence；
- 沒有 current-main evidence 前，不把單一舊 run 說成正式環境回歸問題，也不把它靜默忽略。

接著修正 Tribunal bounded recovery 的 deterministic version drift：

- `scripts/tribunal-batch-runner.sh` launch-time 仍是 `TRIBUNAL_VERSION=8`，但 `scripts/tribunal.sh` 與 `scripts/tribunal-quota-loop.sh` 已是 version 9；
- manual / bounded recovery 可能因此把舊 v8 PASS 誤當 current result 並跳過處理；
- 收斂成單一 version SSOT，或採 repo 能證明等價的最小耐久修法；
- 補回歸測試，證明所有 recovery entrypoints 讀到同一 current version；
- 不順手重評全站歷史文章。

### P1：收尾已接近完成的客觀 PR

先處理 #738：

1. fresh-read PR head、diff、checks、comments 與 current main；
2. 不 force-push，安全整合最新 main；
3. 重跑針對 auth/session-expiry 的回歸測試；
4. 取得 current-head exact preview，做 light/dark、mobile/desktop、auth expiry recovery smoke；
5. UI/UX fresh-eyes audit 無 must-fix、required CI 全綠後轉 ready、merge；
6. 驗證 merge tree、正式環境 artifact 與 canonical smoke。

若 live state 顯示 #738 已被其他工作取代、已 merge 或需求失效，依 evidence 更新 / close，不重做。

對 #691，只完成可自主部分：釐清與已 merge #700 的衝突、整合最新 main / conflict resolution、規則的 safety review、simplify review、tests 與清楚的 proofreading surface。若 remote history 使 rebase 必須 force-push，改走 non-destructive merge 或只留下交接，不 force-push。不得代替 ShroomDog 做 line-by-line proofreading，也不得自行 merge；完成後留下 `READY_FOR_HUMAN_PROOFREADING` checkpoint。

#579 的正式發布時機是 human decision。只做 live-state / conflict / CI evidence 對帳；除非 issue / user 已有新的明確授權，不自行發布。

### P2：補完既有文章的英文 sidecar

以 `node scripts/check-translation-pairs.mjs` 的 live output 為 queue，分成可 review、可 revert 的小批次持續做到 0。

- canonical recovery command：

  ```bash
  tools/gp-pipeline/gp-pipeline run --from-step translate --file <existing-zh-file>.mdx
  ```

- launch-time queue 是 22 篇 MP、SD-8 與 3 篇長篇 Lv；優先把 MP 每批 3–5 篇收掉，再處理 SD-8，Lv-01 / Lv-02 / Lv-03 各自成批。live output 若變動，以 live 為準。
- zh-tw 原文是內容 SSOT；英文 sidecar 不得反向改寫中文立場。
- Codex 只負責 orchestration、mechanical repair、validation 與 正式環境 closure；文章 prose 必須走 `GU-LOG_WRITER_PROMPT.md` 指定、由 `.claude/agents/` frontmatter owner-pin 的 canonical writer / translator 路徑。#745 已更新 model routing；每批重新偵測並記錄實際 provenance，不得複製舊批次的 Opus 4.5 標籤。
- 不得因 pinned model 暫時不可用而用 Codex 或較弱 model 偷換。
- 每批開始前做 deterministic preflight：確認 `GP_WRITER_PROVIDER` 沒有強制走 Codex、解析 `.claude/agents/tribunal-writer.md` 的 pinned model、依 pipeline skill 做最小 Claude auth / model probe，並用 `scripts/detect-model.mjs` 記錄實際 model。任一條不符就把 prose 項目記為外部阻礙，不執行 translate。
- 每批檢查 heading / import / MoguNote / code fence parity、source fidelity、CJK residue、summary、glossary links、frontmatter provenance、post-version / reader-revision manifests、validation 與 build。
- 每批走 feature branch → atomic commits → PR → CI → merge → 正式環境 English route smoke，再開始下一批。
- 若某篇牽涉新的 terminology / glossary owner decision，標記該篇 blocked，繼續其他 sidecar。

### P3：收斂已證實的 SSOT、provenance 與 reliability drift

以下 launch-time findings 都要先以 current main 重驗，再做獨立 atomic PR：

1. `scripts/rewrite-queue.md` 仍把 GP-175 列為 score 7 / 待重寫，但 live article 已是 v3、`8/9/9/8` PASS。移除 stale queue entry，不重寫文章。
2. `scripts/check-translation-pairs.mjs` 內的「52-post backlog」註解已過時。改成不複製會漂移的 count，runtime output 繼續當 SSOT。
3. `scripts/obsidian-import.mjs` 對缺失 model metadata 預設猜成 `Opus 4.6`。改成 fail closed 或要求明確 CLI / template metadata，補既有 draft flow 的回歸測試；不得只把 fallback 字串追成最新 model。
4. nightly coverage / link baselines 在 launch-time 已到 freshness budget 邊界。先查 live staging branch 與最新 run；只有 baseline 真 stale 或 generator 有缺口才修，不做無證據 churn。

### P4：UI token rolling audit 與小型 interaction work

逐元件 evidence-first 掃描，不把「有 literal color」自動當 bug：

1. 找真實 caller、surface、theme selector、responsive state 與 accessibility semantics。
2. 先做 value review；no-change 也是有效結論，將 evidence 記回 #585。
3. 要改才補回歸測試，覆蓋 light/dark、390px mobile、desktop、keyboard / focus、contrast 與 overflow。
4. reader-visible UI change 完成後 MUST 交給 `uiux-auditor` 做 zero-context fresh-eyes audit；有 must-fix 就修完再送。
5. safe bugfix 完成到 正式環境；taste call 停在 preview + 一個具體問題。

對 #747，只完成不需要 taste call 的 autonomous portion：

- audit gu-log 的高頻互動與目前 feedback 缺口；
- 對照 Amicro pattern，但不預設安裝整套 library；
- 用頻率、狀態辨識、accessibility、效能與 motion 風險排序 2–3 個 bounded prototype 候選；
- 寫出每個候選的最小驗收面與 `prefers-reduced-motion` contract；
- 留下一個具體選擇題給 ShroomDog。選哪個 interaction、motion 調性與正式 prototype 都是 reader-facing taste call；human 回覆前不實作、不部署 preview、不擴大 rollout。

### P5：OpenSpec 與 human-decision items 的自主前置工作

`add-editorial-spine-rebuild` 目前 0 tasks，內容會改變 editorial mechanism。可以做：

- strict validation；
- current-state / overlap / value review；
- 找出會受影響的 prompts、schema、orchestration 與 tests；
- 把需要 ShroomDog 拍板的最小問題寫清楚。

目前已知它和 stable Editorial Charter 有真衝突：舊 delta 允許 `rebuild` 砍掉 30–50% body，但上位 charter 不允許刪除 source payload 的 claims、關係、conditions、hedges、caveats、evidence boundaries 與 conclusions。human checkpoint MUST 明確問：GP/MP 的 rebuild 是否只能改 packaging，以及 SD/Lv 是否需要不同邊界。不得自行跨過 OpenSpec human checkpoint、補 tasks 後直接 apply，或把 proposal 當已核准方向。

另外 fresh audit 已找到兩個可客觀收斂的 OpenSpec drift：

- `spec-driven-review-loop` 對 builder 唯讀牆的文字仍寫「強制方式尚未定案」，但 live code / archived design 已是 warn-only heuristic + reviewer backstop。可以修 stale 說法、改善 heuristic、加 假陽性回歸測試；在無法排除 controller 正當同步前，不得自行把 gate 升成 blocking。
- `dedup-eval-harness` 仍把 `clean-diff` fixture 寫成 outstanding，但 main 已有兩個 fixture。確認 live evidence 後收斂這個 obsolete statement。

純 evidence-backed 敘述修正只有在「不改 Requirement / Scenario、不改 MUST / SHALL / WHEN / THEN 等 normative meaning、也不改 executable enforcement」時才可當一般 doc de-drift。任何會動 stable spec semantics、normative wording、enforcement behavior 或新引入 spec delta 的修正都照 `.agents/openspec-sdlc.md` 走，不把「文件 de-drift」當跳過人類檢查點的後門。

其他 product wishes、series ideas、homepage curation、theme-toggle semantics、X Read+Write 權限等項目，同樣只做能降低 human decision 成本的 evidence / option framing，不替 user 選。

#603 的 quarantine 到 2026-08-15；final human queue 應把它列為最先需要 ShroomDog 回覆的產品問題。#745 暫時讓 writer 與三位浮動 judges 都解析成同一代 Opus、model diversity 為零；是否重新 pin Fresh Eyes 是品味／評審設計決策，記錄但不自行修改。

### P6：清掉可驗證的低風險 maintenance

在前面 correctness / 正式環境 工作完成後：

- `pnpm exec astro check` 的 launch baseline 是 0 errors、0 warnings、114 hints。逐類判斷；Markdown config、Astro `z` import、unused symbol 等能以 mechanical test 證明安全的才分批修。`document.execCommand` fallback 與 Markdown processor migration 必須先有相容性 evidence，否則留作 human / future work。
- `validate:posts` launch baseline 有 6 個 English summary 超過 300 characters（`en-gp-260`、`en-gp-261`、`en-sd-28`～`en-sd-31`）。用 pinned prose owner 做最小縮寫、保持內容忠實，跑 content gates 並完成到 正式環境。
- 讀 `pnpm run deps:report`、`pnpm run security:gate` 與 allowlist expiry。可用 non-breaking patched dependency 安全解除的就處理；涉及 major migration、LHCI retirement 或產品 runtime tradeoff 的不硬升。Launch-time 11 個 dev / LHCI transitive entries 到 2026-09-05 才到期，不是假裝 P0 的理由。
- read-only 確認 Tribunal daemon / quota ledger 健康；只修本 repo 能客觀解除的 阻礙，不把 off-repo VM mutation 偷渡進 scope。

### P7：清理 tracking drift

每個 wave 結束更新 #585：

- current main SHA、正式環境 deployment / tree；
- open issue / PR / active OpenSpec / missing sidecar counts；
- 本 wave merged PR 與 正式環境 evidence；
- blocked 項目的 exact 阻礙 / decision owner；
- 下一個 safe-autonomous 順序。

#585 body 維持精簡的 current dashboard；細節 evidence 放 comments 或對應 PR，避免 body 無限膨脹。宣告 目標 完成前，#585 不得再指向舊 main、舊 count 或已解除 阻礙。

## 明確不是 backlog 的數字

以下訊號只能拿來觀察或分類，不能要求本 目標 歸零：

- 593 篇 active zh 中沒有 current-v9 PASS 的 grandfathered corpus；背景進度 SSOT 是 Tribunal ledger，不是「556 篇同步重評」。
- `scripts/mogu-picks-queue.yaml` 的候選 URL；是否大量發布是 editorial / product decision。
- 無 scoped baseline 的全 repo 晶晶體 violation 總數；CI 刻意只檢 changed posts，accepted-English boundary 由 ShroomDog 決定。
- Node 26 下的 test timeout、缺 `.git` 的 `/tmp` archive check、archived OpenSpec checklist、教學 pseudo TODO 或 branch name。

目標 只需確認背景 Tribunal 健康且沒有本 repo 可安全解除的 阻礙；不得為了漂亮的「0」重寫歷史文章、擴張 Mogu Picks 或改 glossary policy。

## 每個項目的交付 loop

1. Fresh-read live state 與 dependency。
2. 寫一句 falsifiable success criterion。
3. 確認 worktree clean，從 fresh exact `origin/main` 建立隔離的 feature branch / worktree，避免從上一個 feature head 疊 branch。接手既有 PR 前先重查 remote head SHA 與 active worktree owner；只有 agent 明確擁有 / 獲授權的 head 才 regular non-force push，remote 已前進就重新整合，不覆寫。若是他人 head，建立 successor branch / PR 或只交接，不直接 mutation。
4. bug 先補會失敗的 BDD / 回歸測試；mechanical content parity 要有等價 deterministic check。
5. 實作最小必要改動；不做 unrelated cleanup。
6. 跑 targeted tests，再跑該類改動要求的完整 gates。
7. 檢查 `git diff`、generated artifacts、secrets、provenance 與 commit identity。
8. atomic commit、push、開 PR；立即盯 CI 與 review。
9. required CI 全綠且不是 human checkpoint 時自行 merge。
10. 等 正式環境 exact-tree deployment，做 user-visible smoke，附可點 URL。
11. 更新 issue / #585，再 fresh-sweep 選下一項。

同一項目若因暫時性阻礙卡住，不要原地燒 quota。記錄 evidence、移到 queue 後面，繼續其他 safe 項目；合理時間後再回來 retry。

## Verification contract

所有改動都不能跳過 repo hooks。依 change surface 執行對應 subset 與完整 gate，包括但不限於：

```bash
git diff --check
pnpm run lint
pnpm run test
pnpm run build
pnpm run security:gate
node scripts/validate-posts.mjs
openspec validate --all --strict
```

另外：

- content：canonical pipeline / Tribunal contracts、translation parity、manifest freshness、正式環境 article route；
- UI：targeted Playwright BDD、Desktop Chrome + Mobile Safari、light/dark、390px overflow、keyboard / focus、contrast、reduced motion、fresh-eyes audit；
- GitHub：required checks、mergeability、base freshness；
- 正式環境：HTTP status、頁面 title / 關鍵 UI、exact merge tree / deployment artifact，不只看「Vercel Ready」；
- issue closure：附 PR、merge SHA、正式環境 URL 或 duplicate canonical owner。

15 分鐘無 CI 進展就依 playbook 檢查；25 分鐘仍卡住才把它列為 外部阻礙，不能假裝成功。

## Quota 與停止規則

用 `codexbar usage --provider both --source cli` 在以下時機檢查：

- 起跑；
- 每個 wave 結束；
- 至少每 45–60 分鐘；
- 開始 content / Tribunal batch 前；
- 準備宣告完成前。

策略：

- Codex weekly remaining `> 10%`：繼續執行 safe queue。
- Codex weekly remaining `<= 10%`：停止開新項目。若當前項目尚未 merge，完成 tests、push verified branch、更新 #585 後停；若已 merge，必須先完成 deploy、正式環境 smoke、issue / #585 closure 才能停。回報 `PAUSED — safe to resume`。這只是 report verdict；agent 沒有可設定的目標暫停狀態，因此 active goal 保持 active，不呼叫 `update_goal complete` 或 `blocked`，並明講需要 user 在 UI pause，quota reset 後再 resume。
- Claude / pinned prose owner quota 不足：不替換 model；跳過需要 prose generation 的項目，繼續純 Codex safe work 並記阻礙。
- quota command 失敗：不要猜數字。完成當前 checkpoint後停止並回報工具錯誤。

## 完成判定

只有以下條件全部成立才能把 active goal 標成 complete：

- fresh launch manifest、其必要 dependencies 與執行期間出現的 P0 都沒有未完成的 safe-autonomous issue、PR、OpenSpec task、repo 回歸問題 或 translation pair；起跑後新增的獨立 idea 已記入下一輪而不是偷偷擴 scope；
- #738 或其 live successor 已客觀收尾到 正式環境，或已由 live evidence 證明失效／被取代；transient 外部阻礙 只能讓 目標 pause，不能當完成；
- missing English sidecar count 為 0，或每個例外都有 owner-bound terminology / source 阻礙；
- UI audit 已逐項留下 patch 或 no-change evidence；#747 已完成 evidence / candidate framing 並停在正式 prototype 前的人類 taste checkpoint；
- Tribunal recovery entrypoints 使用同一 current version，stale queue / translation count / Obsidian provenance drift 已收斂；
- 可安全機械處理的 Astro hints、summary warnings 與 dependency fixes 已完成；其餘每項都有具體相容性或 owner 阻礙；
- #691 已到 human proofreading checkpoint；#579 與其他 human items 沒被誤合；
- 所有已 merge work 都有 正式環境 smoke 與 exact-tree evidence；
- #585 反映最新 main、counts、完成項與 human-decision queue；
- worktree clean，沒有未推送 commit、未 stage 改動或被遺忘的 background process；
- 所有 launch 項目收尾後立即跑一次 final sweep，再用 nonblocking follow-up 於 5 分鐘後重跑同一組 manifest queries；兩次都沒有未處理的 P0、目標造成的回歸問題或 manifest dependency。若環境沒有 nonblocking wakeup，明確回報限制，不能用主觀的「看起來穩定」代替。

若所有剩餘項目都已完成 autonomous prework，且確實只剩 human decision，目標 可以 COMPLETE。若 safe queue 尚未清空，只是 quota、provider rate limit 或其他 外部阻礙 擋住，只能回報 `PAUSED — safe to resume`，不得宣稱「all done」。回報應明確區分：

- 已部署到正式環境；
- safe-autonomous but externally blocked；
- ready for human decision；
- intentionally out of scope。

## Final report

最終回報至少包含：

- 目標 verdict：`COMPLETE` 或 `PAUSED — safe to resume`；
- live main SHA、正式環境 deployment ID / tree、canonical URL；
- merged PRs 與每個 正式環境 URL；
- #585 URL 與最後更新時間；
- open issue / PR / active OpenSpec / missing sidecar 最終 counts；
- 每個剩餘 human checkpoint 的一行具體問題；
- Codex / Claude remaining quota；
- `git status --short --branch` 與任何未完成 background process。
