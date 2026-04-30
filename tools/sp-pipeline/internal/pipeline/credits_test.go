package pipeline

import (
	"strings"
	"testing"
)

func TestQuoted(t *testing.T) {
	if got := quoted("plain"); got != `"plain"` {
		t.Fatalf("quoted(plain) = %q, want \"plain\"", got)
	}
	if got := quoted(`"already"`); got != `"already"` {
		t.Fatalf("already-quoted should be returned untouched, got %q", got)
	}
	if got := quoted(""); got != `""` {
		t.Fatalf("quoted(empty) = %q, want \"\"", got)
	}
}

func TestNonEmpty(t *testing.T) {
	if got := nonEmpty("foo", "fallback"); got != "foo" {
		t.Fatal("non-empty should pass through")
	}
	if got := nonEmpty("", "fallback"); got != "fallback" {
		t.Fatal("empty should yield fallback")
	}
}

func TestLeadingWhitespace(t *testing.T) {
	cases := []struct{ in, want string }{
		{"  pipeline", "  "},
		{"\tx", "\t"},
		{"\t \t hello", "\t \t "},
		{"none", ""},
		{"", ""},
	}
	for _, tc := range cases {
		if got := leadingWhitespace(tc.in); got != tc.want {
			t.Fatalf("leadingWhitespace(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestRenderPipelineBlock(t *testing.T) {
	entries := []PipelineEntry{
		{Role: "Written", Model: "Opus 4.6", Harness: "Claude Code CLI"},
		{Role: "Reviewed", Model: "GPT-5.4", Harness: "Codex CLI"},
		{Role: "Refined", Model: "Opus 4.6", Harness: "Claude Code CLI"},
		{Role: "Orchestrated", Model: "Opus 4.6", Harness: "OpenClaw"},
	}
	out := renderPipelineBlock("  pipeline", entries)

	expected := []string{
		`  pipeline:`,
		`    - role: "Written"`,
		`      model: "Opus 4.6"`,
		`      harness: "Claude Code CLI"`,
		`    - role: "Reviewed"`,
		`      model: "GPT-5.4"`,
		`      harness: "Codex CLI"`,
		`    - role: "Orchestrated"`,
		`      model: "Opus 4.6"`,
		`      harness: "OpenClaw"`,
	}
	for _, line := range expected {
		if !strings.Contains(out, line) {
			t.Errorf("renderPipelineBlock missing line:\n%q\nfull output:\n%s", line, out)
		}
	}
	// Should NOT have a trailing newline
	if strings.HasSuffix(out, "\n") {
		t.Error("renderPipelineBlock should not end with newline")
	}
}

func TestRenderPipelineBlock_RootKey(t *testing.T) {
	out := renderPipelineBlock("pipeline", []PipelineEntry{
		{Role: "x", Model: "m", Harness: "h"},
	})
	// No leading indent → child indent = 2 spaces
	if !strings.Contains(out, "\n  - role: \"x\"") {
		t.Fatalf("root-key block not rendered with 2-space child indent: %q", out)
	}
}

func TestPipelineURL_Constant(t *testing.T) {
	// Pin the canonical pipelineUrl that gets written to frontmatter.
	want := "https://github.com/chitienhsiehwork-ai/clawd-workspace/blob/master/scripts/shroom-feed-pipeline.sh"
	if PipelineURL != want {
		t.Fatalf("PipelineURL drift: got %q, want %q", PipelineURL, want)
	}
}
