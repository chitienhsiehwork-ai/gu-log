## Context

`quality/brand-taxonomy-post-migration.json` 同時是已公開舊網址的有限清單，也是 `vercel.mjs` 產生永久轉址的執行期 SSOT。它原本只承擔 SP／CP 遷移，所以轉址登錄器用「目標也必須唯一」把每筆遷移鎖成一對一。GP-53 發布後因文章聲音與事實更正需要改成 MP-316；此時 SP-53 與 GP-53 都是已流通網址，卻應直接匯流到同一篇現行正式文章。

## Goals / Non-Goals

**Goals:**

- 保住所有曾公開流通的精確文章 URL，並讓它們一跳抵達目前正式文章。
- 允許歷史別名匯流，同時維持來源唯一、禁止自我迴圈、路由上限、欄位一致性與目標存在檢查。
- 讓現行站內連結的 URL、編號標籤與標題都跟目前正式文章一致。

**Non-Goals:**

- 不新增依 prefix 猜目標的廣域轉址。
- 不建立通用別名 API、資料庫或執行期查詢層。
- 不改變初次 SP／CP 遷移的一對一數字關係，也不重用已發布編號。

## Decisions

### 歷史別名直接指向目前正式目標

manifest 保存「現在應如何導流」，Git history 保存先前曾導向哪裡。文章再次重分類時，舊遷移 URL 與先前正式 URL 都直接寫成現行目標，避免兩段轉址、已刪除的中繼頁面與 SEO 稀釋。

替代方案是把遷移寫成 SP → GP → MP 的邊鏈，再由產生器求閉包。它保留更多行內 lineage，卻需要迴圈偵測、鏈結攤平與額外 schema，對有限且已有 Git 歷史的清單太重。

### 匯流是一般登錄器能力，遇錯即停放在來源與 entry 一致性

HTTP 轉址是否衝突由來源決定；兩個來源共用目標不會產生歧義。登錄器因此只拒絕重複來源與自我迴圈。manifest entry 另驗證新舊編號與 slug／filename 的 prefix、number、language 一致，完整 manifest 測試驗證現行目標檔案存在。

### regression 使用真實四條 route

測試直接斷言 zh-tw／English 的 SP-53 與 GP-53 都永久導向 MP-316，並另用無效測試資料證明 `newTicketId` 與 `newSlug` 不一致時遇錯即停。這比製造欄位互相矛盾、只為湊匯流的測試資料更貼近契約。

### 站內連結不用歷史 alias

別名只服務外部舊連結。repo 內仍在維護的延伸閱讀連結要更新目標、編號標籤與標題，避免讀者看到 GP-53 卻被送到 MP-316。

## Risks / Trade-offs

- **[風險] manifest 不再是不可變的初次遷移帳冊** → Git history 保留 lineage；proposal 與 spec 明定它是現行 routing SSOT。
- **[風險] 放寬目標唯一後，錯誤匯流不再被一刀切 guard 攔截** → 編號／slug／filename 一致性、目標檔案存在、四條真實回歸案例與人工 review 一起限縮。
- **[風險] 更新歷史文章連結標籤會觸發現行內容 gates** → 只修 gate 明確指出的既有 MoguNote 摘要／評分 metadata，不繞過 hooks，也不順手改正文。

## Migration Plan

1. 提案 review 通過後，補齊 manifest entry 欄位一致性驗證與真實匯流測試。
2. 更新四個現行站內連結的正式標籤／標題，完成因此觸發的窄內容 gates。
3. 重建 manifests，跑 Tribunal／content integrity／完整 Vitest／production build。
4. Preview 驗證四條 308 與兩個正式頁面 200；archive change 後才轉 ready／merge。
5. MP-316 首次公開前若 preview 發現 blocker，可整個 PR revert；一旦 MP-316 已公開，後續只能 forward-fix，並持續保留 SP-53、GP-53、MP-316 等所有已流通精確 URL。不得以 rollback 重新公開已知錯誤的 GP-53，或讓已發布的 MP-316 變成 404。

## Open Questions

無。這是既有精確 manifest compatibility boundary 的窄擴充，不涉及新的產品方向或外部 API。
