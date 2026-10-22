# Design

## 數值照現況寫進 spec

這次只是把已經在跑的規則寫下來：Librarian 的 composite 門檻、Fact Checker 的核心 composite 加兩個邊界維度、四位評審的 AND，都照 `check_pass_bar` 與 `meetsPublishBar` 現在的行為寫，跟評分標準的總覽表一致。要改門檻是另一個 change。

## parity test 比行為，不比文字

`tests/tribunal-pass-bar-parity.test.ts` 從 `tribunal.sh` 抽出 `check_pass_bar`，連同 `STAGES` 表裡評審與 gate 的對應，跟 `meetsPublishBar` 吃同一批 case；每個 case 的預期結果照本 spec 寫。這樣改了任何一邊、或兩邊一起改但沒改 spec，測試都會紅。測試不去比對 spec 或評分標準的原句（`docs/agent-discipline.md`〈測試不斷言 prompt／指示檔的原句〉）。

## 不合併兩份實作

讓 `tribunal.sh` 改呼叫 TS、或讓網站讀 Python，都要動 24 小時運作的 runner 主體；#1164〈刻意不建議做的事〉也不建議趁這次大改 `tribunal.sh`。兩份實作留著，由 parity test 鎖住。

## 不處理的相關問題

- runner 用維度重算 composite，網站則讀 frontmatter 的 `score`；judge 寫入的 `score` 跟維度對不上時兩邊可能不同。這是 #1164 第 2 節另一條 P2（floor 不再相信 judge 的 `score`），parity test 的 case 一律用跟維度一致的 `score`。
- 缺 `tribunalVersion` 時各處預設值不一致，也是同節另一條 P2。
