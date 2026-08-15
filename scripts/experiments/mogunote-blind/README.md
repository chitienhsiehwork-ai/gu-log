# MoguNote blind test

這個實驗工具替 GP-273 建立可稽核的 current／revised prompt 配對測試。它不是 production commentary runner，也不會直接改文章。

核心邊界：

- private experiment root 固定在 `/private/tmp/gu-log-mogunote-blind.XXXXXX/`。
- 每次 provider invocation 使用 opaque UUID 與唯一 CWD。
- exact model probe 失敗就記 `UNAVAILABLE`，不 fallback。
- 每格只接受第一個通過 strict JSON、hash、0/1 cardinality 與 anchor 驗證的輸出；transport 或格式錯誤最多 retry 一次。格式 retry 會先凍結 candidate 語意，第二次有任何改稿就整格拒絕。
- Codex 關閉 shell／hosted tools，並以 permission profile 把檔案讀取限縮到該格 CWD。由於 `codex exec --json` 不提供 provider-attested actual model，exact-model gate 會把 Codex probe 記為 `UNAVAILABLE`，不把 requested slug 冒充 actual model。
- 匿名 board 只從 sanitized packet 產生，不讀 mapping。
- mapping、raw output 與 manifests 留在 private collector，揭盅前不得貼入 reviewer packet。`execute` 完成時會 seal collector；board 在 private temp 通過 self-hash 與 leakage scan 後才 atomic publish。

常用指令：

```bash
node scripts/experiments/mogunote-blind/runner.mjs init
node scripts/experiments/mogunote-blind/runner.mjs execute --root /private/tmp/gu-log-mogunote-blind.XXXXXX
node scripts/experiments/mogunote-blind/runner.mjs board --root /private/tmp/gu-log-mogunote-blind.XXXXXX --output /absolute/path/gp-273-mogunote-blind.html
node scripts/experiments/mogunote-blind/runner.mjs verify --root /private/tmp/gu-log-mogunote-blind.XXXXXX --board /absolute/path/gp-273-mogunote-blind.html
node scripts/experiments/mogunote-blind/runner.mjs reveal --root /private/tmp/gu-log-mogunote-blind.XXXXXX --result /absolute/path/ranking.json
```

`init` 只建立 inputs；`execute` 才會呼叫外部模型。`reveal` 必須等 user 已匯出 blind ranking JSON 後才能執行。
