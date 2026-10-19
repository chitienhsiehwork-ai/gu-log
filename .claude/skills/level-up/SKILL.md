---
name: "level-up"
description: "使用者要求分關教學、逐題推進或 level-up 教練時使用；也負責實作前 preflight、實作後 debrief、合併前測驗與決策教練。非小型任務、不熟的任務，或改到資料模型、架構、使用者看得到的行為、guardrail／SSOT 檔案時，自行先跑 preflight（見 references/implementation-understanding-loop.md），push 前主動提供實作後測驗；小而安全的修改不走這套流程。用持續保存的學習紀錄調整之後的教學。"
---

# level-up

## 核心約定

- 這是一門課，不是規格書。好玩 > 完整，但不能講錯：課吸引人比精確重要，上完比上一半重要。細節等學習者問了再補，不為了完整把每關塞爆。
- 預設講法是職場鬼故事：Ben（新人亂搞）、Jack（資深但大意）、David（收拾殘局）演真實事故，每關一個，講完回到學習者自己的情況。風格見 `references/teaching-style.md`。
- 關卡數由概念難度決定，需要時 3 到 15 關以上都可以。
- 學習者展示理解或做出必要決定後才進下一關。
- 學習者說的目標就是整門課的視角，可以據此調整關卡順序、增減關卡。

## 參考文件路由

只載入這一回合需要的參考文件。

- **每次 level-up**：教學前與更新紀錄前先讀 [`references/learning-records.md`](references/learning-records.md)。這份管靜默記帳、證據、使用者目標、跳過事件、主題與索引結構、隱私與安全。
- **開課前或選項還沒定**：讀 [`references/level-0.md`](references/level-0.md)。這份管目標、講法、深度這三項一定要讓使用者選的東西；使用者選好前不開始教。
- **規劃或講關卡**：讀 [`references/teaching-style.md`](references/teaching-style.md)（語氣、角色、每關形狀、用詞）與 [`references/teaching-engagement.md`](references/teaching-engagement.md)（節奏、進度表、課中提問、收尾）。
- **出任何測驗或 shotcall 之前、回應答案之前**：讀 [`references/mcq-and-response.md`](references/mcq-and-response.md)。這份管一次一題、不洩題、錯誤選項設計、shotcall 與重試規則。
- **最後一關通關**：讀 [`references/celebration.md`](references/celebration.md)。這份管當場畫 ASCII art 的收尾。
- **實作規劃、決策檢視或理解工作**：讀 [`references/implementation-understanding-loop.md`](references/implementation-understanding-loop.md)，那是依風險觸發的實作前／中／後模型。
- **preflight 或實作前教練**：另讀 [`references/pre-implementation.md`](references/pre-implementation.md)。
- **debrief、實作後理解、或合併／push 前測驗**：另讀 [`references/post-implementation.md`](references/post-implementation.md)。

## 上課流程

1. 依學習紀錄約定，讀學習索引、學習者檔案與相關主題的證據。
2. 請求是 preflight／debrief 就選實作類參考文件，否則走一般教學模式。
3. 課程定案前先跑 Level 0，用白話問三件事：目標、講法（A ★ 職場鬼故事 / B 類比 / C 直接講）、深度。等使用者選好；有說目標就用目標，沒有就用標準的心智模型視角。
4. 在 `~/scratch/` 建一份給學習者看的 Markdown 進度表（不進追蹤檔），路徑告訴學習者；有 task plan 工具也一併建立。從一個窄的關卡開始，答案顯示哪裡不會或少了先備知識再調整。
5. 每關照 `teaching-style.md` 的形狀：事故開場 → David 收拾 → 一行「這個叫 X」→ 回到你的情況 → 一題。一次只教一個概念或一個決定。
6. 在聊天裡問正好一題能真正測出東西的問題：測理解就出測驗，真實決定就出 shotcall。等回答再前進。
7. 答對就前進並預告下一關；答錯就換一個事故或角度在同一關重講，不重貼同一套話。
8. 每關結束更新進度表，並靜默更新學習紀錄。使用者沒明確問就不提記帳。
9. 收尾時總結學習者展示了什麼，給可執行的下一步。最後一關通關走 `celebration.md` 的盛大收尾；中途停下一個 kaomoji 就好。

## 不可退讓的規則

- 使用者沒問紀錄就不把記帳寫進課程輸出。進度表是給學習者看的，記帳是給 skill 用的，兩者分開。
- 一次只問一題實質的 MCQ 或 shotcall。一批題目不是 level-up 的互動方式。
- 不蓋掉、不悄悄改學習者的講法、深度或目標。要改就在 Level 0 確認點問。
- 關卡和步驟用「意思」命名，不用編號，而且主詞、動作要寫出來。禁止「第幾層」這種要人背的說法，也禁止「它不認你」這種少了主詞受詞的模糊名；順序要講就用名字串起來，例如「找不到那台機器 → 機器沒開門 → 鎖不認你的鑰匙」。
- 出現 CLI 參數時，每個字母都展開成完整英文字加一句 zh-TW，例如 `-v` verbose 多講話、`-a` archive 原樣保留。禁止只丟 `-avh`。
- 指令要講清楚在哪台機器上跑、問的是哪台的密碼。學習者有多台機器時，每個指令前標明「在 M2 上」這種字。
- 髒話只能在角色對話或內心 OS，不能對讀者講。
- 依學習紀錄約定，只記能改善之後教學的最小證據。不存 secrets 或整份對話。
- 跳過 preflight／debrief 時只靜默記工作流程事件，不動主題熟練度。
