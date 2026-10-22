## ADDED Requirements

### Requirement: Librarian pass bar SHALL 只看 composite

Librarian SHALL 在每個 `tribunalVersion` 都擁有 `glossary`、`crossRef`、`sourceAlign`、`attribution` 四維，composite 照〈Per-judge composite〉計算。Librarian stage SHALL 在 composite >= 8 時過關；單一維度 SHALL NOT 另設門檻。

#### Scenario: 單一低分維度被 composite 補回來

- **WHEN** Librarian 的 glossary、crossRef、sourceAlign 都是 10，attribution 是 2
- **THEN** composite SHALL 是 8
- **AND** Librarian stage SHALL 過關

#### Scenario: composite 低於 8

- **WHEN** Librarian 的 glossary 7、crossRef 7、sourceAlign 8、attribution 9
- **THEN** composite SHALL 是 7
- **AND** Librarian stage SHALL 不過關

### Requirement: Fact Checker pass bar SHALL 分開檢查核心 composite 與兩個邊界維度

Fact Checker SHALL 擁有 `accuracy`、`fidelity`、`consistency`、`sourceBoundary`、`commentarySeparation` 五維，composite 照〈Per-judge composite〉計算。Fact Checker stage SHALL 只在三個條件都成立時過關：`floor((accuracy + fidelity + consistency) / 3) >= 8`、`sourceBoundary >= 8`、`commentarySeparation >= 8`。兩個邊界維度 SHALL 不能被其他維度補償。

#### Scenario: 核心三維 floor 到 8

- **WHEN** accuracy 7、fidelity 8、consistency 9，sourceBoundary 與 commentarySeparation 都是 8
- **THEN** Fact Checker stage SHALL 過關

#### Scenario: 核心三維 floor 到 7

- **WHEN** accuracy 7、fidelity 7、consistency 9，sourceBoundary 與 commentarySeparation 都是 10
- **THEN** Fact Checker stage SHALL 不過關

#### Scenario: 邊界維度低於 8

- **WHEN** 核心三維都是 10，但 `sourceBoundary` 或 `commentarySeparation` 是 7
- **THEN** Fact Checker stage SHALL 不過關

### Requirement: Tribunal PASS SHALL 要求四位評審都過關

一篇文章 SHALL 只在 Vibe、Fact Checker、Librarian、Fresh Eyes 四位評審都有分數，而且各自依文章的 `tribunalVersion` 通過自己的 pass bar 時，才算達到 Tribunal PASS bar（首頁與 featured 用的 publish bar）。評審之間 SHALL NOT 互相補償。Tribunal runner 逐關判定的 gate 與網站判定 publish bar 的邏輯，對同一份分數 SHALL 得到相同結果。

#### Scenario: 一位評審沒過

- **WHEN** 三位評審都過關且 composite 很高，第四位沒過自己的 pass bar
- **THEN** 這篇文章 SHALL 不算 PASS

#### Scenario: 缺一位評審的分數

- **WHEN** 文章的 scores 缺 Vibe、Fact Checker、Librarian、Fresh Eyes 其中任何一位
- **THEN** 這篇文章 SHALL 不算 PASS

#### Scenario: runner 與網站對同一份分數的判定一致

- **WHEN** 同一份評審分數分別交給 Tribunal runner 的 gate 與網站的 publish bar 判定
- **THEN** 兩邊對每位評審過不過關、整篇算不算 PASS SHALL 得到相同結果
