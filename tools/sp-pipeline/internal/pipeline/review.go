package pipeline

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/prompts"
)

// Review is the Go port of scripts/sp-pipeline.sh Step 3. It renders the
// review.tmpl prompt and runs it through the dispatcher with WorkDir set
// so the LLM can read draft-v1.mdx by relative path and write review.md
// to the same directory. The review prompt does NOT embed the draft text
// or the style guide contents — the LLM is expected to read them from
// disk in the work dir, matching bash semantics.
func (s *State) Review(ctx context.Context) error {
	reviewPath := filepath.Join(s.WorkDir, "review.md")

	if s.shouldSkipBelow(StepReview) {
		s.Log.Info("Step 3: codex review — SKIPPED (--from-step)")
		return nil
	}

	s.Log.Info("Step 3: review")

	prompt, err := prompts.Render("review", prompts.ReviewData{
		TicketID: s.PromptTicketID,
	})
	if err != nil {
		return fmt.Errorf("review: render prompt: %w", err)
	}

	res, err := s.Dispatcher.Run(ctx, prompt, llm.RunOptions{WorkDir: s.WorkDir})
	if err != nil {
		return NewStepError(14, fmt.Errorf("review: dispatcher failed: %w", err))
	}

	// Mirror the Write fallback: if the LLM did not write review.md
	// directly, spill stdout into the file.
	info, statErr := os.Stat(reviewPath)
	if statErr != nil || info.Size() == 0 {
		if len(res.Output) == 0 {
			return fmt.Errorf("review: review.md missing or empty and dispatcher returned no stdout")
		}
		if err := os.WriteFile(reviewPath, []byte(res.Output), 0o644); err != nil {
			return fmt.Errorf("review: write fallback review.md: %w", err)
		}
	}

	s.ReviewModel = llm.DisplayName(res.Model)
	s.ReviewHarness = llm.HarnessName(res.Model)
	s.Log.OK("Step 3: review.md written by %s", s.ReviewModel)
	return nil
}
