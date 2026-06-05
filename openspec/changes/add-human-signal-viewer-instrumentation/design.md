## Design

### Shape

最小 UI 建議掛在 `/reading-tracker`，因為它已經有 login gate、文章清單、sync controls、import/export 心智模型。

```
Reading Tracker
  ├─ read progress
  ├─ stale/current reads
  └─ Human Signals panel
       ├─ total / pending / failed / synced
       ├─ by kind: finish / abandon / share / comment
       ├─ recent events
       └─ copy/export pending JSON
```

### Semantics

- `share_intent` 只表示 strong reaction，不代表 positive。
- `read_abandon_candidate` 是低信心訊號；viewer 要標出 low-confidence，不要把它寫成「確定無聊」。
- `unknown` / `guest_reference` 只能是 reference，不能在 UI 裡暗示會自動改寫文章。
- Article identity 必須顯示 `postId/pathname/postVersion`；若有 reader revision/content version，也要能顯示 stale/current。

### Mutation boundary

Viewer 預設不改 event。允許的 mutation 只有：

- 使用 sync transport 後 mark `synced` / `sync_failed`
- 明確的 local debug reset/export/import（若做，需有清楚 UI）

### Deferred

- Remote observation / backend storage 在 `add-human-signal-transport-ledger`。
- Giscus comment indexer 可以之後補，不阻塞 viewer。
