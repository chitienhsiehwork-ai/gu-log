package llm

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestClaudeWriterModelPreservesPinnedVersion locks the regression that made a
// pinned writer build get stamped from the family fallback instead of its own
// id: Model() must keep the concrete pinned id, DisplayName must render that id
// (not pass the raw build id through), and Name() must still collapse to the
// family label for logs. Assertions derive from ClaudeOpusPinned so bumping the
// pin does not require editing this test — the pin lives in claude.go, not here.
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
	// constant and DisplayName maps it to whichever concrete Opus the alias
	// currently points at. The invariant is that a versionless alias never
	// reaches provenance verbatim — the concrete value itself floats, so it is
	// asserted by shape, not by literal (its SSOT is OPUS_ALIAS_CURRENT in
	// scripts/detect-model.mjs, mirrored by the ModelClaudeOpus case below).
	a := NewClaudeOpus()
	if got := a.Model(); got != ModelClaudeOpus {
		t.Fatalf("alias Model() = %q, want %q", got, ModelClaudeOpus)
	}
	got := DisplayName(a.Model())
	if got == string(ModelClaudeOpus) || got == ClaudeOpusAlias {
		t.Fatalf("alias DisplayName = %q, must resolve to a concrete build, not the alias", got)
	}
	if !strings.ContainsFunc(got, func(r rune) bool { return r >= '0' && r <= '9' }) {
		t.Fatalf("alias DisplayName = %q, want a version number", got)
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
// the pin: it must be rendered from the pinned id itself, not passed through as
// the raw build id. It deliberately does NOT assert "differs from the alias
// display" — when the pin and the floating alias happen to sit on the same
// generation those names coincide legitimately, so that would be a flaky
// assertion about Anthropic's release timing rather than about our code.
func assertPinnedDisplay(t *testing.T, label, got string) {
	t.Helper()
	if got == ClaudeOpusPinned {
		t.Fatalf("%s DisplayName = %q, want a rendered name, not the raw build id", label, got)
	}
	if want := DisplayName(ModelID(ClaudeOpusPinned)); got != want {
		t.Fatalf("%s DisplayName = %q, want %q", label, got, want)
	}
}
