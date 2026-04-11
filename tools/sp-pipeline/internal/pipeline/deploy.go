package pipeline

import (
	"context"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/deploy"
)

// Deploy is the Go port of scripts/sp-pipeline.sh Step 5. It delegates the
// heavy lifting to the deploy package and copies the resulting final ticket
// + filenames back onto the State for the summary report.
//
// Honors s.DryRun (entirely skips deploy), s.FromStepInt (skipped when the
// caller starts later than StepDeploy, which never happens but is kept for
// symmetry with other State methods), and s.ExistingFile (which makes the
// counter bump a no-op — if the user is resuming an existing file, no new
// ticket is allocated).
func (s *State) Deploy(ctx context.Context) error {
	if s.DryRun {
		s.Log.Warn("--dry-run enabled; skipping deploy step")
		return nil
	}
	if s.shouldSkipBelow(StepDeploy) {
		s.Log.Info("Step 5: deploy — SKIPPED (--from-step)")
		return nil
	}

	s.Log.Info("Step 5: deploy")

	if s.ExistingFile != "" {
		s.Log.Info("  Skipping counter bump (--file resume)")
		// No ticket allocation — just leave the active filename as-is.
		// The bash pipeline also does nothing in this branch; we match it.
		return nil
	}

	res, err := deploy.Run(ctx, deploy.Options{
		Cfg:              s.Cfg,
		Log:              s.Log,
		Counter:          s.Counter,
		Prefix:           s.Prefix,
		ActiveFilename:   s.ActiveFilename,
		ActiveENFilename: s.ActiveENFilename,
		DateStamp:        s.DateStamp,
		AuthorSlug:       s.AuthorSlug,
		TitleSlug:        s.TitleSlug,
		Title:            s.Title,
		SkipBuild:        s.SkipBuild,
		SkipPush:         s.SkipPush,
		SkipValidate:     s.SkipValidate,
	})
	if err != nil {
		// Map deploy errors to the documented exit codes. The deploy
		// package already wraps subprocess errors with descriptive
		// prefixes ("npm run build failed", "git push:", etc.) so we
		// match against those substrings to pick the right code.
		code := 1
		msg := err.Error()
		switch {
		case contains(msg, "validate-posts rejected"):
			code = 16
		case contains(msg, "npm run build"):
			code = 17
		case contains(msg, "git push"):
			code = 18
		}
		return NewStepError(code, err)
	}

	s.SPNumber = res.SPNumber
	s.PromptTicketID = res.PromptTicketID
	s.Filename = res.Filename
	s.ENFilename = res.ENFilename
	s.ActiveFilename = res.Filename
	s.ActiveENFilename = res.ENFilename
	s.Log.OK("Step 5: deployed %s", res.PromptTicketID)
	return nil
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
