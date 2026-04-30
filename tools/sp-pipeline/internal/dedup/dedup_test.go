package dedup

import (
	"context"
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
		{"WARN with score", "WARN: similar to SP-12 (score: 0.24)\n", VerdictWarn},
		{"plain BLOCK", "BLOCK\n", VerdictBlock},
		{"BLOCK with reason", "BLOCK: Duplicate of SP-170 (tweet ID match): foo\n", VerdictBlock},
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
		"- sp-1-x.mdx — Hello",
		"• cp-2-y.mdx — World",
		"plain line ignored",
	}, "\n")
	got := parseMatches(in)
	want := []string{"sp-1-x.mdx — Hello", "cp-2-y.mdx — World"}
	if len(got) != len(want) {
		t.Fatalf("parseMatches len = %d, want %d (got %v)", len(got), len(want), got)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("parseMatches[%d] = %q, want %q", i, got[i], want[i])
		}
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
