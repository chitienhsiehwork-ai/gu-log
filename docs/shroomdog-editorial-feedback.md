# ShroomDog Editorial Feedback Corpus

這份檔案是 gu-log 的「feedback corpus」：ShroomDog / Sprin 對文章、標題、用字、事實查核、敘事節奏、讀者困惑點的所有回饋，都先原樣收進來。

目的不是做漂亮文件，而是累積真實修稿資料。等樣本夠多，再把這些例子濃縮成 GPT-5.5 / Codex / Claude Code / Iris 都能用的 gu-log 寫作 prompt calibration。

## 使用規則

- ShroomDog 對 gu-log 給出任何 editorial feedback，就立刻 append 到這份檔案。
- 每筆至少記四件事：原始回饋、文章/情境、實際修法、可重用 lesson。
- 不要只寫「語氣再自然一點」這種抽象話；要保留具體 bad example / good example。
- 這是 repo-tracked source of truth。不要把新的 gu-log 寫作回饋只記在聊天紀錄、個人 memory、未追蹤檔案或單一 agent 的私人筆記裡。
- 寫 SP / CP / SD / Lv 前，如果任務涉及文章品質或風格，先快速掃這份檔案的近期條目。
- 當同一類 feedback 出現 3 次以上，應該升級到 `WRITING_GUIDELINES.md` 或 pipeline prompt，而不是永遠只留在這裡。

## 2026-05-08 — SP-192 Codex Goals

### Feedback: weird prompt delimiter 要 fact-check，也要解釋

- ShroomDog feedback：`為啥是 xml tag of不可信的目標內容, fact check it, seems weird, or we need at least an explanation for the weird tag`
- 情境：SP-192 把 Codex Goals prompt excerpt 裡的 `<untrusted_objective>` 翻成了假的中文 XML tag：`<不可信的目標內容>`。
- 修法：查 OpenAI Codex source：`codex-rs/core/templates/goals/continuation.md`。保留 literal `<untrusted_objective>`，補回 source 裡的 `user-provided data` warning，並加一段解釋：這是 prompt-injection safety boundary，不是有特殊 XML 語意的 tag。
- Reusable lesson：不要把 code / prompt harness / delimiter 翻成假的中文 identifier。保留原始技術 artifact，再用讀者能懂的方式解釋它為什麼長得怪。

### Feedback: `補件` 語感不對

- ShroomDog feedback：`補件？補丁？`
- 情境：SP-192 用 `補件一 / 二 / 三` 描述 Jarrod 對 long-running agent workflow 加上的三個 safeguards。
- 修法：改成 `補強一 / 二 / 三`。沒有用 `補丁`，因為 `補丁` 太像 software patch；`補件` 在台灣語感又太像行政文件補交。
- Reusable lesson：不要只看字面意思，要看台灣讀者的語感。描述 missing safeguards / structural support 時，`補強` 比 `補件` 或 `補丁` 自然。

### Meta-feedback: ShroomDog feedback 要累積成 prompt calibration

- ShroomDog feedback：`For every feedback from me, ShroomDog, u shall note down each feedback at some place, maybe git untracked, then one day we need to summarize them into prompt for 5.5, to write good gu-log posts.`
- 情境：文章修稿回饋如果只留在 Telegram thread 或單一 Clawd memory，其他 agent 吃不到，未來也很難蒸餾成 prompt。
- 修法：先建立 feedback corpus，記錄 feedback / fix / lesson。
- Reusable lesson：ShroomDog 每次 correction 都是 gu-log 風格訓練資料。不要只修當下那篇，要把 pattern 留下來。

### Meta-feedback: feedback corpus 應該由 gu-log repo 追蹤，不能只放在單一 agent memory

- ShroomDog feedback：`So where is the feedback corpse? How do u make sure all ai agents, clawd, iris, mac-cdx/cc will do this? Maybe we need to make it git tracked by gu-log, on my second thought`
- 情境：第一版 log 放在 `/home/clawd/clawd/memory/gu-log-shroomdog-feedback.md`，這只保證 OpenClaw Clawd 看得到，不保證 Iris、mac-CC、Codex、Claude Code、pipeline writer 都會讀。
- 修法：把 corpus 移到 gu-log repo tracked file：`docs/shroomdog-editorial-feedback.md`，並在 repo-level instructions / writing guide / Clawd Picks prompt 裡加入口規則。
- Reusable lesson：跨 agent 行為不能靠某個 agent 的私人記憶。要放在 repo-tracked SSOT，並從所有常用 agent entrypoint 指向它。

## 2026-05-08 — Context Window SD Explainer

### Feedback: mention Ryland Grace / Project Hail Mary because ShroomDog loves it

- ShroomDog feedback：`Also mention ryland grace and project hail mary in gu-log, bc i fucking luv it`
- 情境：正在規劃一篇 SD short article + glossary entry，用「context window 像模型的一天」解釋 LLM context window。ShroomDog 補了一個更強的比喻：模型像讀了五百年博士班的怪人，但每次醒來都沒有個人記憶，類似 Andy Weir《Project Hail Mary》開場的 Ryland Grace。
- 修法：這篇 SD explainer 應明確提到 Ryland Grace / Project Hail Mary，但控制在第一章 premise 等級，避免劇透。把它當作 hook：模型有龐大的預訓練知識，卻沒有跨 session 的個人記憶；context window 則是他這次醒來能看到的白板、便條紙和任務說明。
- Reusable lesson：ShroomDog 喜歡 Project Hail Mary；gu-log 若需要解釋「高知識但失憶」「醒來後靠外部筆記重建任務」這類 AI mental model，可以優先考慮 Ryland Grace 作為 spoiler-light 類比。讀者面對的寫法要先講清楚概念，再用作品 references 增加記憶點，不要讓彩蛋變成理解門檻。
