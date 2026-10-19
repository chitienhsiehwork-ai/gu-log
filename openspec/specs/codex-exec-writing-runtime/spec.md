# codex-exec-writing-runtime Specification

## Purpose

記錄 GP pipeline 的 Codex 寫作 runtime 已經退役。現行文章寫作 runtime 見 `claude-prose-writing-runtime`；退役原因與取捨見 `openspec/changes/archive/2026-09-26-claude-only-prose-writing/design.md`。

## Requirements

### Requirement: Codex 寫作 runtime SHALL 維持退役

本 capability 只保留 Codex 寫作 runtime 的退役紀錄。gp-pipeline 與 Tribunal 的寫作步驟不再以 Codex 模型撰寫或改寫文章，現行寫作 runtime 由 `claude-prose-writing-runtime` 規範。日後要讓 Codex 重新撰寫文章，提案 SHALL 以 delta 修改本 requirement 與 `claude-prose-writing-runtime`，不得只改設定檔或環境變數。

#### Scenario: 設定要求以 Codex 撰寫文章

- **WHEN** 設定、旗標或寫手模式要求以 Codex 撰寫或改寫文章（例如 `GP_WRITER_PROVIDER=codex` 或 `GP_WRITER_MODE=codex`）
- **THEN** 呼叫 SHALL 依 `claude-prose-writing-runtime` 在呼叫任何模型前以已退役的錯誤失敗
