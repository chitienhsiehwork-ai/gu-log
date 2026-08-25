## Context

`differentiate-gp-mp-editorial-contracts` 已將 GP 與 MP 的核心邊界定為 voice ownership。Debrief 隨後補齊兩個同一契約內的問題：MP 能否選擇貼近來源，以及 MoguNote 能否誠實使用第一人稱。由於這不是獨立 capability，新增第二個 active change 會錯誤製造兩條 implementation 與 stable-spec 歷史。

## Goals / Non-Goals

**Goals:**

- 將 close-form 與 far-form MP 都納入同一個 Mogu-authored、source-grounded contract。
- 讓 reviewer 依 voice ownership、retained-claim grounding 與文章品質判斷，不把距離本身當成品質指標。
- 精準允許 MoguNote 的誠實第一人稱 persona，同時阻止經歷挪用與可信的假人類證言。
- 留下完整且不誤導的 OpenSpec provenance。

**Non-Goals:**

- 不建立第二套 implementation、stable SSOT 或發布流程。
- 不新增 `MP-rewrite`／`MP-original` submode 或 frontmatter 欄位。
- 不放寬 fact、quote、number、causality、citation、speaker chain 或 claim-closure grounding。

## Decisions

### 1. 決策折回原 change

這些要求直接補強 GP／MP 同一條 editorial contract，因此 proposal、implementation、雙重 review、驗證與 stable-spec sync 都由 `differentiate-gp-mp-editorial-contracts` 完成。本 archive 只忠實保存曾出現的 transient change 與其最終去向。

### 2. 用 voice ownership 定義 MP，不用 edit distance

MP 可以貼近來源翻譯／改寫，也可以選材、重排、反駁或重建。只要正文由 Mogu 負責且 retained claims grounded，接近或遠離來源都不應被單獨獎懲。Close-form MP 不因此取得 GP 的完整覆蓋、順序或來源作者 voice fidelity 承諾。

### 3. Experience gate 判斷是否冒充可信真實證言

MoguNote 可以容納第一人稱反應、立場、實際發生的 editorial／tool interaction，以及合理讀者一眼可辨識的奇幻 persona。所有 reader-visible prose 仍不得把來源作者經歷移給 Mogu，也不得杜撰可能被信以為真的人類履歷或事件。

### 4. 不以 provenance 修復製造第二套契約

Archive 保留完整 planning artifact shape 與實際 delta，但不重複修改 stable spec；stable `editorial-charter` 已由 canonical change 同步至相同最終語意。這讓 commit history、archive gate 與單一實作來源同時保持真實。

## Risks / Trade-offs

- [兩份 archive 看似兩套功能] → proposal、design 與 tasks 都明確指出本 change 已被 canonical change 吸收，沒有獨立 implementation lane。
- [Archive 只剩形式性 placeholder] → 保留實際被吸收的兩項完整 delta requirements，不放空檔或 dummy spec。
- [為修 provenance 製造 stable-spec churn] → 不改已同步且相對 base 確實更新的 stable `editorial-charter`。
