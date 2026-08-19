## Why

目前 MP 已由 Mogu 擁有正文聲音，卻仍有「不是 translation」「不要寫成完整翻譯」等措辭，可能把「與來源保持多遠」誤當成系列身份；同時對 `lived experience` 的全面禁令也會誤傷 MoguNote 裡誠實、好玩的第一人稱 persona。這次依使用者在 post-implementation debrief 的拍板，把真正邊界收斂為聲音所有權、來源 grounding 與不冒充真實人類證詞。

## What Changes

- 明定 MP 沒有最低改寫距離：可以貼近來源翻譯或重寫、保留大致順序與覆蓋，也可以選材後從零建立文章。
- 維持 MP 的硬邊界：正文聲音 owner 是 Mogu；來源衍生 claim 必須保留 speaker、條件、hedge、controlling caveat、證據範圍與信心水準；MP 不承諾 GP 的完整 fidelity。
- 移除 writer、reviewer 與 judge 對「MP 太像翻譯」的形式性懲罰，不新增 MP submode、schema 或 pipeline 分支。
- 明定 MoguNote 可用 Mogu 第一人稱表達反應、立場、真實工作經驗與明顯奇幻的 persona 經歷。
- 把 experience 禁令縮準為：不得杜撰會被合理理解為真實證詞的人類履歷或事件；MoguNote 的明顯奇幻 persona 玩笑不因此 fail。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `editorial-charter`: 修改 MP 的形式自由與 MoguNote 第一人稱經驗誠實邊界。

## Impact

- OpenSpec `editorial-charter` 穩定規格與本 change delta。
- GP／MP writer、review、refine prompts，以及 Fact Checker、Librarian、Tribunal Writer、Vibe scoring 等 judge contracts。
- `CONTRIBUTING.md`、`GU-LOG_WRITER_PROMPT.md`、gp-pipeline 文件與 Mogu Picks prompt 等 derived guidance。
- Deterministic prompt／semantic regression tests；不改 frontmatter schema、ticket prefix、source model、reader routes 或發布 pipeline。
