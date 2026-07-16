package pipeline

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/counter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/logx"
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
		"GP-170":                     "gp-170",
		"   leading-and-trailing   ": "leading-and-trailing",
	}
	for in, want := range cases {
		got := sanitizeSlug(in)
		if got != want {
			t.Errorf("sanitizeSlug(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestJudgeStampLabelsUsesRunScopedCodexModelWithoutDispatcher(t *testing.T) {
	binDir := t.TempDir()
	codexPath := filepath.Join(binDir, "codex")
	if err := os.WriteFile(codexPath, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("GP_CODEX_MODEL", "gpt-5.6-sol")

	model, harness := NewState().JudgeStampLabels()
	if model != "GPT-5.6-Sol" || harness != "Codex CLI" {
		t.Fatalf("JudgeStampLabels() = (%q, %q), want (GPT-5.6-Sol, Codex CLI)", model, harness)
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
ticketId: "GP-PENDING"
originalDate: "2026-04-11"
translatedDate: "2026-04-11"
translatedBy:
  model: "Sonnet 4.5"
  harness: "Old Harness"
source: "@fakeauthor on X"
sourceUrl: "https://x.com/fakeauthor/status/1"
lang: "zh-tw"
summary: "fake summary"
tags: ["ai"]
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
		WritingGuide: filepath.Join(tmp, "GU-LOG_WRITER_PROMPT.md"),
	}
	s.WorkDir = workDir
	s.WriteModel = "GPT-5.5"
	s.WriteHarness = "Codex CLI"
	s.ReviewModel = "GPT-5.5"
	s.ReviewHarness = "Codex CLI"
	s.RefineModel = "GPT-5.5"
	s.RefineHarness = "Codex CLI"

	if err := s.Credits(context.Background()); err != nil {
		t.Fatalf("Credits: %v", err)
	}
	out, err := os.ReadFile(filepath.Join(workDir, "final.mdx"))
	if err != nil {
		t.Fatal(err)
	}
	got := string(out)
	for _, want := range []string{
		`  model: "GPT-5.5"`,
		`  harness: "Codex CLI"`,
		`- role: "Written"`,
		`- role: "Reviewed"`,
		`- role: "Refined"`,
		`- role: "Orchestrated"`,
		`  pipelineUrl: "https://github.com/chitienhsiehwork-ai/gu-log/tree/main/tools/gp-pipeline"`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("credits output missing %q", want)
		}
	}
	// Sibling top-level keys must survive.
	if !strings.Contains(got, `ticketId: "GP-PENDING"`) {
		t.Errorf("ticketId clobbered")
	}
	if !strings.Contains(got, `lang: "zh-tw"`) {
		t.Errorf("lang clobbered")
	}
}

// TestRalph_WithStubScript runs the ralph step against a stub
// tribunal.sh that just exits 0. This verifies the shellout
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

	// Stub tribunal.sh that just writes a marker file.
	stub := `#!/usr/bin/env bash
set -e
echo "[stub-ralph] invoked with: $*"
exit 0
`
	stubPath := filepath.Join(scriptsDir, "tribunal.sh")
	if err := os.WriteFile(stubPath, []byte(stub), 0o755); err != nil {
		t.Fatal(err)
	}

	// Seed a final.mdx in the work dir.
	finalSeed := `---
title: "Fake Title"
ticketId: "GP-PENDING"
originalDate: "2026-04-11"
translatedDate: "2026-04-11"
translatedBy:
  model: "Opus 4.6"
  harness: "Claude Code CLI"
source: "@fakeauthor on X"
sourceUrl: "https://x.com/fakeauthor/status/1"
lang: "zh-tw"
summary: "fake summary"
tags: ["ai"]
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
	s.Prefix = "GP"
	s.AuthorHandle = "fakeauthor"
	s.Title = "Fake Title"
	// Pin the stamp provider to Codex so the canonical-frontmatter assertions
	// are deterministic regardless of which CLI happens to be on the test
	// box's PATH (CCC has claude, the VPS has codex).
	disp, err := llm.NewDispatcher(s.Log, llm.NewFakeCodex())
	if err != nil {
		t.Fatal(err)
	}
	s.Dispatcher = disp

	if err := s.Ralph(context.Background()); err != nil {
		t.Fatalf("Ralph: %v", err)
	}
	if !s.RalphPassed {
		t.Errorf("RalphPassed should be true with an exit-0 stub")
	}
	if s.ActiveFilename == "" || !strings.HasPrefix(s.ActiveFilename, "gp-pending-") {
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
		`  harness: "Codex CLI"`,
		`- role: "Scored"`,
		`- role: "Rewritten"`,
		`- role: "Orchestrated"`,
		`tree/main/tools/gp-pipeline`,
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
	if err := os.WriteFile(filepath.Join(scriptsDir, "tribunal.sh"), []byte(failStub), 0o755); err != nil {
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
	s.Prefix = "GP"
	s.AuthorHandle = "fake"
	s.Title = "Fake"

	if err := s.Ralph(context.Background()); err != nil {
		t.Errorf("Ralph should NOT return an error on tribunal failure (log-and-continue), got %v", err)
	}
	if s.RalphPassed {
		t.Errorf("RalphPassed should be false after an exit-1 stub")
	}
}

func TestRunPostFixers_BestEffortOnFailure(t *testing.T) {
	tmp := t.TempDir()
	binDir := filepath.Join(tmp, "bin")
	scriptsDir := filepath.Join(tmp, "scripts")
	for _, d := range []string{binDir, scriptsDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	logPath := filepath.Join(tmp, "node-calls.log")
	nodeStub := `#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FIXER_CALL_LOG"
exit 1
`
	if err := os.WriteFile(filepath.Join(binDir, "node"), []byte(nodeStub), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("FIXER_CALL_LOG", logPath)

	postPath := filepath.Join(tmp, "post.mdx")
	if err := os.WriteFile(postPath, []byte("---\ntitle: Test\n---\nbody\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	s := NewState()
	s.Log = logx.New()
	s.Cfg = &config.Config{RepoRoot: tmp, ScriptsDir: scriptsDir}

	s.runPostFixers(context.Background(), postPath)

	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("fake node was not called: %v", err)
	}
	got := string(data)
	for _, want := range []string{"add-kaomoji.mjs --write", "apply-glossary-links.mjs", "inject-related-posts.mjs --file"} {
		if !strings.Contains(got, want) {
			t.Fatalf("node calls missing %q:\n%s", want, got)
		}
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
  "GP": { "next": 171, "label": "Gu-log Picks", "description": "test" },
  "MP": { "next": 1, "label": "Mogu Picks", "description": "test" },
  "SD": { "next": 1, "label": "ShroomDog Original", "description": "test" },
  "Lv": { "next": 1, "label": "Level-Up", "description": "test" }
}
`), 0o644); err != nil {
		t.Fatal(err)
	}

	// Seed a pending file.
	pendingName := "gp-pending-20260411-fake-title.mdx"
	pendingBody := `---
title: "Fake"
ticketId: "GP-PENDING"
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
	s.Prefix = "GP"
	s.ActiveFilename = pendingName
	s.ActiveENFilename = ""
	s.Title = "Fake"
	s.DateStamp = "20260411"
	s.AuthorSlug = "fake"
	s.TitleSlug = "title"
	s.SkipBuild = true
	s.SkipPush = true
	s.SkipValidate = true

	if err := s.Deploy(context.Background()); err != nil {
		t.Fatalf("Deploy: %v", err)
	}
	if s.TicketNumber != 171 {
		t.Errorf("TicketNumber = %d, want 171", s.TicketNumber)
	}
	if s.PromptTicketID != "GP-171" {
		t.Errorf("PromptTicketID = %q, want GP-171", s.PromptTicketID)
	}
	// Pending file should have been renamed.
	if _, err := os.Stat(filepath.Join(postsDir, s.Filename)); err != nil {
		t.Errorf("renamed file missing: %v", err)
	}
	// Its ticketId should be the allocated one.
	data, _ := os.ReadFile(filepath.Join(postsDir, s.Filename))
	if !strings.Contains(string(data), `ticketId: "GP-171"`) {
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
