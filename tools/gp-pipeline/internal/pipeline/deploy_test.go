package pipeline

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/logx"
)

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
		{"pnpm run build failed: stuff", "pnpm run build", true},
		{"git push: rejected by remote", "git push", true},
	}
	for _, tc := range cases {
		if got := contains(tc.s, tc.sub); got != tc.want {
			t.Fatalf("contains(%q, %q) = %v, want %v", tc.s, tc.sub, got, tc.want)
		}
	}
}

func TestHydrateTitleFromActiveFile(t *testing.T) {
	dir := t.TempDir()
	postsDir := filepath.Join(dir, "posts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	name := "gp-pending-20260801-author-slug.mdx"
	body := "---\nticketId: 'GP-PENDING'\ntitle: \"AI 炸出來的 26 個坑\"\n---\nbody\n"
	if err := os.WriteFile(filepath.Join(postsDir, name), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	s := &State{Cfg: &config.Config{PostsDir: postsDir}, Log: logx.New(), ActiveFilename: name}
	if err := s.hydrateTitleFromActiveFile(); err != nil {
		t.Fatalf("hydrate: %v", err)
	}
	if s.Title != "AI 炸出來的 26 個坑" {
		t.Fatalf("Title = %q", s.Title)
	}

	// An already-set title wins: the full pipeline's ralph-extracted value
	// must not be clobbered by a re-read.
	s2 := &State{Cfg: &config.Config{PostsDir: postsDir}, Log: logx.New(), ActiveFilename: name, Title: "from ralph"}
	if err := s2.hydrateTitleFromActiveFile(); err != nil {
		t.Fatalf("hydrate: %v", err)
	}
	if s2.Title != "from ralph" {
		t.Fatalf("Title overwritten: %q", s2.Title)
	}
}
