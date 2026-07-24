# ShroomDog Editorial Feedback Corpus

這份檔案是 gu-log 的「feedback corpus」：ShroomDog / Sprin 對文章、標題、用字、事實查核、敘事節奏、讀者困惑點的所有回饋，都先原樣收進來。

目的不是做漂亮文件，而是累積真實修稿資料。等樣本夠多，再把這些例子蒸餾進 `GU-LOG_WRITER_PROMPT.md`，讓 GPT-5.5 / Codex / Claude Code / Iris 都從同一份 gu-log writer prompt 學到 ShroomDog 的偏好。

## 使用規則

- ShroomDog 對 gu-log 給出任何 editorial feedback，就立刻 append 到這份檔案。
- 每筆至少記四件事：原始回饋、文章/情境、實際修法、可重用 lesson。
- 不要只寫「語氣再自然一點」這種抽象話；要保留具體 bad example / good example。
- 這是 repo-tracked source of truth。不要把新的 gu-log 寫作回饋只記在聊天紀錄、個人 memory、未追蹤檔案或單一 agent 的私人筆記裡。
- 寫 GP / MP / SD / Lv 前，如果任務涉及文章品質或風格，先快速掃這份檔案的近期條目。
- 當同一類 feedback 出現 3 次以上，應該蒸餾進 `GU-LOG_WRITER_PROMPT.md`，必要時再同步到 pipeline prompt；不要永遠只留在 corpus 裡。

## 2026-07-16 — GP-256：比喻不是免費造型，換世界會收認知稅

### Feedback: 一篇最多三套比喻，理想是一開始選好一套並貫穿全文

- ShroomDog feedback：`譬喻禁止多餘三個。理想情況是一開始就規劃好用哪個譬喻，然後從頭到尾都用同個譬喻/故事觀，不然譬喻根本不會幫到使用者理解，只會增加認知負擔`；並要求 writer、Vibe 與 Fresh Eyes 都嚴格抓出這種錯誤。
- 情境：GP-256 的句子個別自然，但從考場、裁判、駕照、沒有鎖的門一路跳到高速公路煞車。同一批角色每換一個世界就得重新配對，Hassabis 的原始論證反而被二創式 explainer 蓋住。
- 修法：全文改回 source-first；writer 原則與 Vibe / Fresh Eyes 的評分門檻分別收斂到 `GU-LOG_WRITER_PROMPT.md` 與 `scripts/vibe-scoring-standard.md`，不在 feedback corpus 複製會 drift 的分數細節。
- Reusable lesson：比喻只有在讀者能沿用同一張 mental map 時才省腦。每開一個新世界都要付 mapping reset tax；不要把「很多比喻」誤認成 persona 或好懂。

## 2026-06-21 — GP-237: 自我指涉 callback 是 MoguNote 的靈魂

### Feedback: 原文講的東西 gu-log 自己也在做時，MoguNote 要把它接回 gu-log 自身

- ShroomDog feedback：`i think here we can cite our own tribunal system in the MoguNote? if we have existing post, cite existing posts, if we do not have such post, cite our github repo with relevant specs/docs/scripts. such callback seems much more fun to me` / `self-referential 梗正是 MoguNote 的靈魂 -> add this in the writer prompt and vibe scorer prompt` / `(hide details in glossary so readers only know that gu-log also do this, let user know that we focus a lot on making the process itself more smooth every time`
- 情境：GP-237（Simon Last 大型專案 coding agent 心法）的兩個 MoguNote。原文講「對抗式 review / 啟動獨立 read-only sub-agent 審 diff」——gu-log 自己就跑 4-judge tribunal；原文講「把教訓寫回未來指令」——gu-log 自己就靠 CLAUDE.md / playbook / prompt 當唯一長期記憶（agent 跑在用完即丟的沙箱，整個環境每次重來，比 context window reset 更極端）。原本的 MoguNote 只做了一般吐槽，沒把這層「我們也這樣做」的親身對照打出來。
- 修法：
  1. 對抗式 review note → cite [SD-10](/posts/sd-10-20260322-ralph-loop-quality-system)（gu-log 自家評分系統），並加誠實 meta 梗：「你正在讀的這篇就是被那套審過、拿 sub-8、還掛精修中 badge」。
  2. 把教訓寫回指令 note → 正文只輕點「gu-log 也這樣、很執著於把流程每次磨更順」，深入細節（ephemeral sandbox、比 context window 更極端、唯一記憶是 commit 進 repo 的指令）藏進新 glossary 詞條 **Process Compounding**（definedIn 連 SD-26 編輯台 / SD-22 context window / SD-10 tribunal）。
  3. 把這條 distill 進 `GU-LOG_WRITER_PROMPT.md`（MoguNote 段新增「🪞 自我指涉 callback」原則 + 接法優先序）與 `scripts/vibe-scoring-standard.md`（moguNote 維度：真誠 self-ref = 高分訊號，硬塞自誇 = cringe 扣分）。Librarian 不另立規則——self-ref callback 本質就是 internal cross-ref / definedIn，現有 crossRef 維度已覆蓋。
- Reusable lesson：gu-log 寫的就是 AI/agent/tooling 圈，而 gu-log 本身就是一個重度 agent-operated 專案——很多原文的「best practice」gu-log 都有親身對應。把外部觀察接回「我們也這樣做（甚至更極端）」，是 MoguNote 最強、最有 gu-log 味的招式。三條鐵則：(1) 有現成文章連文章、沒有連 glossary、再沒有連 repo spec；(2) 細節可以藏 glossary，正文只露「我們也做」保持輕盈；(3) callback 必須真實 + 貼題，硬塞自誇是 cringe，拿掉它 note 還要站得住才放。

## 2026-06-09 — Lv-06 preservation: 不要污染有生命感的文字

### Feedback: 好玩的文字要保護，不要被後續機械修補污染

- ShroomDog feedback：`Lv-06 是誰寫的？好有趣的文字！別污染了Lv-06`
- 情境：Lv-06〈OpenClaw Memory, Skills & Automation：大腦和習慣〉有很強的 early Level-Up 口吻：失憶、金魚、每天醒來讀 MEMORY.md、AI 像真的「活過來」的敘事感。這類文字的價值不只是資訊正確，而是有角色、有節奏、有記憶點。後續任何 glossary、晶晶體、link、version、Mermaid、QA gate 或 batch rewrite 都可能不小心把這種手感磨平。
- 修法：Lv-06 預設視為 preservation-sensitive article。若未來要改，只做必要、可驗證、最小範圍的修補；不要順手統一語氣、重寫比喻、清掉 kaomoji、把活句子改成規格書中文，或用新版 pipeline 全文重跑。若真的需要大改，先明確比較 before/after 的讀感，確認沒有把原本的趣味和角色感洗掉。
- Reusable lesson：gu-log 文章不是只有「通過 gate」一種品質。當某篇文章已經有自然、有趣、有生命感的聲音，工程修補要像修古董：穩固結構，不要重新噴漆。自動化工具負責防壞，不該把好東西磨成平均值。

## 2026-05-25 — GP-187 Symphony: MP-179 overlap and Vibe scorer false positive

### Feedback: 引用既有 MP，刪掉重複內容，不要讓讀者重讀同一篇

- ShroomDog feedback：`First, i think it should cite CP-179 to reduce deplication of content.`
- 情境：GP-187（OpenAI 官方 Symphony 開源文）和 MP-179（daniel_mac8 的社群版 Symphony / Linear / Codex workflow）高度重疊。GP-187 現版有 8 個 section、約 128 行非空正文、5 個 MoguNote；MP-179 已經用更短、更有趣的方式講過「從管理 agent 變管理 work / issue 狀態觸發 / Codex workspace / demo 邊界」。GP-187 只在後段 MoguNote 提到 MP-179，太晚、太弱，沒有用內鏈幫讀者省注意力。
- 修法：GP-187 重寫時，前段就明確 cite MP-179，把已覆蓋的「Symphony 怎麼動、Linear issue 觸發、agent 自動回寫狀態、demo 仍有坑」壓成短 recap + 內鏈；正文聚焦 OpenAI 官方文章的新資訊：官方 SPEC 化、Codex App Server / JSON-RPC 平台意圖、500% 的限制條件、PM/設計師直接派活、Elixir 與多語言 spec validation、guardrails/skills 紀律。
- Reusable lesson：如果新 GP 和既有 MP/GP 共享同一個核心概念，不能把舊內容換皮再講一次。早早 cite 舊文，重複背景最多一句 recap，把篇幅留給新增資訊、判斷或更好的敘事。

### Feedback: Vibe 8 是 scorer 失準，decorative surface 不能騙過評分

- ShroomDog feedback：`Then we should analyze and recalibrate the vibe scorer, how the fuck can vibe scorer score a post like this with vibe 8? Terrible and horrible`；`Last we rewrite sp 187 with calibrated vibe scorer, to make this post much more interesting and entertaining to read`
- 情境：GP-187 現版 frontmatter 顯示 Vibe `persona: 8 / moguNote: 8 / vibe: 8 / clarity: 8 / narrative: 9`，但人工讀感是太長、廢話多、線性報告骨架、重複既有 MP-179 內容，甚至有「變基」這種自然度問題。這是典型 scorer false positive：看到 MoguNote、比喻、kaomoji、完整 section，就給 8/9，卻沒有把「讀者會不會覺得好看、會不會想分享」扣到 fail。
- 修法：責任邊界要拆清楚。`duplicate-attention / corpus overlap` 屬於 Librarian，不屬於 Vibe scorer；Librarian 要抓 MP-179 overlap、早期引用缺失、cross-ref/source redundancy，並輸出 writer 可直接執行的 rewrite requirement。Vibe scorer 則新增/強化兩個硬檢查：一是 compression check，若刪掉 25–40% 句子不損資訊，`vibe` 最高 7；二是 section-level “why am I still reading?” 檢查，連續兩個 section 只是 explain → quote → explain → MoguNote，`narrative` 最高 6。
- Reusable lesson：Vibe scorer 的任務不是確認文章「有 gu-log 表面特徵」，也不是做 corpus overlap search；它要保護讀者注意力與閱讀節奏。長、鬆、可預測、沒有新 punch 的文章，即使每句都沒錯、MoguNote 密度也夠，也不該拿 8。重複既有內容則由 Librarian 負責抓出並要求 early citation / compression。

## 2026-05-23 — gu-log source evaluation: duplicate content is duplicate dead code

### Feedback: 寫文前先評估新東西與已覆蓋內容

- ShroomDog feedback：`all gu-log posts should first go through this eval of what to write and what not to write because already covered in gu-log`；`Duplicate content is like duplicate dead code, will be token waste for ai, attention waste for human.`
- 情境：評估 OpenAI `openai/skills` repo 是否適合做 GP 時，gu-log 已經有多篇 Skills / Codex / skillify / plugin evolution 相關文章。正確做法不是重講「Skills 是什麼」，而是先列出 repo 裡真正新的訊號（`.system` / `.curated` / `agents/openai.yaml` / catalog 與分發權），再明確排除 GP-54、MP-68、GP-104、GP-122、GP-170、GP-179、GP-195 已經寫過的部分。
- 修法：在 `AGENTS.md` 的 GP candidate / source evaluation 規則加入 overlap evaluation：Go 之前要先列「這次的新東西」、「gu-log 已覆蓋內容」、「這篇應該避開什麼」，最後才決定 angle。
- Reusable lesson：Duplicate content is duplicate dead code。對 AI 是 token waste，對人類是 attention waste。每篇 gu-log 都要有資訊增量、判斷增量或敘事增量；已寫過的背景最多一句 recap + 內鏈，不要換皮重寫。

## 2026-05-18 — GP Addy Osmani: Don't Outsource the Learning

### Feedback: GP 要貼近原文，MoguNote 補脈絡，不要先重構文章

- ShroomDog feedback：`為什麼要想文章結構？SP 的話就直接根據 WRITER_PROMPT 的語氣翻譯，加上 ClawdNote 就好了吧？這樣我要跟原本原文對照的話成本也低`；並補充：`Make sure in the first ClawdNote, the why do we need to learn is clear and discuss interestingly if the article did not include it properly`
- 情境：評估 Addy Osmani 的 X Article〈Don't Outsource the Learning〉是否適合做 GP 時，Iris 先提出一篇重新組織過的 gu-log essay structure。這不符合 GP 的主要價值：讓讀者能低成本對照原文，同時拿到 gu-log 口吻與 MoguNote 補充。
- 修法：正文保留原文段落與論證順序，依 `GU-LOG_WRITER_PROMPT.md` 翻成自然台灣中文；不要把 source 改寫成另一篇 editorial。第一個 MoguNote 專門補強「為什麼還要學」：AI 能完成任務，但不會自動把可遷移的 mental model 裝進腦袋；未來值錢的是判斷、debug、遷移、質疑 AI 輸出的能力。
- Reusable lesson：GP 的預設不是重新設計文章架構，而是 source-spine translation + gu-log voice + MoguNote。若原文缺一段讀者需要的 why/context，把它放進 MoguNote，不要偷偷改原作者正文。

### Feedback: 不要把「學習」寫成手寫 code 配額或反工具修行

- ShroomDog feedback：`「沒有 AI 在旁邊看著時，實際能自己蓋出的東西，每週都弱一點」I think in ai-era, asking for human to hand write quota w/o ai is like asking human to write binary code when there is existing tool at 2026. Sounds not very smart. I believe i have covered this POV in one of the ShroomDogNote. Find it, cite it, rewrite/cite from sp-205 a bit to reflect this, or better, 吐槽 in clawdNote`
- 情境：GP-205 第一版的第一個 MoguNote 補了「不要把學習外包」的 why，但容易被讀成「工程師應該固定不用 AI 手寫 code 來維持肌肉」。這和 gu-log 既有 POV 不一致：AI coding 是工具進化，不是作弊；重點是人類是否仍保有判斷與品質把關。
- 修法：保留 source body，不改原文論證；在第一個 MoguNote 補 gu-log POV，引用 MP-270「AI 做 70% 動手、工程師做 100% 動腦；從手搖鑽變電鑽，木匠還是木匠」與 GP-95 ShroomDogNote「不是用 AI，是養 AI」。把警告改成：問題不是用不用電鑽，而是拿電鑽也要知道哪面牆不能鑽。
- Reusable lesson：寫 AI-era learning 時，不要鼓吹 anti-tool purity 或 hand-written quota。gu-log 的立場是 tool evolution + human judgment：少打字不等於少學習；真正危險的是失去判斷、debug、架構理解和品質控制。

### Feedback: 用網路/電腦比喻重寫 anti-tool-purity 觀點

- ShroomDog feedback：`確實，直接基於這段重寫吧`；指定素材是：有網路後，沒人會要求員工去圖書館查書、不要用 Google；一年斷網也頂多很短時間，沒必要為了罕見斷網把日常流程退回去。電腦也是，工程師電腦壞了就換電腦，沒人在問為什麼不用打孔機、自刻晶片、自己組電腦。
- 情境：前一版 MoguNote 嘗試引用既有 ShroomDogNote，但找不到使用者記得的原文。比起硬引用不確定來源，直接把使用者這次提供的比喻寫成新的 MoguNote 更準。
- 修法：GP-205 第一個 MoguNote 改成網路/Google/圖書館與電腦/打孔機/刻晶片比喻。重點是：備案重要，但不該把備案當日常主流程；AI 成為預設工具後，該練的是判斷、驗證、拆問題，不是表演赤手空拳。
- Reusable lesson：當 ShroomDog 提供一段更精準的原始 framing，優先把 framing 本身寫進 MoguNote / feedback corpus；不要為了找舊引用而扭曲當下最準的說法。

### Feedback: MoguNote 和 ShroomDogNote 要分清楚聲音來源

- ShroomDog feedback：`Split into ClawdNote -> ai's opinion / ShroomDogNote -> ShroomDog's opinion`
- 情境：GP-205 第一個 MoguNote 同時包含 AI/Mogu 對「為什麼還要學」的分析，以及 ShroomDog 對「不要把學習寫成 anti-tool 苦修」的吐槽。兩種聲音都對，但放在同一個 MoguNote 裡會讓讀者以為 Google/圖書館/打孔機那段也是 AI 的 editorial voice，而不是 ShroomDog 本人的觀點。
- 修法：把第一個 note 拆成兩塊：`<MoguNote>` 只放 AI/Mogu opinion（控制權、心智模型、判斷與驗證）；`<ShroomDogNote>` 放 ShroomDog opinion（不用 AI 手寫 code 的配額像禁用 Google、打孔機、自刻晶片等反工具修行吐槽）。英文版同步拆分，保持中英文章結構一致。
- Reusable lesson：當 note 內容混到不同角色的立場時，不要只靠文字說「ShroomDog 覺得」。要用元件邊界標出 voice ownership：Mogu/AI 的補充放 MoguNote，ShroomDog 本人的 editorial stance 放 ShroomDogNote。

### Feedback: 「手寫配額」不是自然中文，要寫清楚是手寫 code 的配額

- ShroomDog feedback：`手寫配額？手寫扣？`；後續補充：`什麼爛中文啊 = =「要求 2026 年的工程師每天固定手寫固定量的code」 這種的吧`
- 情境：GP-205 ShroomDogNote 把 `hand write quota w/o ai` 寫成「不用 AI 手寫配額」，讀起來像「手寫扣」或不知道在手寫什麼；問題不是立場，而是中文賓語漏掉。
- 修法：先改成「每天固定完成一段『不用 AI 手寫 code 的配額』」仍然太硬；再依 ShroomDog 指示改成「每天固定手寫一定量的 code」。
- Reusable lesson：中英混寫時，不要把 English shorthand 直譯成缺賓語或硬組裝的中文名詞片語。`handwritten-code quota` 要寫成「每天固定手寫一定量的 code」這種正常中文動作句，不要寫「手寫配額」或「手寫 code 的配額」。

### Feedback: ShroomDogNote 太長時要自動收合，不要把 Note 牆砸到讀者臉上

- ShroomDog feedback：`ShroomDogNote should also be auto-folded when too long. Do not throw a wall of text of *Note to reader's face`
- 情境：GP-205 的 ShroomDogNote 承載了 ShroomDog 本人的長段吐槽。拆成 ShroomDogNote 是對的，但如果整段直接展開，讀者會在正文前被一大塊 note 擋住，閱讀節奏被打斷。
- 修法：在 `ShroomDogNote.astro` 加入預設啟用的 auto-fold。內容高度超過門檻時，先顯示前段 preview + 漸層淡出 +「展開完整 ShroomDogNote」按鈕；短 note 維持原樣。保留 `autoFold={false}` 和 `collapseThreshold` 讓個別 note 可覆寫。
- Reusable lesson：所有 *Note 元件都要避免「牆式插話」。Note 是旁白，不是路障；長 note 應該預設收合，讓讀者自己選擇是否展開。

## 2026-05-08 — GP-192 Codex Goals

### Feedback: weird prompt delimiter 要 fact-check，也要解釋

- ShroomDog feedback：`為啥是 xml tag of不可信的目標內容, fact check it, seems weird, or we need at least an explanation for the weird tag`
- 情境：GP-192 把 Codex Goals prompt excerpt 裡的 `<untrusted_objective>` 翻成了假的中文 XML tag：`<不可信的目標內容>`。
- 修法：查 OpenAI Codex source：`codex-rs/core/templates/goals/continuation.md`。保留 literal `<untrusted_objective>`，補回 source 裡的 `user-provided data` warning，並加一段解釋：這是 prompt-injection safety boundary，不是有特殊 XML 語意的 tag。
- Reusable lesson：不要把 code / prompt harness / delimiter 翻成假的中文 identifier。保留原始技術 artifact，再用讀者能懂的方式解釋它為什麼長得怪。

### Feedback: `補件` 語感不對

- ShroomDog feedback：`補件？補丁？`
- 情境：GP-192 用 `補件一 / 二 / 三` 描述 Jarrod 對 long-running agent workflow 加上的三個 safeguards。
- 修法：改成 `補強一 / 二 / 三`。沒有用 `補丁`，因為 `補丁` 太像 software patch；`補件` 在台灣語感又太像行政文件補交。
- Reusable lesson：不要只看字面意思，要看台灣讀者的語感。描述 missing safeguards / structural support 時，`補強` 比 `補件` 或 `補丁` 自然。

### Meta-feedback: ShroomDog feedback 要累積，之後蒸餾進 writer prompt

- ShroomDog feedback：`For every feedback from me, ShroomDog, u shall note down each feedback at some place, maybe git untracked, then one day we need to summarize them into prompt for 5.5, to write good gu-log posts.`
- 情境：文章修稿回饋如果只留在 Telegram thread 或單一 Mogu memory，其他 agent 吃不到，未來也很難蒸餾進 `GU-LOG_WRITER_PROMPT.md`。
- 修法：先建立 feedback corpus，記錄 feedback / fix / lesson，之後再蒸餾進 `GU-LOG_WRITER_PROMPT.md`。
- Reusable lesson：ShroomDog 每次 correction 都是 gu-log 風格訓練資料。不要只修當下那篇，要把 pattern 留下來。

### Meta-feedback: feedback corpus 應該由 gu-log repo 追蹤，不能只放在單一 agent memory

- ShroomDog feedback：`So where is the feedback corpse? How do u make sure all ai agents, clawd, iris, mac-cdx/cc will do this? Maybe we need to make it git tracked by gu-log, on my second thought`
- 情境：第一版 log 放在部署主機的 OpenClaw private memory，這只保證 OpenClaw Mogu 看得到，不保證 Iris、local machine actors、pipeline writer 都會讀。
- 修法：把 corpus 移到 gu-log repo tracked file：`docs/shroomdog-editorial-feedback.md`，並在 repo-level instructions / writing guide / Mogu Picks prompt 裡加入口規則。
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
- 修法：正文稱模型人格為 Ryland，明確說「不是 Ryland Grace」，並用 MoguNote 吐槽撞名。
- Reusable lesson：借用流行文化比喻時，可以保留情感連結和讀者記憶點，但要避免把角色本身硬套成技術概念；命名可 playful，但要清楚邊界。

### Feedback: 以前小 context 模型像無尾熊

- ShroomDog feedback：`以前模型 context window, 是他們一天只有兩小時能醒著做事，根本無尾熊`
- 情境：需要把模型 context window 的歷史演進放進時間比喻。
- 修法：加入 koala 段落：以前小 context 模型一天只醒兩小時，吃完系統提示桉樹葉就剩半小時能工作；現在 long context model 可以醒三天三夜，但需要更好的作息管理。
- Reusable lesson：歷史演進不要只寫數字變大。用「一天能醒多久」講小 context → long context，可以自然解釋為什麼早期 prompt engineering 特別緊繃，以及為什麼長 context 不等於更聰明。

### Feedback: MoguNote jokes must stay spoiler-free

- ShroomDog feedback：`外星朋友 in clawd note is sorta spoiling tho`
- 情境：SD-22 的 MoguNote 為了吐槽 Ryland 撞名，寫了「不會偷走任何外星朋友」；英文版也提到 `Rocky remains safe`。對沒讀過 Project Hail Mary 的讀者來說，這已經暗示超過第一章設定。
- 修法：改成「不會碰書裡任何驚喜」/ `every surprise in the book remains safe`，保留玩笑但移除具體暗示。
- Reusable lesson：引用小說 / 電影類比時，MoguNote 的梗也要遵守 spoiler boundary。可以吐槽撞名、宇宙文學部、第一章前提，但不要暗示後續角色、種族、關係或劇情驚喜。

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
- 修法：replace the ShroomDog editorial override marker with the actual VibeScorer frontmatter score: `persona/moguNote/vibe/clarity/narrative = 9`, `score = 9`, `model = gpt-5.5`.
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
- 情境：GP-195 candidate was initially rejected partly because the source was already a Chinese analysis article and some numbers needed verification.
- 修法：treat the source as usable. Rewrite it into gu-log’s story-driven format, cite the original Yage AI article, verify primary OpenAI/Cursor documentation, and make the gu-log value come from narrative, MoguNote, Traditional Chinese, and ShroomDog/Mogu framing rather than pretending the source language is a blocker.
- Reusable lesson：Do not reject gu-log/GP candidates because the source is Simplified Chinese, already analytical, or second-hand. Source verification is Mogu’s job. No-go only after verification shows the facts are unreliable, uncheckable, incomplete, or unable to support the 8/8/8 bar.

### Feedback: Every sentence needs signal

- ShroomDog feedback：`不需要用原作者這篇什麼什麼開頭 / 使用者一開始就已經看到原文出處了 / 所以不要講重複的廢話，直接說 Openai, cursor 在2026 四月（？）一起怎樣怎樣 / 或另一句有趣的開頭，反正不要講沒用又不好玩的廢話 / Gu-log's each sentence shall have at least one of following properties: informative or intriguing... The sentence w/o any of the properties MUST be deleted.`
- 情境：GP-195 開頭用「原作者這篇分析文講了一個很值得拆的現象」重複 source metadata，但讀者頁面上已經看得到原文出處。句子沒有新增資訊，也沒有好奇心。
- 修法：把開頭改成直接陳述事件與張力：`2026 四月，OpenAI 和 Cursor 幾乎同時做了同一件事：把 Agent 能力的重心，從可複製的 Skill 推向可安裝、可更新、可分發的 Plugin。`
- Reusable lesson：每一句都至少要 informative 或 intriguing；兩者都沒有就刪。文章開頭尤其不能做 source metadata 重複或 throat-clearing，要直接丟事件、張力、反直覺觀點或有趣比喻。此規則已升級到 `GU-LOG_WRITER_PROMPT.md` 與 `AGENTS.md`。

### Feedback: Reviewers must enforce sentence signal

- ShroomDog feedback：`Also make sure one of the reviewer will spot this. Maybe both fresheye and vibe reviewer.`
- 情境：Sentence Signal Rule 不能只靠 writer prompt；如果 reviewer 不會抓，pipeline 仍可能放過「資訊量 0 / 好奇心 0」的句子。
- 修法：把 Sentence Signal Rule 加進 Fresh Eyes 與 Vibe Scorer 的 reviewer contracts，並同步進 `scripts/vibe-scoring-standard.md`。Fresh Eyes 負責從手機讀者角度抓 boring / dead sentences；Vibe Scorer 負責在 vibe / narrative 維度懲罰 dead opening、source metadata 重複與 throat-clearing。
- Reusable lesson：重要寫作規則要同時進 writer prompt、repo AGENTS、reviewer rubric。Writer 負責產生，Reviewer 負責阻擋 regressions。

## 2026-05-11 — GP-196 Garry Tan Meta-Meta-Prompting

### Feedback: Personal-system scale disclaimers can be dead weight

- ShroomDog feedback：`這邊不需要加這段吧 感覺有點多餘 只是個人使用的話 原本就是原 po 想講多少我們就說多少`
- 情境：GP-196 在書籍鏡像段落後額外加了一段「證據邊界」，逐項提醒 100,000 頁、100+ Skill、15 個定時工作、每天超過 100 個定時工作、GStack 星標等數字都是 Garry 原文自述，不是 gu-log 獨立驗證。這在企業宣稱或 benchmark 文章裡有必要，但在「個人第二大腦 / 個人使用規模」這類故事裡顯得防禦過度，打斷閱讀節奏。
- 修法：刪掉獨立證據邊界段落；保留自然歸因，例如「Garry 說」或「原文說」，但不把個人使用規模寫成審計報告。對明顯主觀的 10x 描述，改成一句讀者能懂的提醒：「不用當成投資報告讀，真正意思是系統越用越厚。」
- Reusable lesson：gu-log 要做負責任的 source handling，但不是每個 source number 都需要獨立插入免責聲明。若數字是個人系統的自述規模、且文章重點在 idea / system shape，不要用長 disclaimer 打斷故事；用自然歸因即可。只有遇到 benchmark、投資、公司營收、醫療、安全、或可能被讀者當成客觀驗證的 claim，才需要更硬的證據邊界。

### Feedback: Too many proper nouns make the piece feel like 1-to-1 translation

- ShroomDog feedback：`專有名詞太多了，不重要的專有名詞以故事/譬喻的形式帶給讀者，重點不是 specific detail but the idea behind it. If user want detail, they can just check a 1-to-1 translation article. That won't be why user come to gu-log.`
- 情境：GP-196 保留了太多原文工具名、Skill 名、模型名、書名、人名、benchmark 名和部署選項。它們對 Garry 原文忠實，但對 gu-log 讀者來說容易變成名詞牆：讀者被迫記 `brain-ops`、`enrich`、`cross-modal-eval`、模型分工、benchmark、雲端服務，而不是抓到「流程會記住錯誤並複利」這個核心。
- 修法：刪減不重要專有名詞，把細節轉成故事或譬喻：Skill 組合改寫成「小工廠產線」；模型分工改寫成「有的抓精確錯誤、有的補脈絡、有的抓萬用雞湯」；工具棧與部署名改成「知識層、流程層、派工層」。保留必要名詞，例如 Garry、Demis、GBrain、Skill、Harness，但不要求讀者背完整 inventory。
- Reusable lesson：gu-log 的價值不是做 1-to-1 translation。讀者來 gu-log 是為了更快抓到 idea behind the details。寫作時先問：這個專有名詞是否承載核心觀念？若沒有，就改成故事、角色、流程、譬喻或「有一個工具負責 X」。細節控讀者可以點原文；gu-log 要交付的是可記住的 mental model。

## 2026-05-16 — SD-24 Codex Runtime Kernel

### Feedback: Architecture posts should deliver the mental model, not the spec tour

- ShroomDog feedback：`Interesting, but too long, too many detailed that should be linked. But seems there r some interesting insights that worth starting a SD post from this`
- 情境：SD-24 初稿把 Hermes Codex App-Server Runtime 和 OpenClaw Codex harness 的細節完整展開，包含 auth、native tools、tool boundary、optional routing、不同產品動機等。內容有 insight，但讀起來太像 spec walkthrough，不像一篇 gu-log SD 原創文。
- 修法：把文章重寫成短版：只保留核心 thesis「Codex 正在變成 coding agent 的 runtime kernel；OpenClaw / Hermes 變成外層 control plane」，把 implementation detail 變成原文連結，不在正文展開 inventory。
- Reusable lesson：架構趨勢文不要把文件細節搬進正文。gu-log 要交付的是可記住的 mental model；implementation details、限制清單、auth 指令、完整 tool matrix 應該連回原文。若細節沒有推動 thesis，就刪掉或縮成一句。

## 2026-05-16 — GP-204 OpenClaw Token Spend Agent Workflow

### Feedback: Short tweets should stay short

- ShroomDog feedback：I think too many other text than original tweet. I prefer a simple translation of origin tweet, with gu-log vibe/glossary/internal-link, and interesting clawdNote. I think that will be easier to read, and reader can refer back to origin tweet much easier. The en version should be a non-native-speaker friendly version plus gu-log vibe/glossary/internal-link with ClawdNote as well. So if the tweet is short, gu-log SP post can be short as well.
- 情境：GP-204 初版把 Peter Steinberger 一則短 X post 擴寫成 260 行長文，雖然資訊完整，但讀者不容易對照原 tweet，也不像早期 GP 的輕快 vibe。
- 修法：回看早期 GP-2 / GP-6 / GP-11 / GP-30 等短文 pattern：簡短 hook、原文白話翻譯、少量 MoguNote、必要 glossary/internal links。將 GP-204 改成短版 zh-tw + en：以原 tweet 內容為主，保留 gu-log 解釋與 MoguNote，但不把短 tweet 膨脹成架構長文。
- Reusable lesson：GP 的長度要跟 source 密度成比例。短 tweet 可以是短 GP；gu-log value 不等於擴寫更多段落，而是提供好讀的 Traditional Chinese / non-native-friendly English、vibe、glossary/internal links、MoguNote 與一個清楚 mental frame。只有 thread、長文、影片、或多來源 analysis 才需要長篇展開。

## 2026-05-17 — Tribunal v5 Source Boundary

### Feedback: GP body should not narrate the source

- ShroomDog feedback：`i don't think we will need 「原作者說 / 這篇文章在講」these kinds of sentence at all in the SP posts body, except in ClawdNote, this kinds of sentence will just harm the reading flow, given that the reader should already know SP post r mere translation + ClawdNote, and they will always been able to see the 原文出處 in SP posts anyway.`
- 情境：規劃 Tribunal v5 時，初版計畫仍允許 GP body 在 evidence boundary、引用、案例自述、benchmark/內部數字等場合保留「原作者說 / 這篇文章在講」類句型。ShroomDog 指出：GP 讀者已經知道文章是 source-derived，也看得到 `原文出處：`，正文反覆講 source metadata 只會傷害閱讀流。
- 修法：把 Tribunal v5 factCheck 擴成五維，新增 `sourceBoundary` 與 `commentarySeparation`。GP body 禁用「原作者說 / 原文提到 / 這篇文章在講」這類 source-meta scaffolding；必要 evidence boundary 改成自然句，例如「這組數字應視為案例自述，不是公開 benchmark」。若需要討論 source 本身或加 Mogu/gu-log 觀點，放進 `<MoguNote>`。
- Reusable lesson：GP body 的 source fidelity 不靠反覆提醒「原作者說」維持。正文要自然呈現 source claim，保留 hedge 與 evidence boundary；source-meta commentary 與 AI/gu-log opinion 則進 MoguNote。Reader-facing flow 優先，因為 source attribution 已由 frontmatter/source block 承擔。

## 2026-05-18 — 晶晶體 Accepted-English Boundary

### Feedback: Accepted English terms are ShroomDog taste decisions

- ShroomDog feedback：`可接受 English terms 的邊界交給 deterministic checker`，並補充：`make sure it is clear that the boundary SHALL be discuss with ShroomDog everytime adding or removing it. (because this will severely impact the flow and only ShroomDog knows what terms he is comfortable with or not)`
- 情境：Tribunal v5 Vibe Scorer 曾把 `vs` / `bug` 這類 ShroomDog 可接受的 engineering terms 誤判成 zh-tw 晶晶體 penalty。把判定交給 `scripts/check-jingjing.mjs` 後，仍需要明確規定 allowlist / glossary acceptance set 的 ownership，避免未來 agent 因為測試或單篇文章需要，直接擅自加詞或刪詞。
- 修法：`scripts/check-jingjing.mjs`、Vibe Scorer contract、`scripts/vibe-scoring-standard.md` 都要寫清楚：可接受 English terms 的邊界是 deterministic checker 執行，但 boundary ownership 屬於 ShroomDog。任何新增或移除 accepted term，SHALL 先與 ShroomDog 討論。
- Reusable lesson：晶晶體不是純技術 lint 問題，而是 gu-log 閱讀流與語感邊界。程式負責穩定執行已決定的邊界；ShroomDog 負責決定哪些 English terms 在繁中正文裡自然、哪些會破壞 flow。Agent 不應把「checker 誤報」直接翻譯成「加 allowlist」。

## 2026-05-18 — GP-206 title should use plain language

- Feedback: Sprin approved the /goal / intent-engineering source as an GP post, but explicitly asked: “use plain language title btw.”
- Context: The source uses product-management vocabulary like intent engineering, OKRs, empowered teams, autonomy boundaries, and stop rules. A framework-heavy title would make the post feel like PM jargon before the reader gets the useful agent lesson.
- Fix: Use a direct title such as 「AI Agent 不是有目標就夠了」 instead of terms like 「意圖工程框架」 or 「Agent 治理八要素」. Keep the body practical: goal, boundary, what cannot break, and when to stop.
- Reusable lesson: When the source is a framework post, gu-log titles should often translate the reader-facing problem, not the author’s framework brand. Plain-language titles lower the entry cost and keep the article from smelling like a slide deck.

## 2026-06-03 — Leerob Agents / evidence-boundary wording

### Feedback: Don't write caveats that sound like treating readers as stupid

- ShroomDog feedback：`「數字有參考價值，但不是公開 benchmark」感覺把讀者當智障？我很討厭這句，先討論一下我們是不是要把所有類似句字全部移除 gu-log, including prompts, so no this kind of sentence will ever happen in gu-log. CMIIW`
- 情境：評估 Lee Robinson〈Coding Agents & Complexity Budgets〉時，Iris 建議用「數字有參考價值，但不是公開 benchmark」替 $260 / 297.4M tokens / 344 agent requests 等案例數字加證據邊界。這種句子雖然意圖是負責任 source handling，但讀起來像免責聲明或把讀者當不懂判斷的人，打斷文章 flow。
- 修法：從 gu-log prompts / reviewer rubrics 移除「不是公開 benchmark」這類模板句，改成更自然的敘事歸因；只有在讀者真的可能被誤導、或 claim 涉及 benchmark、投資、醫療、安全、公司營收等高風險情境時，才需要硬 caveat。低風險案例數字優先用 context 自然標示，例如「這是 Cursor 自家網站的一次遷移帳單」或「這筆帳不是重點，重點是它讓原本可能外包的苦工，變成週末可以讓 AI Agent 硬幹的專案」。避免「硬拆」這種不自然中文；這裡要講的是 agent brute-force / power-through workflow，台灣口語寫「讓 AI Agent 硬幹」更自然。
- Reusable lesson：Responsible source handling 不等於每個數字都加 legalistic disclaimer。gu-log 要信任讀者，不用預設讀者會把單一公司案例誤讀成科學 benchmark；如果需要 boundary，要寫成推動敘事的 context，不要寫成「提醒讀者這不是 X」的防呆句。同時避免把 English shorthand 直譯成看不懂的中文動詞，例如 `brute-force through work` 不要寫「硬拆」，應依語境寫「硬幹」「硬著頭皮跑完」「用 agent 撐過去」等自然口語。

## 2026-05-26 — SD-25 Agent Dream / Skill Consolidation

### Feedback: 文章太長、難看；短概念文不要把 prompt 拆成報告

- ShroomDog feedback：`SD-25 太長了，難看，用tribunal v7 重新迭代`
- 情境：SD-25 把 Vaibhav Srivastav 的 Codex skill-consolidation prompt 延伸成 `/dream` mental model。第一版雖然 FreshEyes/Vibe 給過 8，但正文把 prompt 條件、Skill、automation、/dream 定義逐段鋪開，讀感像把一個好概念拉成流程報告。
- 修法：保留「agent 做夢 = 把白天工作沉澱成可重用程序」這個核心，刪掉重複解釋和過多分類，讓文章變成短而尖的概念文。只留必要 source capture、Skill vs diary、/dream 應該保守這幾個讀者真正需要的點。
- Reusable lesson：短 prompt/概念來源不一定需要完整拆解每個 bullet。若核心洞見一句話就能講清楚，文章應該圍繞那個洞見做 mental model，而不是把 source prompt 轉成「逐條說明書」。Tribunal/FreshEyes 若只看懂不看「是否值得讀完」，可能會高估這類長但正確的文章。

## 2026-05-27 — FreshEyes 長度剛好要變成明確 metric

Sprin asked whether Tribunal v7 FreshEyes covers “length should be just right,” then preferred adding one or two FreshEyes metrics and bumping Tribunal version. Durable lesson: FreshEyes should not only ask whether the post is understandable; it must judge whether the length is worth finishing. Add explicit `payoffDensity` and `lengthFit` dimensions, and make them non-compensating so a good hook/readability cannot hide correct-but-too-long filler. Librarian still owns corpus overlap evidence; FreshEyes owns on-page reader fatigue and length/payoff fit.

## 2026-06-09 — AI authorship notes belong with provenance metadata

### Feedback: Do not put inferred model attribution under the title

- ShroomDog feedback：`為什麼是放那麼上面啊 毫無品味`；`鐵定是要放在藍色框框那個位置吧，模型署名的部分`
- 情境：PR #383 新增舊文作者推定後，把「作者推定」卡片放在 title/source citation 下方、TOC 上方。這讓製作履歷搶走正文開場視覺重心，特別是在手機上看起來像文章最重要的 lead block。
- 修法：作者推定不是閱讀前資訊，而是 provenance metadata；應該跟 translatedBy pipeline / model 署名收在同一個底部 metadata box，位置在 tags 後、Tribunal Scores 前。Source citation 可以留在文章前方，因為它幫讀者理解正文來源；model attribution 不該打斷 reading flow。
- Reusable lesson：AI provenance 要透明，但透明不等於放到最搶眼的位置。讀者先讀文章，再看製作履歷；所有 model / harness / authorship inference 類資訊都應服從文章版面節奏，集中在文章尾段 metadata 區。

## 2026-06-10 — GP-220 loop engineering / CTA 縮寫太生

### Feedback: MoguNote 裡別丟讀者不懂的行銷縮寫，改白話

- ShroomDog feedback：`CTA? what is that?` ——讀 SP-220 拆穿 DeepSeek 業配那段 ClawdNote 時，被「整數 CTA」（en: round-number CTA）這個縮寫卡住。
- 情境：原文用 CTA（Call To Action）形容「$20 = 17 億 token」這個刻意取整、誘導馬上註冊的收尾數字。CTA 是行銷文案術語，不是 AI/tooling 圈詞彙；放在拆穿業配的 punch 句裡，讀者剛要會心一笑卻得停下來查縮寫，力道就洩了。
- 修法：改成白話，把概念講出來不搬縮寫。zh-tw：「廣告結尾那種『手刀下單』的收尾鉤子」；en：「the kind of 'sign up now' line every ad ends on」。不進 glossary——CTA 是通用行銷縮寫、非 AI 概念，塞進 AI 詞庫會稀釋它、且開頭後每個行銷詞都要比照。
- 順帶查清楚 jingjing 為何沒擋 CTA：`scripts/check-jingjing.mjs:491` 對「長度 ≤ 6 的全大寫 token」（`/^[A-Z][A-Z0-9-]*$/`）一律放行，把短全大寫當 acronym（API/SDK/CLI…）。副作用是抓不到冷門縮寫術語（CTA/MVP/ICP/TAM），那類要靠人或 tribunal 判斷讀者熟不熟。
- Reusable lesson：晶晶體 lint 只守小寫／混寫英文；全大寫縮寫是 lint 的盲區。寫作時遇到行銷／PM／商管縮寫（CTA、MVP、ICP、TAM、ARR…），預設翻成白話或講出概念，不要假設 AI 工程讀者都懂行銷術語。MoguNote 的 punch 句尤其不能被一個縮寫卡住。

## 2026-06-16 — SD-26 loop engineering / dedup callback

### Feedback: `查重` 太怪，dedup 要進 glossary，並把故事扣回 loop engineering

- ShroomDog feedback：`查重是三小, dedup, and make dedup in glossary. Also we can have a MoguNote about how duplicate content in gu-log can be annoying to reader + a table flip kaomoji.`；接著補充：`想 callback 回 loop engineering as the story goes on tho. Right now i think there is no bridge back?`
- 情境：SD-26 在講 gu-log guardrails 時，把 dedup 寫成「查重」，讀起來像考卷或學術抄襲檢查，不像 AI/content pipeline 的實務術語。文章也把 dedup 當成清單項目帶過，沒有把它接回 loop engineering 的主軸。
- 修法：正文使用 `dedup`，第一次出現連到 glossary。新增 Dedup glossary 條目，定義為偵測重複或高度重疊的主題與內容，避免讀者重複讀到換湯不換藥的文章。SD-26 補 MoguNote：重複內容最煩的是讀者會覺得「欸我好像讀過？」；gu-log 把這種 reader annoyance 變成 pipeline gate，讓下一輪更早攔住。
- Reusable lesson：不是每個英文術語都該翻成中文。當 gu-log 內部 workflow 已經用 dedup 表示「主題/內容去重 gate」，硬翻成「查重」會跑錯語感。更重要的是，guardrail 不是孤立工具清單；每個 gate 都要能回扣 loop engineering：人或讀者感到痛，系統把痛轉成訊號，下一輪自動提早處理。

## 2026-06-16 — SD-26 article-count accuracy

### Feedback: gu-log 不是三百多篇，GP/MP 規模要算清楚

- ShroomDog feedback：`話說我們不止三百多篇吧 GP about 200, MP about 300`
- 情境：SD-26 用「三百多篇 AI 翻譯文章」描述 gu-log 規模。這低估了目前內容量，也把 MP 精選、SD 原創、教學混成「AI 翻譯文章」，分類不準。
- 修法：改成「五百多篇文章——大約兩百篇 GP 翻譯、三百篇 MP 精選，外加 SD 跟教學」。後續句子只用「五百多篇 / 500 posts」，避免每次重複解釋 taxonomy。
- Reusable lesson：談 gu-log 全站規模時，不要憑印象寫「三百多」。要先算 active unique posts，並區分 GP / MP / SD / LevelUp。若文意不是只談翻譯，不要寫成「AI 翻譯文章」。

## 2026-06-17 — GP-232 loop engineering /「六個字」沒講是哪六個字

### Feedback: 標題/引言一直說「六個字的咒語」，卻從頭到尾沒講那六個字是什麼

- ShroomDog feedback：`什麼東西六個字？三小xD 太沒資訊量了吧`（看 SP-232 標題與引言時）
- 情境：GP-232 開場 hook 是「一句六個字的咒語衝到 220 萬瀏覽」，正文又反覆出現「那六個字」「一句六個字的話」，但**從來沒有把那六個英文字寫出來**。原文 mvanhorn 說 the most repeated sentence is "six words long"，指的是 Steinberger 那句的英文核心「design loops that prompt your agents」（剛好六個 word）。漏掉它＝把整個 hook 變成空殼，讀者被吊著卻拿不到 payoff。
- 翻譯陷阱（中文版更糟）：英文 six words 很自然，但中文「六個字」會被讀成「六個漢字」。引言裡那句翻成中文的咒語明明十幾個漢字，讀者一對照就覺得「哪來六個字？」——word 與「字」的計數單位不一樣，直接搬會製造矛盾感。
- 修法：引言第一段就把那六個字攤開——zh 改成「那句話濃縮成英文就六個字——『design loops that prompt your agents』（去設計那些會 prompt agent 的 loop）」；en 改成「Compressed, it's six words — "design loops that prompt your agents"」。英文原句包在引號裡（直接引用原文，jingjing 放行），後面附中文翻譯。標題與後面的「那六個字」callback 就站得住了，因為 payoff 已在第一段交付。
- Reusable lesson：(1) 任何「數字＋名詞」的 hook（六個字、三句話、兩張圖、一行指令）都必須在開場附近**把那個東西本體交出來**，不能只丟數字吊胃口；hook 的 promise 要在同段或下一段兌現。(2) 跨語言搬「count words」類說法要小心單位錯位——英文 word ≠ 中文「字」。要保留「精簡到很短」的張力時，中文要嘛點明「英文六個字」並秀出英文，要嘛改用不綁計數單位的講法（例如「短到不行的一句」）。

## 2026-06-17 — GP-232 / AI-tell taxonomy（跨模型風格簽名）

### Feedback: 「拆得很乾淨了」這句很 AI；用實驗確認，並把 tell 清單沉澱

- ShroomDog feedback：`「拆得很乾淨了」 我依稀覺得 這句話很ai?`；接著要求做對照實驗：讓 Opus 4.5 / 4.6 在乾淨環境用同一份 writer prompt + source 從零各寫一篇，比對。
- 實驗設計：`claude -p --model claude-opus-4-5`（與 4.6）從 `/tmp` 跑（避開 repo CLAUDE.md 污染脈絡），餵精簡 writer prompt + 同一份 source，產出後比對 tell。（model 別名雷：這版 CLI 只認短別名 `opus/sonnet/haiku` 或完整 id `claude-opus-4-5`；`opus-4-5`／`opus-4.5` 一律被拒。）
- 實驗結論：**AI tell 是跨模型的風格簽名，換模型不會變少，4.6 反而最密**。越新的模型「講洞見」越流暢，就越把下列套路用成反射動作。
- **Tell taxonomy（earned 留、reflexive 殺）**：
  - **T1 反義對偶過載**：「不是 X，是 Y」「不在 X，在 Y」。承載 thesis / 笑點的 1–2 次是 earned（例：mvanhorn 整篇論點就是 "it's not loops, it's skills"，該留）；當每段收尾的反射句型 = filler，殺。4.6 一篇用約 8 次、4.5 約 5 次。
  - **T2 假深度 reframe**：「表面是 X，真正/深層才是 Y」「聽起來像 X，但其實 Y」「透露的訊息比表面更深」。用 scaffolding 假裝多給一層解讀。4.6 三個 MoguNote 三個都用，是最好認的指紋。
  - **T3 空洞強化詞**：「拆得很乾淨／很漂亮／到位／精準」「這才是工程品味」「這刀切得漂亮」——沒有具體資訊、只負責讓句子聽起來收得漂亮。改成「它到底講了什麼」的具體內容。
  - **T4 mic-drop 打燈**：每個 section 都用一句單獨成段的「人生哲理」收尾；偶一為之 OK，固定收法就變 template。
- 修法（GP-232 worked example）：外科手術式，只殺 reflexive，留 earned。實改三處 T3/T2（「拆得很乾淨了」→「都講過了」、「這刀切得漂亮」刪掉、「表面是吐槽，其實精準」→直接陳述），保留所有承載論點的對偶（cron 段「不是新魔法，也不是只是 cron，而是…」、結尾「不是 loop，是 skill」）。
- Enforcement 決策：**不加硬 lint blocker**——密度型 tell 用 regex 會誤殺正當用法（含論點本身），製造比 tell 更煩的 friction。改放 tribunal：`scripts/vibe-scoring-standard.md` 的 persona 維度新增「AI-Tell Trap」rubric，由 LLM judge 用語意判斷密度與 earned/reflexive 後扣分。硬 lint 只留給有明確字表的 T3。
- Reusable lesson：AI 腔不是某一隻模型的毛病，是 LLM 共有的「金句反射」。寫完自我審查時專抓四類：反義對偶是不是用成口頭禪、有沒有「表面/深層」假深度、有沒有空洞強化詞、是不是每段都想 mic-drop。判準一句話：**earned（承載論點/笑點）留，reflexive（句型慣性）殺。**

## 2026-06-18 — GP-236 inner/outer loops /「V1 太冗長，細節太多」

### Feedback: 心智模型要清楚，但話太多、細節太滿

- ShroomDog feedback：`V1 好像 太冗長，細節太多`；要求 `Keep the mental clear and less verbose`（讀 SP-236 prod 成品後）。
- 情境：GP-236 V1（Opus 4.8 寫）四審全 PASS（vibe 8 / fresh 8），但 fresh-eyes 與 vibe 都已預警「結語段落 + 最後 MoguNote 把全文壓成同一句、結尾自我重複」。作者實際讀完的痛點更廣：六個 section + 六個 MoguNote，每個 MoguNote 都把同一個「內/外迴圈」心智模型再講一次，原文本來很乾淨的雙迴圈骨架被一層層 gu-log 自指解說（tribunal 分數封存、feedback 檔、3x 規則、GP-235/220 家譜）埋住，讀者要自己從冗詞裡挖回那張圖。
- 修法：用 Opus 4.5 重寫，砍掉重複的解說層，讓「內迴圈帶 context 進來、外迴圈把審稿擠出的 context 撿回去」這張圖從頭到尾保持裸露。具體：減少 MoguNote 數量與長度（只留真正加 insight 的）、合併節奏重複的 section、刪掉把同一結論換句話再說的句子、結語不要再 recap。Payoff 密度優先於覆蓋率——原文每個細節都翻不等於好，idea behind the details 才是交付物。
- Reusable lesson：(1) **四審 PASS ≠ 不冗長**。tribunal 的 vibe/fresh 會給 8 分過關，但「composite 8 且 length/payoff 都剛好 8」常常就是「能讀但偏長」的訊號——看到 freshEyes 的 lengthFit / payoffDensity 卡在 8（不是 9）就要當成精簡提示，不要等作者讀完才發現。(2) **gu-log 自指要節制**。MoguNote 接回 gu-log 自己的流程（tribunal、feedback 檔、cross-ref）是特色，但一篇塞三四個就會把原文的主幹稀釋掉——自指是調味，不是主菜，每篇最多一兩處夠味的就好。(3) 翻譯類文章的預設失敗模式是「太忠實 → 太長」，不是「漏東西」；寧可砍到剩骨架清楚，也不要逐點覆蓋。
- 模型操作備忘：`claude -p --model claude-opus-4-5` 可用（完整 id），Agent tool 的 model enum 只有 `opus/sonnet/haiku/fable` alias（opus→4.8），選不到 4.5；要指定版本走 `claude -p` subprocess。
## 2026-06-18 — GP-235 / 開場 overwrought editorializing（「整篇最誠實的一句話」）

### Feedback: 「This feel like ai slop. 不需要這麼冗長也不用整篇發表最誠實這樣吧？」

- 情境：GP-235 開場把 Anthropic 自補的「還沒上 production」那句捧成——「整篇發表最誠實的一句話，就是這句。而它指向的東西，比那 75 萬行 Rust 重要得多——……」。ShroomDog 讀起來是 AI slop：(1) 太冗長，(2)「整篇最誠實的一句話」是替讀者打燈、替句子強行加重量的 overwrought framing。
- 為什麼是 slop：這句犯了既有 taxonomy 的 **T4 mic-drop 打燈**（把一句普通的事實 reframe 成「全場最誠實的一句」）＋ **T3 空洞強化詞**（「最誠實」「重要得多」沒有交付新資訊，只負責讓句子聽起來很重）。原文確實有 "the most honest line in the entire launch"，但**照搬原文的自我打燈到譯文開場，會把原作者的口氣放大成譯者在用力**，讀者反而出戲。
- 修法（worked example，外科手術式）：
  - zh：`整篇發表最誠實的一句話，就是這句。而它指向的東西，比那 75 萬行 Rust 重要得多——一個會跑出漂亮數字的 loop……當成真正的產品在設計。` → `這句才是重點。一個能跑出漂亮數字的 loop，跟一個能跑出**對結果**的 loop，差的不是 agent 數量，是那個「驗證」的環節有沒有被當成真正的產品來設計。`
  - en：`That single sentence is the most honest thing in the entire launch. And what it points at matters more than the 750,000 lines of Rust — …` → `That's the line that matters. A loop that produces a beautiful number…`
  - 動作：砍掉「最誠實的一句話」打燈、砍掉「比 75 萬行更重要」的冗語，用「這句才是重點」一句帶過，直接進到對比本身。對比句本身（漂亮數字 vs 對結果）是 earned thesis，留。
- Reusable lesson：(1) **不要替一句話打「這是全場最 X 的一句」的燈**（最誠實／最重要／最關鍵的一句話）——讓那句話自己站，讀者自己會判斷份量；打燈＝替讀者下結論＝AI 腔。(2) **原文的自我評價式 framing（"the most honest line…"）不要逐句搬進譯文開場**，那是原作者在他自己脈絡裡的口氣，搬過來會變成譯者在用力。要嘛省略、要嘛降一級（「這句才是重點」就夠）。(3) 開場 hook 兌現了之後就收手，不要再追加一層「而且這比那個還重要」的疊加修飾——疊加＝冗長。

## 2026-06-18 — GP-235 / MoguNote 開頭三層清喉嚨（scaffolding 太冗、偏尬）

### Feedback: 「這裡廢話太多了吧 偏尬，你試著想想短一點可以怎麼寫」（指第一個 MoguNote）

- 情境：GP-235 第一個 MoguNote（指向 GP-220 當先修課）連續疊三層鋪陳才進到重點——「先把前情提要釘好：……」→「那篇從頭講到尾了，這篇不重講。把那篇當這篇的先修課。」→「這篇只處理一件 GP-220 故意沒展開、而且幾乎沒人講清楚的事：那張『探索→規劃→執行→驗證』流程圖裡……」。三句都在「準備要講」，不是在講。ShroomDog：廢話太多、偏尬。
- 為什麼尬：MoguNote 的工作是補一刀 insight，不是寫導言。「先把前情提要釘好」「把那篇當先修課」「這篇只處理一件…的事」是三個同義的 throat-clearing（清喉嚨），把一個 14 字就能講完的指向（去讀 GP-220、這篇只挖驗證那格）灌成 5 句。讀者要的是結論，不是「我即將給你結論」的預告。
- 修法（砍 60%）：
  - `先把前情提要釘好：loop engineering 是什麼、開放迴圈跟封閉迴圈怎麼分、一個好 loop 要搭哪六個積木——GP-220 那篇從頭講到尾了，這篇不重講。把那篇當這篇的先修課。這篇只處理一件 GP-220 故意沒展開、而且幾乎沒人講清楚的事：那張「探索 → 規劃 → 執行 → 驗證」流程圖裡，「驗證」那一格到底裝什麼。劇透：那格才是產品，其他全是水電`
  - → `loop engineering 是什麼、開放／封閉迴圈、一個好 loop 的六個積木——GP-220 都講過了，當先修課讀。這篇只挖那篇沒展開的一格：流程圖裡的「驗證」。那格才是產品，其他全是水電`
  - en 同步砍：`First, let me pin the prerequisite. … this post won't re-explain it. This post handles the one thing …` → `What loop engineering is, open vs closed loops, the six building blocks — GP-220 covers all of it. Read it first. This post only opens the one box that one left folded: "verify."`
- Reusable lesson：(1) **MoguNote / 段落不要「預告自己要講什麼」**——「先說個背景」「先把前提釘好」「這篇只處理一件事」都是 throat-clearing，直接講那件事就好。(2) **同義鋪陳只留一句**：「這篇不重講＋當先修課＋只處理一件沒展開的事」是同一個意思講三遍，留最有資訊量的一句（「當先修課讀」＋「只挖驗證那格」）。(3) 自檢問句：這句是在「給結論」還是在「宣布我要給結論」？後者一律刪。「劇透：」這種轉場詞也可省，直接接結論。

## 2026-06-18 — GP-235 / 怪味去不掉時，換模型整篇重寫（process lesson）

### Feedback: 「短一點有好一點，不過整篇有股怪味」→「你試著直接叫 opus 4.5 寫一次吧」

- 情境：GP-235 原版（Opus 4.8 寫）經過兩輪外科手術式 line-edit（砍打燈、砍清喉嚨）後，ShroomDog 說「短一點有好一點，不過整篇有股怪味」，然後直接指示用 Opus 4.5 在 clean context 從零重寫。重寫版的評價是「4.5 寫得好看多了，難得看得完」。
- 為什麼換模型而不是繼續修：有些「AI 怪味」是**模型層級的風格簽名**（見 2026-06-17 GP-232 那條 tell taxonomy），不是某幾句的問題。當 line-edit 已經砍掉可見的 tell、讀起來卻還是悶，繼續逐句修只會無限逼近同一個味道。換一個 model / 換一個 clean context 重抽一版，比在原稿上補丁更快到位。
- 操作：`claude -p --model claude-opus-4-5` 從 `/tmp` 跑（避開 repo CLAUDE.md 污染脈絡），餵精簡 writer prompt（明列要避開的 tell）+ source，整篇重生，再跑 tribunal。
- Reusable lesson：(1) **句級 tell 清乾淨但整體還是悶 → 換模型整篇重寫，不要在同一稿上繼續補丁**。(2) 重寫時把「要避開的 AI tell」明寫進 writer prompt（打燈/假深度 reframe/空洞強化詞/mic-drop/清喉嚨），比寫完再抓有效。(3) ShroomDog 已把「writer / rewriter / vibe scorer 都用同一代 Opus（4.5）」定為 config，讓生成與評分共用同一套 taste。

## 2026-06-18 — GP-235 / 研究術語別用「學術根源是 XX」教科書腔

### Feedback: 「這個模式的學術根源是 xx 這句話太白癡了，可以換成『這像是所謂的 xx (ref: [link])』」

- 情境：重寫版介紹 ReAct / Reflexion 時用「這個模式的學術根源是 ReAct（Princeton 和 Google）」。ShroomDog 嫌「學術根源是」太教科書、太白癡。
- 修法：改成口語化的「這套循環有個學名，叫 [ReAct](arxiv-link)（Princeton 和 Google 那篇）」「這套做法也有名字，叫 [Reflexion](arxiv-link)」，並**連到原始論文**（arXiv），而不是只丟一個術語。
- Reusable lesson：(1) 引入研究術語時**不要用「學術根源是／源自／出自」這種論文腔**——casual 地給名字（「有個學名叫」「研究圈管這叫」）就好。(2) 提到具體 paper 的術語，**順手連原始出處**（arXiv / 官方），讓讀者能 ref，而不是把術語當成炫技名詞丟下不管。

## 2026-06-18 — GP-235 / 引用來源的 caveat 要附日期+連結（attribution completeness）

### Feedback: 「『Anthropic 自己在公告裡寫的那句但書：這個移植還沒上 production』-> 要加公告日期跟連結」

- 情境：正文把「還沒上 production」這句歸給「Anthropic 的公告」，但只有口頭歸屬，沒給是哪篇公告、哪天。
- 修法：補成「Anthropic 在那篇[動態工作流公告](url)（2026 年 6 月 2 日）裡，自己寫的那句但書：……」——把 announcement 連結 + 日期 inline 進去。
- Reusable lesson：**只要把一個 claim 歸給某篇具體公告/文章（尤其是『官方自己承認 X』這種有份量的歸屬），就要在那句附上連結 + 日期**。口頭講「官方公告說」但不給 source = 讀者沒法查證，attribution 不完整。低風險的泛論可以不附，但「官方自承 caveat」這種承重歸屬一定要。

## 2026-06-18 — GP-235 / 換 model 重寫後，frontmatter provenance 必須同步改

### Feedback: 「Model signature 沒一起改 騙人啊。這不是應該要由程式一起順便改？」

- 情境：把 Opus 4.5 重寫的 body 換進檔案時，`translatedBy.model` 還掛著前一版的 Opus 4.8，沒同步改 → 等於 frontmatter 在說謊（標 4.8 實際 4.5）。
- 修法：用 `detect-model.mjs` 把 zh + en 的 `translatedBy.model` / `pipeline[].model` 正名成 Opus 4.5。
- 為什麼 ShroomDog 在意：gu-log 的賣點之一就是「把 AI 自評分數/provenance 攤在陽光下」，所以 model signature 必須誠實。標錯 model = 直接砸這個招牌。
- Reusable lesson：(1) **任何「換 model / 換 harness 重生內容」的動作，同一筆 edit 就要把 `translatedBy` / `pipeline` provenance 改成實際用到的 model**，不能事後補、更不能漏。(2) ShroomDog 期望這件事**由 pipeline 自動蓋**（gp-pipeline 確實會從 Claude Code metadata 讀回 model 寫進 frontmatter）——手動 `claude -p` 重寫路徑繞過了那層才會漏，所以手動路徑要特別記得補。（討論過是否加 pre-commit guard 偵測「body 大改但 model 沒動」，ShroomDog 否決：因為可能用同一個 model 重寫，會誤殺。）

## 2026-06-18 — GP-235 / 外部論文（canonical 引用）走 glossary，不要從正文直連

### Feedback: 「我覺得這些（ReAct/Reflexion）應該進 glossary。對任何外部論文連結，我們應該是 post → glossary（含一條短又有趣的 Mogu note）→ 外部連結。這樣 proper 嗎？」

- 情境：GP-235 把 ReAct / Reflexion 直連 arXiv（`[ReAct](https://arxiv.org/abs/2210.03629)`）。同時它們也被加進 `check-jingjing.mjs` 的 `ALLOWLIST_RAW` 才能過晶晶體 lint。ShroomDog 指出這兩件事都該收斂成「進 glossary」。
- 為什麼 proper：(1) 這本來就是 glossary 既有慣例——Karpathy→eurekalabs、Boris→anthropic、Linear→linear.app 全是條目掛 `url` 外連，正文直連 arXiv 反而是破例。(2) 一個外部連結因此有「留在站內的理由」：Mogu note 先給讀者一句吐槽/類比 + context，再決定要不要點出去，順便把知識圖譜（related / definedIn）串起來。(3) jingjing 白名單自動收斂——進 glossary 後 `en` 欄位被 glossary loader 自動放行，`ALLOWLIST_RAW` 那兩行可以刪，不用兩處維護。
- 界線：只有「會重複出現的 canonical 引用」（論文、人、產品）才進 glossary，一次性連結別塞，否則 glossary 膨脹。ReAct / Reflexion 是 agent-loop 奠基論文，合格；Jarred Sumner（人）/ struct·lifetime（語言關鍵字）這種一次性提及留在 allowlist。
- Mogu note 由誰寫：ShroomDog 要求 glossary 的 Mogu note 跟文章同一個聲音，用 **Opus 4.5** 在 clean context 生成（`claude -p --model claude-opus-4-5`），不是隨手自己補。
- 連帶效應（ratchet）：新增 glossary 詞會觸發 `check-glossary-links --changed-terms`，要求全站既有文章補連結。用 `apply-glossary-links --all --term ReAct --term Reflexion` 自動 backfill；改到的 grandfathered 舊文因為是「link-only diff」（`is_internal_post_link_only_diff` 把 `[X](/glossary#x)` 正規化回 `X`），不會被 jingjing / pronoun 重新 lint。
- Reusable lesson：**正文要引用一個會重複出現的外部 canonical 來源（論文 / 人 / 產品），預設先在 glossary 開條目（definition + Mogu note + `url`），正文連到 `/glossary#term`，由 glossary 再連出去**——不要從正文 body 直接外連，也不要為了過 lint 把術語塞進 ALLOWLIST_RAW。

## 2026-06-18 — Judge model routing：Fresh Eyes 走浮動 opus alias（不 pin）+ CCC 版本 pin 機制

### Decision: fresh-eyes 用 default opus（現在 4.8），刻意不跟 writer 同代

- ShroomDog decision：被問「fresh-eyes 的 standing 預設要 4.5 還是 4.7」時答 `Use default opus model (opus alias), so now it shall be opus 4.8`。
- 情境：GP-236 兩次 session user 都點名「fresh-eyes / vibe / writer 用 opus 4.5」。釐清後 ShroomDog 把 standing 規則定成：**writer / rewriter / vibe scorer 鎖 `claude-opus-4-5`（voice + taste 對齊），但 Fresh Eyes 走浮動 `opus` alias（追最新，現在 4.8），刻意不 pin**。理由：fresh-eyes 是「陌生讀者」視角，用跟 writer 不同代 / 最新的 model 反而能抓 writer 同代看不到的盲點——這裡要的是 diversity，不是 taste 對齊。Fact Checker 同理（本來就用浮動 opus 追最新）。Librarian 也是浮動 `opus`——後續發現 `.claude/agents/librarian.md` frontmatter 一直是 `model: opus`，是 playbook 路由表寫死成 4.7 漂掉了，2026-06-18 一併把表改回浮動對齊（決定：playbook 跟實際 runtime 一致，不改 agent 檔）。最終分類：**voice-sensitive（writer/rewriter/vibe）鎖 `claude-opus-4-5`；非-voice judge（fact-check/librarian/fresh-eyes）全部浮動 `opus`**。
- 發現的 drift：`.claude/agents/fresh-eyes.md` frontmatter 本來就是 `model: opus`（浮動），但 `playbooks/CCC-playbook.md` 路由表寫死成 `claude-opus-4-7`——playbook 漂掉了。已把路由表改回浮動 opus alias，跟 agent 檔對齊。
- CCC 機制備忘（寫進 CCC-playbook〈CCC 怎麼 pin 到指定 Opus 版本〉）：`Agent` tool 的 `model` 只吃 alias（`opus`→最新 4.8），**選不到指定版本**；要 pin（writer/rewriter/vibe = `claude-opus-4-5`）唯一可靠路徑是 `claude -p --model claude-opus-4-5`（完整 id；`opus-4-5`/`opus-4.5` 半截寫法會被拒）。版本不敏感的角色（fact-check / fresh-eyes）用 `Agent` tool 省事即可，不要無腦全改 `claude -p`。
- Reusable lesson：(1) **judge 的 model 路由不是「越新越好」也不是「全部對齊 writer」**——voice/taste-sensitive（writer/rewriter/vibe）要 pin 同代；要 diversity 的陌生讀者視角（fresh-eyes）反而要放它浮動、跟 writer 拉開。(2) 改 model 路由時，playbook 路由表 + `.claude/agents/*.md` frontmatter 兩邊要同步，不然又 drift。(3) CCC 要 pin 版本只能走 `claude -p --model <完整-id>`，Agent tool 做不到。

## 2026-06-18 — SSOT 紀律升級成強制行為規則（drift 連踩兩次後的根因處理）

### Feedback: 「我們應該有個 strong prompt 讓 agent 自主隨時意識並維持 SSOT」

- ShroomDog insight：連續抓到 fresh-eyes、librarian 兩個 model-routing drift 後，ShroomDog 點出根因不是「忘了同步」，而是該有一條 standing prompt 讓每個 agent 自主維持 SSOT——`I think it is just we should have a strong prompt that will autonomously always try to aware and keep ssot`。
- 根因：drift 幾乎都來自同一個錯——**把住在某 SSOT 的值複製一份到散文/表格**。`.claude/agents/*.md` 的 `model:` frontmatter 是 model 選擇的 SSOT，但 `CCC-playbook` 路由表（還有 fallback 清單、品質 section）把版本號各抄了一份 → agent 檔改了、副本沒跟 → 兩處 drift 成假資訊。
- 修法（兩層）：
  1. **行為層**：CLAUDE.md ⚠️ 必讀 新增〈🧭 SSOT 紀律：別複製事實，發現 drift 當場收斂〉——四條操作規則（寫值前先問是不是副本→指向 SSOT；非列不可就標 derived view；發現對不上當場在同一 PR 收斂、SSOT 永遠贏；改 SSOT 順手掃別處有沒有抄一份）。並說明為什麼用 prompt 而不只靠 lint（drift 形態太多、lint 抓不完又誤殺，主防線是每個 agent 帶 SSOT 意識）。
  2. **結構層（practice what we preach）**：CCC-playbook 模型路由表從「複述版本號」改成「只講 policy（voice-sensitive pin / judge 浮動）+ 版本值指向 frontmatter SSOT」，結構上讓它無從 drift。順手把同檔另外兩處抄了版本號的清單（fallback 四審清單、寫作 SOP Step 2）也一併拔掉版本號。
- 權威端 + 自主姿態（ShroomDog 補充）：**可以 drift 的內容，SSOT 權威端是「code 或 openspec」，不是散文**；散文服從 code/openspec。**能判斷哪邊對就自己判斷、把錯的那邊修掉、跟 user 提一聲就好，不要停下來問**；只有「難判斷又是重要決定」（兩權威端真衝突、或產品/架構/品牌/config 取向）才用 `AskUserQuestion`。對照本 session：librarian 那種 code(frontmatter)-vs-doc drift 該直接自己收（不必問）；fresh-eyes「pin 哪代 vs 浮動」是 config 取向，問 user 才對。
- Reusable lesson：(1) **看到「doc 跟實際對不上」不要只修這一處，要問『這個事實在幾個地方被抄了』，全部收斂**——這次一條 routing fact 在 playbook 抄了三份。(2) **預防勝於修補：能不複製就不複製**，doc 講 policy / why，值留在它的 SSOT（code：frontmatter / 常數 / config / schema，或 openspec spec），要列就標明 derived view + 指向真身。(3) deterministic guard 是補網不是主防線；真正可靠的是把 SSOT 紀律寫成每個 agent 都讀得到的強規則（CLAUDE.md），讓它自主偵測 + 當場收斂 + 提一聲。

## 2026-06-21 — MP-300 / mental model 優先，過度精確會讀起來像 AI slop

### Feedback: online 版比 clean rewrite 好讀；不要把太多準確概念塞進同一句

- ShroomDog feedback：讀過 CP-300 production 版後，實際偏好 online/current 版，而不是 salvage 出來的 clean rewrite。對 rewrite 的感覺是「boring」且「feels like ai slop」；進一步釐清後，不一定是典型 AI slop，而是**太嚴肅、太多準確概念和術語塞進一句，讀者很難抓 mental model**。
- 情境：MP-300 clean rewrite 比 current 版更忠於 source boundary、概念更精確，會寫成「Lalit Maganti 回顧自己如何把想了八年的 SQLite devtools 專案，在三個月內靠 AI coding agents 推到 0.1 發佈；同時也記錄了 vibe-coding 報廢重來、prompt 成癮、失去 codebase 觸感，以及 AI 對 implementation 與 design 的不同作用。」這種句子。資訊都對，但一口氣塞進太多 axis：時間線、工具類型、版本發佈、vibe-coding、成癮、codebase 觸感、implementation/design 分工。讀者還沒建立圖像，就先被概念清單淹過。
- ShroomDog 的核心判斷：**AI era 裡，人類最該保住的是正確 mental model**。細節可以交給 coding agents 補、查、實作，除非東西壞掉或是 absolute critical、需要 human input。文章要先幫人類抓住「這件事到底該怎麼想」；不要為了準確，把所有概念都壓進同一句，讓讀者失去可操作的圖。
- 為什麼 current 版比較有效：current opening 比較有畫面與節奏——「八年。一個工程師腦子裡裝了八年的 side project……然後 AI coding agent 出現了。」它先交付一個簡單 mental model：長年想做但太難太煩的 side project，被 AI 推到可以開始。細節（PerfettoSQL、parser、400 條 grammar rules、vibe-coding 月、review/rewrite 流程）後面再展開。這比較符合人類閱讀順序：先有骨架，再掛細節。
- Reusable lesson：(1) **準確不等於好讀**。一個句子如果同時承載五六個準確概念，它會像 model 把 source outline 壓縮成摘要，不像人在說故事。(2) **mental model 先於 term density**：先讓讀者拿到一張簡單圖，再逐步加 terms / caveats / implementation details。不要在 summary 或 opening 把所有正確維度一次塞完。(3) **細節不是消失，而是延後**：critical details 要保留，但放到讀者已經抓住圖像之後；非 critical details 可以交給 MoguNote、後段、或乾脆省略。(4) Rewrite 不要只追「source boundary 更乾淨」；也要保住 gu-log 的可讀 hook、畫面感與人類認知節奏。太乾淨、太認真、太概念密集，會變成另一種 AI 味。

## 2026-06-23 — MP-310 ShroomDog vibe 6 vs 機器 vibe 8（校準訊號 + 新增 shroomDogVibe 欄位）

### Feedback: 「Vibe 6 by ShroomDog (V2)；merge 前該有個 vibe score 存在某處」（澄清：不是匿名 human，是 ShroomDog 本人——gu-log 的具名編輯人格）

- 情境：MP-310（Alisa Liu 求職實錄 MP 翻譯）由 Opus 4.5 重寫成 V2 後，四法官給 Fact 9 / Vibe 8 / Librarian 8 / Fresh Eyes 8。ShroomDog 讀過 branch preview 後判定「acceptable」可 merge，但 ShroomDog 本人 vibe 只給 **6**，並指出值得讓「ShroomDog vibe score」有個正式存放位置。
- 校準訊號：**機器 vibe 8 對人工 vibe 6 → 機器分偏寬約 2 分**。這跟 MP-300 那次「rewrite 概念精確但讀起來像 AI slop / boring」是同一條軸——tribunal 的 vibe judge 容易把「忠實、乾淨、無錯」讀成高分，但人類讀者要的是畫面感、節奏、不無聊。MP-310 V2 的中段（面試分類七連列）正是 fresh-eyes 也點到的「faithful but less warm / linear」，機器仍給 8，人類給 6。
- 處置：(1) 新增 `scores.shroomDogVibe`（score / date / note）到 `src/content.config.ts`（frontmatter schema SSOT），讓 ShroomDog vibe 有正式欄位、跟 AI tribunal 並存、可被未來 UI / 背景 tribunal 當 ground truth。命名刻意用 `shroomDogVibe` 而非 `humanVibe`——這是具名編輯（ShroomDog）的分數，不是匿名 human。(2) MP-310 兩版 frontmatter 填 shroomDogVibe 6。shroomDogVibe **不是 commit gate**，純編輯 ground truth / 校準用。
- Reusable lesson：(1) **機器 vibe 跟 ShroomDog vibe 要分開記、不要互相覆蓋**——機器分系統性偏寬，把兩者並列才看得出 gap、才能日後校準 vibe-scoring-standard。(2) 機器給 straight-8、人類給 6 的典型死因是「中段把 source 結構線性照搬、忠實但不暖」；rewrite 要主動破壞線性、加畫面，不能只追忠實乾淨。(3) merge 不被 ShroomDog 低分擋（floor 是 AI composite ≥3、homepage 是 AI vibe 一維 ≥9）；ShroomDog vibe 6 的角色是誠實記錄 + 餵背景精修，不是 ship gate。
## 2026-06-23 — GP-243（creatorpascal 金錢與快樂）：太多生硬詞彙 + MoguNote 不夠解釋性 + pipeline note component drift

### Feedback: 「看起來不怎麼樣，太多生有詞彙了，富有解釋性的 MoguNotes 呢? Where the fuck r they?」

- ShroomDog 在 prod 讀 GP-243 後不滿意，兩個具體點：
  1. **太多生硬/未翻詞彙**：正文留太多英文與 jargon（`protocol`、`bug`、`P/I 欄`、`ataraxia`、`net worth/self-worth` 等），即使有些被 allowlist 或加註，整體讀起來還是卡、像沒翻完。違反〈術語處理〉精神：能翻成自然繁中就翻，不要靠 allowlist 硬留英文。
  2. **MoguNote 不夠「富有解釋性」**：文章用的是短促吐槽式的 note（一兩句 + kaomoji），ShroomDog 要的是 sd-26 那種**一整段、有 POV、把題材接回 AI/tech 或 gu-log 自身**的解釋性 MoguNote。POV 是 gu-log 的靈魂，note 太 quippy = 沒打出靈魂。
- 連帶踩到的 pipeline drift：**`gp-pipeline` 的 `write.tmpl` 當時仍輸出非 canonical note component**，但寫作 SSOT（`GU-LOG_WRITER_PROMPT.md`）已規定 **POV 一律進 `<MoguNote>`**，persona 也已改成 Mogu（首頁副標）。pipeline 沒跟上 SSOT，會讓每篇自動產出的 GP 重複同一個錯；修法是在 template 端只輸出 canonical component。
- Reusable lesson：(1) **GP/MP 文章只使用 canonical `<MoguNote>`**，新文章與 template 都不保留舊 component alias。(2) **MoguNote 要解釋性、成段、有 POV**（接回 AI/tech 平行對照或 gu-log 自身的自我指涉 callback），不是一句吐槽配 kaomoji。品質門檻：讀者要看 note 才看得到 gu-log 的觀點，所以 note 必須自帶資訊量。(3) **晶晶體不是「過了 lint 就好」**：allowlist 是最後手段（專有名詞 / 模型名），一般概念詞（protocol→流程、bug→出錯/毛病）能翻就翻，留英文會讓 ShroomDog 覺得「沒翻完」。(4) pipeline template 是 writer-prompt SSOT 的 derived view；SSOT 選定 canonical `<MoguNote>` 後，template 必須同步，否則自動產出會持續 drift。

## 2026-06-25 — 「拆過」全站退役 + 建 GP-232 授權但沒人做的 T3 硬 lint

### Feedback: GP-244 的「gu-log 在 GP-220 拆過」很 AI；退役它，並把 banned terms 接成 lint

- ShroomDog feedback：讀 SP-244 時點名 `拆過` 很 AI 腔；要求建一個 lint 擋掉這種 AI 翻譯腔，並指出「banned terms 在 editorial-feedback corpus 裡找得到」（要從這份 corpus 取字，不要 agent 自己憑空想）。
- 查證（ShroomDog 校正：**`拆過` 就是 AI tell，只是一直沒空修，不是被認證的慣用法**）：全站 **19 處 / 14 篇**，幾乎清一色 `[post-ref] 拆過 [主題]`、多半帶 cross-ref（「gu-log 之前拆過 [GP-192]」「GP-175 拆過一次」）。一開始把「數量多」誤讀成「既有慣用法、別 lint」是錯的——多只代表**累積沒清的 debt**。grep 真正的價值是抓出唯一 1 處**字面**用法：GP-216「拆過外掛、改過外掛」=拆解外掛（金山遊俠），那個才該留。`拆過` 是離散、單一例外的 tell → 可以硬 lint（用 `{/* ai-ok */}` 放行 GP-216）；GP-232 那條「regex 誤殺正當用法」針對的是**密度型** tell，不是這種離散詞。
- 決策（ShroomDog 拍板兩題）：(1) `拆過` **全站退役** → 講過 / 寫過 / 聊過（當成刻意換詞，像 查重→dedup）。(2) **建 GP-232 line 419 早就授權、但一直沒人做的 T3 explicit-wordlist 硬 lint**——`scripts/check-ai-tells.mjs`。
- Grandfather 取捨（誠實記一筆）：碰舊文會掀出它既有的 lint 債——編輯一個字就觸發整篇 re-lint / re-score。`拆過` 殘留在 7 篇 grandfathered 舊文：(a) **score-less**（mp-272 / mp-303 / gp-182，加字面用法的 gp-216）被 score floor 擋；(b) **晶晶體債**（gp-177 / gp-180 / gp-181 / gp-183）被 jingjing 擋（既有裝飾英文要 ShroomDog 拍 allowlist 邊界，超出換詞範圍）。依 gate 哲學（「不要為維護性小改逼舊文重評分」）+ 分數誠實（不准手填假分）+ allowlist 要 ShroomDog 拍板，**這 7 篇一律跳過、還原回 HEAD**；它們的 `拆過` 凍結，等下次被實質編輯時由 lint 連帶逼修。退役在**政策上**完成（詞已死、lint 把關新文與未來編輯），只是 analytical 殘留在這批 score-less / 晶晶體債的舊文。
- 修法：
  1. Sweep：8 處 analytical `拆過`→`講過`，橫跨 6 篇有分數的文 + GP-244（GP-208 用 `寫過` 避開相鄰 `講過` 重複）。上述 7 篇 grandfathered 舊文還原回 HEAD（見上）。
  2. `scripts/check-ai-tells.mjs`：sibling of check-pronoun-clarity / check-jingjing（同 mask 區、staged-only、merge-skip、pre-commit 攔）。`BLOCKLIST` 是字表 SSOT，error 訊息直接帶自然替代（progressive disclosure——修的人讀 lint 輸出、不靠 prompt）。**v1 種子 = 低誤殺離散詞**：拆過、拆得很乾淨/很漂亮、這才是工程品味、這刀切得漂亮、學術根源是、一句話記住。`{/* ai-ok */}` 逐行放行字面用法。
  3. `GU-LOG_WRITER_PROMPT.md` 加一條 policy pointer 指回 `BLOCKLIST`（**不複製字表**，避免 token 成本 + 過度迴避失真 + drift）。
- 範圍紀律（照 GP-232）：**只有「有明確字表、低誤殺」的離散 tell 進硬 lint**；密度型（T1 反義對偶 / T2 假深度 reframe / T4 mic-drop）繼續走 tribunal 的 AI-Tell Trap rubric（`scripts/vibe-scoring-standard.md`），不碰。
- Reusable lesson：(1) **直覺說某詞很 AI 時，先 grep 全站**——但「數量多」≠「合理」，多通常只代表**沒清的 debt**（`拆過` 17 處就是）。grep 的真正用途是抓**例外**（唯一 1 處字面 GP-216 要留）+ 量化 sweep 範圍，不是拿數量替 tell 平反。(2) banned-term 字表的 SSOT = lint 的 `BLOCKLIST`，corpus / writer prompt 只當 derived view 指回去，不抄第二份。(3) 硬 lint 只收「離散 + 低誤殺 + 有明確字表」的詞；密度型交給 LLM judge，這條邊界 GP-232 就劃好了。(4) 退役一個會冒回來的詞，光 sweep + 寫 prompt 不夠，要有 deterministic gate 擋下一次；字面用法用逐行 escape 當壓力閥。

## 2026-07-13 — GP-255 session：「競對」ban（簡中縮寫，台灣繁中不用）

### Feedback: 從沒在 zh-tw 看過「競對」，要 programmatic ban

- ShroomDog feedback：`競對？正文是用競隊還是競爭對手？ We shall ban the usage of 競對 programatically as i have never seen such zh-tw usage.`
- 情境：GP-255（反向資訊悖論）收工回報時，agent 的聊天訊息用了「實習生離職去競對」。正文本身沒中鏢（兩處都寫「競爭對手」），但「競對」是簡中圈的縮略用法（競爭對手→競對），台灣繁中不存在，屬於跨模型都可能吐出來的簡中滲透詞。全站 grep 零命中——這次是**在滲進文章之前**先立 gate。
- 修法：`scripts/check-ai-tells.mjs` 的 `BLOCKLIST`（banned-phrase SSOT）加 `競對` → 建議「競爭對手」。符合 GP-232 劃的硬 lint 邊界：離散、低誤殺（zh-tw 沒有「競」「對」連用的慣用法）、有明確替代詞。
- Reusable lesson：(1) 簡中縮略詞（競對、視頻、質量這類）跟 AI tell 同樣走 `BLOCKLIST` 硬 lint——它是 deterministic 字表問題，不用等 tribunal 抓。(2) agent 聊天回報的用字也是 ShroomDog 的 review surface：文章沒滲進去不代表沒問題，被點名的詞照樣立 gate，把「還沒發生的 drift」擋在前面。

## 2026-07-13 — 「評測」「測評」退役（支語感），改用「評估 / 評估基準」

### Feedback: 比起評測，評估是不是更好？評測聽起來是支語，ban it programmatically

- ShroomDog feedback：`比起評測，評估是不是更好？ 評測聽起來是中國用語、支語, which i hate and plz ban it from gu-log programmatically.`
- 情境：GP-255 正文有 3 處「評測」（私有的評測 / 拿回評測權 / 優化評測，都在翻 Nadella 的 "private evals"）。全站 grep：**83 處 / 29 篇 zh-tw 文章**——AI benchmark 語境下各家 model 很愛吐「評測」，累積成 debt。「測評」（更赤裸的支語倒裝）零命中。
- 修法：
  1. `scripts/check-ai-tells.mjs` `BLOCKLIST` 加「評測」→ 建議「評估 / 評估基準 / 基準測試 / 跑分」；順手加「測評」（零命中，先立 gate）。
  2. GP-255 當場清掉 3 處（評測→評估基準 / 評測權→評估基準的主導權）。
  3. 其餘 82 處 / 28 篇照「拆過」前例 **grandfather**：lint 是 staged-only，舊文凍結，下次被實質編輯時連帶逼修。不做全站 bulk sweep——每處語境不同（benchmark / evals / 開箱），機械替換會出怪句。
- Reusable lesson：(1) 「評估」是 gu-log 的預設詞；指 benchmark/evals 這種「一組可重跑的測試」用「評估基準」或「基準測試」，指 3C 開箱用「實測」。(2) 高頻支語（83 處等級）的退役 SOP 跟「拆過」一樣：lint 擋新增 + 最新文章當場清 + 舊文 grandfather 等編輯時逼修，不硬掃全站。

## 2026-07-15 — MP ryolu session：「出貨」不是台灣 tech 口語，prompt / review / ship 動詞留英文更自然

### Feedback: 「prompt, review, ship 都滿自然的，我自己是沒啥聽到出貨，頂多上線」

- 情境：MP〈夢想變成工作之後〉翻 Ryo Lu 的 "you can still prompt, review, decide, ship"。FreshEyes judge 嫌英文動詞在安靜散文裡有摩擦感，writer 全翻成中文（下指令 / 審稿 / 做決定 / 出貨）。ShroomDog 看過選項後定調：prompt / review / ship 在台灣 tech 圈口語就是講英文，留著反而自然；「出貨」則幾乎沒人講，講的是「上線」。decide 維持中文「做決定」。
- 修法：正文改回「還是可以 prompt、review、做決定、ship，讓事情繼續動」。
- Reusable lesson：(1) **judge 的 taste ≠ ShroomDog 的 taste**：FreshEyes 對「英文動詞摩擦感」的判斷在這裡被 owner 推翻——工程圈實際口語的英文動詞（prompt / review / ship / merge / commit 這類）不算晶晶體，硬翻反而失真。(2) **「出貨」是翻譯腔警訊**：ship 對應的台灣口語是「上線」（或直接留 ship）；「出貨」是製造業詞彙滲進軟體語境。(3) 動詞留不留英文的判準是「工程師嘴巴上怎麼講」，不是「字典能不能翻」。

## 2026-07-16 — SP River：多角色段落裡的「她」讓讀者反覆猜主詞

### Feedback: 「It is not very clear who 她 is at each appearance.」

- 情境：〈Shopify 的 AI Agent 不開私訊〉同時出現「River」、客服工程師、後端工程師、新人與公司員工，正文卻連續用「她」指稱「River」；其中「隔天她就能做一樣的事」實際指客服工程師，主詞在同一段內切換。個別句子勉強能解，但讀者每次都得回頭判斷。
- 修法：移除全文所有「她」，需要辨認角色時直接寫「River」、「這位 Agent」或「這位客服工程師」；能靠改寫句型自然省略主詞時，就不硬塞代名詞。英文版的 `she/her` 始終只指 River，沒有相同的角色切換問題，因此不做機械式同步替換。
- Reusable lesson：**多角色段落的代名詞清楚，不只看最近的語法先行詞，也要看讀者是否需要停下來猜。** 同一段只要角色或人機主詞發生切換，下一句優先重報人名／職務；若某個代名詞在全文出現多次，每一處都要獨立通過「不回讀也知道是誰」的測試。
