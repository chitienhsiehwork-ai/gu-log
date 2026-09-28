# Tasks

> 前提：本 change 疊在 `retire-gp-translation-pipeline`（PR #1116）上，那個 PR 合併後先 rebase 到 main 再開 draft PR。實作 commit 不碰 `openspec/**/specs/**`（唯讀牆）。每一組做完，`tools/gp-pipeline` 的 `go test -count=1 ./...`、`pnpm exec vitest run` 與該組動到的 shell 測試都要是綠的；會互相牽動的刪改放在同一個 commit。測試資料一律自寫合成文字，不放第三方原文或已下架的譯文。延後的項目（CI 牆、共用 `hasExternalSource`、合併兩份下架欄位清單、代名詞與 obsidian-import、浮動 alias）見 design 的延後清單，不在這份 tasks 裡。

## 1. Pin 升級（第一個 commit）

- [x] 1.1 寫手與 vibe-opus-scorer 一起換到 `claude-opus-5-5`：`.claude/agents/tribunal-writer.md`、`.claude/agents/vibe-opus-scorer.md` 的 `model:` 與 `# PINNED:` 註解（owner sign-off 2026-09-27、History 補 `→ 5-5 (2026-09-27)`、保留 `[1m]` 警告）；`tools/gp-pipeline/internal/llm/claude.go` 的 `ClaudeOpusPinned` 與註解；`scripts/detect-model.mjs` 的 `MODEL_MAP` 在 `'claude-opus-5'` 之前加 `'claude-opus-5-5': 'Opus 5.5'`。新增 Go 測試：vibe-opus-scorer 的 `model:` 必須等於 `ClaudeOpusPinned`；更新寫死舊 pin 的 Go 測試；`tests/content-gates.test.ts` 加 `formatModelName('claude-opus-5-5')` 與 `[1m]` 變體顯示成 Opus 5.5 的斷言。`docs/shroomdog-editorial-feedback.md` 補 2026-09-27 條目。確認文章裡的歷史 `model` 值沒有被改（`git diff --stat src/content/posts` 為空）。Go 測試與 vitest 綠

## 2. 來源距離計分器（Node）

- [x] 2.1 把 `unified`、`remark-parse`、`remark-gfm`、`remark-mdx` 列進 devDependencies（含 lockfile）；`scripts/lib/source-distance.mjs` 的正文投影、原文正規化、斷句與 units（以校準原型為起點，依 design 決策 6、7）：排除規則、只排除「文字就是目標文 ticket 或標題」的站內文章連結、其他連結只取文字、元件與 note、依 policy 門檻判斷的 CJK code fence、擷取標頭、寫死的外框規則、外部來源判斷。`tests/source-distance.test.ts` 與 `tests/fixtures/source-distance/` 的合成樣本涵蓋：中文句末標點、英文縮寫、小數與版本號、網址、清單、標題、GFM 表格列、MoguNote／ShroomDogNote、連結剝除、包成站內連結的轉述照樣進投影、含 CJK 的 code fence、外框剪除後每次結果相同；固定指紋測試寫死一份合成 MDX 的投影 hash（對應「投影指紋固定」「包成站內連結的轉述照樣計分」「網站外框不算進原文」「斷句避開縮寫與數字」）
- [x] 2.2 計分與 policy：`source-distance/v1` 集中 owner 數字、校準參數與未校準初值（見 design 決策 4 的表）；規則①（翻譯型配對、相鄰分群、第一個翻譯型配對新涵蓋 ≥ minStep 算第 1 步、推進才加步、多條候選連續段）、規則②（每句上限、分攤、每個原文句封頂）、第一次配對的零配對、兩次配對的判法（第一次三條都過才做第二次；① 各自、② 用聯集）；改寫報告（連續段導讀句、累計四成的高轉述段落，不含數字）。用手寫配對 JSON 的合成案例測：三句逐句翻譯、三句併一句照翻、翻兩句夾一句吐槽、一句總覽不吃占比、占比超過 30%、第一次零配對、第二次配對沒過規則①、「S4＋S103」分群、被切碎的短引文不湊出假連續段，以及改寫報告不含任何數字（對應 spec「擋下條件 SHALL 由程式依固定參數計算」的全部情境與「改寫 prompt 不含門檻」）
- [x] 2.3 英文逐字檢查：詞級 8-gram 比例、最長逐字詞數、blockquote 與雙引號引文豁免與上限（依文件順序超出的照常計入）。合成案例：40 詞照抄不通過、上限內的引文通過、超過上限的引文被計入、中文原文自然通過（對應「英文版 SHALL 通過逐字 n-gram 檢查」的前三個情境）
- [x] 2.4 章的序列化與驗證、CLI `scripts/source-distance.mjs`（`segment`／`score`／`ngram`／`stamp`／`verify`，JSON 輸出與錯誤碼寫在檔頭）：指紋 = `sourceUrl` 原字串＋投影；只寫 design 決策 6 的欄位（含 `rewrites`、`alignerCalls`、`englishSkipped`），不含配對明細。測試：寫入後重讀驗證通過、改正文一字過期、改 `sourceUrl` 過期、只改 ticket／標題型站內連結或任何連結網址或機器插入區塊仍有效、改 `englishSkipped` 不影響指紋、policy 版本不符、verdict 不是 PASS、指標超過門檻（對應「GP 缺章」以外的「有外部來源的 GP SHALL 帶有效的來源距離章」情境與「章不存配對明細」）

## 3. 章接進 schema、validator 與下架

- [x] 3.1 `src/content.config.ts` 接受選填的 `sourceDistance`（只驗型別）；`scripts/validate-posts.mjs` 用 lib 的外部來源判斷加驗章規則：有外部來源、沒下架的 GP 繁中與英文檔都要有效章，非 GP 帶章失敗，訊息指向 `tools/gp-pipeline/gp-pipeline stamp --file <檔名>`。`tests/validate-posts.test.ts` 涵蓋「GP 缺章」「不需要章的文章」（GP-1、墓碑、MP）；對全站跑 `node scripts/validate-posts.mjs` 通過
- [x] 3.2 下架清掉章：`validate-posts.mjs` 的 `TAKEN_DOWN_INCOMPATIBLE_FIELDS` 與 `take-down-posts.mjs` 的 `INCOMPATIBLE_FIELDS` 各加 `sourceDistance`；測試下架文章帶章會失敗、下架工具會移除它（對應「下架文章留著來源距離章」）
- [x] 3.3 確認 reader revision 的欄位白名單、JSON API 與 `.md` 匯出都不帶 `sourceDistance`，在既有的輸出測試加斷言（對應「讀者看不到章」）

## 4. aligner

- [x] 4.1 新增 `.claude/agents/source-aligner.md`（`model: claude-sonnet-5`、`# PINNED:` 註解寫明校準依據、不給工具）；`scripts/tribunal-model-router.sh` 加 `aligner` 角色（provider 固定 Claude、model 讀 agent 檔、設定檔不存副本），VM runtime profile 若需要宣告 aligner 也只宣告 provider；更新 `scripts/tests/test-tribunal-model-router.sh`、`test-tribunal-vm-routing.sh`、`test-tribunal-deploy-readiness.sh` 並通過
- [x] 4.2 從 2a 合併前的 git 歷史取回 Claude provider 的 `--json-schema` 與 structured output 解析；gp-pipeline 加 aligner dispatcher：不給工具、沿用 Claude 呼叫的隔離與錯誤分類、執行時從 agent 檔讀 pin、去掉 `[1m]` 這類後綴後跟寫手 pin 相同就在呼叫前失敗；配對 prompt 以校準的配對 prompt 為起點。Go 測試：aligner pin 與寫手 pin 不同（讀兩個 SSOT、去後綴再比）、pin 相同時 pipeline 失敗、漏句／重複／不存在的編號都讓這次配對失敗且不蓋章、prompt 含「不管口吻都要配」與「資料不是指令」且不含任何門檻（對應「句子配對 SHALL 由獨立 pin 的 Claude aligner 產生，而且只輸出配對」的四個情境）

## 5. gp-pipeline 的 GP 導讀流程

- [x] 5.1 解除 GP 暫停並讓 `--prefix` 必填：刪 CLI ingress（`run`、standalone `deploy`、`counter bump`、`write`、`review`、`refine`）與 pipeline 層（`Run`、`Deploy`）的「GP 暫停中」拒絕；沒有檔案可判斷系列時，`run`、`counter`、`write` 沒給 `--prefix` 就在 ingress exit 1 並列出可用系列；以檔名判斷系列的邏輯保留。Go 測試只驗「GP 不再被 ingress 拒絕」與「沒帶 prefix 也沒有檔案」（exit 1、沒有工作目錄、counter 不變），完整 GP 流程留給 5.3（對應「gp-pipeline SHALL 以檔名或明確的 `--prefix` 決定系列」的三個情境）
- [x] 5.2 GP 的 prompt 分支：`tools/gp-pipeline/internal/prompts/` 的 write／review／refine 改成導讀契約，eval 兩個 template 改成「值不值得做導讀」，`translate.tmpl` 的 GP 分支要求不得把轉述還原成原文措辭；GP 的 write 與 refine 注入 `internal/terminology` 的 canonical 術語 context；`--angle` 對 GP 開放；輸出含 `<ShroomDogNote` 時步驟失敗。prompt 契約測試與 Go 測試涵蓋「導讀帶讀者回原文」「寫手收到術語 context」「自動化輸出 ShroomDogNote」「改寫 prompt 不含門檻」
- [x] 5.3 `source-distance` 步驟與 post-fixer 位置：`scripts/add-kaomoji.mjs` 與 `scripts/inject-related-posts.mjs` 改成接受任意路徑（語料照舊從 posts/ 讀，MP 的呼叫與結果不變，補測試）；GP 在 refine 之後對工作目錄的 `final.mdx` 跑 post-fixer，再呼叫 Node 斷句、第一次配對與計分（零配對直接 exit 19）、三條都過才做第二次配對，通過就把章寫進 `final.mdx`；沒過就把改寫報告放進工作目錄、重跑 refine 與 post-fixer，最多三輪，仍沒過 exit 19；章記錄 `rewrites` 與 `alignerCalls`；每輪證據寫進工作目錄、run report 記錄結果；`--from-step source-distance` 可恢復；`ralph` 對 GP 把已蓋章的 `final.mdx` 放進 posts/、不跑 post-fixer、只評分。Go 測試用 FakeProvider：第一輪通過、沒過→改寫→通過、第二次配對沒過、第一次零配對直接 exit 19 且沒有呼叫 refine、三輪都沒過（exit 19、沒有 deploy、counter 不變、證據保留）、aligner 失敗不算一輪、從 source-distance 恢復不重寫草稿，以及跑完整條 GP 流程後部署出去的繁中檔重算指紋等於章（對應「GP 導讀跑完整流程」「章涵蓋 post-fixer 之後的正文」「從 source-distance 恢復」與「沒過 SHALL 自動改寫最多三輪，改寫看不到門檻」的情境）
- [x] 5.4 英文逐字檢查步驟：`translate` 產出英文檔後呼叫 Node 檢查，通過就寫英文章，沒過就移除英文檔、繁中章寫 `englishSkipped: verbatim`、繁中照常部署、run report 記錄，不重翻；之後補上通過的英文版時清掉標記。`scripts/check-translation-pairs.mjs` 看到這個標記就放行只有繁中的 GP。Go 測試涵蓋通過與沒過兩條路；vitest 涵蓋配對檢查在 strict 模式下「有標記放行、沒標記且 Tribunal 通過照舊失敗」（對應「英文版沒過不重翻」「略過英文版的 GP 通過翻譯配對檢查」）
- [x] 5.5 `gp-pipeline stamp --file <檔> [--source <capture>]`：繁中檔兩次配對與計分、英文檔逐字檢查，通過只寫章、不改正文，英文檔通過時清掉繁中章的 `englishSkipped`；沒過或零配對 exit 19 並印出標出的段落、檔案不變；非 GP 或非外部來源在 ingress exit 1、不呼叫模型；擷取結果不寫進 repo。Go 測試對應「手寫或人工修改的 GP SHALL 能用 `gp-pipeline stamp` 蓋章」的三個情境
- [x] 5.6 help 與操作文件：root、`run`、`counter`、`stamp` 等 help 拿掉「GP 暫停中」與「`--prefix` 預設 GP，要明確帶系列」的提醒，寫出導讀流程與 exit code 19；`tools/gp-pipeline/SKILL.md`、`tools/gp-pipeline/README.md`（系列表、流程、`--from-step source-distance`、`stamp`、exit code 表）、`.agents/skills/gp-pipeline-sop/SKILL.md`、`scripts/crontab-tribunal.example` 同步；help contract 測試通過

## 6. 棘輪、dedup 與下架工具

- [x] 6.1 `scripts/dedup-gate.mjs` 的 `layer1Match` 改成回傳所有命中（呼叫端同步），`scripts/check-takedown-ratchet.mjs`：刪「GP 暫停期間擋新 GP」；來源封鎖對新增檔與改了 `sourceUrl` 的既有檔檢查，只有「這個檔是 GP、相同來源的下架文章全部是 GP、帶有效章」三個條件都成立才放行（驗章呼叫 3.1 的同一份邏輯）；檔頭註解同步。測試涵蓋「新文章使用已封鎖的來源」「帶有效章的新導讀使用下架 GP 的來源」「帶有效章的 GP 導讀用下架 MP 的來源」「既有文章改用已封鎖的來源」，以及原本的「自動化把全文寫回下架文章」仍失敗
- [x] 6.2 dedup：`--series GP` 的候選只撞到下架的 GP 時回 WARN（exit 0）並說明要帶有效章，撞到任何下架的 MP 或公開文章仍 BLOCK；其他系列不變；檔頭說明同步。gp-pipeline 的 `dedup.Check` 系列改成必填，`candidate` 改成明確傳入系列。node 測試與 gp-pipeline 的 dedup 測試涵蓋「Pipeline 用已下架的來源」「GP 導讀用下架 GP 的來源」「GP 候選撞到下架的 MP」與「沒給系列就失敗」
- [x] 6.3 `scripts/take-down-posts.mjs` 依規則選文加上 `translatedDate` 不晚於授權日的條件；測試涵蓋「授權之後才發布的文章」，並用 #1114 的規則檔跑 `--plan` 確認現有清單不變

## 7. 評審與 Tribunal

- [x] 7.1 刪 `.claude/agents/` 的 fact-checker、librarian、fresh-eyes、vibe-opus-scorer、tribunal-writer，以及 `.codex/agents/` 對應 toml 與 `scripts/vibe-scoring-standard.md` 裡的 GP 翻譯分支，改成「GP 照 MP 規則評，只留不改寫與 `ShroomDogNote` 兩個差異」；引用已下架 GP 的校準範例換掉；`tests/mp-editorial-contract.test.ts` 加 GP 導讀的契約斷言（對應「Tribunal 評 GP 導讀」）
- [x] 7.2 `scripts/tribunal.sh` 對 GP 的 no-rewrite 錯誤訊息改成要經 gp-pipeline 重新蓋章；`scripts/tests/test-tribunal-safety-contract.sh` 同步並通過（對應「明確要求改寫 GP」）
- [x] 7.3 Tribunal v2：`src/lib/tribunal-v2/pipeline.ts` 對 GP 只跑評審，不進評審→寫手迴圈、不跑 FactCorrector 的改寫、不跑第 3 階段 Librarian 的加連結；vitest 斷言 GP 評審沒過時這三個角色都沒被呼叫、文章檔不變（對應「Tribunal v2 評 GP」）

## 8. 解除暫停與讀者看得到的地方

- [x] 8.1 刪 `src/lib/gp-series-pause.mjs` 與首頁、英文首頁、GP 系列頁的暫停分支：GP 列表只列公開導讀、沒有時顯示中性空狀態、GP-1 不列出；`.github/workflows/deploy-smoke-test.yml` 的 GP 列表檢查接受「有文章」或「空狀態」。`tests/post-tombstone.spec.ts` 裡對 `[data-gp-paused-notice]` 與改版文案的斷言改成中性空狀態、`tests/spec-ownership.json` 裡該檔的 reason 同步；`tests/mp-editorial-identity.spec.ts`、`tests/tombstone-copy.test.ts`、`tests/deploy-smoke-workflow.test.ts` 同步並通過（對應「讀者開啟 GP 系列頁」）
- [x] 8.2 GP 用語改成導讀（design 決策 15 的預設）：首頁與系列頁副標、卡片來源標籤、文章頁 `contentMode` 與 `src/components/ArticleTechnicalDetails.astro`、`src/pages/about.astro` 與 `src/pages/en/about.astro`；對應測試斷言同步（對應「GP uses reading-guide labels」，MP 標籤的斷言維持不變）
- [x] 8.3 跑 uiux-auditor（雙主題、390px 與桌面），must-fix 清零；preview 截圖附在 PR 說明

## 9. 寫作與操作文件

- [x] 9.1 `GU-LOG_WRITER_PROMPT.md` 的 GP 段落改成導讀契約與 Mogu 聲音，自然中文段落加入 GP-273 的「銜尾蛇」「演算法動態」反例；`CONTRIBUTING.md` 的 GP 段落從「暫停中」改成導讀流程、來源距離章與 `stamp`，拿掉「`--prefix` 預設 GP」的提醒；`scripts/mogu-picks-prompt.md` 裡跟 GP 的對照改成導讀；`tests/mp-editorial-contract.test.ts` 通過
- [x] 9.2 `AGENTS.md` 路由表、`playbooks/CCC-playbook.md`（CCC 可以跑完整 GP、拿掉 `--prefix` 提醒）、`docs/tribunal-runbook.md`（GP 只評分的理由改成重新蓋章）、`docs/shroomdog-editorial-feedback.md`（2026-09-27 導讀格式決定）同步；以 `rg -n "GP 暫停中|GP_SERIES_PAUSED|gp-series-pause|忠實翻譯|paused|GP 翻譯|GP translation"` 掃 repo（含 `.github/workflows/ci.yml`、兩份 pre-commit hook、`tests/spec-ownership.json`、兩份 x-source-fetch skill、`.agents/README.md`），剩下的命中只能在 openspec archive 與歷史紀錄，逐一確認

## 10. 整合驗證、archive 與上線

- [ ] 10.1 全套驗證：`tools/gp-pipeline` 的 `go build ./...`、`go vet ./...`、`go test -count=1 ./...`，`pnpm run lint`、`pnpm exec astro check`、`pnpm exec vitest run`、`node scripts/validate-posts.mjs`、`npm run -s taxonomy:check`、`openspec validate --all --strict`、`pnpm run build`；PR 上 CI 全綠（含 Go leaf 與翻譯配對檢查）
- [x] 10.2 用一個真實網址跑 `tools/gp-pipeline/gp-pipeline run <url> --prefix GP --dry-run`（時機由 controller 依額度決定），確認配對、改寫迴圈、蓋章與英文檢查在真的 Claude 上跑得通，run report 與工作目錄證據附在 PR 說明（不附原文）
  - 2026-09-28 controller 依額度改做小規模試跑：用 repo 的 Go 程式（`gp-pipeline stamp --file <草稿> --source <擷取檔>`，legacy profile，走 contained、不給工具的 aligner）對校準樣本 GP-184 導讀 r1 跑一次來源距離檢查；草稿、擷取與工作目錄都在 repo 外。真的 Claude（`claude-sonnet-5`）呼叫 2 次，structured output 兩次都解析成功，78 句導讀句全數出現。第一次配對 37 句、maxRun 2、占比 0.211 → 做第二次；第二次 33 句、maxRun 2、占比 0.209；聯集 39 句、占比 0.2243 → PASS，章寫進草稿、verify 通過（原文 186 句、2284 units；兩次呼叫共約 3 分鐘）。這個 sandbox 的 claude CLI 靠環境變數登入，contained 呼叫只帶 HOME／PATH，所以試跑在 PATH 前放了只在 scratchpad 的 shim 補回登入用的環境變數，參數與 prompt 照 gp-pipeline 組的原樣。沒涵蓋：完整 `run --dry-run` 的寫作、改寫迴圈與英文逐字檢查。
- [ ] 10.3 archive：確認 `retire-gp-translation-pipeline` 已 archive、分支已 rebase；`openspec archive gp-commentary-format` 沒有 "not in the current spec" 警告；移除 `quality/brand-taxonomy-residual-allowlist.json` 裡本 change 的 exact exception，再跑 `npm run -s taxonomy:check`；直接改 `openspec/specs/editorial-charter/spec.md` 的 Purpose（GP 改成導讀、不再寫「翻譯忠實邊界」）；`openspec validate --specs --strict` 通過
- [ ] 10.4 轉 ready、等 Codex auto-review、掛 auto-merge；上線後 smoke：`/gu-log-picks` 與 `/en/gu-log-picks` 回 200 並顯示中性空狀態、首頁 GP 區塊正常、GP-1 文章頁仍可讀；在 chat 回報 production URL
