---
name: html-explainer
description: Recipe for effective self-contained HTML learning artifacts — single-file explainer pages that teach ONE concept through a strong analogy carried throughout, an interactive micro-world the reader manipulates, and a built-in comprehension quiz. Use when the user asks for an HTML explainer, learning page, concept lesson, or a code/diff explainer doc that teaches a person to understand a change (not a merge-decision review), or when the level-up workflow needs a level rendered as HTML.
---

# html-explainer — 有效的 HTML 學習頁配方

一份自包含 HTML，教懂**一個概念**。目標不是讓讀者「看過」，是讓讀者變成**參與者**：讀完能預測行為、能推到沒教過的情境、能判斷 AI 的輸出是不是唬爛。

## 三支柱（缺一份就不算學習頁）

1. **解說** —— 先背景、再直覺、最後細節。
2. **微世界** —— 讀者親手操作概念，不是看動畫。
3. **理解測驗** —— 測驗是「人類理解速度」的調速器：agent 產出多快都行，讀者過了測驗才算跟上。

## 頁面骨架（照這個順序排，不要跳）

1. **背景** —— 先教「原本就在那裡的東西」。讀者缺的前置知識在這裡補齊，別假設他知道。
2. **直覺** —— 用一句白話講清楚「這個概念到底在幹嘛 / 這次改動的本質是什麼」，在任何細節、任何 code 之前。
3. **微世界** —— 互動段落（見下）。
4. **細節走讀** —— literate 順序：照「理解的順序」走，不是照字母序或檔案序。散文為主、片段為輔。
5. **測驗** —— 3–5 題，內建在頁面底部（見下）。

關鍵定義、edge case、常見誤解可用少量 callout 標出；圖解只選 1–2 種形式反覆使用，不要每段換一套視覺語法。

## 一個強類比扛到底

- 類比**就是**解說本身，不是旁邊的裝飾。讀者跟著故事走完，概念就該吸收進去；最後才用一行錨點對回術語（「這在技術上叫 X」）。
- **一頁一類比**，從背景一路扛到測驗，絕不中途換世界觀、絕不混搭兩套比喻。
- 挑類比先想「扛得動整個概念嗎」：只撐得起前兩段的類比是壞類比。
- 類比要用讀者真的活過的世界。呼叫方（如 level-up）通常已指定讀者的偏好框架——沿用它；專有名詞不確定就查證或停在機制層，不要憑印象掰。
- 角色稱呼要自然變化但保留身分線索；避免每次重複「名字＝職位」模板。同一角色可依場景改用職稱或口語稱呼，但不要為變化而新增難記角色。

## 微世界設計

- **predict → act → observe**：每個互動都該讓讀者先猜、再操作、再對答案。能推翻讀者預測的互動才有教學力。
- 選**最小**的互動模型：拖曳看座標變化、slider 掃參數、按鈕逐步執行、時間軸來回刷。夠讓讀者驗證心智模型就好。
- 「自己動手做」跟「看別人做完」是兩回事——理解是在操作過程長出來的。所以控制權給讀者：下一步讓他按，狀態讓他改。
- 純裝飾動畫、自動播放的炫效果 = 噪音，砍掉。

## 測驗設計

- 3–5 題選擇題，放頁面最底，全部用頁內 JS 判分：選了立刻回饋，答錯附一句「回去看第 N 段」的指路。
- 錯誤選項要**真的有誘惑力**：常見誤解、對的概念用錯層次、半真半假。不要送分strawman。
- 別用形狀洩題：正確選項不可以固定位置、不可以總是最長最詳細。解釋放在作答後回饋裡，不放在選項裡。
- 答對時，在使用者點擊事件內把精簡的「題目＋正解」複製到系統剪貼簿，並顯示「已複製，可直接貼回 agent」。若 Clipboard API 不可用，顯示可手動複製的同一段文字；不得讓複製失敗卡住作答回饋。
- 立下規矩並寫在測驗開頭：**測驗沒過，不算讀完**。若呼叫方明確要求 learning-gated review，才把測驗當該流程的驗收門檻。

## 單檔硬規則

- 一個 `.html` 檔，CSS/JS 全部 inline。**零外部依賴**：無 CDN、無外部字型、無 `<script src>`、無網路請求。用終端機 `open <file>.html` 離線就能看。
- 手機可讀：單欄流式排版、觸控可操作的控制項。
- 視覺主題依呼叫方指定（level-up 有自己的主題 tokens——以 level-up skill 為準，不要在這裡複製一份）；沒指定就用高對比、可讀性優先的中性配色。
- 語言依呼叫方；教學頁預設 zh-tw 白話，英文縮寫第一次出現要展開解釋。

## 變體：code / diff explainer

教「agent 剛寫的 code」時骨架不變，對應成：

- 背景 = 既有系統怎麼運作（改動前的世界）
- 直覺 = 這次改動的目標與本質，一句話
- 微世界 = 可玩的關鍵行為（改前 vs 改後對照、逐步執行器）
- 細節走讀 = literate diff：照理解順序走過改動，散文串接、嵌 code 片段
- 測驗 = 5 題關於這次改動；若呼叫方明確指定 learning-gated learning/code-explainer 交接，沒過才不往下游送
- 一次性解說檔預設放目標 repo 外；若呼叫方要納入 docs，才放進 repo。

## 交付與驗收

1. 寫完先自檢零依賴：`grep -cE '<script src|href="http|cdn|@import url' <file>` 必須是 0。
2. 允許且實務上可行時，用 `open <abs-path>` 直接開給讀者看；否則聊天裡只給一句簡介 + 絕對路徑。
3. 自己過一遍測驗的每個選項路徑（對、錯、指路連結）確認 JS 判分沒壞。
   - 若有答對自動複製，實際點擊正解並讀回剪貼簿，確認內容正確；同時驗證失敗 fallback 仍可手動複製。
4. 有 code block 時確認換行與縮排沒被 HTML 吃掉（用 `<pre>` 或等價 CSS）。
5. 用可用的 subagent / reviewer 機制請一個零上下文 fresh reviewer 讀一遍，抓「沒展開的縮寫、只當裝飾的類比、預設讀者已懂的跳步」。

## 跟其他 skill 的分工

- **level-up**：教學「工作流程」SSOT（等級規劃、學習紀錄、聊天內 MCQ、類比選擇儀式）。它要渲染 HTML 教材時，用本 skill 當配方。
- **html-artifacts**：一般工作產出（計畫、review、報告）的 HTML。學習頁歸這裡。目的不是「教懂人」的一般 report/review，不用本 skill。
- **playground / dataviz**：前者是「調參數→複製 prompt」工具、後者是圖表規範——都不是教學頁；但微世界需要圖表時可參照 dataviz 的配色紀律。
