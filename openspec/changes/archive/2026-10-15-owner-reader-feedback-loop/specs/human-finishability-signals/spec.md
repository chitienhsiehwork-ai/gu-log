# Spec Delta

## ADDED Requirements

### Requirement: Engagement events SHALL carry the reader-facing content revision

每筆 human-signal 事件 SHALL 在可取得時帶上讀者當下看到的 reader revision（文章內容雜湊，不含 Tribunal 分數等 metadata）。消費端比對「這筆回饋是不是針對目前內容」時 SHALL 以 reader revision 為準，`postVersion` 只作為顯示用的參考。

#### Scenario: Tribunal writes scores without changing prose

- **WHEN** owner 對某篇文章留下回饋
- **AND** 之後 Tribunal 只把分數寫進 frontmatter，讀者看到的內文沒變
- **THEN** 該文章的 reader revision SHALL 維持不變
- **AND** 消費端 SHALL 仍把那筆回饋視為針對目前內容

#### Scenario: Article prose is rewritten

- **WHEN** 文章內文被改寫，reader revision 改變
- **THEN** 改寫前的回饋 SHALL 被視為針對舊版本

## MODIFIED Requirements

### Requirement: Human signal transport SHALL be explicit and queryable

Gu-log SHALL use the gu-log backend database behind `api.shroomdog.dev`, reached through an authenticated human-signals endpoint, as the human-signal transport, with an authorized export for Tribunal tooling and operators. Until that endpoint is deployed, signals SHALL remain local-only and SHALL NOT be used for Tribunal decisions. Browser `localStorage` SHALL remain only an outbox and offline cache.

#### Scenario: Existing Vercel Analytics pageviews are telemetry, not Tribunal evidence

- **WHEN** gu-log only has the current `@vercel/analytics` injection from `BaseLayout.astro`
- **AND** no custom event payload with article identity/version is emitted
- **AND** no deterministic export/query path is available to Tribunal
- **THEN** Vercel Analytics pageviews SHALL NOT be treated as the configured human-signal transport
- **AND** they SHALL NOT drive requeue/block/preserve decisions by themselves

#### Scenario: Tribunal requests signals for a post

- **WHEN** Tribunal tooling prepares to score or rewrite an article
- **AND** the backend export is deployed and human-signal automation is enabled
- **THEN** it SHALL be able to query a deterministic packet of human signals for that article
- **AND** the packet SHALL include event kinds, versions, reader revisions, timestamps, and unresolved/resolved state
- **AND** if the backend is unreachable, Tribunal SHALL proceed without human signals rather than block or retry indefinitely

#### Scenario: Browser-only local state has not synced

- **WHEN** engagement state exists only in a browser localStorage and has not synced to the backend
- **THEN** Tribunal SHALL NOT assume that state exists
- **AND** the UI SHOULD expose sync status or otherwise avoid implying unsynced events are already part of automation
