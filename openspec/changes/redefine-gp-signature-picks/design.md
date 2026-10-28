## Context

GP／MP 的現行定義在 `editorial-charter`：GP = ShroomDog 精選導讀（Mogu 講重點、帶讀者回原文），MP = Mogu 消化來源後寫成自己的文章。導讀的「不是翻譯」靠 `source-distance-stamp` 強制：aligner 配對導讀句與原文句，重講原文超過 30% 或連續轉述太長就擋，pipeline 自動改寫三輪還不過就 exit 19。

盤點 2026-10-28 的內容：`gp-*` 繁中檔 275 個，其中 270 個是 `post-takedown` 下架的翻譯墓碑（正文已清空），1 個是 GP-1 自寫示範文，真正還在線上的導讀只有 GP-276～279 四篇。

ShroomDog 在 chat 決定：MP 是日常文章，GP 是他親自指定的招牌文章；名字 Gu-log Picks 保留；4 篇導讀改成 MP；墓碑留著。

## Goals / Non-Goals

**Goals:**
- 一句話就能分 GP／MP，而且分法跟名字一致：MP 日常、GP 招牌。
- agent 永遠不必猜系列：有來源就寫 MP，GP 只聽 ShroomDog。
- 拿掉只為「GP 是導讀」存在的機制，不留死碼。

**Non-Goals:**
- 不改 GP／MP 代碼、`/gu-log-picks`／`/mogu-picks` 路徑、Mogu Picks 名稱與圖示。
- 不搬 270 個下架墓碑，也不動 GP-1 示範文。
- 不改 MP 的寫作與 grounding 規則本身；SD、Lv 不動。
- 不改 `gp-pipeline` 這個工具名稱。

## Decisions

### D1. GP 的差別是「格」，寫作規則跟 MP 一樣

GP 是 ShroomDog 指定的 MP 等級文章：單一主要來源、Mogu 擁有正文聲音、遵守 MP grounding（speaker、條件、hedge、caveat、證據範圍）。這樣 GP 不需要自己的寫作 contract、judge 規則或 pipeline 分支，升格也不用重寫正文。升格不改變內容契約：GP 就是遵守 MP 契約的文章；「沒有來源作者同意的整篇翻譯不能公開」這條適用所有系列，close form 的 MP（不管有沒有升格）不算整篇翻譯。

替代方案：讓 GP 也能是 SD／Lv 等原創。否決：一篇文章只有一個 ticket，SD／Lv 已有自己的系列身份；要擴就另開 change。

### D2. 只有 ShroomDog 能讓一篇文章變成 GP

GP 只能由 MP 升格而來，寫作永遠先寫 MP：
1. **還沒上線就指定**：ShroomDog 先說「這篇要當 GP」，agent 照 MP 流程寫（含 Tribunal 與改寫），過 PASS 後把 `MP-PENDING` 換成 `GP-PENDING`、兩種語言的檔名一起改，之後照常從 GP counter 配號。沒有舊網址，不需要轉址，也不動 counter 與 manifest。
2. **已上線再升格**：ShroomDog 說「這篇 MP 升成 GP」，走 `brand-taxonomy` 既有的改系列路徑：配新的 GP 號（不重用號碼）、兩種語言一起搬、舊 MP 網址寫進 `quality/brand-taxonomy-post-migration.json` 成為 308 轉址、站內連結改成新網址。

兩條路都用新增的 `scripts/reclassify-post.mjs <ticketId> <GP|MP>`，它是讓文章變成 GP 的唯一方式：已上線的配新號、改兩種語言的 ticket 與檔名、寫 manifest、改 repo 內連結、bump counter、跑 `validate-posts`；上線前的只改名與 ticket（`MP-PENDING` 有好幾篇時改用繁中檔名指定）。這次 GP-276～279 的清理也走它。`gp-pipeline` 的寫作指令（`run`、`write` 等）拒絕 `--prefix GP`，錯誤訊息指向「先寫 MP，再由 ShroomDog 指定升格」，拒絕發生在任何副作用之前（比照既有的 Lv 拒絕）。

agent 在 URL intake 與候選評估時一律建議 MP；覺得特別好可以說「可能夠格當招牌」，但不能自己選 GP、也不能把 GP 當推薦選項。這條寫進 `gp-signature-picks`，由 Tier-2 文件引用，不在 Tier-0 複製全文。

替代方案：用 frontmatter `featured: true` 標招牌、不動系列。否決：ShroomDog 明確要用 GP 這個名字當招牌，而且列表頁、首頁、徽章都已經以系列分區。

### D3. 升格成 GP 要 Tribunal PASS

招牌要能代表品質，所以升格成 GP 的門檻是 PASS（兩層門檻的上層，數值以 `CONTRIBUTING.md`〈兩層品質門檻〉與 pass-bar code 為準，本文件不抄數字）。把關放在 `scripts/reclassify-post.mjs`：兩條升格路徑都先檢查兩種語言檔的分數，沒有 PASS 就拒絕、什麼都不改。因為產生 GP 只有這一條路，不需要另外的驗證。

PASS 是升格的門檻，不是之後的持續條件：升格後重評（例如 Tribunal 改版）沒過，不擋 commit，GP 也不下線；沒過 publish bar 的 GP 照 `publish-bar-visibility` 不上首頁，跟其他系列一樣。

替代方案：在 `validate-posts.mjs` 要求「公開的 GP 一定要 PASS」。否決：重評沒過時，寫回分數的 commit 會被擋，24/7 daemon 會卡在同一篇；publish bar 已經把沒過的文章擋在首頁外，不需要再多一條。

### D4. 退役來源距離章

章只為「GP 是導讀不是翻譯」存在。GP 改成 MP 規則後，沒有任何文章需要章，留著就是死碼和一套要維護的 aligner model pin。整個 `source-distance-stamp` capability 移除，相關 code、agent 設定、測試、frontmatter 欄位一起刪；git 歷史保留原實作，未來要重啟可以從 archive 的 design 找回。

替代方案：保留章，改成「重寫下架來源時必須帶章」。否決：這是為了極少見的情境保留一整套 aligner 與校準參數；需要時再提 change。

### D5. Tribunal 對 GP 仍只評分不改寫

GP 的正文是 ShroomDog 認可過的版本（升格前已經過 PASS），背景精修不能自己改。所以 `--no-rewrite` 與「沒改過的未過關 GP 不重評」照舊，`gp-source-preservation` 只換理由、拿掉跟章有關的段落。要改 GP 的正文，由人或 agent 依 ShroomDog 指示修改，再跑 Tribunal。

### D6. 清理：4 篇導讀改 MP，墓碑不動

GP-276～279 依 `brand-taxonomy`〈Later reclassification allocates a new identity〉改成 MP：用 MP counter 當下的 next 依 GP 號碼順序配號，現有的語言檔一起改 ticket、檔名，舊網址寫進 migration manifest，`sourceDistance` 欄位刪掉，站內連結改新網址。GP-276、277 只有繁中（舊規則下 Tribunal FAIL 的 GP 可以只出繁中），所以改系列的是 6 個檔；MP 一定要中英成對，改完再用 `gp-pipeline translate` 替這兩篇補英文版，最後共 8 個檔。reader 相關資料（post-versions、reader revision）跟著重新產生。

墓碑不搬：路由預算其實放得下（每個檔一條轉址，539 個墓碑檔加上去約 1621 條，上限 2048），但搬了只是白忙——墓碑沒有正文、也不出現在列表，搬過去還會用掉約 270 個 MP 號碼。它們留在 GP 當歷史紀錄。GP-1 示範文照舊。

### D7. 下架來源一律擋

「帶有效章的 GP 可以用下架 GP 的來源」這個例外跟著章消失。新文章（或改了 `sourceUrl` 的既有文章）的來源跟任何下架文章相同，dedup gate 與 takedown ratchet 都擋。要重寫某個下架來源，另提 change。

改系列不算新文章：takedown ratchet 用 `--no-renames` 比對，改名後的檔案會被當成新增，而 GP-276、277、278 的來源剛好跟下架的 GP-233、257、259 相同。所以遷移清單有記舊檔名到新檔名、`sourceUrl` 沒變的改名，視為既有文章；之後替這篇補上缺少的語言版本（同一個 ticket、同一個 `sourceUrl`）也不算新增，D6 補英文版才過得了棘輪。

### D8. 首頁與列表

首頁在一篇可列的 GP 都沒有時不輸出 GP 區（不留空殼）；有的話照舊放最新、過 publish bar 的前 3 篇。`/gu-log-picks` 列表頁保留中性空狀態，文案改成「還沒有招牌文章」／"No signature picks yet."。副標、徽章 tooltip、about 頁改成新定義。

### D9. 自動寫作一律不產生 `ShroomDogNote`

`ShroomDogNote` 裝的是 ShroomDog 本人的話，原本只有 GP 的寫作步驟會擋。GP 不再由 pipeline 寫之後，這條改成不分系列：gp-pipeline 的 write 與 refine 只要輸出含 `ShroomDogNote` 就失敗（exit 14，輸出移到旁邊留證據），prompt 對每個系列都說不能寫；評審在任何系列都把 `ShroomDogNote` 當成 ShroomDog 本人的話，不當成 Mogu persona 評分。

### D10. GP 規則集中在新的 `gp-signature-picks`

GP 的定義、指定、升格、改系列指令、列表與 pipeline 拒絕都放進新 capability，`editorial-charter` 只留系列身份、MP 規則、分流與不分系列的規則（整篇翻譯、`ShroomDogNote`）。理由：一個地方就能讀完 GP 的全部規則；而且 `scripts/check-file-size.mjs` 擋超過上限、或本來就超標還變大的檔案，把新要求分散塞進 `editorial-charter`、`brand-taxonomy`、`gp-pipeline-publish-integrity`、`post-takedown`，archive 後這四份 main spec 都會被擋。

## Risks / Trade-offs

- [首頁上方暫時少一區] → GP 清空後首頁從 SD／MP 區開始；ShroomDog 指定第一篇招牌後自動出現。
- [刪掉一整套距離章機制] → 只刪 GP 導讀專用的部分；git 歷史與 archive design 保留重啟資訊。
- [下架來源完全不能重寫] → 目前沒有排隊中的需求；真的需要時另提 change。
- [MP 可以貼近原文，招牌也一樣] → 這是 MP 既有的規則，這次不改；GP 多了 ShroomDog 把關與升格時的 PASS。
- [升格後重評沒過的 GP 還是 GP] → publish bar 讓它不上首頁；要不要降回 MP 由 ShroomDog 決定，用同一支 script。

## Migration Plan

1. 改 spec 與文件，退役距離章 code。
2. 4 篇導讀改系列並補轉址，替原 GP-276、277 補英文版，跑 `validate-posts`、route budget 檢查、相關測試。
3. Preview 驗證：舊 GP-276～279 網址 308 到新 MP 網址、首頁沒有 GP 區、`/gu-log-picks` 顯示空狀態。
4. Archive 這個 change、合併、production smoke test。

Rollback：revert 這個 PR 即可（轉址與檔名改動都在同一個 PR）。
