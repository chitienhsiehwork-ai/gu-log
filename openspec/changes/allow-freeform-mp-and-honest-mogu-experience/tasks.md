## 1. MP 自由形式契約

- [ ] 1.1 更新 `CONTRIBUTING.md`、`GU-LOG_WRITER_PROMPT.md`、Mogu Picks 與 gp-pipeline 指引，明定 MP 不設最低改寫距離且不新增子模式。
- [ ] 1.2 更新 MP write／review／refine prompts，禁止只因成品接近來源就要求重排、刪減或增加 Mogu 味。
- [ ] 1.3 更新 Fact Checker、Librarian、Tribunal Writer 與 Vibe contracts，讓貼近來源與重建型 MP 都依正文聲音所有權和 retained-claim grounding 評估。

## 2. Mogu 第一人稱經驗契約

- [ ] 2.1 更新寫手指引，允許 MoguNote 的第一人稱反應、真實編輯／工具互動與明顯奇幻人設經歷。
- [ ] 2.2 把評審／pipeline 的 `lived experience` 禁令縮準為來源作者經驗轉嫁，或會被合理理解為真實證詞的人類履歷／事件。

## 3. Regression tests

- [ ] 3.1 擴充 deterministic 編輯契約測試，固定「無最低改寫距離」「不新增子模式」與 MoguNote experience 正反邊界。
- [ ] 3.2 擴充 Go prompt tests，證明 MP 寫手／審查者不懲罰貼近來源形式，並保留 false-testimony gate。
- [ ] 3.3 建立 scenario→tier 對照：可確定字串／routing contract 為 Tier-1；需語境判斷的人設經驗為 Tier-2 binary review。

## 4. Verification

- [ ] 4.1 跑 focused Vitest、Go tests、OpenSpec strict validation、Astro check、lint 與 format gate。
- [ ] 4.2 跑 correctness reviewer 逐 scenario 對帳與 simplify reviewer Keep／Simplify／Drop，修到收斂。
- [ ] 4.3 完成 archive、CI 與 preview／production 驗證，不新增 schema、pipeline branch 或讀者可見模式。
