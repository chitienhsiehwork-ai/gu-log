## 1. 可執行合約

- [ ] 1.1 擴充候選快照回歸：只接受相同引號樣式的既有單行 `summary` 值，並拒絕其他 frontmatter、重複欄位、多行語法、標籤、錨點、無引號純量與單邊雙語變更
- [ ] 1.2 擴充雙語原子交換回歸：成對摘要候選的套用、反向復原、平行編輯與行程中斷復原仍收斂成完整雙語檔案
- [ ] 1.3 加入執行器合約案例：只有 FactChecker 改寫取得成對摘要權限，下一輪重評讀到新摘要；其他評審與最終建置修復維持全部保護

## 2. 限定評審階段的摘要交易

- [ ] 2.1 在快照工具實作封閉失敗的成對單行摘要比較，並讓捕獲與套用指令明確接受權限策略
- [ ] 2.2 在 shell 工具與寫手交易明確傳遞同一策略，包含驗證失敗後的反向原子交換
- [ ] 2.3 只在 `factCheck` 重試啟用成對摘要策略；所有其他呼叫點預設保護全部 frontmatter

## 3. 合約收斂

- [ ] 3.1 更新 Codex／舊版 tribunal-writer 規則與 FactChecker 改寫 prompt，說明摘要例外只在評審明確指出時使用
- [ ] 3.2 更新 Tribunal runbook 的寫手候選安全邊界與診斷方式，不複製程式擁有的參數值

## 4. 驗證與交付

- [ ] 4.1 跑快照、執行器、systemd 安全測試、OpenSpec 嚴格驗證與相關 Vitest
- [ ] 4.2 跑 pre-commit、pre-push 與全套 repo 關卡，完成正確性、安全性與 Keep／Simplify／Drop 審查
- [ ] 4.3 封存 OpenSpec change、同步穩定 spec，確認 draft PR 的 CI 全綠後轉為可審查並自動合併
- [ ] 4.4 更新 Tribunal runtime 到已合併的 main，重播 SD-31，並以 log、fresh quota 與 production-safe 狀態驗證修正
