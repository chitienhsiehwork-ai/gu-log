# Design

## 逐行看新增內容，不解析文章

舊 gate 先把 MDX 解析成「讀者看得到的表面」：frontmatter 哪些欄位會顯示、component props、圖片 alt、code block，還要解 HTML entity 和 CSS／JS escape，算不出來的運算式一律擋。這是在防「有人刻意讓原始碼不含 emoji、渲染後卻冒出 emoji」，但 gu-log 的寫手是 LLM 和 ShroomDog，沒有這種對手。

新做法直接看原始碼的新增行：frontmatter、正文、component、code block 一視同仁。文章原始碼裡本來就不該有 emoji，不需要先判斷那一行讀者看不看得到。

## 偵測器沿用 `scripts/lib/emoji-sequences.mjs`

這支 63 行的偵測器已經處理 ZWJ 組合、旗幟、keycap，也知道 kaomoji 裡的 `♥` 不算 emoji。它不大、行為也對，直接沿用。

## 核准清單寫在腳本裡

核准紀錄只留 `{ path, emoji, reason }`，放在 `scripts/check-content-emoji.mjs` 開頭。同一篇文章裡被核准的 emoji，出現在哪一行、出現幾次都放行。舊版要綁行號、整行 hash、數量，連 feedback corpus 都要鏡像一份；這套機制上線兩個月沒用過一次。改這份清單本身就要過 PR，git history 就是稽核紀錄。

## 取捨

- 渲染後才出現的 emoji（HTML entity `&#x1F600;`、CSS `content: "\1F600"`、MDX 運算式拼出來的字串）不再擋。要寫出這種東西得刻意為之，不是 LLM 順手會犯的錯。
- 核准不再精確到某一行：同一篇文章之後再加同一個 emoji 也會放行。可以接受，因為核准本來就是 ShroomDog 對這篇文章的判斷。
- gp-pipeline 直接給檔案時，整份檔案每一行都算新增，而且不套核准清單，跟舊行為一樣。
