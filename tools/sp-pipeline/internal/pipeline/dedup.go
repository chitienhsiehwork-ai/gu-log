package pipeline

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/dedup"
)

// Dedup is the Go port of scripts/sp-pipeline.sh Step 1.7. It wraps
// scripts/dedup-gate.mjs via internal/dedup and sets s.DedupVerdict for
// downstream logging. A BLOCK verdict returns StepError{Code:13}, which
// the cmd layer maps to exit code 13.
//
// When run inside the orchestrator, the dedup title is taken from
// s.SuggestedTitle (populated by Eval). Callers that do not run Eval
// (e.g. the standalone `sp-pipeline dedup` subcommand) populate the title
// themselves.
func (s *State) Dedup(ctx context.Context) error {
	if s.shouldSkipBelow(StepDedup) {
		s.Log.Info("Step 1.7: dedup gate — SKIPPED (--from-step)")
		return nil
	}
	if s.TweetURL == "" && s.SuggestedTitle == "" {
		s.Log.Warn("Step 1.7: dedup — skipping (no URL or title to check)")
		return nil
	}

	s.Log.Info("Step 1.7: dedup gate")

	scriptPath := filepath.Join(s.Cfg.ScriptsDir, "dedup-gate.mjs")
	result, err := dedup.Check(ctx, dedup.Options{
		ScriptPath: scriptPath,
		URL:        s.TweetURL,
		Title:      s.SuggestedTitle,
		Series:     s.Prefix,
	})
	if err != nil {
		// Gate failures (not BLOCK verdicts — real crashes) bubble as
		// generic errors; the caller can decide to retry.
		return fmt.Errorf("dedup: %w", err)
	}
	s.DedupVerdict = string(result.Verdict)
	switch result.Verdict {
	case dedup.VerdictPass:
		s.Log.OK("Step 1.7 dedup: PASS")
		return nil
	case dedup.VerdictWarn:
		s.Log.Warn("Step 1.7 dedup: WARN — %d potential match(es) (advisory)", len(result.Matches))
		return nil
	case dedup.VerdictBlock:
		for _, m := range result.Matches {
			s.Log.Warn("  match: %s", m)
		}
		return NewStepError(13, fmt.Errorf("dedup: BLOCK (%d match(es))", len(result.Matches)))
	default:
		return fmt.Errorf("dedup: unknown verdict %q", result.Verdict)
	}
}
