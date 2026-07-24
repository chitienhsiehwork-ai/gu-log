## Why

Gu-log 已經有很多機制層規格：frontmatter、Tribunal、reader state、rewrite loop、評分維度、發佈 gate。這些規格回答「怎麼做」，但沒有一份規格回答「為什麼做、寫給誰看、怎樣算贏」。

這個缺口讓編輯哲學散在 `CONTRIBUTING.md`、`GU-LOG_WRITER_PROMPT.md`、playbook、judge prompt 和 agent note 之間。單點看都合理，放在一起卻容易 drift：gu-log 到底是在翻譯、改寫、原創吐槽、還是幫 ShroomDog 做可分享的中文知識卡，沒有被 first-principles 層明確定義。

本 change 新增 `editorial-charter` capability，作為 gu-log 編輯哲學的北極星。它不取代既有內容規則與 Tribunal 機制，而是在它們之上定義：

- 讀者是誰
- 成功怎麼判斷
- GP/MP 的 body 能重組到哪裡、不能跨到哪裡
- Lv 什麼時候是原創、什麼時候是導讀
- 四個系列的一句話定位
- MOBA register 應該跟著聲音走，而不是跟著系列走

## Relationship to `add-editorial-spine-rebuild`

`add-editorial-spine-rebuild` 定義的是 editorial loop 的結構性修稿能力：怎麼辨識 `surface-fail` / `structural-fail`，以及何時進 `polish` / `restructure` / `rebuild`。它處理的是「一篇稿子骨架不好時怎麼修」。

本 change 定義的是更上層的 editorial charter：gu-log 寫給誰、怎樣算成功、忠實翻譯與重組敘事的邊界在哪裡。它處理的是「所有後續規則要服從的北極星」。

兩者不重複：`editorial-charter` 是 first-principles policy；`editorial-spine-rebuild` 是基於該 policy 可以派生出的 editorial mechanism。未來若兩者有衝突，應先以 `editorial-charter` 決定方向，再調整 spine/rebuild 機制。

## What Changes

### 新增 `editorial-charter` capability

新增一份 capability spec，集中定義 gu-log 的 why / who / win：

- 北極星：作者優先、陌生讀者為底線
- 成功標準：幾個月後 ShroomDog 重讀仍然讀得爽，且願意把 gu-log 連結丟給人，而不是丟英文原文
- 流量與 audience growth 是 bonus，不是計分板
- Fresh Eyes 是下限守門，不是把文章磨成泛用技術文的權力中心

### 定義 GP/MP body 的忠實邊界

GP/MP 的 body 是忠實翻譯，但忠實不等於逐句搬運。Spec 會把「重組敘事」定義成：

> 改 packaging，不改 payload。

也就是可以改順序、節奏、切塊、故事框架、自然中文表達；不能改原文主張之間的因果、強弱、條件、hedge、caveat 或結論。所有意見、吐槽、玩笑、外加類比都進 MoguNote / MoguNote，永不進 body。

### 定義 Lv 的兩種 mode

Lv 不再只有「原創入門教學」一種隱含身份：

- `Lv-原創 mode`：無 source，從零教概念，類比自由
- `Lv-導讀 mode`：拆解一篇長文或難文，開頭必須 cite 原文 ref；可以挑重點、簡化與重組，但轉述原文時不能扭曲

### 定義四系列的一句話定位

Spec 會把 GP、MP、SD、Lv 的角色濃縮成可引用的一句話定義，避免散文文件各自發明說法。

### 定義 MOBA register policy

MOBA 味跟著聲音走，不跟著系列走。Mogu / SD / Lv 的嘴可以 MOBA-flavored，被翻譯的 body 永遠素顏。深詞可以用，但上下文本身必須扛住概念：on-site MOBA glossary 上線前就地解釋或泛化，上線後連到 glossary；glossary 不是塞滿術語的免死金牌。

## Impact

### Affected specs

- `editorial-charter`（新 capability）

### Affected docs / prompts after this change is accepted

後續 implementation 應把散在文件改成 derived view，指向 `editorial-charter`：

- `CONTRIBUTING.md`
- `GU-LOG_WRITER_PROMPT.md`
- `CLAUDE.md` / `AGENTS.md`
- `playbooks/local-agent-playbook.md`
- `playbooks/CCC-playbook.md`
- Tribunal judge prompts and writer prompts

### Affected routing

Charter 不能只是另一份沒人讀的散文。後續應把 `editorial-charter` 接進既有開場路由：

- `scripts/detect-env.sh` 繼續負責辨識 local machine actor / CCC
- 各 playbook 在 content / editorial work 的開場路徑中 MUST 指向 `openspec/specs/editorial-charter/spec.md`（archive 後）或 active change 的 `openspec/changes/add-editorial-charter/specs/editorial-charter/spec.md`
- agent 在寫文、修文、改內容規則、改 Tribunal judge prompt 前 MUST 讀 charter

### Non-goals

- 不實作 MOBA glossary section
- 不調整 Fresh Eyes scoring code
- 不重寫 `CONTRIBUTING.md`、`GU-LOG_WRITER_PROMPT.md` 或 playbook 的 operational rules；本 change 只補 stable charter pointer，並移除與 charter 衝突的 first-principles 重述
- 不再次更名 GP / MP / SD / Lv / Mogu
- 不改 publish bar 或 Tribunal PASS bar
