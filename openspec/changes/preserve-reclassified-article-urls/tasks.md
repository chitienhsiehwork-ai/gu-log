## 1. 轉址契約

- [ ] 1.1 把 SP-53／GP-53 的 zh-tw 與 English 歷史 URL 記成四筆精確別名，直接導向對應語言的 MP-316 正式文章。
- [ ] 1.2 讓轉址登錄器接受多個唯一來源匯流到同一目標，同時保留重複來源、自我迴圈與路由上限的遇錯即停 guards。
- [ ] 1.3 驗證每筆 manifest 的新舊編號、slug、filename 與語言彼此一致，並維持現行目標檔案存在的 gate。

## 2. 回歸測試

- [ ] 2.1 用四條真實 SP-53／GP-53 → MP-316 路由斷言匯流、對應語言路徑與 `permanent: true`。
- [ ] 2.2 新增欄位矛盾的測試資料，證明 `newTicketId` 與 `newSlug`／`newFilename` 不一致時遇錯即停。
- [ ] 2.3 保留完整 manifest 的來源唯一、自我迴圈、目標存在、正式輸出與路由上限 coverage。

## 3. 內容重分類

- [ ] 3.1 用通過 Tribunal v9 的 MP-316 中英文更正稿取代錯誤 GP-53 pair，明確承認 gu-log 舊查核錯誤並維持來源歸因。
- [ ] 3.2 將四個現行延伸閱讀連結的 URL、編號標籤與標題一起更新為 MP-316；只修因此觸發的既有窄內容 gate blocker。
- [ ] 3.3 將 MP counter 推進到下一個未用號碼、收斂 source-grounded description，並重建文章版本／讀者修訂 manifests。

## 4. 驗證與交付

- [ ] 4.1 跑 MP-316 的 Fact Checker、Librarian、Fresh Eyes 與 Vibe，將真實 PASS 分數寫回兩語 frontmatter。
- [ ] 4.2 跑 pre-commit 與 pre-push hooks、完整 Vitest、內容完整性、taxonomy／glossary／emoji gates、production build 與正式輸出驗證。
- [ ] 4.3 在 Vercel preview 驗證四條歷史 URL 回 308、兩個正式 URL 回 200，完成雙 reviewer 收斂後交給 archive 階段；archive commit 同步移除這批 active-change exact exceptions。
