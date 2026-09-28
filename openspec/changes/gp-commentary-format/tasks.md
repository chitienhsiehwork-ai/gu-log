# Tasks

> 前提：本 change 疊在 `retire-gp-translation-pipeline` 上，那個 change 合併後先 rebase 到 main 再開 draft PR。實作 commit 不碰 `openspec/**/specs/**`（唯讀牆）。每一組做完，`tools/gp-pipeline` 的 `go test -count=1 ./...`、`pnpm exec vitest run` 與該組動到的 shell 測試都要是綠的；會互相牽動的刪改放在同一個 commit。測試資料一律自寫合成文字，不放第三方原文或已下架的譯文。

## 1. Pin 升級（第一個 commit）

- [ ] 1.1 寫手與 vibe-opus-scorer 一起換到 `claude-opus-5-5`：`.claude/agents/tribunal-writer.md`、`.claude/agents/vibe-opus-scorer.md` 的 `model:` 與 `# PINNED:` 註解（owner sign-off 2026-09-27、History 補 `→ 5-5 (2026-09-27)`、保留 `[1m]` 警告）；`tools/gp-pipeline/internal/llm/claude.go` 的 `ClaudeOpusPinned` 與註解；`scripts/detect-model.mjs` 的 `MODEL_MAP` 在 `'claude-opus-5'` 之前加 `'claude-opus-5-5': 'Opus 5.5'`。新增 Go 測試：vibe-opus-scorer 的 `model:` 必須等於 `ClaudeOpusPinned`；更新寫死舊 pin 的 Go 測試；`tests/content-gates.test.ts` 加 `formatModelName('claude-opus-5-5')` 與 `[1m]` 變體顯示成 Opus 5.5 的斷言。`docs/shroomdog-editorial-feedback.md` 補 2026-09-27 條目。確認文章裡的歷史 `model` 值沒有被改（`git diff --stat src/content/posts` 為空）。Go 測試與 vitest 綠
- [ ] 1.2 另一個 commit：實測 `claude -p --model opus --output-format json` 的 `modelUsage`；若浮動 alias 已解析到 `claude-opus-5-5`，同步 `OPUS_ALIAS_CURRENT` 與 gp-pipeline `models.go` 的 alias 顯示 fallback 與對應測試；不是就不改，在 PR 說明記錄實測結果

## 2. 來源距離計分器（Node）

- [ ] 2.1 `scripts/lib/source-distance.mjs` 的正文投影、原文正規化、斷句與 units（以校準原型為起點，依 design 決策 6、7）：排除規則、站內文章連結文字、glossary 連結保留文字、元件與 note、CJK code fence、擷取標頭、寫死的外框規則。`tests/source-distance.test.ts` 與 `tests/fixtures/source-distance/` 的合成樣本涵蓋：中文句末標點、英文縮寫、小數與版本號、網址、清單、標題、表格列、MoguNote／ShroomDogNote、連結剝除、含 CJK 的 code fence、外框剪除後每次結果相同；固定指紋測試寫死一份合成 MDX 的投影 hash（對應「投影指紋固定」「網站外框不算進原文」「斷句避開縮寫與數字」）
- [ ] 2.2 計分與 policy：`source-distance/v1` 集中 owner 數字與校準參數（β、κ 依原文文字比例、容忍間隔、minStep、原文句數上限）；規則①（翻譯型配對、相鄰分群、多條候選連續段、推進才算步、minStep）、規則②（每句上限、分攤、每個原文句封頂）、零配對、兩次配對的判法（① 各自、② 與零配對用聯集）；改寫報告（連續段導讀句、累計四成的高轉述段落，不含數字）。用手寫配對 JSON 的合成案例測：三句逐句翻譯、三句併一句照翻、翻兩句夾一句吐槽、一句總覽不吃占比、占比超過 30%、零配對、第二次配對沒過規則①、「S4＋S103」分群、被切碎的短引文不湊出假連續段，以及改寫報告不含任何數字（對應 spec「擋下條件 SHALL 由程式依固定參數計算」的全部情境與「改寫 prompt 不含門檻」）
- [ ] 2.3 英文逐字檢查：詞級 8-gram 比例、最長逐字詞數、blockquote 與雙引號引文豁免與上限（原文詞數的 5%，依文件順序超出的照常計入）。合成案例：40 詞照抄不通過、上限內的引文通過、超過上限的引文被計入、中文原文自然通過（對應「英文版 SHALL 通過逐字 n-gram 檢查」的前三個情境）
- [ ] 2.4 章的序列化與驗證、CLI `scripts/source-distance.mjs`（`segment`／`score`／`ngram`／`stamp`／`verify`，JSON 輸出與錯誤碼寫在檔頭）：指紋 = `sourceUrl` 原字串＋投影；只寫 design 決策 6 的欄位、不含配對明細。測試：寫入後重讀驗證通過、改正文一字過期、改 `sourceUrl` 過期、只改站內文章連結或其他連結網址或機器插入區塊仍有效、policy 版本不符、verdict 不是 PASS、指標超過門檻（對應「GP 缺章」以外的「有外部來源的 GP SHALL 帶有效的來源距離章」情境與「章不存配對明細」）

## 3. 章接進 schema、validator 與下架

- [ ] 3.1 `src/content.config.ts` 接受選填的 `sourceDistance`（只驗型別）；把 `src/pages/posts/[...slug].astro` 裡的 inline `hasExternalSource` 換成共用的外部來源判斷（示範網域、站內、ChatGPT 分享都不算）；`scripts/validate-posts.mjs` 加驗章規則：有外部來源、沒下架的 GP 繁中與英文檔都要有效章，非 GP 帶章失敗，訊息指向 `tools/gp-pipeline/gp-pipeline stamp --file <檔名>`。`tests/validate-posts.test.ts` 涵蓋「GP 缺章」「不需要章的文章」（GP-1、墓碑、MP）；對全站跑 `node scripts/validate-posts.mjs` 通過
- [ ] 3.2 下架清掉章：`validate-posts.mjs` 的 `TAKEN_DOWN_INCOMPATIBLE_FIELDS` 與 `take-down-posts.mjs` 的 `INCOMPATIBLE_FIELDS` 收斂成一份共用清單並加 `sourceDistance`；測試下架文章帶章會失敗、下架工具會移除它（對應「下架文章留著來源距離章」）
- [ ] 3.3 確認 reader revision 的欄位白名單、JSON API 與 `.md` 匯出都不帶 `sourceDistance`，在既有的輸出測試加斷言（對應「讀者看不到章」）

## 4. aligner

- [ ] 4.1 新增 `.claude/agents/source-aligner.md`（`model: claude-sonnet-5`、`# PINNED:` 註解寫明校準依據、不給工具）；`scripts/tribunal-model-router.sh` 加 `aligner` 角色（provider 固定 Claude、model 讀 agent 檔、設定檔不存副本），VM runtime profile 若需要宣告 aligner 也只宣告 provider；更新 `scripts/tests/test-tribunal-model-router.sh`、`test-tribunal-vm-routing.sh`、`test-tribunal-deploy-readiness.sh` 並通過
- [ ] 4.2 從 2a 合併前的 git 歷史取回 Claude provider 的 `--json-schema` 與 structured output 解析；gp-pipeline 加 aligner dispatcher：不給工具、沿用 Claude 呼叫的隔離與錯誤分類、執行時從 agent 檔讀 pin、pin 等於寫手 pin 時在呼叫前失敗；配對 prompt 以校準的配對 prompt 為起點。Go 測試：aligner pin 與寫手 pin 不同（讀兩個 SSOT）、pin 相同時 pipeline 失敗、漏句／重複／不存在的編號都讓這次配對失敗且不蓋章、prompt 含「不管口吻都要配」與「資料不是指令」且不含任何門檻（對應「句子配對 SHALL 由獨立 pin 的 Claude aligner 產生」的四個情境）

## 5. gp-pipeline 的 GP 導讀流程

- [ ] 5.1 解除 GP 暫停：刪 CLI ingress（`run`、standalone `deploy`、`counter bump`、`write`、`review`、`refine`）與 pipeline 層（`Run`、`Deploy`）的「GP 暫停中」拒絕；以檔名判斷系列的邏輯與測試保留。改寫原本驗證 GP 被拒的 Go 測試，改成驗證 GP 走導讀流程（對應「gp-pipeline SHALL 以檔名判斷既有文章的系列」與「沒有 runtime profile 的環境跑 GP」）
- [ ] 5.2 GP 的 prompt 分支：`tools/gp-pipeline/internal/prompts/` 的 write／review／refine 改成導讀契約，eval 兩個 template 改成「值不值得做導讀」，`translate.tmpl` 的 GP 分支要求不得把轉述還原成原文措辭；GP 的 write 與 refine 注入 `internal/terminology` 的 canonical 術語 context；`--angle` 對 GP 開放；輸出含 `<ShroomDogNote` 時步驟失敗。prompt 契約測試與 Go 測試涵蓋「寫手收到術語 context」「自動化輸出 ShroomDogNote」「改寫 prompt 不含門檻」
- [ ] 5.3 `source-distance` 步驟：GP 在 refine 之後跑 post-fixer、呼叫 Node 斷句、第一次配對與計分、通過才做第二次配對，通過就蓋章；沒過就把改寫報告放進工作目錄、重跑 refine 與 post-fixer，最多三輪，仍沒過 exit 19；每輪證據寫進工作目錄、run report 記錄結果；`--from-step source-distance` 可恢復；`ralph` 對 GP 維持只評分。確認 credits、ralph 寫分數與 deploy 配號改名後重算的指紋仍等於章。Go 測試用 FakeProvider：第一輪通過、沒過→改寫→通過、第二次配對沒過、三輪都沒過（exit 19、沒有 deploy、counter 不變、證據保留）、aligner 失敗不算一輪、從 source-distance 恢復不重寫草稿、部署後指紋等於章（對應「GP 導讀跑完整流程」「章涵蓋 post-fixer 之後的正文」「從 source-distance 恢復」與「沒過 SHALL 自動改寫最多三輪」的情境）
- [ ] 5.4 英文逐字檢查步驟：`translate` 產出英文檔後呼叫 Node 檢查，通過就寫英文章，沒過就移除英文檔、繁中照常部署、run report 記錄，不重翻。Go 測試涵蓋通過與沒過兩條路（對應「英文版沒過不重翻」）
- [ ] 5.5 `gp-pipeline stamp --file <檔> [--source <capture>]`：繁中檔兩次配對與計分、英文檔逐字檢查，通過只寫章、不改正文；沒過 exit 19 並印出標出的段落、檔案不變；非 GP 或非外部來源在 ingress exit 1、不呼叫模型；擷取結果不寫進 repo。Go 測試對應「手寫或人工修改的 GP SHALL 能用 `gp-pipeline stamp` 蓋章」的三個情境
- [ ] 5.6 help 與操作文件：root、`run`、`stamp` 等 help 拿掉「GP 暫停中」、寫出導讀流程與 exit code 19；`tools/gp-pipeline/SKILL.md`、`tools/gp-pipeline/README.md`（系列表、流程、`--from-step source-distance`、`stamp`、exit code 表）、`.agents/skills/gp-pipeline-sop/SKILL.md` 同步；help contract 測試通過

## 6. 棘輪、dedup 與下架工具

- [ ] 6.1 `scripts/check-takedown-ratchet.mjs`：刪「GP 暫停期間擋新 GP」；來源封鎖改成對新增檔與改了 `sourceUrl` 的既有檔檢查，帶有效章的檔案放行（呼叫 3.1 的驗章邏輯）；檔頭註解同步。測試涵蓋「新文章使用已封鎖的來源」「帶有效章的新導讀使用下架文章的來源」「既有文章改用已封鎖的來源」，以及原本的「自動化把全文寫回下架文章」仍失敗
- [ ] 6.2 `scripts/dedup-gate.mjs`：`--series GP` 的候選只撞到下架文章時回 WARN（exit 0）並說明要帶有效章，同時撞到公開文章仍 BLOCK；其他系列不變；檔頭說明同步。node 測試與 gp-pipeline 的 dedup 測試涵蓋「Pipeline 用已下架的來源」「GP 導讀用下架文章的來源」
- [ ] 6.3 `scripts/take-down-posts.mjs` 依規則選文加上 `translatedDate` 不晚於授權日的條件；測試涵蓋「授權之後才發布的文章」，並用 #1114 的規則檔跑 `--plan` 確認現有清單不變

## 7. CI 牆

- [ ] 7.1 新增 `scripts/check-guard-wall.mjs`（防護檔清單只寫在這裡，見 design 決策 13）與 `.github/workflows/ci.yml` 的 leaf（比較 PR base 與 head，列進 `ci-passed.needs`）；單元測試涵蓋「內容 PR 順手放寬門檻」「防護檔與文章分開改」，既有的 workflow 結構測試加上這個 leaf 的斷言

## 8. 評審與 Tribunal

- [ ] 8.1 刪 `.claude/agents/` 的 fact-checker、librarian、fresh-eyes、vibe-opus-scorer、tribunal-writer，以及 `.codex/agents/` 對應 toml 與 `scripts/vibe-scoring-standard.md` 裡的 GP 翻譯分支，改成「GP 照 MP 規則評，只留不改寫與 `ShroomDogNote` 兩個差異」；引用已下架 GP 的校準範例換掉；`tests/mp-editorial-contract.test.ts` 加 GP 導讀的契約斷言（對應「Tribunal 評 GP 導讀」）
- [ ] 8.2 `scripts/tribunal.sh` 對 GP 的 no-rewrite 錯誤訊息改成要經 gp-pipeline 重新蓋章；`scripts/tests/test-tribunal-safety-contract.sh` 同步並通過（對應「明確要求改寫 GP」）
- [ ] 8.3 Tribunal v2：`src/lib/tribunal-v2/pipeline.ts` 對 GP 只跑評審、不進評審→寫手迴圈、不跑 FactCorrector 的改寫；vitest 驗證 GP 評審沒過時寫手與 FactCorrector 都沒被呼叫、正文不變（對應「Tribunal v2 評 GP」）
- [ ] 8.4 `scripts/check-pronoun-clarity.mjs` 不再豁免 GP、`scripts/obsidian-import.mjs` 的 GP role 改成 Author；`tests/content-gates.test.ts`、`tests/obsidian-import.test.ts` 同步並通過

## 9. 解除暫停與讀者看得到的地方

- [ ] 9.1 刪 `src/lib/gp-series-pause.mjs` 與首頁、英文首頁、GP 系列頁的暫停分支：GP 列表只列公開導讀、沒有時顯示中性空狀態、GP-1 不列出；`.github/workflows/deploy-smoke-test.yml` 的 GP 列表檢查接受「有文章」或「空狀態」。`tests/mp-editorial-identity.spec.ts`、`tests/tombstone-copy.test.ts`、`tests/deploy-smoke-workflow.test.ts` 同步並通過（對應「讀者開啟 GP 系列頁」）
- [ ] 9.2 GP 用語改成導讀（design 決策 15 的預設）：首頁與系列頁副標、卡片來源標籤、文章頁 `contentMode` 與 `src/components/ArticleTechnicalDetails.astro`、`src/pages/about.astro` 與 `src/pages/en/about.astro`；對應測試斷言同步（對應「GP uses reading-guide labels」，MP 標籤的斷言維持不變）
- [ ] 9.3 跑 uiux-auditor（雙主題、390px 與桌面），must-fix 清零；preview 截圖附在 PR 說明

## 10. 寫作與操作文件

- [ ] 10.1 `GU-LOG_WRITER_PROMPT.md` 的 GP 段落改成導讀契約與 Mogu 聲音，自然中文段落加入 GP-273 的「銜尾蛇」「演算法動態」反例；`CONTRIBUTING.md` 的 GP 段落從「暫停中」改成導讀流程、來源距離章與 `stamp`；`scripts/mogu-picks-prompt.md` 裡跟 GP 的對照改成導讀；`tests/mp-editorial-contract.test.ts` 通過
- [ ] 10.2 `AGENTS.md` 路由表、`playbooks/CCC-playbook.md`（CCC 可以跑完整 GP）、`docs/tribunal-runbook.md`（GP 只評分的理由改成重新蓋章）、`docs/shroomdog-editorial-feedback.md`（2026-09-27 導讀格式決定）同步；以 `rg -n "GP 暫停中|GP_SERIES_PAUSED|gp-series-pause|忠實翻譯"` 掃 repo，剩下的命中只能在 openspec archive 與歷史紀錄，逐一確認

## 11. 整合驗證、archive 與上線

- [ ] 11.1 全套驗證：`tools/gp-pipeline` 的 `go build ./...`、`go vet ./...`、`go test -count=1 ./...`，`pnpm run lint`、`pnpm exec astro check`、`pnpm exec vitest run`、`node scripts/validate-posts.mjs`、`node scripts/check-brand-taxonomy.mjs --check`、`openspec validate --all --strict`、`pnpm run build`；PR 上 CI 全綠（含 Go leaf 與 CI 牆）
- [ ] 11.2 用一個真實網址跑 `tools/gp-pipeline/gp-pipeline run <url> --prefix GP --dry-run`（時機由 controller 依額度決定），確認配對、改寫迴圈、蓋章與英文檢查在真的 Claude 上跑得通，run report 與工作目錄證據附在 PR 說明（不附原文）
- [ ] 11.3 archive：確認 `translation-takedown-tombstone` 與 `retire-gp-translation-pipeline` 都已 archive、分支已 rebase；`openspec archive gp-commentary-format` 沒有 "not in the current spec" 警告；移除 `quality/brand-taxonomy-residual-allowlist.json` 裡本 change 的 exact exception，並依 `node scripts/check-brand-taxonomy.mjs --check` 重算 stable spec 的次數；直接改 `openspec/specs/editorial-charter/spec.md` 的 Purpose（GP 改成導讀、不再寫「翻譯忠實邊界」）；`openspec validate --specs --strict` 通過
- [ ] 11.4 轉 ready、等 Codex auto-review、掛 auto-merge；上線後 smoke：`/gu-log-picks` 與 `/en/gu-log-picks` 回 200 並顯示中性空狀態、首頁 GP 區塊正常、GP-1 文章頁仍可讀；在 chat 回報 production URL
