# Tasks

> 授權：ShroomDog 2026-09-27 在 chat 授權下架清單依規則產生、直接 e2e 做完，不需逐篇確認。本 change 沒有「等 owner 確認清單」的 gate；清單由工具依 `takedown-list.json` 的規則產生，controller 用 `--plan` 對帳。實作 commit 不碰 `openspec/**/specs/**`。

## 1. 規格與決策紀錄

- [x] 1.1 建立 proposal、design、tasks、spec delta、`takedown-list.json` 與 `design-ref/` 墓碑定稿素材，確認 `pnpm exec openspec validate translation-takedown-tombstone --strict` 通過
- [x] 1.2 依審查意見與 controller 2026-09-27 的決定改寫提案（200 加 `noindex`、不變式不動、保留原欄位、清單由工具產生、CI 棘輪、dedup 來源封鎖、MP 文案、補齊 spec 衝突與漏掉的出口）
- [x] 1.3 在 `docs/shroomdog-editorial-feedback.md` 記錄 2026-09-26／27 的 owner 決定（整篇翻譯要作者同意、GP 全下架、付費新聞 MP 下架、`retired`／`deprecated` 不等於下架、清掉 HEAD 副本、2026-09-27 授權 e2e 不逐篇確認），格式照既有條目

## 2. 狀態、文案與 schema

- [x] 2.1 墓碑文案模組（GP／MP × 繁中／英文，含中性摘要）與 GP 暫停旗標，兩者都是單一來源，給元件、exporter、下架工具、validator 與 CI 棘輪共用
- [x] 2.2 `src/content.config.ts`：`status` 加 `taken-down`，新增選填 `takenDownAt`、`sourceTitle`，跨欄位不變量照 `extended-post-frontmatter` delta；以 schema 測試驗證
- [x] 2.3 `src/utils/post-status.ts`：`PostStatus` 加 `taken-down`，`getListablePosts()`、`getIndexPosts()` 與導覽 baseline 排除；以 `tests/post-status.test.ts` 驗證
- [x] 2.4 `scripts/validate-posts.mjs`：下架文章檢查正文為空、摘要是中性句、配對一致、`sourceTitle` 不等於標題，並跳過只對正文有意義的規則；重複掃描比照 `deprecated` 跳過下架文章（GP-35／GP-105 案例要有測試）

## 3. 墓碑頁與列表

- [x] 3.1 從 `design-ref/` 複製素材到 `src/assets/tombstone/`；墓碑元件照 design D4、D5；新增兩個主題同值的碑文 token
- [x] 3.2 繁中與英文文章路由遇到下架文章只渲染墓碑；`BaseLayout` 新增 `robots` 參數（墓碑傳 `noindex`），保留 `.md` alternate
- [x] 3.3 顏文字：擴充偵測讓 `(－人－)` 不可斷行，三個顏文字加進 `scripts/check-kaomoji-unbreakable.mjs` 的 corpus
- [x] 3.4 GP 系列頁（繁中／英文）在暫停期間只產生第 1 頁並顯示改版空狀態；首頁與英文首頁不顯示 GP 區塊；glossary 的文章連結排除下架文章
- [x] 3.5 `astro.config.mjs` 的 sitemap filter 排除下架文章
- [x] 3.6 Playwright：墓碑文案逐字、視覺隱藏 h1、`noindex`、沒有文章周邊元件；GP 空狀態；在 `tests/spec-ownership.json` 登記

## 4. 輸出與建置檢查

- [x] 4.1 `scripts/lib/post-markdown-exporter.mjs`：`taken-down` marker、墓碑元素與 frontmatter 交叉驗證，產生墓碑 Markdown；以 `tests/post-markdown-exporter.test.mjs`、`tests/build-post-markdown.test.mjs` 驗證
- [x] 4.2 確認 JSON API 對下架文章回空 `body`、空 `headings` 與中性摘要（路由不改）；RSS、JSON feed、三份搜尋索引、閱讀紀錄已因 status 排除
- [x] 4.3 `scripts/verify-canonical-public-output.mjs` 加下架洩漏檢查；以 `tests/canonical-public-output.test.ts` 驗證

## 5. 轉址與部署 smoke

- [x] 5.1 `vercel.mjs`：舊品牌 GP 列表數字分頁轉到 GP 系列頁，MP 保留頁碼；更新 `tests/vercel-routing-config.test.ts` 與 `scripts/verify-brand-redirects.mjs`，平台路由數維持 1,082
- [x] 5.2 `.github/workflows/deploy-smoke-test.yml`：GP 分頁的預期目的地、GP 列表改驗空狀態、最新文章 smoke 跳過下架文章

## 6. CI 棘輪、Tribunal 與 dedup

- [x] 6.1 `scripts/check-takedown-ratchet.mjs`：已下架不可回復、新 GP 擋下、新文章不可用已封鎖來源、`sources/` 只准新增 `chatgpt/`；接進 pre-commit（兩份 hook）與 CI；以單元測試驗證
- [x] 6.2 內容 gates（score floor、代名詞、晶晶體、AI tells、glossary 覆蓋、翻譯配對等）跳過下架文章；以 hooks 與 gate 測試驗證
- [x] 6.3 Tribunal 候選選取（batch runner、quota loop、`scripts/tribunal-v2-run.ts`、gp-pipeline `ralph`）依 status 排除下架文章；以 shell 與 Go 測試驗證
- [x] 6.4 `scripts/dedup-gate.mjs`：第一層命中下架文章時回 BLOCK 並說明來源已封鎖，第二層不比下架文章；以 `tests/dedup-gate.test.ts` 驗證

## 7. 測試頁換成仍公開的文章

- [x] 7.1 28 個以 GP 文章當測試頁的 Playwright spec 改用有同樣特性（MoguNote、TOC、系列、影片、程式碼、連結顏色等）的公開文章；`lighthouserc.cjs`、`scripts/visual-test.mjs` 同步；確認 `tests/spec-ownership.json` 的分類不變

## 8. 下架工具與執行（工具與實際下架分開 commit）

- [x] 8.1 `scripts/take-down-posts.mjs`：`--plan`、`--apply`（當時另有一次性的 `--resolve-source-metadata`，批次套用後已刪），slug 用小寫 `post.id`；以單元測試驗證規則、GP-1 排除、GP-63 大小寫、冪等、欄位保留與中性摘要
- [x] 8.2 查來源 metadata（一次性，cache 不 commit），controller 用 `--plan` 對帳
- [x] 8.3 下架 commit：套用規則（依 847d1f67 實算 547 檔）、刪除只被下架文章使用的 `src/assets/posts/**`；重跑 build、validator 與一次性洩漏檢查（拿下架前的正文片段比對 `dist/`）

## 9. Repo HEAD 副本清理

- [x] 9.1 刪除 `sources/` 的第三方原文擷取（保留 `sources/chatgpt/`）；確認 brand-taxonomy 掃描與測試照常通過
- [x] 9.2 保真 regression 原本的 GP-273 fixture 目錄換成自寫合成稿 `tools/gp-pipeline/internal/preservation/testdata/synthetic-first-person/`，保留原 regression 的四種 finding；`tools/gp-pipeline/testdata/clean-fxtwitter.md` 換成自寫推文；以 `go test ./...` 驗證
- [x] 9.3 `tribunal/fixtures/` 的 GP 譯文快照換成合成摘要（`fix(fixture):` commit，分類與理由不變）
- [x] 9.4 刪除 `public/prompts/ui-ux-auditor-prompt.md` 與沒人使用的 `scripts/ui-ux-auditor-prompt.md`
- [x] 9.5 `.agents/skills/shroomdog-url-fetch/SKILL.md`：第三方原文的長期擷取放 repo 外

## 10. 文件同步

- [x] 10.1 `CONTRIBUTING.md`：`status` 語意、下架流程指向 `post-takedown`、GP 暫停；`tools/gp-pipeline/SKILL.md` 加一行指回 `editorial-charter`
- [x] 10.2 playbooks 的「Tribunal 必跑」規則補上下架例外，只寫 policy 並指回 spec

## 11. 驗證與交付

- [x] 11.1 跑 `pnpm run lint`、`pnpm exec astro check`、`node scripts/validate-posts.mjs`、`pnpm exec vitest run`（沙盒已知失敗維持不變）、`go test ./...`、`pnpm exec openspec validate --all --strict`、`pnpm run build`，以及受影響的 Playwright spec
- [x] 11.2 uiux-auditor：墓碑頁深淺雙主題、手機與桌面寬度，截圖存 scratchpad
- [x] 11.3 Archive 前移除 `quality/brand-taxonomy-residual-allowlist.json` 裡本 change delta 的 active-change exact exceptions（archive 後會變 stale）
- [ ] 11.4 Archive change、轉 ready、等 auto-review、掛 auto-merge；production smoke（墓碑 200 且 `noindex`、JSON 空正文、`.md` 墓碑、列表與 sitemap 已排除），在 chat 回報 production URL

## 12. 交給 owner（CCC 做不到）

- [ ] 12.1 遠端舊分支（例如 `backup/main-pre-squash`）HEAD 上的全文：CCC 刪 remote branch 會 403，併入 issue #1111
- [ ] 12.2 舊 Vercel deployment 網址的 Deployment Protection 或保留期限
- [ ] 12.3 VM 更新：延到導讀新格式上線後；在那之前 CI 棘輪會擋下 VM 寫回墓碑的 PR

## 13. 實作審查第 1 輪修正

- [x] 13.1 Tribunal 碰到下架文章改回一般失敗碼 1（`tribunal.sh`、`tribunal-v2-run.ts` 一致），batch 與 quota loop 記一筆失敗就繼續、不停機也不查 ledger；runbook 的 exit code 說明同步，shell 測試補 stale `QUOTA_SUSPENDED` 與 loop 不 drain 的情境
- [x] 13.2 下架工具刪掉連網查 metadata 的程式、`--cache`、`--prune-assets` 與預設規則檔路徑，`--list` 必填；`sourceTitle` 退路改成既有值 → `source` → 網域，不補也不改 `author`
- [x] 13.3 修正下架時補錯的 `author`：GP-59～62、GP-185 改成「DeepLearning.AI」，GP-190 改成「@MindOS_Lisa」，GP-248 改成「张鑫旭」，繁中與英文一致
- [x] 13.4 sitemap、RSS、JSON feed、搜尋索引改以「項目」判斷下架文章（RSS 看每個 item 的 link／guid，JSON 條目看 slug／url／id），公開文章正文連到墓碑頁不算；補「公開文章連到下架文章」測試
- [x] 13.5 下架文章的逐篇檢查只留在 exporter（新增 `noindex` 與 JSON `body` 必須是空字串），postbuild 驗證只管機器輸出、列表與導覽
- [x] 13.6 棘輪的來源封鎖改用 dedup 的 `layer1Match`（補上 YouTube）；`normalizeUrl` 去掉 `smid`、`fbclid`、`gclid`、`mc_cid`、`mc_eid`
- [x] 13.7 JS 的下架判斷統一用 `isTakenDownData`／`isTakenDownSource`，不相容欄位清單只留一份
- [x] 13.8 `BaseLayout` 的 robots meta 只留 `robots` 一個參數
- [x] 13.9 定稿文案的逐字比對只留在 `tests/tombstone-copy.test.ts`，E2E 改從文案模組與 frontmatter 算預期值，刪掉拿常數測常數的斷言
- [x] 13.10 墓碑頁：石碑圖載入失敗時墊石頭色碑身（`--color-tombstone-stone`，兩主題碑文 5.63:1）；對話框改成中文只在標點處換行、各行平衡，390／360px 都沒有孤行；uiux-auditor 深淺主題、390px 與桌機重跑
- [x] 13.11 publisher 碰到在 origin/main 已下架的 PASS 文章就跳過，不開 PR
- [x] 13.12 更正 `getTombstoneHeading` 的註解：墓碑 Markdown 的 H1 用原標題

## 14. 實作審查第 2 輪後的清理

- [x] 14.1 exporter 檢查下架文章「沒有正文容器」改查整頁 HTML；測試補 `.post-content` 放在 `</article>` 之後的情境
- [x] 14.2 下架工具的 `sourceTitle` 退路對齊 spec R1：`source` 是必填欄位，刪掉網域退路；`source` 是空的或等於 gu-log 標題時，在寫入那一對檔案前停下，請執行的人手動補；design D10 同步
- [x] 14.3 定稿文案的逐字比對真的只留在 `tests/tombstone-copy.test.ts`：exporter、build-post-markdown、下架工具與 validator 的測試改從文案模組組預期值，只留版面與跳脫的斷言；`tests/spec-ownership.json` 的描述同步
- [x] 14.4 `scripts/check-contrast.mjs` 的 `bgVar` 死分支改回一行
- [x] 14.5 確認列表與導覽排除的測試覆蓋：首頁、系列頁、tags、Level-Up、閱讀紀錄與文章底部導覽都呼叫 `tests/post-status.test.ts` 測過的 helper，glossary 的過濾卻寫在兩個頁面裡、沒有測試，所以 postbuild 對列表與文章底部導覽的掃描這輪保留
- [x] 14.6 刪掉 360／390px 對話框孤行的 E2E（逐字量座標、受字型影響）；顏文字不斷行的 E2E 保留
- [x] 14.7 小重複：postbuild 驗證改用共用的 `postPathFor`；下架工具改用 `readPostIndex`（多回傳 `source`）；`global.css` 淺色區塊不再重複定義墓碑 token
- [x] 14.8 過時說明：`scripts/lib/taken-down-posts.mjs` 的使用者清單改成實際情況；下架文章用 rc 1 而不用 75／78 的理由只留在 `docs/tribunal-runbook.md`，並補 `TRIBUNAL_WORKER_SYNC_REF=origin/main` 時選文可能一直挑到已下架文章的注意事項
- [x] 14.9 測試去重：batch 測試裡和 `for rc in 0 1 2` 重複的 rc 1 案例；deploy smoke 只比對 workflow YAML 字串的兩個測試，連同兩條品牌 allowlist 例外
