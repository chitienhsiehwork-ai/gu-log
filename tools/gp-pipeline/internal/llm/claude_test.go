package llm

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// TestClaudeWriterModelPreservesPinnedVersion locks the regression that made a
// pinned writer build get stamped with the floating alias's version: Model()
// must keep the concrete pinned id, DisplayName must render that pin (never the
// alias display), and Name() must still collapse to the family label for logs.
// Assertions derive from ClaudeOpusPinned so bumping the pin does not require
// editing this test — the pin's value lives in claude.go, not here.
func TestClaudeWriterModelPreservesPinnedVersion(t *testing.T) {
	w := NewClaudeOpusWriter()
	if got := w.Model(); got != ModelID(ClaudeOpusPinned) {
		t.Fatalf("writer Model() = %q, want %q", got, ClaudeOpusPinned)
	}
	assertPinnedDisplay(t, "writer", DisplayName(w.Model()))
	if got := w.Name(); got != string(ModelClaudeOpus) {
		t.Fatalf("writer Name() = %q, want %q", got, ModelClaudeOpus)
	}

	// The floating alias carries no version, so it resolves to the family
	// constant and DisplayName maps it to the current concrete Opus.
	a := NewClaudeOpus()
	if got := a.Model(); got != ModelClaudeOpus {
		t.Fatalf("alias Model() = %q, want %q", got, ModelClaudeOpus)
	}
	if got := DisplayName(a.Model()); got != "Opus 4.8" {
		t.Fatalf("alias DisplayName = %q, want %q", got, "Opus 4.8")
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
	assertPinnedDisplay(t, "stamped", DisplayName(w.ActualModel()))
}

// assertPinnedDisplay checks a pinned-writer provenance stamp without hardcoding
// the pin: it must be a rendered display name (not the raw build id), and it
// must differ from the floating alias's display — the alias leaking into a
// pinned stamp is the provenance bug these tests guard.
func assertPinnedDisplay(t *testing.T, label, got string) {
	t.Helper()
	if got == ClaudeOpusPinned {
		t.Fatalf("%s DisplayName = %q, want a rendered name, not the raw build id", label, got)
	}
	if alias := DisplayName(ModelClaudeOpus); got == alias {
		t.Fatalf("%s DisplayName = %q, must not collapse to the floating alias display", label, got)
	}
	if want := DisplayName(ModelID(ClaudeOpusPinned)); got != want {
		t.Fatalf("%s DisplayName = %q, want %q", label, got, want)
	}
}
