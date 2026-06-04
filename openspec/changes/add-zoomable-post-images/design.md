# Design: Zoomable Post Images

## Current shape

gu-log 已有 `PostImage`，可以在文章裡放 optimized image；也有 `Mermaid` 的 fullscreen overlay，證明站台已經有「點開圖表再看」的互動方向。但一般文章圖片目前比較像一張貼在紙上的圖：手機上看得到，細節卻不好讀。

## Proposed shape

文章作者在 MDX 裡使用一個標準元件放圖。正文裡它保持乾淨、有 caption、不破壞閱讀節奏；讀者點擊圖片後，進入全螢幕檢視。這個檢視要把 iPhone 當一等公民：雙指可以放大，放大後可以拖曳，關閉後回到原本閱讀位置。

## Interaction model

- Inline image：顯示 optimized image、caption、可點擊提示，open control 必須可 keyboard 操作。
- Expanded view：使用原圖或高解析版本，背景不干擾內容，並使用 modal/dialog 語意。
- Mobile gestures：允許 native iOS pinch zoom；overlay 不得使用 `touch-action: none`，也不得用自製 gesture handler 攔截雙指手勢。
- Pan safety：讀者在放大後拖曳圖片時，不應因碰到 backdrop 而誤關閉。
- Close behavior：提供明顯 close button，touch target 至少 44×44 CSS px，位置尊重 iPhone safe area；Escape close 是 desktop/keyboard 的必要 enhancement。
- Return behavior：關閉後回到原閱讀位置，並把 focus 還給原本開圖的 control。

## Content model

圖片必須有 alt text。Caption 可選，但對解釋型圖表應鼓勵使用。若圖片來自外部來源，文章或 caption 應保留 attribution / source context。

## Performance boundary

Inline image 應繼續走 Astro image optimization 或既有 asset pipeline，包含 responsive `srcset` / `sizes`、intrinsic dimensions、lazy loading 或同等策略。Expanded view 可以使用較大版本，但 high-resolution/full-size asset 不應在文章初始載入時被請求；應在開圖時才建立或設定 expanded image source。若需要 JS，應只在使用 zoomable image 的頁面付成本，且避免每張圖重複塞一份大型 overlay。

## Non-goals

- 不在這個 change 建立自動抓圖或 AI 生圖流程。
- 不在這個 change 定義圖片授權審核系統。
- 不把所有 markdown image 自動變成 zoomable；先以明確元件或明確語法支援，避免意外改變舊文章。
