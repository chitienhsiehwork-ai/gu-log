package pipeline

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/prompts"
)

// Translate is the automated en-sidecar step referenced by gu-log #546:
// the pipeline's root help used to claim `write` produces a zh-tw + en
// MDX pair, but no Go step ever produced the en file — it was a fully
// manual step a human/coordinating agent did by hand.
//
// Translate reuses the same writer LLM chain as Write/Refine
// (ClaudeOpusPinned) to translate a tribunal-passed zh-tw article
// (postsDir/s.ActiveFilename) into its en sidecar
// (postsDir/s.ActiveENFilename), matching CONTRIBUTING.md's zh-tw-first
// SOP: translation only happens AFTER the zh-tw article has passed the
// tribunal, never on an unstable draft.
//
// When s.RalphPassed is false, Translate is a no-op (logged, not an
// error) — Deploy keeps its existing best-effort semantics of shipping
// zh-tw only when the tribunal didn't pass.
func (s *State) Translate(ctx context.Context) error {
	if s.shouldSkipBelow(StepTranslate) {
		s.Log.Info("Step 4.8: translate — SKIPPED (--from-step)")
		return nil
	}

	s.Log.Info("Step 4.8: translate")

	if !s.RalphPassed {
		s.Log.Warn("  Tribunal did not pass — skipping en translation, deploying zh-tw only")
		return nil
	}
	if s.ActiveFilename == "" {
		return fmt.Errorf("translate: ActiveFilename is empty")
	}

	postsDir := s.Cfg.PostsDir
	sourcePath := filepath.Join(postsDir, s.ActiveFilename)
	source, err := os.ReadFile(sourcePath)
	if err != nil {
		return fmt.Errorf("translate: read %s: %w", sourcePath, err)
	}

	disp := s.writerDispatcher()
	if disp == nil {
		return fmt.Errorf("translate: writer dispatcher is nil")
	}
	prompt, err := prompts.Render("translate", prompts.TranslateData{
		TicketID: s.PromptTicketID,
		Source:   string(source),
	})
	if err != nil {
		return fmt.Errorf("translate: render prompt: %w", err)
	}

	res, err := disp.Run(ctx, prompt, llm.RunOptions{WorkDir: s.WorkDir})
	if err != nil {
		return NewStepError(14, fmt.Errorf("translate: dispatcher failed: %w", err))
	}

	translatedPath := filepath.Join(s.WorkDir, "translated-en.mdx")
	translated, statErr := os.ReadFile(translatedPath)
	if statErr != nil || len(translated) == 0 {
		if len(res.Output) == 0 {
			return fmt.Errorf("translate: translated-en.mdx missing or empty and dispatcher returned no stdout")
		}
		translated = []byte(res.Output)
	}

	if s.ActiveENFilename == "" {
		s.ActiveENFilename = "en-" + s.ActiveFilename
	}
	enPath := filepath.Join(postsDir, s.ActiveENFilename)
	if err := os.WriteFile(enPath, translated, 0o644); err != nil {
		return fmt.Errorf("translate: write %s: %w", enPath, err)
	}

	s.Log.OK("Step 4.8: %s written by %s", s.ActiveENFilename, llm.DisplayName(res.ActualModel))
	return nil
}
