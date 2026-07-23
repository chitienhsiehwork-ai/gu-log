package dedup

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseVerdict(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want Verdict
	}{
		{"plain PASS", "PASS\n", VerdictPass},
		{"PASS prefixed", "PASS: looks fine\n", VerdictPass},
		{"PASS bracketed", "[PASS]\n", VerdictPass},
		{"plain WARN", "WARN\n", VerdictWarn},
		{"WARN with score", "WARN: similar to GP-12 (score: 0.24)\n", VerdictWarn},
		{"plain BLOCK", "BLOCK\n", VerdictBlock},
		{"BLOCK with reason", "BLOCK: Duplicate of GP-170 (tweet ID match): foo\n", VerdictBlock},
		{"empty", "", ""},
		{"junk", "hello world\n", ""},
		{"first match wins", "BLOCK: x\nPASS\n", VerdictBlock},
		{"trailing whitespace OK", "  PASS  \n", VerdictPass},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := parseVerdict(tc.in); got != tc.want {
				t.Fatalf("parseVerdict(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestParseMatches(t *testing.T) {
	in := strings.Join([]string{
		"BLOCK: dupe found",
		"- gp-1-x.mdx — Hello",
		"• mp-2-y.mdx — World",
		"plain line ignored",
	}, "\n")
	got := parseMatches(in)
	want := []string{"gp-1-x.mdx — Hello", "mp-2-y.mdx — World"}
	if len(got) != len(want) {
		t.Fatalf("parseMatches len = %d, want %d (got %v)", len(got), len(want), got)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("parseMatches[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

// When the gate prints the match inline on the verdict line (no bullets),
// parseMatches must still recover the reason so the caller does not report
// a misleading "0 match(es)".
func TestParseMatchesInlineBlockFallback(t *testing.T) {
	in := "BLOCK: Duplicate of MP-52 (topic similarity: 0.420): Some Title"
	got := parseMatches(in)
	want := "Duplicate of MP-52 (topic similarity: 0.420): Some Title"
	if len(got) != 1 || got[0] != want {
		t.Fatalf("parseMatches inline = %v, want [%q]", got, want)
	}
}

func TestCheckArgValidation(t *testing.T) {
	ctx := context.Background()

	if _, err := Check(ctx, Options{}); err == nil {
		t.Fatal("expected error when ScriptPath is empty")
	}
	if _, err := Check(ctx, Options{ScriptPath: "/x"}); err == nil {
		t.Fatal("expected error when URL and Title are both empty")
	}
}

func TestCheckLoadsSourceURLFrontmatterAndBlocksYouTubeAliases(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node unavailable")
	}
	repoRoot, err := filepath.Abs(filepath.Join("..", "..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	scriptRaw, err := os.ReadFile(filepath.Join(repoRoot, "scripts", "dedup-gate.mjs"))
	if err != nil {
		t.Fatal(err)
	}

	fixtureRoot := t.TempDir()
	scriptPath := filepath.Join(fixtureRoot, "scripts", "dedup-gate.mjs")
	if err := os.MkdirAll(filepath.Dir(scriptPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(scriptPath, scriptRaw, 0o644); err != nil {
		t.Fatal(err)
	}
	scriptPath, err = filepath.EvalSymlinks(scriptPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(repoRoot, "node_modules"), filepath.Join(fixtureRoot, "node_modules")); err != nil {
		t.Fatal(err)
	}
	postsDir := filepath.Join(fixtureRoot, "src", "content", "posts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	post := `---
ticketId: GP-42
title: Existing video
sourceUrl: https://www.youtube.com/watch?v=dQw4w9WgXcQ
tags:
  - youtube
---

Existing body.
`
	if err := os.WriteFile(filepath.Join(postsDir, "gp-42-existing.mdx"), []byte(post), 0o644); err != nil {
		t.Fatal(err)
	}

	for _, rawURL := range []string{
		"https://youtube.com/shorts/dQw4w9WgXcQ",
		"https://youtu.be/dQw4w9WgXcQ",
	} {
		result, err := Check(context.Background(), Options{
			ScriptPath:   scriptPath,
			URL:          rawURL,
			Series:       "GP",
			IdentityOnly: true,
		})
		if err != nil {
			t.Fatalf("Check(%s): %v", rawURL, err)
		}
		if result.Verdict != VerdictBlock {
			t.Fatalf("Check(%s) verdict = %s, want BLOCK\n%s", rawURL, result.Verdict, result.Raw)
		}
		if len(result.Matches) == 0 ||
			(!strings.Contains(result.Matches[0], "GP-42") &&
				!strings.Contains(result.Matches[0], "gp-42-existing.mdx")) ||
			!strings.Contains(strings.ToLower(result.Matches[0]), "youtube video id match") {
			t.Fatalf("Check(%s) did not preserve the YouTube identity match: %#v", rawURL, result.Matches)
		}
	}
}
