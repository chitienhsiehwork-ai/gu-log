## Context

GP 在 Tribunal 只評分（`gp-source-preservation`）：正文一改，來源距離章就失效，所以 Tribunal 不能叫寫手修。非 GP 文章沒過時會進改寫迴圈，最後沒過就不寫那一關的分數；GP 沿用這條規則，就會少一個分數區塊，而 `validate-posts` 要求四個分數區塊都在，GP 只要一關沒過就部署不了。前 10 篇導讀試做的第一篇就卡在這裡。

## Goals / Non-Goals

**Goals:**

- 沒到 PASS 門檻、但過了分數下限的 GP 可以照 CONTRIBUTING〈兩層品質門檻〉只上繁中。
- GP 的每個分數都是那一版正文實際評出來的結果，沒過的也照實記錄。

**Non-Goals:**

- 改分數下限、PASS 門檻或 `validate-posts` 對分數區塊的要求。
- 改非 GP 的改寫迴圈或分數寫入時機。
- 修 Tribunal v2 寫 `factCheck` 時缺維度的既有問題（跟 GP 無關，兩種文章都受影響）。

## Decisions

### 1. GP 沒過也寫分數，而且其餘評審照樣評分

GP 不會被改寫，沒過的那一關重評也只會拿到同一版正文的另一次抽樣，所以直接把這次的分數寫進 frontmatter，接著評完其餘關卡，最後以失敗結束。能不能上線交給分數下限，PASS 門檻決定能不能上首頁與英文版。

替代方案是放寬 `validate-posts`，讓 GP 缺分數區塊也能過。這樣網站會顯示不完整的評審結果，分數下限也失去依據，所以不採用。

### 2. 非 GP 維持原規則

非 GP 沒過時會進改寫迴圈，最後的正文跟評分時的正文不一定相同，照舊只在 PASS 後寫分數。

### 3. 兩個入口一起改

`scripts/tribunal.sh` 是 gp-pipeline 與部署版在用的入口，`pnpm tribunal:run` 也接受 GP，兩個入口都要跑完每一關並寫入每一關的分數；只改一邊，走另一邊的 GP 還是會卡住。

## Risks / Trade-offs

- [重跑時會重評已經沒過的關卡] GP 不會被 Tribunal 改寫，同一版正文重跑會再評一次，多花額度，也可能評出不同分數。本 change 不處理：試過「正文沒變就跳過已記錄的 FAIL」，但要可靠判斷「評審看到的內容有沒有變」，不能只看正文（FactChecker 也會評 title 與 summary）。之後要做，應該直接沿用 pre-commit 判斷分數是否過期的內容指紋（`scripts/reader-revision-of-stdin.mjs`），不要另寫一套。
- [Tribunal v2 的 `factCheck` 缺維度] 走 v2 的文章仍過不了 `validate-posts`；這是既有問題，本 change 不處理。
