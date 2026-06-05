## Human Review Summary

This change asks whether gu-log should expose a human-readable, session-gated viewer for locally captured human signals so ShroomDog can inspect finish/share/abandon/comment evidence without DevTools, including on iPhone-sized usage.

The viewer is intentionally inspection-first. It should surface local evidence, sync status, article/version identity, and copy/export packets, without overstating low-confidence events or silently mutating event semantics.

## Review Decision Requested

Approve this change if ShroomDog agrees that:

- the reader dashboard or a nearby session-gated route should include a Human Signals viewer;
- the viewer should show event counts, recent events, article/version identity, confidence/trust, and sync status;
- share intent should not be labeled positive unless polarity is classified;
- abandon candidates should be displayed as low-confidence suspected evidence;
- inspection must be read-only by default except explicit sync/export/import/debug actions.

Not approved by this change:

- durable backend transport;
- Tribunal requeue automation;
- treating guest/unknown signals as automation-authoritative evidence.

## Why

ShroomDog 不想每次都開 DevTools 才知道 gu-log 有沒有記到「讀完 / 中離 / 分享 / 留言」。現在 human signals 已經會進 localStorage，但沒有一個人類可讀、iPhone 可用的小入口。

這個 change 先做 viewer/instrumentation：讓站內已登入使用者可以看到本機已收集到的 signals、哪些還沒 sync、哪些是低信心中離、哪些只是 strong share reaction。它不決定 durable backend，也不讓 guest/unknown signals 直接驅動 Tribunal。

## What Changes

- 在 reader tracker 或相近 session-gated page 加入 Human Signals viewer。
- 顯示 local human signal store 的摘要、recent events、pending/failed/synced 狀態與 article/version identity。
- 補齊 export/copy pending packet，方便 debug 或人工回報。
- 明確規定 viewer 是 read-only by default；只有明確 sync/status 操作可以改 `syncStatus`。
- 規定 dashboard/bulk mark-read 是否產生 human signal，避免 read state 和 human signal 分裂。

## Impact

- Frontend: `reading-tracker.astro` 或新 route、`human-signals.ts` helper、測試。
- Product: ShroomDog 可用 iPhone 看 signals，不必開 Mac DevTools。
- Out of scope: durable remote transport、backend API、Tribunal requeue automation。
