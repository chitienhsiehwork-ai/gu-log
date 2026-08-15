# MoguNote blind test

這個實驗工具替 GP-273 建立可稽核的 current／revised prompt 配對測試。它不是 production commentary runner，也不會直接改文章。

核心邊界：

- private experiment root 固定在 `/private/tmp/gu-log-mogunote-blind.XXXXXX/`。
- 每次 provider invocation 使用 opaque UUID 與唯一 CWD。
- exact model probe 失敗就記 `UNAVAILABLE`，不 fallback。
- 每格只接受第一個通過 strict JSON、hash、0/1 cardinality 與 anchor 驗證的輸出；最多一次 format-only retry。
- 匿名 board 只從 sanitized packet 產生，不讀 mapping。
- mapping、raw output 與 manifests 留在 private collector，揭盅前不得貼入 reviewer packet。

常用指令：

```bash
node scripts/experiments/mogunote-blind/runner.mjs init
node scripts/experiments/mogunote-blind/runner.mjs execute --root /private/tmp/gu-log-mogunote-blind.XXXXXX
node scripts/experiments/mogunote-blind/runner.mjs reconcile --root /private/tmp/gu-log-mogunote-blind.XXXXXX
node scripts/experiments/mogunote-blind/runner.mjs rebuild-packet --root /private/tmp/gu-log-mogunote-blind.XXXXXX
node scripts/experiments/mogunote-blind/runner.mjs board --root /private/tmp/gu-log-mogunote-blind.XXXXXX --output /absolute/path/gp-273-mogunote-blind.html
node scripts/experiments/mogunote-blind/runner.mjs verify --root /private/tmp/gu-log-mogunote-blind.XXXXXX --board /absolute/path/gp-273-mogunote-blind.html
node scripts/experiments/mogunote-blind/runner.mjs reveal --root /private/tmp/gu-log-mogunote-blind.XXXXXX --result /absolute/path/ranking.json
```

`init` 只建立 inputs；`execute` 才會呼叫外部模型。`reveal` 必須等 user 已匯出 blind ranking JSON 後才能執行。
