// Package config resolves repository-relative paths the pipeline depends on.
//
// The Go binary is expected to run from anywhere inside the gu-log repo. To
// find the repo root we walk up from the current working directory looking
// for a sentinel (CLAUDE.md at the top level), which is the same convention
// the existing bash scripts use (they hard-code GU_LOG_DIR via $HOME/clawd/
// projects/gu-log but fall back to pwd).
package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// Config holds all resolved paths for the current run.
type Config struct {
	// RepoRoot is the gu-log repo root (contains CLAUDE.md).
	RepoRoot string
	// ScriptsDir is $RepoRoot/scripts.
	ScriptsDir string
	// PostsDir is $RepoRoot/src/content/posts.
	PostsDir string
	// CounterFile is $RepoRoot/scripts/article-counter.json.
	CounterFile string
	// WritingGuide is $RepoRoot/WRITING_GUIDELINES.md.
	WritingGuide string
	// FetchXArticle is $RepoRoot/scripts/fetch-x-article.sh.
	FetchXArticle string
	// ValidatePosts is $RepoRoot/scripts/validate-posts.mjs.
	ValidatePosts string
}

// Resolve walks up from startDir (or the current working directory when
// empty) looking for the repo root and returns a populated Config.
//
// The environment variable GU_LOG_DIR takes precedence when set — this
// matches the existing bash scripts and lets callers override for tests.
func Resolve(startDir string) (*Config, error) {
	if env := os.Getenv("GU_LOG_DIR"); env != "" {
		return fromRoot(env)
	}

	if startDir == "" {
		wd, err := os.Getwd()
		if err != nil {
			return nil, fmt.Errorf("getwd: %w", err)
		}
		startDir = wd
	}

	root, err := findRepoRoot(startDir)
	if err != nil {
		return nil, err
	}
	return fromRoot(root)
}

func fromRoot(root string) (*Config, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("abs %q: %w", root, err)
	}
	cfg := &Config{
		RepoRoot:      abs,
		ScriptsDir:    filepath.Join(abs, "scripts"),
		PostsDir:      filepath.Join(abs, "src", "content", "posts"),
		CounterFile:   filepath.Join(abs, "scripts", "article-counter.json"),
		WritingGuide:  filepath.Join(abs, "WRITING_GUIDELINES.md"),
		FetchXArticle: filepath.Join(abs, "scripts", "fetch-x-article.sh"),
		ValidatePosts: filepath.Join(abs, "scripts", "validate-posts.mjs"),
	}
	return cfg, nil
}

func findRepoRoot(start string) (string, error) {
	dir := start
	for {
		candidate := filepath.Join(dir, "CLAUDE.md")
		if fi, err := os.Stat(candidate); err == nil && !fi.IsDir() {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("could not locate repo root (no CLAUDE.md found walking up from " + start + ")")
		}
		dir = parent
	}
}
