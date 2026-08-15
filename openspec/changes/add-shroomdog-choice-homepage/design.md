## Context

繁中與英文首頁目前各自在 page frontmatter 內讀取全站文章，再用 `getIndexPosts()` 建立 GP／MP／SD／Lv 列表。`getIndexPosts()` 會排除 deprecated 與低於 publish bar 的文章，但刻意保留 retired；既有 schema 也沒有 issue #587 所需的 `unlisted` 欄位。新策展區因此不能只從既有首頁結果取前三篇，也不能把雙語 slug 各維護一份。

本次設計同時要讓真實 branch homepage 成為 review surface，並保留人工策展的明確承諾：ShroomDog 親自選、順序有意義、列表不會被演算法悄悄補齊。

## Goals / Non-Goals

**Goals:**

- 用一份有序設定驅動繁中與英文首頁的同一批策展文章。
- 明確排除 retired、deprecated、unlisted 與低於首頁 publish bar 的文章。
- 讓缺少語言版本或失效項目安全略過，不改變其餘項目的人工順序。
- 以共用 Astro component 實作首頁第一區，維持 dark／light theme、鍵盤操作與 mobile viewport 品質。
- 讓後續換文只需改中央清單，不必同步兩個首頁或複製 frontmatter 旗標。

**Non-Goals:**

- 不改變一般首頁 GP／MP／SD／Lv 列表保留 retired 的既有行為。
- 不建立 CMS、管理後台、自動推薦或排程輪替。
- 不保證每個語言永遠湊滿三篇，也不以候補文章填洞。
- 不改變文章 route、RSS、搜尋或 tag 頁的公開範圍。

## Decisions

### 1. 以 ticketId 清單作為策展 SSOT

新增一份 typed config，保存唯一的有序 ticketId 清單。第一版沿用已在 A 方案中實際展示的 `GP-127`、`GP-101`、`GP-110`；resolver 以 `ticketId + lang` 找到對應文章，所以繁中與英文共用同一份選單與排序。

採 ticketId 而非 slug，是因為 ticketId 已是雙語文章配對的 canonical key；採中央清單而非每篇 frontmatter 的 rank，則能一次看懂完整菜單、避免重複名次與跨檔排序漂移。

### 2. resolver 將排序與資格判定集中處理

resolver 接收完整文章集合與語言，先驗證設定沒有重複 ticketId，再依清單順序逐一解析。文章只有在以下條件全部成立時才回傳：

- 目前語言有對應 entry；
- 有效狀態為 `published`；
- `isBelowPublishBar()` 為 false，也就是沿用既有首頁包含未評分 grandfathered 舊文的資格語意；
- 繁中 canonical entry 與目前語言 entry 都未標記 `unlisted`。

resolver 對缺少或失效項目採 safe-skip，不重排、不補位。兩個語言共用同一份人工菜單與相對順序，但某個語言缺 sidecar 或被標記 unlisted 時，實際顯示篇數可以不同。這比在 component 內臨時 filter 更容易單元測試，也讓兩個首頁共享完全相同的 eligibility contract。

### 3. `unlisted` 是獨立 metadata，不擴充 PostStatus

schema 新增 `unlisted: boolean`，缺省為 `false`。它描述「不應出現在人工策展等列表」而非文章生命週期，因此不把它塞進 `published | retired | deprecated`。英文 sidecar 以繁中 canonical entry 的 `unlisted` 為上限：任一側明確為 true，該語言項目就不進策展區。

替代方案是新增第四個 status，但那會把可直接瀏覽、生命週期與列表曝光混成一個 state machine，也會擴大到 RSS／搜尋／導覽的既有 contract，本次不採用。

### 4. 共用 component，頁面只負責傳入已解析文章

新增單一 `ShroomDogChoice.astro`，由繁中與英文首頁傳入 resolver 結果及 locale。component 內只處理語系文案與呈現，不重新判斷文章資格。

版型採單一 11px 外框、hairline 分隔與留白建立層次；不使用 `SD` 圓章、內層卡片堆疊、重陰影或大面積橘色漸層。區塊置於現有 Gu-log Picks 前，第一篇顯示 `主廚首選`／`Chef’s Pick`，另兩篇維持人工次序。

### 5. 真實首頁 preview 取代靜態 artifact

移除討論用 HTML artifact。PR 的 Vercel branch root `/` 與 `/en/` 成為視覺 review 與 smoke test 的唯一 preview surface，避免 mock 與 production component 分叉。

## Risks / Trade-offs

- [清單內文章失效後區塊少於三篇] → safe-skip 並用測試鎖定不補位；維護者需明確選新文章，保住「人工背書」的承諾。
- [繁中與英文 metadata 不一致] → status 與 unlisted 都以繁中 canonical entry 作為保守上限，resolver 測試雙語繼承。
- [首頁第一區過度搶眼，壓縮既有內容] → 使用中性 surface、單層邊界與 responsive spacing，並在真實 390×844 dark/light viewport 驗證首屏。
- [中央設定引用錯誤或重複 ticketId] → 重複值 fail-fast；不存在或缺語言 entry 則安全略過並由回歸測試覆蓋。

## Migration Plan

1. 先加入 schema、中央清單、resolver 與單元測試。
2. 加入共用 component，接到繁中與英文首頁最前方。
3. 移除靜態討論 artifact，完成 build、a11y、theme 與 viewport 驗證。
4. 以 Vercel branch root 驗收；通過後 merge，由同一 commit 進 production。
5. 若需 rollback，revert feature commit 即可恢復原首頁與 schema；文章內容不需 migration。

## Open Questions

目前沒有阻擋實作的技術問題；實際首頁 preview 只保留會改變讀者感受的視覺微調給使用者拍板。
