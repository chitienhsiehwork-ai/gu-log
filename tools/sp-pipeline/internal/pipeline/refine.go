package pipeline

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/prompts"
)

// Refine is the Go port of scripts/sp-pipeline.sh Step 4. It renders the
// refine.tmpl prompt and runs it with WorkDir set so the LLM can read
// draft-v1.mdx + review.md from the same directory and write final.mdx.
//
// When skipped via --from-step, final.mdx is populated by copying from
// either the existing posts file (when --file is set) or draft-v1.mdx
// (when resuming after a failed refine), matching the bash fall-through
// at lines 1110-1120.
func (s *State) Refine(ctx context.Context) error {
	finalPath := filepath.Join(s.WorkDir, "final.mdx")

	if s.shouldSkipBelow(StepRefine) {
		s.Log.Info("Step 4: refine draft — SKIPPED (--from-step)")
		return s.resumeFinal(finalPath)
	}

	s.Log.Info("Step 4: refine")

	prompt, err := prompts.Render("refine", prompts.RefineData{
		TicketID: s.PromptTicketID,
	})
	if err != nil {
		return fmt.Errorf("refine: render prompt: %w", err)
	}

	res, err := s.Dispatcher.Run(ctx, prompt, llm.RunOptions{WorkDir: s.WorkDir})
	if err != nil {
		return NewStepError(14, fmt.Errorf("refine: dispatcher failed: %w", err))
	}

	info, statErr := os.Stat(finalPath)
	if statErr != nil || info.Size() == 0 {
		if len(res.Output) == 0 {
			return fmt.Errorf("refine: final.mdx missing or empty and dispatcher returned no stdout")
		}
		if err := os.WriteFile(finalPath, []byte(res.Output), 0o644); err != nil {
			return fmt.Errorf("refine: write fallback final.mdx: %w", err)
		}
	}

	s.RefineModel = llm.DisplayName(res.Model)
	s.RefineHarness = llm.HarnessName(res.Model)
	s.Log.OK("Step 4: final.mdx written by %s", s.RefineModel)
	return nil
}

func (s *State) resumeFinal(finalPath string) error {
	if _, err := os.Stat(finalPath); err == nil {
		return nil
	}
	var src string
	switch {
	case s.ExistingFile != "":
		src = filepath.Join(s.Cfg.PostsDir, s.ExistingFile)
	default:
		src = filepath.Join(s.WorkDir, "draft-v1.mdx")
	}
	data, err := os.ReadFile(src)
	if err != nil {
		return fmt.Errorf("refine: resume from %s: %w", src, err)
	}
	if err := os.WriteFile(finalPath, data, 0o644); err != nil {
		return fmt.Errorf("refine: copy to final.mdx: %w", err)
	}
	s.Log.Info("  Using existing content as final.mdx")
	return nil
}
