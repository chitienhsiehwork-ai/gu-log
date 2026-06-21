## Why

Tribunal 現在每次 judge FAIL 後呼叫 `tribunal-writer` rewrite，接著立即跑 `pnpm run build` 驗證整站。這個策略安全但昂貴：Astro production build 是整站 build，近期 log 顯示單次 build 中位數約 113 秒，且 `astro.js build` 可吃到 2GB+ RSS。多 worker 同時 rewrite 時，多個 build 會疊在一起，造成 MemoryMax 撞牆、exit 137 / OOM、service restart，反而浪費 token 重跑。

需要把 full build 從「每次 rewrite 後」移成「文章所有 judges PASS 後的 final gate」，並用 shared build lock 保證同一台 VM 同一時間最多一個 Astro full build。中間 rewrite loop 保留 cheap validation，避免明顯壞 MDX/metadata 一路流到最後。

## What Changes

- **新增 final build gate**：文章所有 Tribunal judge stages PASS 後，才執行 full `pnpm run build`。build PASS 才能 mark article PASS。
- **新增 shared build lock**：所有 worker worktrees 在 full build 前使用同一個 shared lock path，透過 blocking exclusive `flock` 序列化 Astro build。
- **writer 後改 cheap validation**：`tribunal-writer` rewrite 後不再立即 full build，改跑低成本驗證（檔案存在、frontmatter/schema/target post validation、diff sanity）。
- **build-fix loop**：final build FAIL 時，視為 final judge failure；以 build log tail 呼叫 writer/fixer 修語法或 render 問題，並有 max attempts。
- **timeout 與 logging**：分清楚 waiting for lock、acquired lock、build duration、build rc。timeout SHALL 包住 build execution，不把 lock wait 誤算成 build timeout。

## Capabilities

### New Capabilities
- `tribunal-final-build-gate`: final full-site build gate、shared build lock、cheap validation、build-fix loop、build observability。

### Modified Capabilities
- `tribunal-safe-parallelism`: 多 worker 並行時 SHALL 序列化 full build resource spike，不允許多個 Astro build 同時壓 RAM。

## Impact

- **scripts/tribunal-all-claude.sh** — 主要修改：移動 build timing、加入 cheap validation、final build gate、build-fix loop、shared flock。
- **scripts/tribunal-quota-loop.sh** — 可能修改：export shared lock directory 給 worker worktrees，或確認現有 shared coordinates 可重用。
- **.score-loop/locks/build.lock** — 新增 runtime lock artifact；檔案可常駐，lock state 由 kernel flock 管理。
- **docs/runbook / logs** — 操作上可用 log 判斷 build 是在等 lock、執行中、timeout、還是 fail。

## Non-Goals

- 不把 gu-log 改成 dynamic / hybrid website。
- 不取消 final full build；本 change 仍以 production build 作為最後正確性 gate。
- 不改 judge scoring semantics、model pinning 或 quota controller 演算法。
- 不把 build lock path 放到帶日期的 `/tmp` 檔名；lock path 必須穩定且所有 workers 共用。
