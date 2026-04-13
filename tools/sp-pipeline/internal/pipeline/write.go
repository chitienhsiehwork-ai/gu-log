package pipeline

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/prompts"
)

// Write is the Go port of scripts/sp-pipeline.sh Step 2. It renders the
// write.tmpl prompt (embedding WRITING_GUIDELINES.md + source-tweet.md via
// template variables instead of bash $(cat ...)), runs it through the
// dispatcher with WorkDir set so the LLM's "write output to draft-v1.mdx
// in the current directory" instruction lands correctly, and then checks
// the output file is non-empty.
//
// On successful write, s.WriteModel / s.WriteHarness are populated from
// the dispatcher result so Credits (Step 4.6) can stamp the frontmatter.
//
// Honors s.FromStepInt — when skipped, the step falls back to copying
// s.ExistingFile into $WORK_DIR/draft-v1.mdx so later steps have an input.
func (s *State) Write(ctx context.Context) error {
	draftPath := filepath.Join(s.WorkDir, "draft-v1.mdx")

	if s.shouldSkipBelow(StepWrite) {
		s.Log.Info("Step 2: write draft — SKIPPED (--from-step)")
		return s.resumeDraft(draftPath)
	}

	s.Log.Info("Step 2: write draft")

	source, err := os.ReadFile(s.SourcePath)
	if err != nil {
		return fmt.Errorf("write: read source: %w", err)
	}
	styleGuide, err := os.ReadFile(s.Cfg.WritingGuide)
	if err != nil {
		return fmt.Errorf("write: read writing guidelines: %w", err)
	}
	if s.TranslatedDate == "" {
		s.TranslatedDate = time.Now().Format("2006-01-02")
	}
	if s.PromptTicketID == "" {
		s.PromptTicketID = "PENDING"
	}

	prompt, err := prompts.Render("write", prompts.WriteData{
		TicketID:       s.PromptTicketID,
		OriginalDate:   s.OriginalDate,
		TranslatedDate: s.TranslatedDate,
		AuthorHandle:   s.AuthorHandle,
		TweetURL:       s.TweetURL,
		FirstTag:       s.firstTag(),
		StyleGuide:     string(styleGuide),
		Source:         string(source),
	})
	if err != nil {
		return fmt.Errorf("write: render prompt: %w", err)
	}

	res, err := s.Dispatcher.Run(ctx, prompt, llm.RunOptions{WorkDir: s.WorkDir})
	if err != nil {
		return NewStepError(14, fmt.Errorf("write: dispatcher failed: %w", err))
	}

	// The bash pipeline trusts the LLM to write draft-v1.mdx in the work
	// dir. Some providers also stream the draft to stdout. If the LLM did
	// not write the file (common with the CCC FakeProvider unless the
	// fake response has WriteFile set), fall back to the stdout.
	info, statErr := os.Stat(draftPath)
	if statErr != nil || info.Size() == 0 {
		if len(res.Output) == 0 {
			return fmt.Errorf("write: draft-v1.mdx missing or empty and dispatcher returned no stdout")
		}
		if err := os.WriteFile(draftPath, []byte(res.Output), 0o644); err != nil {
			return fmt.Errorf("write: write fallback draft: %w", err)
		}
	}

	s.WriteModel = llm.DisplayName(res.Model)
	s.WriteHarness = llm.HarnessName(res.Model)
	s.Log.OK("Step 2: draft-v1.mdx written by %s", s.WriteModel)
	return nil
}

// resumeDraft is called when Step 2 is skipped via --from-step. It copies
// the existing post file (or the already-present draft-v1.mdx) into the
// work dir so later steps have something to operate on.
func (s *State) resumeDraft(draftPath string) error {
	if _, err := os.Stat(draftPath); err == nil {
		return nil // already there
	}
	if s.ExistingFile == "" {
		return nil // nothing to copy; later steps will fail if they need draft
	}
	src := filepath.Join(s.Cfg.PostsDir, s.ExistingFile)
	data, err := os.ReadFile(src)
	if err != nil {
		return fmt.Errorf("write: resume from %s: %w", src, err)
	}
	if err := os.WriteFile(draftPath, data, 0o644); err != nil {
		return fmt.Errorf("write: copy existing to draft-v1.mdx: %w", err)
	}
	s.Log.Info("  Copied existing file as draft-v1.mdx")
	return nil
}
