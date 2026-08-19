## Why

Post-implementation debrief 進一步拍板：MP 的系列身份取決於 Mogu 是否擁有正文聲音，不取決於文章與來源之間的改寫距離；MoguNote 也應容許誠實的第一人稱 persona，而不是全面禁止 experience writing。這些決策原本被誤建為第二個 active change，但它們屬於既有 `differentiate-gp-mp-editorial-contracts` 的同一個編輯契約，因此沒有建立第二套 implementation lane。

## What Changes

- MP 沒有最低改寫距離：可以貼近來源翻譯／改寫，也可以選材後從頭建立文章。
- 貼近來源的 MP 仍由 Mogu 擁有正文聲音，不取得 GP 的完整翻譯 fidelity 承諾；距離本身不構成評分理由。
- MoguNote 可用第一人稱表達反應、立場、實際發生的 editorial／tool interaction，以及一眼可辨識的奇幻 persona 經歷。
- 來源作者經歷不得轉嫁給 Mogu；看似可信的人類假履歷或證言仍不允許。
- 以上決策、實作、驗證與 stable-spec sync 全部收斂至 `differentiate-gp-mp-editorial-contracts`；本 archive 只保留 transient change 的完整 provenance，不建立第二份 runtime contract。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `editorial-charter`：MP 自由形式與 MoguNote 第一人稱經驗的誠實邊界。

## Impact

- Canonical implementation 與 stable SSOT 只有 `differentiate-gp-mp-editorial-contracts` 及其同步後的 `editorial-charter`。
- 不新增 MP submode、frontmatter schema、pipeline branch、reader-facing mode 或第二套評審規則。
