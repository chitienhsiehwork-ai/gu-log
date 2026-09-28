## Why

GP 在 Tribunal 只評分、不改寫（`gp-source-preservation`），但 `tribunal-score-persistence` 只在評審 PASS 後寫分數，而且情境「中途失敗只有部分分數」明訂沒過的那一關不寫。兩條合起來，GP 只要有一關沒過就少一個分數區塊，`validate-posts` 擋下部署；這跟 CONTRIBUTING〈兩層品質門檻〉「沒到 PASS 門檻的 GP 照樣可以只上繁中」矛盾。前 10 篇導讀試做的第一篇就卡在這裡（部署 exit 16）。

## What Changes

- GP 的每一關評審判定後，不論 PASS 或 FAIL 都寫入分數；前一關沒過，其餘評審照樣評分。GP 最後帶著四個分數，交給兩層品質門檻決定能不能上線，而不是要求四關全過。
- 非 GP 文章維持原規則：只在 PASS 後寫入，中途失敗只留已通過的分數。
- 兩個 Tribunal 入口（`scripts/tribunal.sh` 與 `pnpm tribunal:run`）行為一致；GP 仍然不改正文、不動來源距離章。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `tribunal-score-persistence`：分數寫入加上 GP 例外，並把「中途失敗只有部分分數」限定在非 GP。

## Impact

影響 `scripts/tribunal.sh`、`src/lib/tribunal-v2/pipeline.ts` 與對應回歸測試。不改評分門檻、評審 model、非 GP 的改寫迴圈，也不改 `validate-posts` 對分數區塊的要求。
