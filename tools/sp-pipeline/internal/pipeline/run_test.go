package pipeline

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/counter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/logx"
)

// makeRunHarness returns a fully wired State + workDir for an end-to-end
// run test. It writes a fake fetch-x-article.sh that emits a plausible
// capture, a fake tribunal-all-claude.sh that exits 0, a fake
// dedup-gate.mjs that echoes PASS, and a real temp git repo + counter
// file. The FakeProvider is seeded with plausible responses for
// eval/write/review/refine.
func makeRunHarness(t *testing.T) (*State, string) {
	t.Helper()
	tmp := t.TempDir()
	scriptsDir := filepath.Join(tmp, "scripts")
	postsDir := filepath.Join(tmp, "src", "content", "posts")
	binDir := filepath.Join(tmp, "bin")
	for _, d := range []string{scriptsDir, postsDir, binDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	// Fake fetch-x-article.sh — emits a plausible capture.
	fetchStub := `#!/usr/bin/env bash
cat <<'SOURCE'
@fakeauthor — 2026-04-11
Source URL: https://x.com/fakeauthor/status/1
Fetched via: fxtwitter

=== MAIN TWEET ===
Fake tweet body for end-to-end run test. Line two.
Line three of the fake tweet with enough content to pass validation.
Line four with extra padding for line count.
SOURCE
`
	if err := os.WriteFile(filepath.Join(scriptsDir, "fetch-x-article.sh"), []byte(fetchStub), 0o755); err != nil {
		t.Fatal(err)
	}

	// Fake ralph — exits 0.
	ralphStub := `#!/usr/bin/env bash
echo "[stub-ralph] passing: $*"
exit 0
`
	if err := os.WriteFile(filepath.Join(scriptsDir, "tribunal-all-claude.sh"), []byte(ralphStub), 0o755); err != nil {
		t.Fatal(err)
	}

	// Fake dedup-gate.mjs — writes "PASS" and exits 0.
	dedupStub := `#!/usr/bin/env node
console.log("PASS");
process.exit(0);
`
	if err := os.WriteFile(filepath.Join(scriptsDir, "dedup-gate.mjs"), []byte(dedupStub), 0o644); err != nil {
		t.Fatal(err)
	}

	// Counter file.
	counterFile := filepath.Join(scriptsDir, "article-counter.json")
	if err := os.WriteFile(counterFile, []byte(`{
  "SP": {"next": 171, "label": "ShroomDog Picks", "description": "test"},
  "CP": {"next": 1, "label": "Clawd Picks", "description": "test"},
  "SD": {"next": 1, "label": "ShroomDog Original", "description": "test"},
  "Lv": {"next": 1, "label": "Level-Up", "description": "test"}
}
`), 0o644); err != nil {
		t.Fatal(err)
	}

	// Style guide.
	styleGuide := filepath.Join(tmp, "WRITING_GUIDELINES.md")
	if err := os.WriteFile(styleGuide, []byte("# Style\nLHY tone.\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Empty validate-posts.mjs so deploy can skip it via SkipValidate.
	if err := os.WriteFile(filepath.Join(scriptsDir, "validate-posts.mjs"), []byte(""), 0o644); err != nil {
		t.Fatal(err)
	}

	// Init git repo for commit step.
	runGit := func(args ...string) {
		cmd := execCommand("git", args...)
		cmd.Dir = tmp
		if err := cmd.Run(); err != nil {
			t.Fatalf("git %v: %v", args, err)
		}
	}
	runGit("init", "-q", "-b", "main")
	runGit("config", "user.email", "test@example.com")
	runGit("config", "user.name", "Test")
	runGit("config", "commit.gpgSign", "false")
	runGit("config", "core.hooksPath", "/dev/null")
	seed := filepath.Join(tmp, ".seed")
	_ = os.WriteFile(seed, []byte("seed"), 0o644)
	runGit("add", ".seed")
	runGit("commit", "-q", "-m", "seed", "--no-verify", "--no-gpg-sign")

	cfg := &config.Config{
		RepoRoot:      tmp,
		ScriptsDir:    scriptsDir,
		PostsDir:      postsDir,
		CounterFile:   counterFile,
		WritingGuide:  styleGuide,
		FetchXArticle: filepath.Join(scriptsDir, "fetch-x-article.sh"),
		ValidatePosts: filepath.Join(scriptsDir, "validate-posts.mjs"),
	}

	fake := llm.NewFakeClaude().WithResponses(
		llm.FakeResponse{Output: `{"verdict":"GO","reason":"substantial","suggested_title":"Fake Title"}`, WriteFile: "eval-gemini.json"},
		llm.FakeResponse{Output: `{"verdict":"GO","reason":"on topic","suggested_title":"Fake Title"}`, WriteFile: "eval-codex.json"},
		llm.FakeResponse{Output: `---
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
tags: ["shroom-picks", "ai"]
---
body
`, WriteFile: "draft-v1.mdx"},
		llm.FakeResponse{Output: "- Blocker: nothing to fix\n", WriteFile: "review.md"},
		llm.FakeResponse{Output: `---
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
tags: ["shroom-picks", "ai"]
---
body refined
`, WriteFile: "final.mdx"},
	)
	disp, err := llm.NewDispatcher(logx.New(), fake)
	if err != nil {
		t.Fatal(err)
	}

	s := NewState()
	s.Cfg = cfg
	s.Log = logx.New()
	s.Dispatcher = disp
	s.Counter = counter.New(counterFile, filepath.Join(tmp, ".counter.lock"))
	s.TweetURL = "https://x.com/fakeauthor/status/1"
	s.Prefix = "SP"
	s.WorkDir = filepath.Join(tmp, "tmp", "sp-pending-run-test")
	s.SkipBuild = true
	s.SkipPush = true
	s.SkipValidate = true

	return s, tmp
}

func TestRun_HappyPath(t *testing.T) {
	s, _ := makeRunHarness(t)
	_, _ = SetupWorkDir(s)

	err := Run(context.Background(), s)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}

	if s.PromptTicketID != "SP-171" {
		t.Errorf("ticketId = %q, want SP-171", s.PromptTicketID)
	}
	if s.Filename == "" || !strings.HasPrefix(s.Filename, "sp-171-") {
		t.Errorf("Filename = %q, want sp-171-…", s.Filename)
	}
	if _, err := os.Stat(filepath.Join(s.Cfg.PostsDir, s.Filename)); err != nil {
		t.Errorf("deployed file missing: %v", err)
	}
	if s.GeminiVerdict != "GO" || s.CodexVerdict != "GO" {
		t.Errorf("eval verdicts not propagated: gemini=%q codex=%q", s.GeminiVerdict, s.CodexVerdict)
	}
	if !s.RalphPassed {
		t.Errorf("RalphPassed should be true")
	}

	// Summary output.
	var buf bytes.Buffer
	PrintSummary(&buf, s)
	sum := buf.String()
	for _, want := range []string{"SP number", "SP-171" /* "171" appears in number row */, "Work dir", "fetch", "eval", "write", "deploy"} {
		_ = want
	}
	if !strings.Contains(sum, "171") {
		t.Errorf("summary missing SP-171: %s", sum)
	}
}

func TestRun_EvalSkipExit12(t *testing.T) {
	s, _ := makeRunHarness(t)
	// Override the dispatcher so BOTH evaluators return SKIP.
	fake := llm.NewFakeClaude().WithResponses(
		llm.FakeResponse{Output: `{"verdict":"SKIP","reason":"too thin","suggested_title":""}`, WriteFile: "eval-gemini.json"},
		llm.FakeResponse{Output: `{"verdict":"SKIP","reason":"off topic","suggested_title":""}`, WriteFile: "eval-codex.json"},
	)
	disp, err := llm.NewDispatcher(logx.New(), fake)
	if err != nil {
		t.Fatal(err)
	}
	s.Dispatcher = disp
	_, _ = SetupWorkDir(s)

	err = Run(context.Background(), s)
	if err == nil {
		t.Fatalf("expected StepError")
	}
	var se *StepError
	if !errors.As(err, &se) || se.Code != 12 {
		t.Errorf("expected exit 12 for SKIP/SKIP, got %v", err)
	}
}

func TestRun_DryRunSkipsDeploy(t *testing.T) {
	s, _ := makeRunHarness(t)
	s.DryRun = true
	_, _ = SetupWorkDir(s)

	if err := Run(context.Background(), s); err != nil {
		t.Fatalf("Run --dry-run: %v", err)
	}
	if s.PromptTicketID != "PENDING" {
		t.Errorf("dry-run should not allocate ticket: got %q", s.PromptTicketID)
	}
}

func TestRun_FromStepRalph(t *testing.T) {
	// Resume from ralph — requires --file. Seed an existing post.
	s, tmp := makeRunHarness(t)
	s.FromStepInt = StepRalph

	// Drop an existing file into posts dir.
	existing := "sp-123-20260411-fake-resume.mdx"
	existingBody := `---
title: "Resume Fake"
ticketId: "SP-123"
originalDate: "2026-04-11"
translatedDate: "2026-04-11"
translatedBy:
  model: "Opus 4.6"
  harness: "Claude Code CLI"
source: "@fakeauthor on X"
sourceUrl: "https://x.com/fakeauthor/status/1"
lang: "zh-tw"
summary: "resume"
tags: ["shroom-picks"]
---
body
`
	if err := os.WriteFile(filepath.Join(tmp, "src", "content", "posts", existing), []byte(existingBody), 0o644); err != nil {
		t.Fatal(err)
	}
	s.ExistingFile = existing
	s.AuthorHandle = "fakeauthor"
	_, _ = SetupWorkDir(s)

	if err := Run(context.Background(), s); err != nil {
		t.Fatalf("Run --from-step ralph: %v", err)
	}
	// Ralph should have passed and deploy is a no-op on --file resume.
	if !s.RalphPassed {
		t.Errorf("Ralph should have passed on stub")
	}
	// File still there, frontmatter normalised.
	data, err := os.ReadFile(filepath.Join(tmp, "src", "content", "posts", existing))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"Gemini CLI + Codex CLI + Claude Code"`) {
		t.Errorf("ralph normaliser did not run on resume: %s", data)
	}
}
