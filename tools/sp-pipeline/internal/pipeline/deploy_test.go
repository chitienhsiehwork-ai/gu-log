package pipeline

import "testing"

func TestContains(t *testing.T) {
	cases := []struct {
		s, sub string
		want   bool
	}{
		{"hello world", "world", true},
		{"hello", "hello", true},
		{"prefix matters", "prefix", true},
		{"", "anything", false},
		{"no match", "xyz", false},
		{"validate-posts rejected something", "validate-posts rejected", true},
		{"npm run build failed: stuff", "npm run build", true},
		{"git push: rejected by remote", "git push", true},
	}
	for _, tc := range cases {
		if got := contains(tc.s, tc.sub); got != tc.want {
			t.Fatalf("contains(%q, %q) = %v, want %v", tc.s, tc.sub, got, tc.want)
		}
	}
}
