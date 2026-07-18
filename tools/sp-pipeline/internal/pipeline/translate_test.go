package pipeline

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/logx"
)

func newTranslateTestState(t *testing.T) (*State, *llm.FakeProvider, string) {
	t.Helper()
	tmp := t.TempDir()
	postsDir := filepath.Join(tmp, "posts")
	workDir := filepath.Join(tmp, "work")
	for _, d := range []string{postsDir, workDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	zhContent := `---
title: "Fake Title"
ticketId: "SP-252"
lang: "zh-tw"
source: "Simon Willison's Weblog"
sourceUrl: "https://example.com/post"
---
zh-tw body
`
	if err := os.WriteFile(filepath.Join(postsDir, "sp-252-20260717-fake-title.mdx"), []byte(zhContent), 0o644); err != nil {
		t.Fatal(err)
	}

	fake := llm.NewFakeClaude()
	disp, err := llm.NewDispatcher(logx.New(), fake)
	if err != nil {
		t.Fatal(err)
	}

	s := NewState()
	s.Log = logx.New()
	s.Cfg = &config.Config{RepoRoot: tmp, PostsDir: postsDir}
	s.WorkDir = workDir
	s.WriterDispatcher = disp
	s.Dispatcher = disp
	s.ActiveFilename = "sp-252-20260717-fake-title.mdx"
	s.PromptTicketID = "SP-252"
	return s, fake, postsDir
}

func TestTranslate_SkippedWhenRalphDidNotPass(t *testing.T) {
	s, fake, postsDir := newTranslateTestState(t)
	s.RalphPassed = false

	if err := s.Translate(context.Background()); err != nil {
		t.Fatalf("Translate should not error when RalphPassed is false, got %v", err)
	}
	if len(fake.Called) != 0 {
		t.Errorf("dispatcher should not have been called, got %d calls", len(fake.Called))
	}
	if s.ActiveENFilename != "" {
		t.Errorf("ActiveENFilename should remain empty, got %q", s.ActiveENFilename)
	}
	entries, _ := os.ReadDir(postsDir)
	if len(entries) != 1 {
		t.Errorf("posts dir should still have only the zh-tw file, got %d entries", len(entries))
	}
}

func TestTranslate_SkippedByFromStep(t *testing.T) {
	s, fake, _ := newTranslateTestState(t)
	s.RalphPassed = true
	s.FromStepInt = StepDeploy // resuming past translate

	if err := s.Translate(context.Background()); err != nil {
		t.Fatalf("Translate: %v", err)
	}
	if len(fake.Called) != 0 {
		t.Errorf("dispatcher should not have been called when skipped via --from-step, got %d calls", len(fake.Called))
	}
}

func TestTranslate_FromStepTranslateResumesExistingPassedFile(t *testing.T) {
	s, fake, postsDir := newTranslateTestState(t)
	s.FromStepInt = StepTranslate
	s.ExistingFile = s.ActiveFilename
	s.ActiveFilename = ""
	s.ActiveENFilename = ""
	s.RalphPassed = false

	enBody := `---
title: "Fake Title"
ticketId: "SP-252"
lang: "en"
source: "Simon Willison's Weblog"
sourceUrl: "https://example.com/post"
---
en body
`
	fake.WithResponses(llm.FakeResponse{
		Output:    enBody,
		WriteFile: "translated-en.mdx",
	})

	if err := s.Translate(context.Background()); err != nil {
		t.Fatalf("Translate: %v", err)
	}
	if !s.RalphPassed {
		t.Fatal("RalphPassed should be true when --from-step translate asserts an already-passed file")
	}
	if s.ActiveFilename != s.ExistingFile {
		t.Errorf("ActiveFilename = %q, want %q", s.ActiveFilename, s.ExistingFile)
	}
	if s.ActiveENFilename != "en-sp-252-20260717-fake-title.mdx" {
		t.Errorf("ActiveENFilename = %q, want en-sp-252-20260717-fake-title.mdx", s.ActiveENFilename)
	}
	if len(fake.Called) != 1 {
		t.Fatalf("expected exactly 1 dispatcher call, got %d", len(fake.Called))
	}
	data, err := os.ReadFile(filepath.Join(postsDir, s.ActiveENFilename))
	if err != nil {
		t.Fatalf("en sidecar not written: %v", err)
	}
	if !strings.Contains(string(data), `lang: "en"`) {
		t.Errorf("en sidecar missing lang: \"en\":\n%s", data)
	}
}

func TestTranslate_FromStepTranslateRequiresExistingFile(t *testing.T) {
	s, fake, _ := newTranslateTestState(t)
	s.FromStepInt = StepTranslate
	s.ExistingFile = ""
	s.ActiveFilename = ""
	s.RalphPassed = false

	err := s.Translate(context.Background())
	if err == nil {
		t.Fatal("Translate should reject --from-step translate without --file")
	}
	if !strings.Contains(err.Error(), "--file") {
		t.Fatalf("Translate error = %q, want --file guidance", err)
	}
	if len(fake.Called) != 0 {
		t.Errorf("dispatcher should not have been called, got %d calls", len(fake.Called))
	}
}

func TestTranslate_ProducesENSidecar(t *testing.T) {
	s, fake, postsDir := newTranslateTestState(t)
	s.RalphPassed = true

	enBody := `---
title: "Fake Title"
ticketId: "SP-252"
lang: "en"
source: "Simon Willison's Weblog"
sourceUrl: "https://example.com/post"
---
en body
`
	fake.WithResponses(llm.FakeResponse{
		Output:    enBody,
		WriteFile: "translated-en.mdx",
	})

	if err := s.Translate(context.Background()); err != nil {
		t.Fatalf("Translate: %v", err)
	}
	if s.ActiveENFilename != "en-sp-252-20260717-fake-title.mdx" {
		t.Errorf("ActiveENFilename = %q, want en-sp-252-20260717-fake-title.mdx", s.ActiveENFilename)
	}
	data, err := os.ReadFile(filepath.Join(postsDir, s.ActiveENFilename))
	if err != nil {
		t.Fatalf("en sidecar not written: %v", err)
	}
	if !strings.Contains(string(data), `lang: "en"`) {
		t.Errorf("en sidecar missing lang: \"en\":\n%s", data)
	}
	if len(fake.Called) != 1 {
		t.Fatalf("expected exactly 1 dispatcher call, got %d", len(fake.Called))
	}
	if !strings.Contains(fake.Called[0].Prompt, "Simon Willison's Weblog") {
		t.Errorf("prompt should embed the zh-tw source content")
	}
}
