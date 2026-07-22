## 1. 可程式化轉址契約

- [x] 1.1 新增 `vercel.mjs`，從遷移清單產生每筆 zh-tw／en 文章的精確永久轉址，以及四組舊列表基底／純數字分頁轉址
- [x] 1.2 在設定載入時驗證清單結構、語言、來源／目的地唯一性、自我迴圈與 Vercel 靜態路由硬上限，任何異常都封閉失敗
- [x] 1.3 確認轉址目的地僅使用正式 GP／MP 路由，未映射舊 URL、API、Reader、artifact、asset 與 `/shroom-picks` 列表不會被 pattern 誤接

## 2. 確定性驗證

- [x] 2.1 改寫 Vercel 路由設定測試，全量覆蓋清單項目的精確來源、目的地、`permanent: true`、唯一性、無迴圈與路由預算
- [x] 2.2 驗每個正式目的地都有對應文章，網站地圖／新連結不含舊來源，列表轉址白名單只含真實舊基底與數字分頁路由
- [x] 2.3 調整本機 Astro 品牌路由測試：保留正式頁面 200 與非相容範圍 404，不把僅存在邊緣路由的 308 當成本機 Astro 行為

## 3. CI 與維運

- [x] 3.1 更新部署冒煙測試：代表性 zh-tw／en、GP／MP、列表／分頁／文章驗原始 308、精確 `Location`、跟隨後 200、無迴圈；舊機器路徑仍 404
- [x] 3.2 更新品牌重構切換手冊，記錄堆疊整合、預覽完整清單稽核、路由計畫、復原 SHA／部署與正式環境冒煙測試
- [x] 3.3 收斂 taxonomy 殘留允許清單／ownership 證據，僅允許精確路由契約所需舊字面值，並讓過時／計數漂移封閉失敗

## 4. Validation 與交付

- [x] 4.1 跑 OpenSpec validate、路由／品牌測試、taxonomy 檢查、內容驗證、型別檢查、建置與相關品牌重構檢查（本機可行範圍；詳見 worker report）
- [x] 4.2 部署堆疊 PR 的 Vercel 預覽：`dpl_BpWwMrtNe2nbQzgfG3hJqCSZZqLo` remote build／canonical-output gate 通過；完整 1,077／1,077 轉址與 10／10 未映射負例通過
- [x] 4.3 正確性、精簡性與 Opus 最終 review 均 `APPROVE`、無阻擋 finding；stable spec 已同步並確認 change 可歸檔，實際 archive 是 tasks 全完成後的交付動作
- [x] 4.4 確認本機／Preview gates 全綠、配套 PR 已具備合入 `rebrand/mogu-gu-log-taxonomy` 的條件；實際 merge 在 archive commit push 後執行，再由 #586 對最新 `main` 重跑完整 required CI；不在此 change 單獨改正式環境網域
