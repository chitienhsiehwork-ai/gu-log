package pipeline

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/source"
)

// Fetch is the Go port of scripts/sp-pipeline.sh Step 1. It shells out to
// the existing scripts/fetch-x-article.sh via the source package, then
// populates SourcePath / AuthorHandle / OriginalDate for downstream steps.
//
// When skipped via --from-step, the step is a no-op and the caller is
// expected to have set SourcePath manually (or to have used --file so
// later steps read from src/content/posts directly).
func (s *State) Fetch(ctx context.Context) error {
	if s.shouldSkipBelow(StepFetch) {
		s.Log.Info("Step 1: fetch content — SKIPPED (--from-step)")
		return nil
	}
	if s.TweetURL == "" {
		return fmt.Errorf("fetch: TweetURL is empty; nothing to fetch")
	}
	if s.WorkDir == "" {
		return fmt.Errorf("fetch: WorkDir must be set before Fetch runs")
	}
	if err := os.MkdirAll(s.WorkDir, 0o755); err != nil {
		return fmt.Errorf("fetch: mkdir work-dir: %w", err)
	}

	s.Log.Info("Step 1: fetch content")

	// If source-tweet.md already exists (--from-step resume or manual
	// seeding), trust it and skip the network call. The bash pipeline
	// has a similar early-return at lines 620-640 but with a KEEP/REFETCH
	// Claude prompt; the Go port takes the simpler "if it exists, keep it"
	// path, which matches PIPELINE_SOURCE_KEEP=1 behavior.
	candidate := filepath.Join(s.WorkDir, "source-tweet.md")
	if info, err := os.Stat(candidate); err == nil && info.Size() > 0 {
		s.Log.Info("  source-tweet.md already present; keeping")
		s.SourcePath = candidate
		return nil
	}

	res, err := source.Fetch(ctx, s.TweetURL, source.FetchOptions{
		WorkDir:             s.WorkDir,
		FetchXArticleScript: s.Cfg.FetchXArticle,
	})
	if err != nil {
		code := 10
		if source.IsValidationError(err) {
			code = 11
		}
		return NewStepError(code, fmt.Errorf("fetch: %w", err))
	}
	s.SourcePath = res.Path
	// The handle comes back as "@foo" from parseCaptureHeader; drop the @.
	if len(res.Handle) > 1 && res.Handle[0] == '@' {
		s.AuthorHandle = res.Handle[1:]
	}
	s.OriginalDate = res.Date
	s.SourceIsX = res.IsX
	s.Log.OK("Step 1: captured %d bytes from %s via %s", res.Bytes, res.Handle, res.FetchedVia)
	return nil
}
