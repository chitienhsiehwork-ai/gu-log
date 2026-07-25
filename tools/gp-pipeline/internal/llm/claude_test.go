package llm

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// TestClaudeWriterModelPreservesPinnedVersion locks the regression that made a
// pinned write get stamped with the floating alias's build instead of its own:
// Model() must keep the concrete pinned id, DisplayName must render it, and
// Name() must still collapse to the family label for logs.
//
// Model() identity is the load-bearing assertion here. While the pin and the
// alias happen to name the same build, their DisplayName strings match, so
// comparing display names alone would no longer catch the collapse.
func TestClaudeWriterModelPreservesPinnedVersion(t *testing.T) {
	w := NewClaudeOpusWriter()
	if got := w.Model(); got != ModelID(ClaudeOpusPinned) {
		t.Fatalf("writer Model() = %q, want %q", got, ClaudeOpusPinned)
	}
	if got := DisplayName(w.Model()); got != "Opus 5" {
		t.Fatalf("writer DisplayName = %q, want %q", got, "Opus 5")
	}
	if got := w.Name(); got != string(ModelClaudeOpus) {
		t.Fatalf("writer Name() = %q, want %q", got, ModelClaudeOpus)
	}

	// The floating alias carries no version, so it resolves to the family
	// constant and DisplayName maps it to the current concrete Opus.
	a := NewClaudeOpus()
	if got := a.Model(); got != ModelClaudeOpus {
		t.Fatalf("alias Model() = %q, want %q", got, ModelClaudeOpus)
	}
	if got := DisplayName(a.Model()); got != "Opus 5" {
		t.Fatalf("alias DisplayName = %q, want %q", got, "Opus 5")
	}
}

// TestDisplayNameWholeNumberClaudeGeneration locks the Claude 5 naming shape:
// 5-generation ids carry no minor version, so "claude-opus-5" must render
// "Opus 5" (not the raw id) and still resolve to the Claude harness. The 4.x
// major-minor ids and the dated Haiku build must keep working unchanged.
func TestDisplayNameWholeNumberClaudeGeneration(t *testing.T) {
	cases := map[ModelID]string{
		"claude-opus-5":             "Opus 5",
		"claude-sonnet-5":           "Sonnet 5",
		"claude-opus-4-5":           "Opus 4.5",
		"claude-haiku-4-5-20251001": "Haiku 4.5",
		"anthropic/claude-opus-5":   "Opus 5",
		"claude-opus-5[1m]":         "Opus 5",
	}
	for id, want := range cases {
		if got := DisplayName(id); got != want {
			t.Errorf("DisplayName(%q) = %q, want %q", id, got, want)
		}
		if got := HarnessName(id); got != "Claude Code CLI" {
			t.Errorf("HarnessName(%q) = %q, want Claude Code CLI", id, got)
		}
	}
}

func TestPrimaryModelUsagePicksHighestOutput(t *testing.T) {
	single := map[string]modelUsageEntry{"claude-opus-4-5": {OutputTokens: 12}}
	if got := primaryModelUsage(single); got != "claude-opus-4-5" {
		t.Fatalf("single key primaryModelUsage = %q, want claude-opus-4-5", got)
	}
	multi := map[string]modelUsageEntry{
		"claude-haiku-4-5": {OutputTokens: 3},
		"claude-opus-4-5":  {OutputTokens: 99},
	}
	if got := primaryModelUsage(multi); got != "claude-opus-4-5" {
		t.Fatalf("multi key primaryModelUsage = %q, want claude-opus-4-5", got)
	}
	if got := primaryModelUsage(nil); got != "" {
		t.Fatalf("empty primaryModelUsage = %q, want empty", got)
	}
}

// TestClaudeRunReadsModelUsageWhenTopLevelModelMissing verifies the readback
// path: current Claude Code JSON omits the top-level "model" field and only
// reports the concrete build under modelUsage. Run() must recover it so the
// stamp matches what actually ran.
func TestClaudeRunReadsModelUsageWhenTopLevelModelMissing(t *testing.T) {
	binDir := t.TempDir()
	claudePath := filepath.Join(binDir, "claude")
	// Stub claude: echo JSON with NO top-level model, modelUsage keyed by the
	// --model value it was invoked with (mirrors real Claude Code output).
	script := `#!/usr/bin/env bash
set -euo pipefail
model=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--model" ]; then shift; model="$1"; fi
  shift
done
printf '{"result":"ok","modelUsage":{"%s":{"outputTokens":7}}}\n' "$model"
`
	if err := os.WriteFile(claudePath, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake claude: %v", err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	w := NewClaudeOpusWriter()
	out, err := w.Run(context.Background(), "hi", RunOptions{WorkDir: t.TempDir()})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out != "ok" {
		t.Fatalf("Run output = %q, want ok", out)
	}
	if got := w.ActualModel(); got != ModelID(ClaudeOpusPinned) {
		t.Fatalf("ActualModel after run = %q, want %q", got, ClaudeOpusPinned)
	}
	if got := DisplayName(w.ActualModel()); got != "Opus 5" {
		t.Fatalf("stamped DisplayName = %q, want Opus 5", got)
	}
}
