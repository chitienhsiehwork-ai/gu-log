package pipeline

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/prompts"
)

// Refine is pipeline Step 4. It renders the
// refine.tmpl prompt and runs it with WorkDir set so the LLM can read
// draft-v1.mdx, review.md, and the staged canonical editorial inputs from
// the same directory before writing final.mdx.
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
	if err := s.refine(ctx, prompts.RefineData{}); err != nil {
		return err
	}
	s.Log.OK("Step 4: final.mdx written by %s", s.RefineModel)
	return nil
}

// refine runs the writer with the refine prompt and leaves its output in
// final.mdx. data.Draft names the input (draft-v1.mdx when empty); a GP
// source-distance rewrite also sets data.RewriteReport. A GP's output must
// then pass the content checks before anything stamps it (see
// fixContentLint).
func (s *State) refine(ctx context.Context, data prompts.RefineData) error {
	if err := s.runRefine(ctx, data); err != nil {
		return err
	}
	if s.Prefix != "GP" {
		return nil
	}
	return s.fixContentLint(ctx)
}

// runRefine is one writer call with the refine prompt; its output lands in
// final.mdx.
func (s *State) runRefine(ctx context.Context, data prompts.RefineData) error {
	finalPath := filepath.Join(s.WorkDir, "final.mdx")
	if err := s.stageEditorialContext(); err != nil {
		return fmt.Errorf("refine: %w", err)
	}

	terms, err := s.gpTerminology()
	if err != nil {
		return fmt.Errorf("refine: %w", err)
	}
	data.Prefix = s.Prefix
	data.TicketID = s.PromptTicketID
	data.Angle = s.Angle
	data.Terminology = terms
	prompt, err := prompts.Render("refine", data)
	if err != nil {
		return fmt.Errorf("refine: render prompt: %w", err)
	}

	disp := s.writerDispatcher()
	if disp == nil {
		return fmt.Errorf("refine: writer dispatcher is nil")
	}
	res, err := disp.Run(ctx, prompt, llm.RunOptions{WorkDir: s.WorkDir})
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
	if err := s.rejectShroomDogNote("refine", finalPath); err != nil {
		return err
	}

	s.RefineModel = llm.DisplayName(res.ActualModel)
	s.RefineHarness = llm.HarnessName(res.Model)
	return nil
}

// refineFrom copies final.mdx to draftFile and runs run, which refines that
// draft into a new final.mdx. final.mdx is removed first: refine falls back to
// the writer's stdout only when final.mdx is absent, so a writer that returns
// without writing cannot pass the old article off as its output. When run
// fails without writing, the old article goes back to final.mdx, so a resumed
// run starts from it instead of an unrefined draft.
func (s *State) refineFrom(ctx context.Context, draftFile string, run func(context.Context) error) error {
	finalPath := filepath.Join(s.WorkDir, "final.mdx")
	article, err := os.ReadFile(finalPath)
	if err != nil {
		return fmt.Errorf("refine: read final.mdx: %w", err)
	}
	if err := os.WriteFile(filepath.Join(s.WorkDir, draftFile), article, 0o644); err != nil {
		return fmt.Errorf("refine: stage %s: %w", draftFile, err)
	}
	if err := os.Remove(finalPath); err != nil {
		return fmt.Errorf("refine: clear final.mdx before refining %s: %w", draftFile, err)
	}
	if err := run(ctx); err != nil {
		if _, statErr := os.Stat(finalPath); os.IsNotExist(statErr) {
			_ = os.WriteFile(finalPath, article, 0o644)
		}
		return err
	}
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
