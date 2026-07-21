package pipeline

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/logx"
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
ticketId: "GP-252"
lang: "zh-tw"
source: "Simon Willison's Weblog"
sourceUrl: "https://example.com/post"
---
zh-tw body
`
	if err := os.WriteFile(filepath.Join(postsDir, "gp-252-20260717-fake-title.mdx"), []byte(zhContent), 0o644); err != nil {
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
	s.ActiveFilename = "gp-252-20260717-fake-title.mdx"
	s.PromptTicketID = "GP-252"
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
ticketId: "GP-252"
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
	if s.ActiveENFilename != "en-gp-252-20260717-fake-title.mdx" {
		t.Errorf("ActiveENFilename = %q, want en-gp-252-20260717-fake-title.mdx", s.ActiveENFilename)
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

func TestValidateTranslationFilenamesCanonicalFamiliesAndRetiredIngress(t *testing.T) {
	for _, filename := range []string{
		"gp-7-example.mdx",
		"mp-9-example.mdx",
		"sd-3-example.mdx",
		"lv-2-example.mdx",
		"levelup-20260213-01-oauth-complete-guide.mdx",
		"levelup-20260701-core-dump-anatomy.mdx",
	} {
		t.Run(filename, func(t *testing.T) {
			if _, err := ValidateTranslationFilenames(filename, "en-"+filename); err != nil {
				t.Fatalf("canonical filename rejected: %v", err)
			}
		})
	}

	for _, tc := range []struct {
		name string
		slug string
		hint string
	}{
		{name: "retired GP predecessor", slug: strings.ToLower("S" + "P"), hint: `use "GP"`},
		{name: "retired MP predecessor", slug: strings.ToLower("C" + "P"), hint: `use "MP"`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			filename := tc.slug + "-7-example.mdx"
			if _, err := ValidateTranslationFilenames(filename, ""); err == nil || !strings.Contains(err.Error(), tc.hint) {
				t.Fatalf("error = %v, want actionable hint %q", err, tc.hint)
			}
			if _, err := ValidateTranslationFilenames("gp-7-example.mdx", "en-"+filename); err == nil {
				t.Fatalf("legacy English output %q should be rejected", "en-"+filename)
			}
		})
	}
}

func TestValidateTranslationTicketIdentityExistingLevelupPatterns(t *testing.T) {
	for _, tc := range []struct {
		filename string
		ticketID string
	}{
		{filename: "levelup-20260213-01-oauth-complete-guide.mdx", ticketID: "Lv-01"},
		{filename: "levelup-20260701-core-dump-anatomy.mdx", ticketID: "Lv-13"},
	} {
		t.Run(tc.filename, func(t *testing.T) {
			if err := ValidateTranslationTicketIdentity(tc.filename, tc.ticketID); err != nil {
				t.Fatalf("existing Lv identity rejected: %v", err)
			}
		})
	}

	if err := ValidateTranslationTicketIdentity("levelup-20260701-core-dump-anatomy.mdx", "GP-13"); err == nil {
		t.Fatal("existing Lv filename accepted a non-Lv ticket namespace")
	}
	if err := ValidateTranslationTicketIdentity("levelup-20260701-core-dump-anatomy.mdx", "Lv-PENDING"); err == nil {
		t.Fatal("existing allocated Lv filename accepted Lv-PENDING")
	}
}

func TestTranslate_FromStepTranslateSupportsExistingLevelupFilename(t *testing.T) {
	s, fake, postsDir := newTranslateTestState(t)
	const filename = "levelup-20260701-core-dump-anatomy.mdx"
	const ticketID = "Lv-13"
	zhBody := `---
title: "Core Dump Anatomy"
ticketId: "Lv-13"
lang: "zh-tw"
---
zh-tw body
`
	if err := os.WriteFile(filepath.Join(postsDir, filename), []byte(zhBody), 0o644); err != nil {
		t.Fatal(err)
	}
	fake.WithResponses(llm.FakeResponse{Output: `---
title: "Core Dump Anatomy"
ticketId: "Lv-13"
lang: "en"
---
en body
`})
	s.FromStepInt = StepTranslate
	s.ExistingFile = filename
	s.ActiveFilename = ""
	s.ActiveENFilename = ""
	s.RalphPassed = false

	if err := s.Translate(context.Background()); err != nil {
		t.Fatalf("Translate existing levelup file: %v", err)
	}
	if s.PromptTicketID != ticketID {
		t.Fatalf("PromptTicketID = %q, want %q", s.PromptTicketID, ticketID)
	}
	if s.ActiveENFilename != "en-"+filename {
		t.Fatalf("ActiveENFilename = %q, want %q", s.ActiveENFilename, "en-"+filename)
	}
	if _, err := os.Stat(filepath.Join(postsDir, s.ActiveENFilename)); err != nil {
		t.Fatalf("existing Lv sidecar not written: %v", err)
	}
}

func TestTranslate_RejectsRetiredFrontmatterTicketBeforeLLMOrSidecar(t *testing.T) {
	s, fake, postsDir := newTranslateTestState(t)
	s.FromStepInt = StepTranslate
	s.ExistingFile = s.ActiveFilename
	s.ActiveFilename = ""
	s.ActiveENFilename = ""

	retiredTicket := "S" + "P-252"
	path := filepath.Join(postsDir, s.ExistingFile)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	data = []byte(strings.Replace(string(data), "GP-252", retiredTicket, 1))
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}

	err = s.Translate(context.Background())
	if err == nil || !strings.Contains(err.Error(), `use "GP-252"`) {
		t.Fatalf("error = %v, want retired-ticket diagnostic", err)
	}
	if len(fake.Called) != 0 {
		t.Fatalf("dispatcher called before taxonomy rejection: %d call(s)", len(fake.Called))
	}
	if _, err := os.Stat(filepath.Join(postsDir, "en-"+s.ExistingFile)); !os.IsNotExist(err) {
		t.Fatalf("retired ticket produced an English sidecar: %v", err)
	}
}

func TestTranslate_RejectsPendingTicketForAllocatedFilename(t *testing.T) {
	s, fake, postsDir := newTranslateTestState(t)
	s.FromStepInt = StepTranslate
	s.ExistingFile = s.ActiveFilename
	s.ActiveFilename = ""
	s.ActiveENFilename = ""

	path := filepath.Join(postsDir, s.ExistingFile)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	data = []byte(strings.Replace(string(data), "GP-252", "GP-PENDING", 1))
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}

	err = s.Translate(context.Background())
	if err == nil || !strings.Contains(err.Error(), `requires ticketId "GP-252"`) {
		t.Fatalf("error = %v, want allocated filename/ticket mismatch diagnostic", err)
	}
	if len(fake.Called) != 0 {
		t.Fatalf("dispatcher called before identity rejection: %d call(s)", len(fake.Called))
	}
	if _, err := os.Stat(filepath.Join(postsDir, "en-"+s.ExistingFile)); !os.IsNotExist(err) {
		t.Fatalf("mismatched pending ticket produced an English sidecar: %v", err)
	}
}

func TestTranslate_ProducesENSidecar(t *testing.T) {
	s, fake, postsDir := newTranslateTestState(t)
	s.RalphPassed = true

	enBody := `---
title: "Fake Title"
ticketId: "GP-252"
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
	if s.ActiveENFilename != "en-gp-252-20260717-fake-title.mdx" {
		t.Errorf("ActiveENFilename = %q, want en-gp-252-20260717-fake-title.mdx", s.ActiveENFilename)
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
