package observability

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/config"
)

func makeStatusRepo(t *testing.T) (*config.Config, string) {
	t.Helper()
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "src", "content", "posts"))
	mustMkdir(t, filepath.Join(root, "scores"))
	mustWrite(t, filepath.Join(root, "CLAUDE.md"), "# fake\n")
	mustWrite(t, filepath.Join(root, "WRITING_GUIDELINES.md"), "# style\n")
	mustWrite(t, filepath.Join(root, "scripts", "article-counter.json"), `{}`)
	mustWrite(t, filepath.Join(root, "scripts", "validate-posts.mjs"), "")
	mustWrite(t, filepath.Join(root, "scripts", "fetch-x-article.sh"), "#!/usr/bin/env bash\n")
	mustWrite(t, filepath.Join(root, "scores", "tribunal-progress.json"), "{}\n")
	runGit(t, root, "init", "-q", "-b", "main")
	runGit(t, root, "config", "user.email", "test@example.com")
	runGit(t, root, "config", "user.name", "Test")
	runGit(t, root, "add", ".")
	runGit(t, root, "commit", "-q", "-m", "seed")
	cfg, err := config.Resolve(root)
	if err != nil {
		t.Fatal(err)
	}
	return cfg, root
}

func TestCheckPendingArtifacts_FindsPendingPostsAndProgress(t *testing.T) {
	cfg, root := makeStatusRepo(t)
	mustWrite(t, filepath.Join(root, "src", "content", "posts", "sp-pending-20260508-test.mdx"), "---\n---\n")
	mustWrite(t, filepath.Join(root, "scores", "tribunal-progress.json"), `{
  "sp-pending-20260508-test.mdx": {
    "article": "sp-pending-20260508-test.mdx",
    "stages": {}
  }
}
`)

	violations, err := CheckPendingArtifacts(cfg.RepoRoot, GuardrailOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(violations) != 2 {
		t.Fatalf("violations = %d, want 2 (%+v)", len(violations), violations)
	}
}

func TestCollect_AllowsCurrentPendingArtifactsWhileRalphRuns(t *testing.T) {
	cfg, root := makeStatusRepo(t)
	workDir := filepath.Join(root, "tmp", "sp-pending-obs")
	mustMkdir(t, workDir)
	mustWrite(t, filepath.Join(workDir, "final.mdx"), "body\n")
	mustWrite(t, filepath.Join(root, "src", "content", "posts", "sp-pending-20260508-test.mdx"), "---\n---\n")
	mustWrite(t, filepath.Join(root, "scores", "tribunal-progress.json"), `{
  "sp-pending-20260508-test.mdx": {
    "article": "sp-pending-20260508-test.mdx",
    "startedAt": "2026-05-08T03:00:00+08:00",
    "stages": {
      "librarian": {"status": "in_progress", "attempts": 1}
    }
  }
}
`)

	if err := WriteSnapshot(cfg, SnapshotInput{
		WorkDir:        workDir,
		RepoRoot:       cfg.RepoRoot,
		RunState:       "running",
		CurrentStep:    "ralph",
		ActiveFilename: "sp-pending-20260508-test.mdx",
	}); err != nil {
		t.Fatal(err)
	}

	status, err := Collect(cfg, workDir, CollectOptions{StaleAfter: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	if !status.Guardrails.OK {
		t.Fatalf("guardrails should allow current pending artifacts during ralph: %+v", status.Guardrails.Violations)
	}
	if status.Tribunal.Stage != "librarian" || status.Tribunal.Status != "in_progress" {
		t.Fatalf("tribunal = %+v, want librarian in_progress", status.Tribunal)
	}
}

func TestCollect_FailedRunFlagsPendingArtifacts(t *testing.T) {
	cfg, root := makeStatusRepo(t)
	workDir := filepath.Join(root, "tmp", "sp-pending-obs")
	mustMkdir(t, workDir)
	mustWrite(t, filepath.Join(workDir, "final.mdx"), "body\n")
	mustWrite(t, filepath.Join(root, "src", "content", "posts", "sp-pending-20260508-test.mdx"), "---\n---\n")
	mustWrite(t, filepath.Join(root, "scores", "tribunal-progress.json"), `{
  "sp-pending-20260508-test.mdx": {
    "article": "sp-pending-20260508-test.mdx",
    "stages": {}
  }
}
`)

	if err := WriteSnapshot(cfg, SnapshotInput{
		WorkDir:        workDir,
		RepoRoot:       cfg.RepoRoot,
		RunState:       "failed",
		CurrentStep:    "deploy",
		ActiveFilename: "sp-pending-20260508-test.mdx",
		Error:          "deploy blocked",
	}); err != nil {
		t.Fatal(err)
	}

	status, err := Collect(cfg, workDir, CollectOptions{StaleAfter: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	if status.Guardrails.OK {
		t.Fatal("guardrails should fail once the run is no longer actively in ralph/deploy")
	}
	if len(status.Suspicious) == 0 {
		t.Fatal("expected suspicious reasons for failed pending artifacts")
	}
	if !strings.Contains(status.NextAction, "clean leftover pending") {
		t.Fatalf("NextAction = %q, want cleanup guidance", status.NextAction)
	}
}

func TestRenameTribunalProgressEntry_RenamesPendingKey(t *testing.T) {
	cfg, root := makeStatusRepo(t)
	mustWrite(t, filepath.Join(root, "scores", "tribunal-progress.json"), `{
  "sp-pending-20260508-test.mdx": {
    "article": "sp-pending-20260508-test.mdx",
    "status": "PASS",
    "stages": {}
  }
}
`)

	if err := RenameTribunalProgressEntry(cfg.RepoRoot, "sp-pending-20260508-test.mdx", "sp-201-20260508-test.mdx"); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(filepath.Join(root, "scores", "tribunal-progress.json"))
	if err != nil {
		t.Fatal(err)
	}
	var progress map[string]map[string]any
	if err := json.Unmarshal(raw, &progress); err != nil {
		t.Fatal(err)
	}
	if _, ok := progress["sp-pending-20260508-test.mdx"]; ok {
		t.Fatal("old pending key still exists")
	}
	entry, ok := progress["sp-201-20260508-test.mdx"]
	if !ok {
		t.Fatal("new key missing after rename")
	}
	if entry["article"] != "sp-201-20260508-test.mdx" {
		t.Fatalf("article field = %v, want renamed value", entry["article"])
	}

	violations, err := CheckPendingArtifacts(cfg.RepoRoot, GuardrailOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(violations) != 0 {
		t.Fatalf("violations after rename = %+v, want none", violations)
	}
}

func mustMkdir(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v failed: %v\n%s", args, err, out)
	}
}
