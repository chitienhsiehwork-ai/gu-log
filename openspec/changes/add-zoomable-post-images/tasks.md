# Tasks

## 1. Component behavior

- [ ] 1.1 更新或新增文章圖片元件，支援 inline display + expanded view。
- [ ] 1.2 Expanded view 在 iPhone / mobile SHALL allow native pinch zoom and pan；不得用 CSS/JS 阻擋雙指手勢。
- [ ] 1.3 保留 caption、alt text、close button 與返回閱讀位置。
- [ ] 1.4 Close button 尊重 iPhone safe area，touch target 至少 44×44 CSS px。
- [ ] 1.5 Opening moves focus into the expanded view; closing restores focus to the opener。

## 2. Content authoring

- [ ] 2.1 文件化 MDX 用法：如何 import 圖片、如何寫 alt、caption、source。
- [ ] 2.2 明確說明什麼圖片適合加：解釋流程、架構圖、截圖、數據圖；不要為裝飾而配圖。
- [ ] 2.3 補一篇測試或 fixture 文章，涵蓋寬圖與長圖。

## 3. Verification

- [ ] 3.1 Desktop：點圖可展開、Escape 可關閉、不破壞原閱讀位置。
- [ ] 3.2 iPhone/mobile：真機或 WebKit Safari 驗證展開後雙指放大與拖曳可用；Playwright mobile emulation 不足以單獨證明。
- [ ] 3.3 Accessibility：open control keyboard-operable；dialog semantics、focus restore、alt、close label、caption association 都可驗證。
- [ ] 3.4 Performance：inline image 不載入不必要的大原圖；high-res source 不在 initial article load 被請求。
- [ ] 3.5 多張圖片時 overlay / script 成本不隨圖片數量爆炸。
- [ ] 3.6 `openspec validate add-zoomable-post-images --strict` 通過。
