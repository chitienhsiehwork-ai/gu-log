package config

import (
	"os"
	"path/filepath"
	"testing"
)

func makeFakeRepo(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "CLAUDE.md"), []byte("# fake"), 0o644); err != nil {
		t.Fatalf("write CLAUDE.md: %v", err)
	}
	return root
}

func TestResolve_FromEnv(t *testing.T) {
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)

	cfg, err := Resolve("")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	abs, _ := filepath.Abs(root)
	if cfg.RepoRoot != abs {
		t.Fatalf("RepoRoot = %q, want %q", cfg.RepoRoot, abs)
	}
	if cfg.ScriptsDir != filepath.Join(abs, "scripts") {
		t.Fatalf("ScriptsDir wrong: %q", cfg.ScriptsDir)
	}
	if cfg.PostsDir != filepath.Join(abs, "src", "content", "posts") {
		t.Fatalf("PostsDir wrong: %q", cfg.PostsDir)
	}
	if cfg.CounterFile != filepath.Join(abs, "scripts", "article-counter.json") {
		t.Fatalf("CounterFile wrong: %q", cfg.CounterFile)
	}
	if cfg.WritingGuide != filepath.Join(abs, "WRITING_GUIDELINES.md") {
		t.Fatalf("WritingGuide wrong: %q", cfg.WritingGuide)
	}
	if cfg.FetchXArticle != filepath.Join(abs, "scripts", "fetch-x-article.sh") {
		t.Fatalf("FetchXArticle wrong: %q", cfg.FetchXArticle)
	}
	if cfg.ValidatePosts != filepath.Join(abs, "scripts", "validate-posts.mjs") {
		t.Fatalf("ValidatePosts wrong: %q", cfg.ValidatePosts)
	}
}

func TestResolve_WalksUp(t *testing.T) {
	t.Setenv("GU_LOG_DIR", "")
	root := makeFakeRepo(t)
	deep := filepath.Join(root, "a", "b", "c")
	if err := os.MkdirAll(deep, 0o755); err != nil {
		t.Fatal(err)
	}

	cfg, err := Resolve(deep)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	abs, _ := filepath.Abs(root)
	if cfg.RepoRoot != abs {
		t.Fatalf("RepoRoot = %q, want %q", cfg.RepoRoot, abs)
	}
}

func TestResolve_NoSentinel_ReturnsError(t *testing.T) {
	t.Setenv("GU_LOG_DIR", "")
	tmp := t.TempDir() // no CLAUDE.md
	_, err := Resolve(tmp)
	if err == nil {
		t.Fatal("expected error when CLAUDE.md not found anywhere")
	}
}

func TestResolve_DefaultStartDirIsCwd(t *testing.T) {
	t.Setenv("GU_LOG_DIR", "")
	root := makeFakeRepo(t)

	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	t.Cleanup(func() { _ = os.Chdir(cwd) })

	if err := os.Chdir(root); err != nil {
		t.Fatalf("chdir: %v", err)
	}
	cfg, err := Resolve("") // empty → uses cwd
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	abs, _ := filepath.Abs(root)
	if cfg.RepoRoot != abs {
		t.Fatalf("RepoRoot = %q, want %q", cfg.RepoRoot, abs)
	}
}
