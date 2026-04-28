package pipeline

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/logx"
)

// newTestState returns a State + fake dispatcher wired up to a temp work
// directory that already contains a plausible source-tweet.md and an
// empty WRITING_GUIDELINES.md pointer.
func newTestState(t *testing.T) (*State, *llm.FakeProvider, string) {
	t.Helper()
	tmp := t.TempDir()
	workDir := filepath.Join(tmp, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatalf("mkdir work: %v", err)
	}
	sourcePath := filepath.Join(workDir, "source-tweet.md")
	if err := os.WriteFile(sourcePath, []byte("@fakeauthor — 2026-04-11\nSource URL: https://x.com/fakeauthor/status/1\n\n=== MAIN TWEET ===\nFake tweet body with enough characters to look plausible.\nSecond line.\nThird line.\n"), 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}

	// Point Cfg at a style guide that exists on disk.
	styleGuide := filepath.Join(tmp, "WRITING_GUIDELINES.md")
	if err := os.WriteFile(styleGuide, []byte("# Style\nLHY tone.\n"), 0o644); err != nil {
		t.Fatalf("write style guide: %v", err)
	}

	fake := llm.NewFakeClaude()
	disp, err := llm.NewDispatcher(logx.New(), fake)
	if err != nil {
		t.Fatalf("dispatcher: %v", err)
	}

	s := NewState()
	s.WorkDir = workDir
	s.SourcePath = sourcePath
	s.TweetURL = "https://x.com/fakeauthor/status/1"
	s.AuthorHandle = "fakeauthor"
	s.SourceIsX = true
	s.OriginalDate = "2026-04-11"
	s.TranslatedDate = "2026-04-11"
	s.Cfg = &config.Config{
		RepoRoot:     tmp,
		WritingGuide: styleGuide,
		PostsDir:     filepath.Join(tmp, "posts"),
	}
	s.Log = logx.New()
	s.Dispatcher = disp
	return s, fake, workDir
}

func TestEval_GoGo(t *testing.T) {
	s, fake, workDir := newTestState(t)
	fake.WithResponses(
		llm.FakeResponse{
			Output:    `{"verdict":"GO","reason":"substantial","suggested_title":"Fake Title"}`,
			WriteFile: "eval-gemini.json",
		},
		llm.FakeResponse{
			Output:    `{"verdict":"GO","reason":"on topic","suggested_title":"Fake Title"}`,
			WriteFile: "eval-codex.json",
		},
	)
	if err := s.Eval(context.Background()); err != nil {
		t.Fatalf("Eval returned %v, want nil", err)
	}
	if s.SuggestedTitle != "Fake Title" {
		t.Errorf("SuggestedTitle = %q, want Fake Title", s.SuggestedTitle)
	}
	// Both verdicts populated.
	if s.GeminiVerdict != "GO" || s.CodexVerdict != "GO" {
		t.Errorf("verdicts not stored: gemini=%q codex=%q", s.GeminiVerdict, s.CodexVerdict)
	}
	// Files exist.
	for _, f := range []string{"eval-gemini.json", "eval-codex.json"} {
		if _, err := os.Stat(filepath.Join(workDir, f)); err != nil {
			t.Errorf("%s missing: %v", f, err)
		}
	}
}

func TestEval_SkipSkipExit12(t *testing.T) {
	s, fake, _ := newTestState(t)
	fake.WithResponses(
		llm.FakeResponse{Output: `{"verdict":"SKIP","reason":"too thin","suggested_title":""}`, WriteFile: "eval-gemini.json"},
		llm.FakeResponse{Output: `{"verdict":"SKIP","reason":"off topic","suggested_title":""}`, WriteFile: "eval-codex.json"},
	)
	err := s.Eval(context.Background())
	if err == nil {
		t.Fatalf("expected StepError, got nil")
	}
	var se *StepError
	if !errors.As(err, &se) {
		t.Fatalf("error is not *StepError: %T %v", err, err)
	}
	if se.Code != 12 {
		t.Errorf("expected exit code 12 for SKIP/SKIP, got %d", se.Code)
	}
}

func TestEval_SplitExit2(t *testing.T) {
	s, fake, _ := newTestState(t)
	fake.WithResponses(
		llm.FakeResponse{Output: `{"verdict":"GO","reason":"yes","suggested_title":"t"}`, WriteFile: "eval-gemini.json"},
		llm.FakeResponse{Output: `{"verdict":"SKIP","reason":"no","suggested_title":""}`, WriteFile: "eval-codex.json"},
	)
	err := s.Eval(context.Background())
	var se *StepError
	if !errors.As(err, &se) {
		t.Fatalf("expected StepError, got %v", err)
	}
	if se.Code != 2 {
		t.Errorf("expected exit code 2 for split, got %d", se.Code)
	}
}

func TestEval_ForceSkips(t *testing.T) {
	s, fake, _ := newTestState(t)
	s.Force = true
	if err := s.Eval(context.Background()); err != nil {
		t.Fatalf("Eval with --force: %v", err)
	}
	if len(fake.Called) != 0 {
		t.Errorf("--force should not call dispatcher, but got %d calls", len(fake.Called))
	}
}

func TestEval_FromStepSkips(t *testing.T) {
	s, fake, _ := newTestState(t)
	s.FromStepInt = StepWrite // start from Write, so Eval must skip
	if err := s.Eval(context.Background()); err != nil {
		t.Fatalf("Eval with --from-step write: %v", err)
	}
	if len(fake.Called) != 0 {
		t.Errorf("from-step skip should not call dispatcher, got %d calls", len(fake.Called))
	}
}

func TestWrite_HappyPath(t *testing.T) {
	s, fake, workDir := newTestState(t)
	fakeDraft := "---\ntitle: \"Fake\"\nticketId: \"PENDING\"\n---\nbody\n"
	fake.WithResponses(
		llm.FakeResponse{
			Output:    fakeDraft,
			WriteFile: "draft-v1.mdx",
		},
	)
	if err := s.Write(context.Background()); err != nil {
		t.Fatalf("Write: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(workDir, "draft-v1.mdx"))
	if err != nil {
		t.Fatalf("draft missing: %v", err)
	}
	if !strings.Contains(string(data), "title: \"Fake\"") {
		t.Errorf("draft does not contain expected frontmatter: %q", data)
	}
	if s.WriteModel == "" {
		t.Errorf("WriteModel not populated")
	}
	// Assert the rendered prompt was properly interpolated.
	if len(fake.Called) != 1 {
		t.Fatalf("expected 1 dispatcher call, got %d", len(fake.Called))
	}
	prompt := fake.Called[0].Prompt
	for _, want := range []string{
		"PENDING",
		"source: @fakeauthor on X",
		"shroom-picks",
		"Fake tweet body",
		"LHY tone",
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("prompt missing %q", want)
		}
	}
	if strings.Contains(prompt, "NARRATIVE ANGLE") {
		t.Errorf("prompt unexpectedly has NARRATIVE ANGLE despite empty s.Angle")
	}
}

func TestWrite_AnglePropagates(t *testing.T) {
	s, fake, _ := newTestState(t)
	s.Angle = "Focus on Task Flow while introducing the others. Use intriguing stories."
	s.SourceLabel = "OpenClaw Docs"
	s.SourceIsX = false
	fake.WithResponses(
		llm.FakeResponse{
			Output:    "---\ntitle: \"x\"\n---\nbody\n",
			WriteFile: "draft-v1.mdx",
		},
	)
	if err := s.Write(context.Background()); err != nil {
		t.Fatalf("Write: %v", err)
	}
	if len(fake.Called) != 1 {
		t.Fatalf("expected 1 dispatcher call, got %d", len(fake.Called))
	}
	prompt := fake.Called[0].Prompt
	for _, want := range []string{
		"NARRATIVE ANGLE",
		"Focus on Task Flow",
		"source: OpenClaw Docs",
		"STRUCTURAL directive",
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("write prompt missing %q", want)
		}
	}
	if strings.Contains(prompt, "@fakeauthor on X") {
		t.Errorf("write prompt leaked X-style source despite custom SourceLabel")
	}
}

func TestRefine_AnglePropagates(t *testing.T) {
	s, fake, workDir := newTestState(t)
	s.Angle = "Focus on Task Flow while introducing the others."
	// Seed draft + review so refine can run.
	if err := os.WriteFile(filepath.Join(workDir, "draft-v1.mdx"), []byte("---\ntitle: \"x\"\n---\nbody\n"), 0o644); err != nil {
		t.Fatalf("seed draft: %v", err)
	}
	if err := os.WriteFile(filepath.Join(workDir, "review.md"), []byte("- Issue 1: minor — fake\n"), 0o644); err != nil {
		t.Fatalf("seed review: %v", err)
	}
	fake.WithResponses(
		llm.FakeResponse{
			Output:    "---\ntitle: \"refined\"\n---\nbody\n",
			WriteFile: "final.mdx",
		},
	)
	if err := s.Refine(context.Background()); err != nil {
		t.Fatalf("Refine: %v", err)
	}
	if len(fake.Called) != 1 {
		t.Fatalf("expected 1 dispatcher call, got %d", len(fake.Called))
	}
	prompt := fake.Called[0].Prompt
	for _, want := range []string{
		"NARRATIVE ANGLE",
		"Focus on Task Flow",
		"angle-pivoted structure is intentional",
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("refine prompt missing %q", want)
		}
	}
}

func TestResolveSourceField(t *testing.T) {
	cases := []struct {
		name        string
		label       string
		isX         bool
		handle      string
		want        string
	}{
		{"explicit override wins", "OpenClaw Docs", true, "nick", "OpenClaw Docs"},
		{"x with handle", "", true, "nickbaumann_", "@nickbaumann_ on X"},
		{"x missing handle", "", true, "", "X (handle missing)"},
		{"generic with hostname", "", false, "docs.openclaw.ai", "docs.openclaw.ai"},
		{"all empty fallback", "", false, "", "Unknown source"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := NewState()
			s.SourceLabel = c.label
			s.SourceIsX = c.isX
			s.AuthorHandle = c.handle
			got := s.ResolveSourceField()
			if got != c.want {
				t.Errorf("ResolveSourceField() = %q, want %q", got, c.want)
			}
		})
	}
}

func TestReview_WritesFile(t *testing.T) {
	s, fake, workDir := newTestState(t)
	fake.WithResponses(
		llm.FakeResponse{
			Output:    "- Issue 1: Major — fake finding\n",
			WriteFile: "review.md",
		},
	)
	if err := s.Review(context.Background()); err != nil {
		t.Fatalf("Review: %v", err)
	}
	if _, err := os.Stat(filepath.Join(workDir, "review.md")); err != nil {
		t.Errorf("review.md missing: %v", err)
	}
}

func TestRefine_WritesFinal(t *testing.T) {
	s, fake, workDir := newTestState(t)
	fake.WithResponses(
		llm.FakeResponse{
			Output:    "---\ntitle: \"Fake Refined\"\n---\nfinal body\n",
			WriteFile: "final.mdx",
		},
	)
	if err := s.Refine(context.Background()); err != nil {
		t.Fatalf("Refine: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(workDir, "final.mdx"))
	if err != nil {
		t.Fatalf("final.mdx missing: %v", err)
	}
	if !strings.Contains(string(data), "Fake Refined") {
		t.Errorf("final.mdx content unexpected: %q", data)
	}
}

func TestRefine_ResumeFromDraft(t *testing.T) {
	s, _, workDir := newTestState(t)
	draftPath := filepath.Join(workDir, "draft-v1.mdx")
	if err := os.WriteFile(draftPath, []byte("---\ntitle: Existing\n---\nbody\n"), 0o644); err != nil {
		t.Fatalf("seed draft: %v", err)
	}
	s.FromStepInt = StepRalph // skip refine
	if err := s.Refine(context.Background()); err != nil {
		t.Fatalf("Refine (skipped): %v", err)
	}
	finalPath := filepath.Join(workDir, "final.mdx")
	if _, err := os.Stat(finalPath); err != nil {
		t.Errorf("final.mdx should have been copied from draft: %v", err)
	}
}
