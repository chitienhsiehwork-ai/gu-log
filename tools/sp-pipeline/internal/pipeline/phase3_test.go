package pipeline

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/counter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/logx"
)

// findRepoRoot walks up from the test binary's CWD looking for CLAUDE.md.
// Returns empty string if we can't find it — tests that depend on real
// gu-log files will t.Skip in that case.
func findRepoRoot() string {
	dir, _ := os.Getwd()
	for i := 0; i < 6; i++ {
		if _, err := os.Stat(filepath.Join(dir, "CLAUDE.md")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
	return ""
}

func TestSanitizeSlug(t *testing.T) {
	cases := map[string]string{
		"Nick Baumann":  "nick-baumann",
		"@nickbaumann_": "nickbaumann",
		"The best tools I give Codex are bespoke CLIs": "the-best-tools-i-give-codex-are-bespoke-clis",
		"don't pad":                  "dont-pad",
		"":                           "article",
		"SP-170":                     "sp-170",
		"   leading-and-trailing   ": "leading-and-trailing",
	}
	for in, want := range cases {
		got := sanitizeSlug(in)
		if got != want {
			t.Errorf("sanitizeSlug(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestCredits_RoundTrip verifies the 4.6 credits stamp on a synthetic
// frontmatter shape matching the bash pipeline's intermediate state.
func TestCredits_RoundTrip(t *testing.T) {
	tmp := t.TempDir()
	workDir := filepath.Join(tmp, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}
	finalSeed := `---
title: "Fake Article"
ticketId: "SP-PENDING"
originalDate: "2026-04-11"
translatedDate: "2026-04-11"
translatedBy:
  model: "Sonnet 4.5"
  harness: "Old Harness"
source: "@fakeauthor on X"
sourceUrl: "https://x.com/fakeauthor/status/1"
lang: "zh-tw"
summary: "fake summary"
tags: ["shroom-picks"]
---
body
`
	if err := os.WriteFile(filepath.Join(workDir, "final.mdx"), []byte(finalSeed), 0o644); err != nil {
		t.Fatal(err)
	}

	s := NewState()
	s.Log = logx.New()
	s.Cfg = &config.Config{
		RepoRoot:     tmp,
		WritingGuide: filepath.Join(tmp, "WRITING_GUIDELINES.md"),
	}
	s.WorkDir = workDir
	s.WriteModel = "Opus 4.6"
	s.WriteHarness = "Claude Code CLI"
	s.ReviewModel = "GPT-5.4"
	s.ReviewHarness = "Codex CLI"
	s.RefineModel = "Opus 4.6"
	s.RefineHarness = "Claude Code CLI"

	if err := s.Credits(context.Background()); err != nil {
		t.Fatalf("Credits: %v", err)
	}
	out, err := os.ReadFile(filepath.Join(workDir, "final.mdx"))
	if err != nil {
		t.Fatal(err)
	}
	got := string(out)
	for _, want := range []string{
		`  model: "Opus 4.6"`,
		`  harness: "Gemini CLI + Codex CLI"`,
		`- role: "Written"`,
		`- role: "Reviewed"`,
		`- role: "Refined"`,
		`- role: "Orchestrated"`,
		`  pipelineUrl: "https://github.com/chitienhsiehwork-ai/clawd-workspace`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("credits output missing %q", want)
		}
	}
	// Sibling top-level keys must survive.
	if !strings.Contains(got, `ticketId: "SP-PENDING"`) {
		t.Errorf("ticketId clobbered")
	}
	if !strings.Contains(got, `lang: "zh-tw"`) {
		t.Errorf("lang clobbered")
	}
}

// TestRalph_WithStubScript runs the ralph step against a stub
// tribunal-all-claude.sh that just exits 0. This verifies the shellout
// wrapper, the filename plumbing, and the frontmatter normaliser.
func TestRalph_WithStubScript(t *testing.T) {
	tmp := t.TempDir()
	scriptsDir := filepath.Join(tmp, "scripts")
	postsDir := filepath.Join(tmp, "posts")
	workDir := filepath.Join(tmp, "work")
	for _, d := range []string{scriptsDir, postsDir, workDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	// Stub tribunal-all-claude.sh that just writes a marker file.
	stub := `#!/usr/bin/env bash
set -e
echo "[stub-ralph] invoked with: $*"
exit 0
`
	stubPath := filepath.Join(scriptsDir, "tribunal-all-claude.sh")
	if err := os.WriteFile(stubPath, []byte(stub), 0o755); err != nil {
		t.Fatal(err)
	}

	// Seed a final.mdx in the work dir.
	finalSeed := `---
title: "Fake Title"
ticketId: "SP-PENDING"
originalDate: "2026-04-11"
translatedDate: "2026-04-11"
translatedBy:
  model: "Opus 4.6"
  harness: "Claude Code CLI"
source: "@fakeauthor on X"
sourceUrl: "https://x.com/fakeauthor/status/1"
lang: "zh-tw"
summary: "fake summary"
tags: ["shroom-picks"]
---
body
`
	if err := os.WriteFile(filepath.Join(workDir, "final.mdx"), []byte(finalSeed), 0o644); err != nil {
		t.Fatal(err)
	}

	s := NewState()
	s.Log = logx.New()
	s.Cfg = &config.Config{
		RepoRoot:   tmp,
		ScriptsDir: scriptsDir,
		PostsDir:   postsDir,
	}
	s.WorkDir = workDir
	s.Prefix = "SP"
	s.AuthorHandle = "fakeauthor"
	s.Title = "Fake Title"

	if err := s.Ralph(context.Background()); err != nil {
		t.Fatalf("Ralph: %v", err)
	}
	if !s.RalphPassed {
		t.Errorf("RalphPassed should be true with an exit-0 stub")
	}
	if s.ActiveFilename == "" || !strings.HasPrefix(s.ActiveFilename, "sp-pending-") {
		t.Errorf("ActiveFilename wrong: %q", s.ActiveFilename)
	}
	// Posts dir should now contain the pending file with normalised frontmatter.
	data, err := os.ReadFile(filepath.Join(postsDir, s.ActiveFilename))
	if err != nil {
		t.Fatalf("active file not in posts dir: %v", err)
	}
	got := string(data)
	// Canonical harness + 6-entry pipeline + pipelineUrl.
	for _, want := range []string{
		`  harness: "Gemini CLI + Codex CLI + Claude Code"`,
		`- role: "Scored"`,
		`- role: "Rewritten"`,
		`- role: "Orchestrated"`,
		`blob/main/scripts/sp-pipeline.sh`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("ralph frontmatter missing %q\n---\n%s", want, got)
		}
	}
}

// TestRalph_StubFailureContinues verifies the log-and-continue contract.
func TestRalph_StubFailureContinues(t *testing.T) {
	tmp := t.TempDir()
	scriptsDir := filepath.Join(tmp, "scripts")
	postsDir := filepath.Join(tmp, "posts")
	workDir := filepath.Join(tmp, "work")
	for _, d := range []string{scriptsDir, postsDir, workDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	// Stub that exits 1 — simulates a tribunal failure.
	failStub := `#!/usr/bin/env bash
echo "[stub-ralph] simulated failure"
exit 1
`
	if err := os.WriteFile(filepath.Join(scriptsDir, "tribunal-all-claude.sh"), []byte(failStub), 0o755); err != nil {
		t.Fatal(err)
	}
	finalSeed := `---
title: "Fake"
translatedBy:
  model: "Opus 4.6"
  harness: "Claude Code CLI"
---
body
`
	if err := os.WriteFile(filepath.Join(workDir, "final.mdx"), []byte(finalSeed), 0o644); err != nil {
		t.Fatal(err)
	}

	s := NewState()
	s.Log = logx.New()
	s.Cfg = &config.Config{RepoRoot: tmp, ScriptsDir: scriptsDir, PostsDir: postsDir}
	s.WorkDir = workDir
	s.Prefix = "SP"
	s.AuthorHandle = "fake"
	s.Title = "Fake"

	if err := s.Ralph(context.Background()); err != nil {
		t.Errorf("Ralph should NOT return an error on tribunal failure (log-and-continue), got %v", err)
	}
	if s.RalphPassed {
		t.Errorf("RalphPassed should be false after an exit-1 stub")
	}
}

// TestDeploy_DryRunWithFakeGitRepo exercises the deploy flow end-to-end
// against a real temp git repo, with validate/build skipped and push
// disabled (no remote). Uses a real counter file.
func TestDeploy_DryRunWithFakeGitRepo(t *testing.T) {
	if testing.Short() {
		t.Skip("deploy end-to-end creates a git repo")
	}
	tmp := t.TempDir()
	postsDir := filepath.Join(tmp, "src", "content", "posts")
	scriptsDir := filepath.Join(tmp, "scripts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(scriptsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	counterFile := filepath.Join(scriptsDir, "article-counter.json")
	if err := os.WriteFile(counterFile, []byte(`{
  "SP": { "next": 171, "label": "ShroomDog Picks", "description": "test" },
  "CP": { "next": 1, "label": "Clawd Picks", "description": "test" },
  "SD": { "next": 1, "label": "ShroomDog Original", "description": "test" },
  "Lv": { "next": 1, "label": "Level-Up", "description": "test" }
}
`), 0o644); err != nil {
		t.Fatal(err)
	}

	// Seed a pending file.
	pendingName := "sp-pending-20260411-fake-title.mdx"
	pendingBody := `---
title: "Fake"
ticketId: "PENDING"
---
body
`
	if err := os.WriteFile(filepath.Join(postsDir, pendingName), []byte(pendingBody), 0o644); err != nil {
		t.Fatal(err)
	}

	// Init a git repo so commit works.
	initRepo(t, tmp)

	cfg := &config.Config{
		RepoRoot:      tmp,
		ScriptsDir:    scriptsDir,
		PostsDir:      postsDir,
		CounterFile:   counterFile,
		ValidatePosts: filepath.Join(scriptsDir, "validate-posts.mjs"),
	}

	s := NewState()
	s.Log = logx.New()
	s.Cfg = cfg
	s.Counter = counter.New(counterFile, filepath.Join(tmp, ".counter.lock"))
	s.Prefix = "SP"
	s.ActiveFilename = pendingName
	s.ActiveENFilename = ""
	s.Title = "Fake"
	s.DateStamp = "20260411"
	s.AuthorSlug = "fake"
	s.TitleSlug = "title"
	s.SkipBuild = true
	s.SkipPush = true
	s.SkipValidate = true

	// Drop a no-op validator AND swap npm for a shim so we don't hit
	// the real tooling. Prepend a local bin dir to PATH.
	binDir := filepath.Join(tmp, "bin")
	_ = os.MkdirAll(binDir, 0o755)
	_ = os.WriteFile(filepath.Join(scriptsDir, "validate-posts.mjs"), []byte(""), 0o644)
	_ = os.WriteFile(filepath.Join(binDir, "npm"), []byte("#!/usr/bin/env bash\nexit 0\n"), 0o755)
	oldPath := os.Getenv("PATH")
	t.Setenv("PATH", binDir+":"+oldPath)

	if err := s.Deploy(context.Background()); err != nil {
		t.Fatalf("Deploy: %v", err)
	}
	if s.SPNumber != 171 {
		t.Errorf("SPNumber = %d, want 171", s.SPNumber)
	}
	if s.PromptTicketID != "SP-171" {
		t.Errorf("PromptTicketID = %q, want SP-171", s.PromptTicketID)
	}
	// Pending file should have been renamed.
	if _, err := os.Stat(filepath.Join(postsDir, s.Filename)); err != nil {
		t.Errorf("renamed file missing: %v", err)
	}
	// Its ticketId should be the allocated one.
	data, _ := os.ReadFile(filepath.Join(postsDir, s.Filename))
	if !strings.Contains(string(data), `ticketId: "SP-171"`) {
		t.Errorf("ticketId not replaced in %s:\n%s", s.Filename, data)
	}
}

// initRepo runs `git init` + a single dummy commit in dir so subsequent
// commits can succeed. t.Fatal on any error.
func initRepo(t *testing.T, dir string) {
	t.Helper()
	run := func(args ...string) {
		c := runShell(t, dir, args...)
		if c != 0 {
			t.Fatalf("git %v exit %d", args, c)
		}
	}
	run("init", "-q", "-b", "main")
	run("config", "user.email", "test@example.com")
	run("config", "user.name", "Test")
	run("config", "commit.gpgSign", "false")
	run("config", "core.hooksPath", "/dev/null")
	// Make an initial commit so the second commit is not "first commit".
	seed := filepath.Join(dir, ".seed")
	_ = os.WriteFile(seed, []byte("seed"), 0o644)
	run("add", ".seed")
	run("commit", "-q", "-m", "seed", "--no-verify", "--no-gpg-sign")
	// Disable push by removing any remote (there isn't one, but leave a
	// fake origin that points to /dev/null so push fails predictably —
	// here we just skip push via SkipPush in the deploy Options).
	_ = os.Remove(seed)
}

// runShell runs git with args in dir and returns the exit code. It
// disables any repo-level hooksPath so a pre-commit hook in an enclosing
// gu-log checkout does not run during the test.
func runShell(t *testing.T, dir string, args ...string) int {
	t.Helper()
	allArgs := append([]string{"-c", "core.hooksPath=/dev/null"}, args...)
	cmd := execCommand("git", allArgs...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Test",
		"GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test",
		"GIT_COMMITTER_EMAIL=test@example.com",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Logf("git %v failed: %v\n%s", args, err, out)
		return 1
	}
	return 0
}
