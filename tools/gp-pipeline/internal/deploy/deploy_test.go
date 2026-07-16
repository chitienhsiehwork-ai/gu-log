package deploy

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/counter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/logx"
)

func TestRunRejectsRetiredPendingBeforeCounterBump(t *testing.T) {
	root := t.TempDir()
	postsDir := filepath.Join(root, "src", "content", "posts")
	scriptsDir := filepath.Join(root, "scripts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(scriptsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	counterPath := filepath.Join(scriptsDir, "article-counter.json")
	counterBody := `{
  "GP": {"next": 259, "label": "Gu-log Picks", "description": "test"},
  "MP": {"next": 315, "label": "Mogu Picks", "description": "test"},
  "SD": {"next": 32, "label": "ShroomDog Original", "description": "test"},
  "Lv": {"next": 18, "label": "Level-Up", "description": "test"}
}
`
	if err := os.WriteFile(counterPath, []byte(counterBody), 0o644); err != nil {
		t.Fatal(err)
	}
	pendingName := "gp-pending-20260716-test.mdx"
	pending := "---\nticketId: \"SP-PENDING\"\n---\nbody\n"
	if err := os.WriteFile(filepath.Join(postsDir, pendingName), []byte(pending), 0o644); err != nil {
		t.Fatal(err)
	}

	c := counter.New(counterPath, filepath.Join(root, "counter.lock"))
	_, err := Run(context.Background(), Options{
		Cfg:            &config.Config{RepoRoot: root, ScriptsDir: scriptsDir, PostsDir: postsDir, CounterFile: counterPath},
		Log:            logx.New(),
		Counter:        c,
		Prefix:         "GP",
		ActiveFilename: pendingName,
		DateStamp:      "20260716",
		AuthorSlug:     "test",
		TitleSlug:      "title",
		SkipBuild:      true,
		SkipPush:       true,
		SkipValidate:   true,
	})
	if err == nil || !strings.Contains(err.Error(), "expected GP-PENDING") {
		t.Fatalf("error = %v, want canonical pending diagnostic", err)
	}
	next, readErr := c.Next("GP")
	if readErr != nil {
		t.Fatal(readErr)
	}
	if next != 259 {
		t.Fatalf("counter advanced on rejected retired input: next = %d", next)
	}
}
