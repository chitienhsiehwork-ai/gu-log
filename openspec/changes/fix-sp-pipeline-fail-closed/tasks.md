## 0. Preflight verification

- [x] 0.1 驗證 `yaml.parse()`（repo 既有 npm dependency）能無錯解析所有既有 1157 篇 `src/content/posts/*.mdx` 的 frontmatter block（純讀取驗證，未改任何檔案）——結果：0 failures，D3 可以直接把 `validate-posts.mjs` 換成真解析，不需要縮小範圍

## 1. deploy 檔名槽位驗證（D1）

- [ ] 1.1 `internal/deploy/deploy.go`：`Run()` 開頭（counter bump 之前）驗證 `DateStamp` 符合 `^\d{8}$`、`AuthorSlug`/`TitleSlug` 非空，缺一律回傳明確錯誤、不 bump counter、不 rename、不 commit
- [ ] 1.2 `cmd/sp-pipeline/deploy.go`：`--date-stamp`/`--author-slug`/`--title-slug` 標成 `MarkFlagRequired`
- [ ] 1.3 `internal/deploy/deploy_test.go`（新增）：table test 涵蓋「三個都缺」「各缺一個」「date-stamp 格式錯誤（非 8 位數字）」「三個都給、正常成功」，斷言錯誤發生在任何檔案 rename/counter bump 之前（counter file 內容不變、posts dir 沒有新檔案）
- [ ] 1.4 確認 `internal/pipeline/phase3_test.go` 的 `TestDeploy_DryRunWithFakeGitRepo`（已明確傳三個 slug flag）不受影響，`run` pipeline 呼叫路徑（`ralph.go` 一定會填三個欄位）行為不變

## 2. translate 步驟 + 子命令（D2）

- [ ] 2.1 `internal/pipeline/state.go`：新增 `StepTranslate = 48`（Ralph=47、Deploy=50 之間）
- [ ] 2.2 `internal/prompts/translate.tmpl`（新增）：指示 LLM 把整篇 zh-tw MDX 譯成道地英文 MDX，`lang: "en"`，套用 `GU-LOG_WRITER_PROMPT.md` 既有 en 版規則（quote 保留原文、不逐字翻譯）
- [ ] 2.3 `internal/pipeline/translate.go`（新增）：`(s *State) Translate(ctx)`——`s.RalphPassed == false` 時 log warn 並直接 return nil（不擋 deploy）；否則讀 `postsDir/s.ActiveFilename`，跑 writer dispatcher，寫出 `postsDir/s.ActiveENFilename`
- [ ] 2.4 `internal/pipeline/run.go`：`steps` slice 在 `"ralph"` 之後、`"deploy"` 之前插入 `{"translate", s.Translate}`；`PrintSummary` 的 timing 列表同步加 `translate`
- [ ] 2.5 `cmd/sp-pipeline/run.go`：`stepNameToInt` map 加 `"4.8"`/`"translate"` → `pipeline.StepTranslate`，`Long` help text 的 step 列表同步更新
- [ ] 2.6 `cmd/sp-pipeline/translate.go`（新增）：standalone `gp-pipeline translate --file <zh-tw.mdx>` 子命令，供人工對已過 tribunal 的既有檔案補 en
- [ ] 2.7 `cmd/sp-pipeline/main.go`：root help 加入 `translate` 條目，`write` 描述改為「draft the zh-tw MDX only」並註明 en 由 `translate`（tribunal 過分數後）產生
- [ ] 2.8 `tools/sp-pipeline/SKILL.md`：新增 `translate` 子命令的 usage row（直接派生自本次實作，需同步更新，非廣泛 docs cleanup）
- [ ] 2.9 測試：`internal/pipeline/translate_test.go`（新增）——`RalphPassed=false` 時 Translate 是 no-op（不呼叫 dispatcher、不產生 en 檔案）；`RalphPassed=true` 時用 fake provider 驗證 en 檔案產生於正確路徑、frontmatter `lang: "en"`
- [ ] 2.10 確認 `--from-step` resume 對新 step 的行為：`internal/pipeline/state_test.go` 或 `run_test.go` 加一個案例驗證 `--from-step deploy` 仍正確跳過 translate

## 3. YAML 安全序列化（D3）

- [ ] 3.1 `internal/frontmatter/frontmatter.go`：新增 exported `QuoteScalar(s string) string`——正確跳脫 `\` 與內嵌 `"`，輸出合法 YAML double-quoted scalar；`internal/frontmatter/frontmatter_test.go` 加測試涵蓋撇號、雙引號、冒號、反斜線、空字串
- [ ] 3.2 `internal/pipeline/credits.go` 的 `quoted()` 呼叫點全部改用 `frontmatter.QuoteScalar`；移除本地 `quoted()`（或改為委派新 helper，視呼叫方便性）
- [ ] 3.3 `internal/pipeline/ralph.go` 的 `normalizeRalphFrontmatter`：新增一步，讀出既有 `source:` 值（`f.GetScalar` 剝除既有引號）、用 `frontmatter.QuoteScalar` 重新序列化寫回，保證無論 LLM 原本怎麼寫引號，最終都合法
- [ ] 3.4 `internal/pipeline/ralph_test.go` 或新測試：驗證帶撇號（`Simon Willison's Weblog`）、雙引號、冒號的 `source` 值經 ralph normaliser 後產出合法可被 `gopkg.in/yaml.v3`（測試依賴）解析的 frontmatter
- [ ] 3.5 `scripts/validate-posts.mjs`：`parseFrontmatter()` 換成 repo 既有 `yaml` npm package 的 `yaml.parse()`；無效 YAML 直接標記為 validate 失敗（沿用既有錯誤回報格式）
- [ ] 3.6 `scripts/validate-posts.mjs` 對應測試（若有現成 test 檔）新增案例：apostrophe/quote/colon 混合的 hostile-but-valid `source` 值 SHALL 通過驗證；真正無效的 YAML（未跳脫的引號）SHALL 被擋

## 4. 直接派生文件更新

- [ ] 4.1 `tools/sp-pipeline/SKILL.md`、`CONTRIBUTING.md` 掃描本次實作直接影響的段落（deploy 必要 flag、write/translate 分工），修正不準確處；不做與本次改動無關的廣泛 docs cleanup

## 5. 驗證

- [ ] 5.1 `cd tools/sp-pipeline && go build ./...`
- [ ] 5.2 `cd tools/sp-pipeline && go test ./...`
- [ ] 5.3 `node scripts/validate-posts.mjs`（全庫，換解析器後）零新增失敗
- [ ] 5.4 `pnpm run build` 通過
- [ ] 5.5 `openspec validate fix-sp-pipeline-fail-closed --strict` 通過
