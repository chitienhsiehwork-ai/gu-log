# ShroomDog Editorial Feedback Corpus

這份檔案是 gu-log 的「feedback corpus」：ShroomDog / Sprin 對文章、標題、用字、事實查核、敘事節奏、讀者困惑點的所有回饋，都先原樣收進來。

目的不是做漂亮文件，而是累積真實修稿資料。等樣本夠多，再把這些例子蒸餾進 `GU-LOG_WRITER_PROMPT.md`，讓 GPT-5.5 / Codex / Claude Code / Iris 都從同一份 gu-log writer prompt 學到 ShroomDog 的偏好。

## 使用規則

- ShroomDog 對 gu-log 給出任何 editorial feedback，就立刻 append 到這份檔案。
- 每筆至少記四件事：原始回饋、文章/情境、實際修法、可重用 lesson。
- 不要只寫「語氣再自然一點」這種抽象話；要保留具體 bad example / good example。
- 這是 repo-tracked source of truth。不要把新的 gu-log 寫作回饋只記在聊天紀錄、個人 memory、未追蹤檔案或單一 agent 的私人筆記裡。
- 寫 SP / CP / SD / Lv 前，如果任務涉及文章品質或風格，先快速掃這份檔案的近期條目。
- 當同一類 feedback 出現 3 次以上，應該蒸餾進 `GU-LOG_WRITER_PROMPT.md`，必要時再同步到 pipeline prompt；不要永遠只留在 corpus 裡。

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

### Meta-feedback: ShroomDog feedback 要累積，之後蒸餾進 writer prompt

- ShroomDog feedback：`For every feedback from me, ShroomDog, u shall note down each feedback at some place, maybe git untracked, then one day we need to summarize them into prompt for 5.5, to write good gu-log posts.`
- 情境：文章修稿回饋如果只留在 Telegram thread 或單一 Clawd memory，其他 agent 吃不到，未來也很難蒸餾進 `GU-LOG_WRITER_PROMPT.md`。
- 修法：先建立 feedback corpus，記錄 feedback / fix / lesson，之後再蒸餾進 `GU-LOG_WRITER_PROMPT.md`。
- Reusable lesson：ShroomDog 每次 correction 都是 gu-log 風格訓練資料。不要只修當下那篇，要把 pattern 留下來。

### Meta-feedback: feedback corpus 應該由 gu-log repo 追蹤，不能只放在單一 agent memory

- ShroomDog feedback：`So where is the feedback corpse? How do u make sure all ai agents, clawd, iris, mac-cdx/cc will do this? Maybe we need to make it git tracked by gu-log, on my second thought`
- 情境：第一版 log 放在 `/home/clawd/clawd/memory/gu-log-shroomdog-feedback.md`，這只保證 OpenClaw Clawd 看得到，不保證 Iris、mac-CC、Codex、Claude Code、pipeline writer 都會讀。
- 修法：把 corpus 移到 gu-log repo tracked file：`docs/shroomdog-editorial-feedback.md`，並在 repo-level instructions / writing guide / Clawd Picks prompt 裡加入口規則。
- Reusable lesson：跨 agent 行為不能靠某個 agent 的私人記憶。要放在 repo-tracked SSOT，並從所有常用 agent entrypoint 指向它。

## 2026-05-08 — SD-22 Context Window Mental Model

### Feedback: Project Hail Mary / Ryland Grace 是 context window 的好比喻

- ShroomDog feedback：`model is weird guy that has studied phd for colleges for like 500 years but has a disease that always wake up with zero person memory, just like Rylan Grace in Project hail mary`；後續補充：`Also mention ryland grace and project hail mary in gu-log, bc i fucking luv it`
- 情境：SD-22 要建立 `context window` 的多層 mental model，避免 glossary 寫成小文章。
- 修法：把文章主軸改成「模型像讀了五百年博士班、但每天醒來失憶的怪人」，並用 Ryland Grace / Project Hail Mary 第一章前提做 spoiler-light 類比。
- Reusable lesson：抽象 AI infra 概念可以先找一個讀者熟悉的故事人物當 anchor。比起直接講 token limit，先給「失憶天才醒來看桌面」會更容易延伸到 context、memory、agent workflow。

### Feedback: Harness 是怪人周圍的一切

- ShroomDog feedback：`We can also mention that harness is everything around him.`
- 情境：SD-22 第一版已區分 pretraining、context window、memory，但還沒有把 `Agent Harness` 放進 Ryland Grace 類比。
- 修法：補一層：model = 怪人，context window = 醒來後看得到的桌面，memory / RAG = 旁邊可查的櫃子，agent harness = 整個房間、工具、交接流程與叫醒他的制度。
- Reusable lesson：講 agent 系統時，不要只講模型本體和上下文。Harness 是「環境設計」：誰叫醒模型、放哪些資料、給哪些工具、什麼時候查記憶、什麼時候交接與重開 session。

### Feedback: Context Window 主比喻應該是時間 / 事件，不是桌面

- ShroomDog feedback：`比起桌面 我更想比喻為模型的世界的「時間」`；`桌面這個比喻太常看到了`；補充說明：`I want to use time/event for all thing for the day of a model.`
- 情境：SD-22 初版仍以桌面 / 便條紙作為主比喻，雖然有「模型的一天」段落，但原創性與解釋力不夠集中。
- 修法：重構全文主軸：Context Window = Ryland 的一天；Token 使用量 = 模型世界的時鐘；user message / tool result / file read = 當天發生的事件；桌面比喻只保留為舊比喻對照，不再當主軸。
- Reusable lesson：桌面比喻只能解釋容量，時間 / 事件比喻可以同時解釋 prompt 成本、疲勞、長 context 混淆、壓縮、harness 設計和新 session。遇到太常見的 AI 比喻時，優先尋找更能產生新推論的 framing。

### Feedback: System prompt / AGENTS.md 是早上的課

- ShroomDog feedback：`AGENTS.md and system prompt human/program teach a lesson to model.`；`If the lesson is fucking long, after reading AGENTS.md, it is already night...`；`if the lesson is taught cripy and on point, it is just 10 am for model's morning.`
- 情境：需要解釋為什麼 long system prompt / workspace instructions 會吃掉模型當天的事件容量。
- 修法：加入「早上的課」段落：系統提示、AGENTS.md、developer instructions、user request 是 Ryland 起床後的第一堂課。課太長 = 還沒工作就傍晚；課精準 = 早上十點就上手。
- Reusable lesson：Prompt hygiene 不是越多規則越好，而是讓模型用最少「世界時間」建立正確行為。寫 instructions 時要用「這會消耗模型一天的早晨」來衡量成本。

### Feedback: Compression 是真正過夜，但隔天看昨天錄好的課

- ShroomDog feedback：`Compression -> 我覺得當成真的過夜比較好`；`只是前一天發生的事是錄成課程給隔天看，課程有好有壞有長有短，看 harness 決定跟怎麼錄課程`
- 情境：前一版把 compression 說成「不是睡覺，只是整理桌面」，與 time/day 模型不完全一致。
- 修法：改成 compression = 昨天結束、今天開始；但昨天不是完整保留，而是被 harness 錄成一堂課給新的 Ryland 看。課錄得好，隔天早上十點進入狀況；錄得爛，隔天一早就在看混亂監視器。
- Reusable lesson：在時間模型裡，compression 應該被寫成「跨日 handoff 品質」問題，而不是單純摘要或空間整理問題。

### Feedback: Harness 可以是宇宙飛船，也可以是收信室

- ShroomDog feedback：`有些 harness 像宇宙飛船，有給模型航行宇宙的能力，錯了也會想辦法通知模型`；`有些 harness 就像收信室，唯一要讓模型做的事就是收信寫信發信`
- 情境：需要讓讀者理解同一個 model 放在不同 harness 裡，能力、風險、世界邊界會完全不同。
- 修法：加入 Agent Harness 世界觀段落：spaceship harness 提供導航、工具、檔案、測試、錯誤警報，讓 Ryland 航行宇宙；mailroom harness 只讓 Ryland 收信、讀信、寫信、發信，能力窄但邊界清楚。
- Reusable lesson：Agent Harness 不是 wrapper 小配件，而是模型所住世界的物理規則。評估 agent 要看 model + harness，不要只看 model。

### Feedback: 稱模型為 Ryland，但不要叫 Ryland Grace

- ShroomDog feedback：`另外讓我們稱模型為 ryland, shall we? Just not ryland grace。（然後我們可以吐槽，對，就是這麼剛好撞名）`
- 情境：文章借 Project Hail Mary 的醒來失憶比喻，但不應直接把模型稱為原作角色。
- 修法：正文稱模型人格為 Ryland，明確說「不是 Ryland Grace」，並用 ClawdNote 吐槽撞名。
- Reusable lesson：借用流行文化比喻時，可以保留情感連結和讀者記憶點，但要避免把角色本身硬套成技術概念；命名可 playful，但要清楚邊界。

### Feedback: 以前小 context 模型像無尾熊

- ShroomDog feedback：`以前模型 context window, 是他們一天只有兩小時能醒著做事，根本無尾熊`
- 情境：需要把模型 context window 的歷史演進放進時間比喻。
- 修法：加入 koala 段落：以前小 context 模型一天只醒兩小時，吃完系統提示桉樹葉就剩半小時能工作；現在 long context model 可以醒三天三夜，但需要更好的作息管理。
- Reusable lesson：歷史演進不要只寫數字變大。用「一天能醒多久」講小 context → long context，可以自然解釋為什麼早期 prompt engineering 特別緊繃，以及為什麼長 context 不等於更聰明。

### Feedback: ClawdNote jokes must stay spoiler-free

- ShroomDog feedback：`外星朋友 in clawd note is sorta spoiling tho`
- 情境：SD-22 的 ClawdNote 為了吐槽 Ryland 撞名，寫了「不會偷走任何外星朋友」；英文版也提到 `Rocky remains safe`。對沒讀過 Project Hail Mary 的讀者來說，這已經暗示超過第一章設定。
- 修法：改成「不會碰書裡任何驚喜」/ `every surprise in the book remains safe`，保留玩笑但移除具體暗示。
- Reusable lesson：引用小說 / 電影類比時，ClawdNote 的梗也要遵守 spoiler boundary。可以吐槽撞名、宇宙文學部、第一章前提，但不要暗示後續角色、種族、關係或劇情驚喜。

### Feedback: Spaceship harness risk should feel probabilistic, not just dramatic

- ShroomDog feedback：`宇宙飛船的 Ryland 能做大事，但如果航行規則寫爛、警報系統亂叫、工具結果亂塞，三天後他也可能在太空中精神崩潰。 -> 改成宇宙飛船的 Ryland 有可能一個手滑開飛船去撞火星，Ryland 是 LLM，是機率模型，手會有手汗，總是有滑的那麼一天`
- 情境：SD-22 的 spaceship harness 段落原本把風險寫成「精神崩潰」，比較像擬人化疲勞，沒有點出 LLM 的 probabilistic failure surface。
- 修法：改成「一個手滑，把飛船開去撞火星」；補出 Ryland 是 LLM / probabilistic model，手會有手汗，總有滑的一天。
- Reusable lesson：寫 agent 風險時，不要只寫 dramatic breakdown。更準的是 probabilistic failure：模型不是邪惡或瘋掉，而是長期操作高權限工具時，總有一次 sampling / interpretation / tool-use slip。高能力 harness 的風險要寫成「blast radius × inevitable slip」。

### Feedback: Avoid AI-ish summary endings; land the metaphor instead

- ShroomDog feedback：`收尾的「一句話記住」，太 ai 了 xD`
- 情境：SD-22 的結尾用「一句話記住」做摘要，像 AI 筆記或考前複習，和全文 Ryland/time metaphor 的故事感不一致。
- 修法：改成「天快亮以前」/ `Before dawn`，用 Ryland 的一天收束：早上的課、白天事件、過夜課程，最後落在「別問 Ryland 能不能再撐一下。先看現在幾點。」
- Reusable lesson：gu-log 原創 metaphor essay 不要用 AI-ish summary heading 收尾。結尾要回到故事核心，留一句能被記住的 punchline，而不是把前文做成條列式重點整理。

### Feedback: Funny but spoiler-free proper-noun jokes

- ShroomDog feedback：`命名巧合委員會超好笑 有夠荒謬`
- 情境：前一版「宇宙文學部」雖然比直接提劇情安全，但仍然有宇宙方向的暗示。
- 修法：改成「命名巧合委員會」/ `Naming Coincidence Committee`，保留荒謬官僚笑點，移除科幻/宇宙暗示。
- Reusable lesson：spoiler-sensitive jokes can be funny through bureaucracy, committees, legalese, or naming coincidence — no need to lean on story-specific nouns.

### Feedback: Post version should be programmatically enforced

- ShroomDog feedback：`版本號怎麼會是要 ai 手改，鐵定是程式要會直接反應版本號吧`
- 情境：SD-22 已經有多個 content-touching commits，但 production still showed v1 because committed `src/data/post-versions.json` was stale. The site needs committed manifest data on shallow Vercel clones.
- 修法：add `--check` mode to `scripts/build-version-manifest.mjs`, wire CI `validate-content` to fail when `post-versions.json` is stale, and add `pnpm versions:check`. This makes stale versions a failing check instead of relying on AI memory.
- Reusable lesson：If a visible value is derived from git history, CI must enforce freshness. Do not rely on agents remembering to hand-edit or regenerate derived manifests.

### Feedback: Reserve vibe 10 for truly ceiling-level pieces

- ShroomDog feedback：`Maybe we can give it a vibe 10 (for the final, refined version that i said yes)` → later adjusted to `還是回到9好了，感覺差10還是差了一點，總是能再更好一點`
- 情境：SD-22 went through several ShroomDog-directed refinements and became a stronger original mental model than the initial draft, but 10/10 felt too absolute after reflection.
- 修法：write frontmatter `scores.vibe` as 9/10 with model marker `ShroomDog final vibe adjustment (refined SD-22)` so the displayed score reflects the final editorial verdict while preserving room above it.
- Reusable lesson：Automated tribunal scores are useful gates, but ShroomDog can override final vibe for original essays after editorial convergence. Keep 10/10 rare; if the piece still feels like it can obviously get better, 9 is the more honest score.

### Feedback: Use actual VibeScorer output instead of editorial override when requested

- ShroomDog feedback：`Let's rollback to the score vibe scorer gave (can u see that or find that?)`
- Evidence found：latest final SD-22 vibe scorer logs showed `composite=9 agent_verdict=PASS` for both zh and en (`tribunal-20260508-233301...` and `tribunal-20260508-233401...`). Re-run with `TRIBUNAL_SCORE_OUTPUT` captured the full judge JSON: all vibe dimensions 9/10 for both languages, model `gpt-5.5`.
- 修法：replace the ShroomDog editorial override marker with the actual VibeScorer frontmatter score: `persona/clawdNote/vibe/clarity/narrative = 9`, `score = 9`, `model = gpt-5.5`.
- Reusable lesson：If the user asks for "the score the scorer gave," do not keep an editorial override label even if the numeric score matches. The visible badge should identify the machine judge/model, not ShroomDog's later calibration note.

### Feedback: Context-window-as-day beats desktop because it carries order

- ShroomDog feedback：`one more reason the metaphor of Context Window ~ LLM's day is that both time and context window filliment has order, while the desktop metaphor does not include this meaning` and `instead of we, use human`.
- 情境：SD-22 already explained capacity and fatigue, but the one ShroomDogNote could better explain why the day metaphor is structurally stronger than the desktop metaphor.
- 修法：expand the only ShroomDogNote to say desktop explains capacity but misses order; context arrives along token time, so later tool results are later events in Ryland's day. Use `human` / `humans`, not `we`, when contrasting reader wall-clock time with Ryland's token time; in zh-tw prose use `人類` to avoid 晶晶體.
- Reusable lesson：When comparing metaphors, state the missing semantic dimension directly. Here: desktop = capacity/simultaneity; day = capacity + ordered experience + different clocks. If the EN instruction says `human`, translate the zh-tw article naturally unless `human` is being used as a literal technical term.

### Feedback: Spoiler disclaimers should sound human, not legalistic

- ShroomDog feedback：`這不是什麼大雷，基本上就是第一章的核心設定。` felt unnatural; suggested `希望沒有暴雷，這只是第一章的內容嗚嗚`.
- 情境：SD-22 references the opening setup of *Project Hail Mary*. The original disclaimer sounded like an explanatory legal note rather than ShroomDog's voice.
- 修法：change the zh line to `希望沒有暴雷，這只是第一章的內容嗚嗚。`; mirror the EN tone naturally as `Hopefully that doesn’t count as a spoiler — it’s just from the first chapter, I swear.`
- Reusable lesson：When spoiler-sensitive gu-log notes are low-stakes, prefer a slightly sheepish human aside over stiff wording like `not a real spoiler` / `core setup`. Avoid literal translated-meme English like `sob` unless the whole EN post is intentionally doing anime subtitle voice.

### Feedback: Chinese analysis source is not a No-go reason

- ShroomDog feedback：`他又沒有 clawdNote / 故事性跟 gu-log 也不一樣 / 而且我也不喜歡看簡體 / 以後你提到的中文分析文不是理由 / 再驗證數字也是你的工作 / 二手整理也沒問題，或我們可以直接重寫然後 cite 他就好`
- 情境：SP-195 candidate was initially rejected partly because the source was already a Chinese analysis article and some numbers needed verification.
- 修法：treat the source as usable. Rewrite it into gu-log’s story-driven format, cite the original Yage AI article, verify primary OpenAI/Cursor documentation, and make the gu-log value come from narrative, ClawdNote, Traditional Chinese, and ShroomDog/Clawd framing rather than pretending the source language is a blocker.
- Reusable lesson：Do not reject gu-log/SP candidates because the source is Simplified Chinese, already analytical, or second-hand. Source verification is Clawd’s job. No-go only after verification shows the facts are unreliable, uncheckable, incomplete, or unable to support the 8/8/8 bar.
