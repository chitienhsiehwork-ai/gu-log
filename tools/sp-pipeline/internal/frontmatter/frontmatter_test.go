package frontmatter

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParse_RoundTripByteStable(t *testing.T) {
	// Round-trip test: a file with no modifications should come out of
	// Parse → Bytes() byte-identical to what went in.
	raw := []byte(`---
title: "Hello"
ticketId: "SP-1"
tags: ["a", "b"]
---
# Body

This is the body.
It has multiple lines.
`)
	f, err := Parse(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if !bytes.Equal(f.Bytes(), raw) {
		t.Fatalf("round-trip mismatch:\n--- want ---\n%s\n--- got ---\n%s", raw, f.Bytes())
	}
}

func TestParse_NoFrontmatter(t *testing.T) {
	_, err := Parse([]byte("# Just a heading\n\nno frontmatter here.\n"))
	if err != ErrNoFrontmatter {
		t.Fatalf("expected ErrNoFrontmatter, got %v", err)
	}
}

func TestParse_OpenerWithoutCloser(t *testing.T) {
	_, err := Parse([]byte("---\ntitle: oops\nbody line with no closing\n"))
	if err == nil {
		t.Fatalf("expected error for missing closing delimiter")
	}
	if !strings.Contains(err.Error(), "closing") {
		t.Fatalf("error should mention missing closing: %v", err)
	}
}

func TestGetScalar(t *testing.T) {
	raw := []byte(`---
title: "Hello World"
ticketId: "SP-170"
lang: en
nested:
  model: "Opus 4.6"
---
body
`)
	f, err := Parse(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	cases := []struct {
		key    string
		want   string
		wantOk bool
	}{
		{"title", `"Hello World"`, true},
		{"ticketId", `"SP-170"`, true},
		{"lang", "en", true},
		// Nested keys MUST NOT be reported as top-level.
		{"model", "", false},
		// Completely missing keys return false.
		{"nonexistent", "", false},
	}
	for _, tc := range cases {
		got, ok := f.GetScalar(tc.key)
		if ok != tc.wantOk {
			t.Errorf("GetScalar(%q) ok = %v, want %v", tc.key, ok, tc.wantOk)
		}
		if got != tc.want {
			t.Errorf("GetScalar(%q) = %q, want %q", tc.key, got, tc.want)
		}
	}
}

func TestSetScalar_ReplaceExisting(t *testing.T) {
	raw := []byte(`---
title: "Old"
ticketId: "SP-pending"
lang: zh-tw
---
body
`)
	f, err := Parse(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	f.SetScalar("ticketId", `"SP-170"`)
	got, _ := f.GetScalar("ticketId")
	if got != `"SP-170"` {
		t.Errorf("after SetScalar: got %q, want %q", got, `"SP-170"`)
	}
	// Check that untouched keys are preserved.
	if v, _ := f.GetScalar("title"); v != `"Old"` {
		t.Errorf("title clobbered: %q", v)
	}
	if v, _ := f.GetScalar("lang"); v != "zh-tw" {
		t.Errorf("lang clobbered: %q", v)
	}
}

func TestSetScalar_AppendMissing(t *testing.T) {
	raw := []byte(`---
title: "Test"
---
body
`)
	f, err := Parse(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	f.SetScalar("ticketId", `"SP-170"`)
	got, ok := f.GetScalar("ticketId")
	if !ok || got != `"SP-170"` {
		t.Errorf("SetScalar append failed: ok=%v got=%q", ok, got)
	}
	out := string(f.Bytes())
	if !strings.Contains(out, `ticketId: "SP-170"`) {
		t.Errorf("output missing appended key:\n%s", out)
	}
}

func TestSetNestedScalar_Replace(t *testing.T) {
	raw := []byte(`---
title: "Hello"
translatedBy:
  model: "Sonnet 4.5"
  harness: "Old Harness"
lang: "zh-tw"
---
body
`)
	f, err := Parse(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	f.SetNestedScalar("translatedBy", "model", `"Opus 4.6"`)
	f.SetNestedScalar("translatedBy", "harness", `"Claude Code CLI"`)

	out := string(f.Bytes())
	if !strings.Contains(out, `  model: "Opus 4.6"`) {
		t.Errorf("model not replaced: %s", out)
	}
	if !strings.Contains(out, `  harness: "Claude Code CLI"`) {
		t.Errorf("harness not replaced: %s", out)
	}
	if !strings.Contains(out, `lang: "zh-tw"`) {
		t.Errorf("sibling key lang clobbered: %s", out)
	}
}

func TestSetNestedScalar_AppendMissingChild(t *testing.T) {
	raw := []byte(`---
title: "Hello"
translatedBy:
  model: "Opus 4.6"
lang: "zh-tw"
---
body
`)
	f, err := Parse(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	// harness is missing — should be appended inside translatedBy.
	f.SetNestedScalar("translatedBy", "harness", `"Claude Code CLI"`)
	out := string(f.Bytes())
	if !strings.Contains(out, `  harness: "Claude Code CLI"`) {
		t.Errorf("harness not appended: %s", out)
	}
	// Must still be BEFORE lang, not after — i.e. inside the block.
	harnessIdx := strings.Index(out, "harness:")
	langIdx := strings.Index(out, "lang:")
	if harnessIdx < 0 || langIdx < 0 || harnessIdx > langIdx {
		t.Errorf("harness inserted outside translatedBy block: %s", out)
	}
}

func TestSetBlock_Replace(t *testing.T) {
	raw := []byte(`---
title: "Hello"
translatedBy:
  model: "Opus 4.6"
  harness: "Old"
  pipeline:
    - role: "Written"
      model: "Opus 4.6"
      harness: "Claude Code CLI"
    - role: "Reviewed"
      model: "GPT-5.4"
      harness: "Codex CLI"
lang: "zh-tw"
---
body
`)
	f, err := Parse(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	snippet := `  pipeline:
    - role: "Written"
      model: "Opus 4.6"
      harness: "Claude Code CLI"
    - role: "Reviewed"
      model: "Opus 4.6"
      harness: "Claude Code CLI"
    - role: "Scored"
      model: "Opus 4.6"
      harness: "Claude Code (vibe-opus-scorer)"`
	f.SetBlock("  pipeline", snippet)
	out := string(f.Bytes())

	// The new block has 3 entries; old had 2 — count dashes.
	dashCount := strings.Count(out, "    - role: ")
	if dashCount != 3 {
		t.Errorf("expected 3 pipeline entries after SetBlock, got %d\n%s", dashCount, out)
	}
	// Must not contain the old GPT-5.4 line.
	if strings.Contains(out, "GPT-5.4") {
		t.Errorf("old GPT-5.4 entry not stripped: %s", out)
	}
	// Sibling key lang must remain at top level.
	if !strings.Contains(out, `lang: "zh-tw"`) {
		t.Errorf("lang clobbered: %s", out)
	}
}

func TestSetBlock_AppendMissing(t *testing.T) {
	raw := []byte(`---
title: "Hello"
translatedBy:
  model: "Opus 4.6"
  harness: "Claude Code CLI"
lang: "zh-tw"
---
body
`)
	f, err := Parse(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	snippet := `  pipeline:
    - role: "Written"
      model: "Opus 4.6"
      harness: "Claude Code CLI"`
	f.SetBlock("  pipeline", snippet)
	out := string(f.Bytes())
	if !strings.Contains(out, `  pipeline:`) {
		t.Errorf("pipeline block not appended: %s", out)
	}
	if !strings.Contains(out, `- role: "Written"`) {
		t.Errorf("pipeline entry not added: %s", out)
	}
}

// TestSetNestedBlock_InsertWhenMissing covers the bug surfaced on SP-186
// (PR #177): credits.go was calling SetBlock("  pipeline", ...) on an
// article whose translatedBy block had no `pipeline:` child yet. SetBlock's
// not-found path appended the snippet at end-of-frontmatter, dropping it
// after `tags:` at the wrong indent — Astro YAML parser then crashed on
// "bad indentation of a mapping entry" and the build failed.
//
// SetNestedBlock fixes the case by inserting the block at the END of the
// parent block (before the next sibling top-level key), matching
// SetNestedScalar's "parent exists, child missing → append inside parent"
// semantics.
func TestSetNestedBlock_InsertWhenMissing(t *testing.T) {
	raw := []byte(`---
title: "Hello"
translatedBy:
  model: "Opus 4.6"
  harness: "Claude Code CLI"
  pipelineUrl: "https://example.com/x"
source: "OpenClaw Docs"
lang: "zh-tw"
tags: ["a", "b"]
---
body
`)
	f, err := Parse(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	snippet := `  pipeline:
    - role: "Written"
      model: "Opus 4.6"
      harness: "Claude Code CLI"`
	f.SetNestedBlock("translatedBy", "pipeline", snippet)
	out := string(f.Bytes())

	// Block must land inside translatedBy, BEFORE source: (the next
	// sibling top-level key). Easiest check: pipeline: appears before
	// source: in the output, and source: still exists at indent 0.
	pIdx := strings.Index(out, "  pipeline:")
	sIdx := strings.Index(out, "\nsource:")
	if pIdx < 0 {
		t.Fatalf("pipeline: header missing from output:\n%s", out)
	}
	if sIdx < 0 {
		t.Fatalf("source: top-level sibling missing from output:\n%s", out)
	}
	if pIdx > sIdx {
		t.Errorf("pipeline: block should appear BEFORE source: but landed after — would be dangling outside translatedBy.\n%s", out)
	}
	if !strings.Contains(out, `- role: "Written"`) {
		t.Errorf("pipeline entry missing: %s", out)
	}
}

func TestSetNestedBlock_ReplaceExisting(t *testing.T) {
	raw := []byte(`---
translatedBy:
  model: "Opus 4.6"
  pipeline:
    - role: "Old"
      model: "Old"
      harness: "Old"
  pipelineUrl: "https://example.com/x"
source: "X"
lang: "zh-tw"
---
body
`)
	f, err := Parse(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	snippet := `  pipeline:
    - role: "Written"
      model: "Opus 4.6"
      harness: "Claude Code CLI"
    - role: "Reviewed"
      model: "GPT-5.4"
      harness: "Codex CLI"`
	f.SetNestedBlock("translatedBy", "pipeline", snippet)
	out := string(f.Bytes())
	if strings.Contains(out, `role: "Old"`) {
		t.Errorf("old entry not replaced: %s", out)
	}
	if !strings.Contains(out, `role: "Written"`) || !strings.Contains(out, `role: "Reviewed"`) {
		t.Errorf("new entries missing: %s", out)
	}
	if !strings.Contains(out, `pipelineUrl: "https://example.com/x"`) {
		t.Errorf("sibling pipelineUrl was clobbered: %s", out)
	}
}

func TestSetNestedBlock_ParentMissing(t *testing.T) {
	// When the parent block doesn't exist, SetNestedBlock is a no-op
	// (rather than appending at end-of-frontmatter, which is what
	// SetBlock does and what produces broken YAML).
	raw := []byte(`---
title: "Hello"
lang: "zh-tw"
---
body
`)
	f, err := Parse(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	before := string(f.Bytes())
	f.SetNestedBlock("translatedBy", "pipeline", "  pipeline:\n    - role: \"X\"\n")
	after := string(f.Bytes())
	if before != after {
		t.Errorf("parent missing should be no-op, got mutation:\nbefore: %q\nafter:  %q", before, after)
	}
}

func TestStripLinesMatching(t *testing.T) {
	raw := []byte(`---
title: "Hello"
pipelineUrl: "https://example.com/old"
lang: "zh-tw"
---
body
`)
	f, err := Parse(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	f.StripLinesMatching(func(line string) bool {
		return strings.HasPrefix(strings.TrimSpace(line), "pipelineUrl:")
	})
	out := string(f.Bytes())
	if strings.Contains(out, "pipelineUrl") {
		t.Errorf("pipelineUrl line not stripped: %s", out)
	}
	if !strings.Contains(out, `lang: "zh-tw"`) {
		t.Errorf("sibling clobbered: %s", out)
	}
}

func TestHasBlock(t *testing.T) {
	raw := []byte(`---
title: Test
scores:
  ralph:
    p: 8
tags: ["a"]
---
body
`)
	f, err := Parse(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if !f.HasBlock("scores") {
		t.Errorf("expected HasBlock(scores) = true")
	}
	if f.HasBlock("ralph") {
		t.Errorf("HasBlock should NOT report nested keys")
	}
	if f.HasBlock("missing") {
		t.Errorf("HasBlock(missing) = true, want false")
	}
}

// TestRoundTrip_RealPost exercises Parse → Bytes on a real gu-log post.
// It is a smoke test: fail only if the body section changes after a no-op
// round trip. Mutating the frontmatter byte-for-byte is out of scope — we
// only guarantee the body is preserved verbatim.
func TestRoundTrip_RealPost(t *testing.T) {
	// Try to find a real post by walking up to the repo root. Skip if not
	// present (makes the test safe to run from outside a checkout).
	postPath := findRealPost(t)
	if postPath == "" {
		t.Skip("no real post available")
	}
	raw, err := os.ReadFile(postPath)
	if err != nil {
		t.Skipf("read %s: %v", postPath, err)
	}
	f, err := Parse(raw)
	if err != nil {
		t.Fatalf("parse %s: %v", postPath, err)
	}
	// Body must be byte-stable.
	if !bytes.HasPrefix(raw, []byte("---")) {
		t.Fatal("expected --- at start of real post")
	}
	if !bytes.Contains(f.Body(), []byte("ClawdNote")) {
		t.Errorf("body does not contain ClawdNote — parse probably truncated")
	}
	// Non-mutating round trip should match byte-for-byte.
	if !bytes.Equal(f.Bytes(), raw) {
		// Show a diff-ish summary for debugging.
		want := string(raw)
		got := string(f.Bytes())
		t.Errorf("round-trip diff on %s\nwant len=%d\ngot  len=%d",
			postPath, len(want), len(got))
	}
}

func findRealPost(t *testing.T) string {
	t.Helper()
	// Walk up from the test binary's working dir to find a posts dir.
	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}
	dir := cwd
	for i := 0; i < 6; i++ {
		candidate := filepath.Join(dir, "src", "content", "posts", "sp-170-20260411-nickbaumann-codex-bespoke-cli-skill.mdx")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}
