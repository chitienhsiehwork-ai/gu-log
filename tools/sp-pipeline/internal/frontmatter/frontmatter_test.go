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
