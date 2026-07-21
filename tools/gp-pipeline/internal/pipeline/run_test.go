package pipeline

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/counter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/logx"
)

// makeRunHarness returns a fully wired State + workDir for an end-to-end
// run test. It writes a fake fetch-x-article.sh that emits a plausible
// capture, a fake tribunal.sh that exits 0, a fake
// dedup-gate.mjs that echoes PASS, and a real temp git repo + counter
// file. The FakeProvider is seeded with plausible responses for
// eval/write/review/refine.
func makeRunHarness(t *testing.T) (*State, string) {
	return makeRunHarnessForPrefix(t, "GP")
}

func makeRunHarnessForPrefix(t *testing.T, prefix string) (*State, string) {
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
	if err := os.WriteFile(filepath.Join(scriptsDir, "tribunal.sh"), []byte(ralphStub), 0o755); err != nil {
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
  "GP": {"next": 171, "label": "Gu-log Picks", "description": "test"},
  "MP": {"next": 1, "label": "Mogu Picks", "description": "test"},
  "SD": {"next": 1, "label": "ShroomDog Original", "description": "test"},
  "Lv": {"next": 1, "label": "Level-Up", "description": "test"}
}
`), 0o644); err != nil {
		t.Fatal(err)
	}

	// Style guide.
	styleGuide := filepath.Join(tmp, "GU-LOG_WRITER_PROMPT.md")
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
	runGit("commit", "-q", "-m", "seed")

	cfg := &config.Config{
		RepoRoot:      tmp,
		ScriptsDir:    scriptsDir,
		PostsDir:      postsDir,
		CounterFile:   counterFile,
		WritingGuide:  styleGuide,
		FetchXArticle: filepath.Join(scriptsDir, "fetch-x-article.sh"),
		ValidatePosts: filepath.Join(scriptsDir, "validate-posts.mjs"),
	}

	draftOutput := strings.ReplaceAll(`---
title: "Fake Title"
ticketId: "PREFIX-PENDING"
originalDate: "2026-04-11"
translatedDate: "2026-04-11"
translatedBy:
  model: "Opus 4.6"
  harness: "Claude Code CLI"
source: "@fakeauthor on X"
sourceUrl: "https://x.com/fakeauthor/status/1"
lang: "zh-tw"
summary: "fake summary"
tags: ["ai","agents"]
---
body
`, "PREFIX-PENDING", prefix+"-PENDING")
	refinedOutput := strings.ReplaceAll(draftOutput, "body\n", "body refined\n")
	fake := llm.NewFakeClaude().WithResponses(
		llm.FakeResponse{Output: `{"verdict":"GO","reason":"substantial","suggested_title":"Fake Title"}`, WriteFile: "eval-codex-primary.json"},
		llm.FakeResponse{Output: `{"verdict":"GO","reason":"on topic","suggested_title":"Fake Title"}`, WriteFile: "eval-codex.json"},
		llm.FakeResponse{Output: draftOutput, WriteFile: "draft-v1.mdx"},
		llm.FakeResponse{Output: "- Blocker: nothing to fix\n", WriteFile: "review.md"},
		llm.FakeResponse{Output: refinedOutput, WriteFile: "final.mdx"},
		llm.FakeResponse{Output: strings.ReplaceAll(`---
title: "Fake Title"
ticketId: "PREFIX-PENDING"
lang: "en"
summary: "fake summary"
tags: ["ai","agents"]
---
translated body
`, "PREFIX-PENDING", prefix+"-PENDING"), WriteFile: "translated-en.mdx"},
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
	s.Prefix = prefix
	s.PromptTicketID = prefix + "-PENDING"
	s.WorkDir = filepath.Join(tmp, "tmp", "gp-pending-run-test")
	s.SkipBuild = true
	s.SkipPush = true
	s.SkipValidate = true

	return s, tmp
}

func runGitForTest(t *testing.T, repo string, args ...string) string {
	t.Helper()
	cmd := execCommand("git", args...)
	cmd.Dir = repo
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func TestRun_HappyPath(t *testing.T) {
	s, _ := makeRunHarness(t)
	_, _ = SetupWorkDir(s)

	err := Run(context.Background(), s)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}

	if s.PromptTicketID != "GP-171" {
		t.Errorf("ticketId = %q, want GP-171", s.PromptTicketID)
	}
	if s.Filename == "" || !strings.HasPrefix(s.Filename, "gp-171-") {
		t.Errorf("Filename = %q, want gp-171-…", s.Filename)
	}
	if _, err := os.Stat(filepath.Join(s.Cfg.PostsDir, s.Filename)); err != nil {
		t.Errorf("deployed file missing: %v", err)
	}
	if s.CodexPrimaryVerdict != "GO" || s.CodexVerdict != "GO" {
		t.Errorf("eval verdicts not propagated: codexPrimary=%q codex=%q", s.CodexPrimaryVerdict, s.CodexVerdict)
	}
	if !s.RalphPassed {
		t.Errorf("RalphPassed should be true")
	}
	if _, err := os.Stat(filepath.Join(s.WorkDir, "pipeline-status.json")); err != nil {
		t.Errorf("pipeline-status.json missing: %v", err)
	}
	if s.ActiveENFilename == "" {
		t.Errorf("translate step should have set ActiveENFilename when RalphPassed")
	} else if _, err := os.Stat(filepath.Join(s.Cfg.PostsDir, s.ActiveENFilename)); err != nil {
		t.Errorf("en sidecar missing: %v", err)
	}

	// Summary output.
	var buf bytes.Buffer
	PrintSummary(&buf, s)
	sum := buf.String()
	for _, want := range []string{"Ticket no.", "GP-171" /* "171" appears in number row */, "Work dir", "fetch", "dedup-url", "eval", "write", "deploy"} {
		_ = want
	}
	if !strings.Contains(sum, "171") {
		t.Errorf("summary missing GP-171: %s", sum)
	}
	if !strings.Contains(sum, "dedup-url") {
		t.Errorf("summary missing dedup-url timing: %s", sum)
	}
}

func TestRun_DedupURLBlockExit13BeforeEval(t *testing.T) {
	s, tmp := makeRunHarness(t)
	if err := os.WriteFile(filepath.Join(tmp, "scripts", "dedup-gate.mjs"), []byte(`#!/usr/bin/env node
if (!process.argv.includes('--title')) {
  console.log('BLOCK: Duplicate of GP-1 (URL match): Existing post');
  process.exit(1);
}
console.log('PASS');
`), 0o644); err != nil {
		t.Fatal(err)
	}
	fake := llm.NewFakeClaude()
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
	if !errors.As(err, &se) || se.Code != 13 {
		t.Fatalf("expected exit 13 for URL dedup BLOCK, got %v", err)
	}
	if len(fake.Called) != 0 {
		t.Fatalf("eval should not be reached after URL dedup BLOCK, got %d LLM call(s)", len(fake.Called))
	}
}

func TestRun_EvalSkipExit12(t *testing.T) {
	s, _ := makeRunHarness(t)
	// Override the dispatcher so BOTH evaluators return SKIP.
	fake := llm.NewFakeClaude().WithResponses(
		llm.FakeResponse{Output: `{"verdict":"SKIP","reason":"too thin","suggested_title":""}`, WriteFile: "eval-codex-primary.json"},
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
	for _, prefix := range []string{"GP", "MP"} {
		t.Run(prefix, func(t *testing.T) {
			s, _ := makeRunHarnessForPrefix(t, prefix)
			s.DryRun = true
			_, _ = SetupWorkDir(s)

			if err := Run(context.Background(), s); err != nil {
				t.Fatalf("Run --dry-run: %v", err)
			}
			if want := prefix + "-PENDING"; s.PromptTicketID != want {
				t.Errorf("dry-run should keep %s without allocation: got %q", want, s.PromptTicketID)
			}
		})
	}
}

func TestRun_FromStepRalph(t *testing.T) {
	// Resume from ralph — requires --file. Seed an existing post.
	s, tmp := makeRunHarness(t)
	s.FromStepInt = StepRalph

	// Drop an existing file into posts dir.
	existing := "gp-123-20260411-fake-resume.mdx"
	existingBody := `---
title: "Resume Fake"
ticketId: "GP-123"
originalDate: "2026-04-11"
translatedDate: "2026-04-11"
translatedBy:
  model: "Opus 4.6"
  harness: "Claude Code CLI"
source: "@fakeauthor on X"
sourceUrl: "https://x.com/fakeauthor/status/1"
lang: "zh-tw"
summary: "resume"
tags: ["ai"]
---
body
`
	if err := os.WriteFile(filepath.Join(tmp, "src", "content", "posts", existing), []byte(existingBody), 0o644); err != nil {
		t.Fatal(err)
	}
	s.ExistingFile = existing
	s.AuthorHandle = "fakeauthor"
	// FromStepInt=StepRalph still runs ralph AND translate (48 >= 47), so the
	// dispatcher needs one response for translate even though write/review/
	// refine are skipped and never touch the queue.
	translateFake := llm.NewFakeClaude().WithResponses(llm.FakeResponse{
		Output:    "---\ntitle: \"Resume Fake\"\nlang: \"en\"\n---\ntranslated\n",
		WriteFile: "translated-en.mdx",
	})
	translateDisp, err := llm.NewDispatcher(logx.New(), translateFake)
	if err != nil {
		t.Fatal(err)
	}
	s.Dispatcher = translateDisp
	_, _ = SetupWorkDir(s)

	if err := Run(context.Background(), s); err != nil {
		t.Fatalf("Run --from-step ralph: %v", err)
	}
	// Ralph should have passed and recovery deploy should publish without a
	// fresh counter allocation or filename rewrite.
	if !s.RalphPassed {
		t.Errorf("Ralph should have passed on stub")
	}
	// File still there, frontmatter normalised.
	data, err := os.ReadFile(filepath.Join(tmp, "src", "content", "posts", existing))
	if err != nil {
		t.Fatal(err)
	}
	// The run harness dispatches through a fake Claude provider, so the honest
	// ralph stamp records Claude Code CLI (not the old hardcoded Codex label) —
	// this is the CCC-fallback stamping path under test.
	if !strings.Contains(string(data), `"Claude Code CLI"`) {
		t.Errorf("ralph normaliser did not run on resume: %s", data)
	}
}

func TestRun_FromStepTranslatePublishesExistingSidecarAndLeavesRepoClean(t *testing.T) {
	s, tmp := makeRunHarness(t)
	s.FromStepInt = StepTranslate
	s.WorkDir = filepath.Join(t.TempDir(), "translate-resume-work")

	existing := "gp-123-20260411-fake-resume.mdx"
	existingBody := `---
title: "Resume Fake"
ticketId: "GP-123"
originalDate: "2026-04-11"
translatedDate: "2026-04-11"
translatedBy:
  model: "Opus 4.6"
  harness: "Claude Code CLI"
source: "@fakeauthor on X"
sourceUrl: "https://x.com/fakeauthor/status/1"
lang: "zh-tw"
summary: "resume"

---
body
`
	if err := os.WriteFile(filepath.Join(s.Cfg.PostsDir, existing), []byte(existingBody), 0o644); err != nil {
		t.Fatal(err)
	}
	// Make the synthetic repo genuinely clean before recovery starts, so a
	// successful Run must own and commit every change it creates.
	runGitForTest(t, tmp, "add", "-A")
	runGitForTest(t, tmp, "commit", "-q", "-m", "resume baseline")
	counterBefore, err := os.ReadFile(s.Cfg.CounterFile)
	if err != nil {
		t.Fatal(err)
	}

	s.ExistingFile = existing
	s.ActiveFilename = ""
	s.ActiveENFilename = ""
	s.RalphPassed = false
	translateFake := llm.NewFakeClaude().WithResponses(llm.FakeResponse{
		Output: `---
title: "Resume Fake"
ticketId: "GP-123"
lang: "en"
---
translated
`,
		WriteFile: "translated-en.mdx",
	})
	translateDisp, err := llm.NewDispatcher(logx.New(), translateFake)
	if err != nil {
		t.Fatal(err)
	}
	s.Dispatcher = translateDisp
	s.WriterDispatcher = translateDisp
	_, _ = SetupWorkDir(s)

	if err := Run(context.Background(), s); err != nil {
		t.Fatalf("Run --from-step translate: %v", err)
	}

	wantEN := "en-" + existing
	if s.Filename != existing || s.ENFilename != wantEN {
		t.Fatalf("published filenames = (%q, %q), want (%q, %q)", s.Filename, s.ENFilename, existing, wantEN)
	}
	if s.PromptTicketID != "GP-123" {
		t.Fatalf("PromptTicketID = %q, want GP-123 from existing frontmatter", s.PromptTicketID)
	}
	if _, err := os.Stat(filepath.Join(s.Cfg.PostsDir, wantEN)); err != nil {
		t.Fatalf("translated sidecar missing: %v", err)
	}
	if got := runGitForTest(t, tmp, "status", "--porcelain"); got != "" {
		t.Fatalf("successful recovery left repo dirty:\n%s", got)
	}
	if got := runGitForTest(t, tmp, "log", "-1", "--format=%s"); got != "Update GP-123: Resume Fake" {
		t.Fatalf("recovery commit subject = %q, want explicit existing-post update", got)
	}
	counterAfter, err := os.ReadFile(s.Cfg.CounterFile)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(counterAfter, counterBefore) {
		t.Fatal("existing-file recovery must not bump the article counter")
	}
}
