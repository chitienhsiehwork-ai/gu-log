# Tasks

> 授權：ShroomDog 2026-09-27 在 chat 授權下架清單依規則產生、直接 e2e 做完，不需逐篇確認。本 change 沒有「等 owner 確認清單」的 gate；清單由 controller 用 7.3 對帳。只有 design〈Open Questions〉的兩題需要 owner 在 chat 回答。

## 1. 規格與決策紀錄

- [x] 1.1 建立 proposal、design、tasks、spec delta、`takedown-list.json` 與 `design-ref/` 墓碑定稿素材，確認 `pnpm exec openspec validate translation-takedown-tombstone --strict` 通過
- [ ] 1.2 依 owner 對「GP 暫停收新文」與「MP 墓碑文案」的答覆更新 delta 與 design（選 GP、MP 同一版時，同步修改 `brand-taxonomy` 的 MP 標籤規則與 `post-takedown` 的 MP 情境），重跑 strict validate
- [ ] 1.3 在 `docs/shroomdog-editorial-feedback.md` 記錄 2026-09-26／27 的 owner 決定（整篇翻譯要作者同意、GP 全下架、付費新聞 MP 下架、`retired`／`deprecated` 不等於下架、清掉 HEAD 副本、2026-09-27 授權 e2e 不逐篇確認），格式照既有條目

## 2. 狀態模型與驗證

- [ ] 2.1 `src/content.config.ts` 的 posts schema 改成「一般文章 ∪ 下架文章（strict allowlist）」，新增 `taken-down`、`takenDownAt`、`sourceTitle`；以 schema 單元測試驗證多餘欄位、缺欄位、日期格式
- [ ] 2.2 `src/utils/post-status.ts` 新增 `taken-down`、`isTakenDown()` 與型別收窄，`getListablePosts()`、`getIndexPosts()`、導覽 baseline 排除下架文章；以 `tests/post-status.test.ts` 驗證
- [ ] 2.3 `scripts/validate-posts.mjs` 的下架分支：欄位 allowlist、正文必須為空、繁中／英文配對一致、`sourceTitle` 不得等於 gu-log 標題，並跳過內容規則；以 `tests/validate-posts.test.ts` 驗證
- [ ] 2.4 下架清單產生器（`scripts/build-taken-down-registry.mjs` → `src/data/taken-down-posts.json`）：pre-commit 動到文章時重生並 stage，prebuild、pre-push 與 CI 跑 `--check`；以測試證明清單過期時 fail closed
- [ ] 2.5 Emoji gate 涵蓋墓碑會顯示的 `sourceTitle` 與 `author`；以 `tests/content-emoji-policy.test.ts` 驗證

## 3. 墓碑頁

- [ ] 3.1 從 `design-ref/` 複製 `tombstone.webp`、`mogu-crying.webp` 到 `src/assets/tombstone/`（保留 `design-ref/` 原檔作為 archive 紀錄）
- [ ] 3.2 墓碑元件：依 design D2、D3 的版面與文案（GP 繁中、GP 英文、MP 繁中、MP 英文），卡片網域與沒有 `author` 的情況，日期格式 `YYYY.MM.DD – YYYY.MM.DD`，視覺隱藏 h1，墓碑 marker
- [ ] 3.3 繁中與英文文章路由遇到下架文章只渲染墓碑；`BaseLayout` 加 `noindex`、不輸出 `.md` alternate、`<title>` 標示已下架、meta description 用站台預設；不渲染目錄、tags、已讀／分享／登入、相關文章與導覽、`ArticleTechnicalDetails`、Giscus、AI popup、狀態 banner
- [ ] 3.4 顏文字：走 `protectKaomoji()`，擴充偵測讓 `(－人－)` 不可斷，並把 `ಥ_ಥ`、`((( ；ﾟДﾟ)))`、`(－人－)` 加進 `scripts/check-kaomoji-unbreakable.mjs` 的 corpus；以該 script 與單元測試驗證
- [ ] 3.5 顏色 token：新增兩個主題同值的 `--color-tombstone-ink`、`--color-tombstone-rule`，其餘用既有 token；通過 `check-contrast`
- [ ] 3.6 跑 uiux-auditor：Dracula 與 Solarized、390px 與桌面，截 GP 繁中、GP 英文、MP 繁中、MP 英文、沒有 `author`、長標題與英文碑文換行；確認 `ಥ` 的字型 fallback 可接受，不行才在墓碑頁載入子集字型
- [ ] 3.7 Playwright：墓碑文案逐字、視覺隱藏 h1、沒有文章周邊元件、`noindex`；在 `tests/spec-ownership.json` 登記

## 4. HTTP 410

- [ ] 4.1 `middleware.ts`：下架路徑（有無結尾斜線）以 subrequest 取靜態墓碑並回 410；HEAD 回 410 無正文；讓 Markdown 勝出的 `Accept` 不改寫；`.md` 回 410；subrequest 失敗仍回 410；以 vitest mock `fetch` 覆蓋每個情境
- [ ] 4.2 `tests/vercel-routing-config.test.ts` 鎖住平台路由總數不因下架增加（目前 1,082）
- [ ] 4.3 新增 `scripts/verify-takedown-deployment.mjs` 並接進 `.github/workflows/deploy-smoke-test.yml`：繁中／英文墓碑回 410 且正文帶墓碑 marker（不是 subrequest 失敗時的最小 HTML）、有無結尾斜線、HEAD、`Accept: text/markdown`、`.md` 回 410、API 回 404、一篇未下架文章回 200

## 5. 從輸出移除與建置不變式

- [ ] 5.1 `src/pages/api/posts/[slug].json.ts` 排除下架文章；確認 RSS、`/api/feed.json`、三份搜尋索引、閱讀紀錄與 tags 索引已因 status 排除
- [ ] 5.2 `astro.config.mjs` 的 sitemap filter 讀下架清單排除墓碑網址
- [ ] 5.3 tags 頁、系列頁、Level-Up 頁、首頁與繁中／英文 glossary 的文章連結排除下架文章；確認空的 `/gu-log-picks` 與 `/en/gu-log-picks` 仍產生第 1 頁並回 200
- [ ] 5.4 `scripts/build-post-markdown.mjs` 的 slug 不變式改成 design D5（HTML = L ∪ T、JSON = Markdown = L、T 帶墓碑 marker），exporter 略過墓碑並驗證 marker；以 `tests/build-post-markdown.test.mjs` 與 `tests/post-markdown-exporter.test.mjs` 驗證
- [ ] 5.5 `scripts/verify-canonical-public-output.mjs` 加上洩漏檢查：墓碑網址不得出現在 sitemap、RSS、搜尋索引、JSON feed；墓碑不得有 JSON／`.md`；墓碑 HTML 不得含文章正文、`.md` alternate、版本歷史連結、Giscus、AI popup；以 `tests/canonical-public-output.test.ts` 驗證

## 6. Gates、Tribunal 與自動化

- [ ] 6.1 `scripts/list-content-gate-posts.mjs` 與 pre-commit／CI 的內容 gates（score floor、代名詞、晶晶體、AI tells、glossary 覆蓋、topic dedup、翻譯配對）跳過下架文章，frontmatter 驗證照跑；以 `tests/hooks-integration.test.ts`、`tests/list-content-gate-posts.test.ts` 驗證
- [ ] 6.2 Tribunal 候選選取（`scripts/tribunal-batch-runner.sh`、quota loop、`scripts/tribunal-v2-run.ts`、gp-pipeline `ralph`）只挑未下架文章；publisher 與寫手不寫入下架文章；以 shell 與 Go 測試驗證
- [ ] 6.3 dedup、`scripts/suggest-crosslinks.mjs`、`scripts/inject-related-posts.mjs` 等語料工具把下架文章視為不存在
- [ ] 6.4 部署 smoke：「最新文章」選取排除下架文章；舊網址轉址檢查在終點是墓碑時接受 410；`scripts/verify-post-markdown-deployment.mjs` 的 sentinel 換成一篇不會下架的文章；以 `tests/deploy-smoke-workflow.test.ts` 驗證
- [ ] 6.5 28 個以 GP 文章當測試頁的 Playwright spec 換成仍公開的文章或既有 fixture 頁，掃全部文章的測試跳過墓碑；同步 vitest、Go 與 shell 測試裡的真實 GP slug

## 7. 執行下架

- [ ] 7.1 `scripts/take-down-posts.mjs`：`--list <path> --verify`、`--dry-run`、`--apply --date YYYY-MM-DD`、`--resolve-source-metadata`，行為照 design D8；以單元測試驗證對帳差異、冪等、fallback 與 emoji 過濾
- [ ] 7.2 補齊 `sourceTitle` 與 `author`，輸出 fallback 清單給 controller
- [ ] 7.3 Controller 對帳：`--verify` 以清單規則重算目前 main 的語料，結果必須等於 `takedown-list.json`；main 若新增 GP 或符合網域的 MP，先更新清單再對帳
- [ ] 7.4 下架 commit：套用清單（GP 繁中 271、英文 270；MP 繁中 4、英文 4，共 549 檔），`takenDownAt` 用執行當天的台北日期；重生下架清單與 manifests；刪除只被下架文章使用的 `src/assets/posts/**`；build 與全部 gates 通過
- [ ] 7.5 （owner 同意 GP 暫停收新文時）啟用 validator 的 GP 規則：非 `taken-down` 的 GP（含 `GP-PENDING`）失敗並指向 `editorial-charter`；以 `tests/validate-posts.test.ts` 驗證；提醒 controller 處理在途的 GP draft PR #978

## 8. Repo HEAD 副本清理

- [ ] 8.1 刪除 `sources/` 的第三方原文擷取（`anthropic/`、`openai/`、`x/`、`supergoal/`、`synthid-c2pa/`、`mattpocock-skills-teach/`、`leerob-agents.md`、`earendil-pi-autoresearch-databricks.md`、`clawd-rip-events.json`、`clawd-rip-timeline.md`），保留 `sources/chatgpt/`；確認 brand-taxonomy 掃描與測試照常通過
- [ ] 8.2 `tools/gp-pipeline/internal/preservation/testdata/gp-273/` 換成自寫合成 fixture，保留原 regression 的四種 finding；`tools/gp-pipeline/testdata/clean-fxtwitter.md` 換成自寫推文；以 `go test ./...` 驗證
- [ ] 8.3 `.agents/skills/shroomdog-url-fetch/SKILL.md`（與它的鏡像，若存在）改成第三方原文的長期擷取放 repo 外、不 commit；ShroomDog 自己的 ChatGPT 對話仍可放 `sources/chatgpt/`

## 9. 文件同步

- [ ] 9.1 `CONTRIBUTING.md`：`status` 語意（`deprecated`／`retired` 是標籤、`taken-down` 才是下架）、下架流程指向 `post-takedown`；GP 暫停時在 GP 流程與 `tools/gp-pipeline/SKILL.md` 各加一行指回 `editorial-charter`
- [ ] 9.2 playbooks 的「Tribunal 必跑」規則補上下架例外，只寫 policy 並指回 spec，不複製細節

## 10. 驗證與交付

- [ ] 10.1 跑 `pnpm exec vitest run`、`pnpm run lint`、`pnpm run validate:posts`、`go test ./...`、`scripts/tests/*.sh`、`pnpm run build`（含 postbuild 不變式與洩漏檢查）與 `pnpm exec openspec validate --all --strict`
- [ ] 10.2 Preview：確認墓碑畫面（雙主題、手機與桌面）與列表、sitemap 已排除；preview 被 SSO 擋住時改用本機 build 截圖，並在 chat 說明 410 要等 production 驗證
- [ ] 10.3 Archive change（同時移除 `quality/brand-taxonomy-residual-allowlist.json` 裡本 change `specs/brand-taxonomy/spec.md` 的 active-change exact exceptions，archive 後它們會變 stale），再轉 ready、等 auto-review、掛 auto-merge
- [ ] 10.4 Production smoke：`scripts/verify-takedown-deployment.mjs`、未下架文章 200、sitemap／RSS／搜尋不含墓碑網址；墓碑回 410 但正文缺墓碑 marker 時，照 design〈Risks〉的 410 備案 forward-fix；在 chat 回報 production URL 與結果
- [ ] 10.5 營運收尾：暫停並同步 Tribunal VM worker 後再恢復；在 chat 提醒 owner 檢查 Vercel Deployment Protection 是否涵蓋舊 deployment 網址
