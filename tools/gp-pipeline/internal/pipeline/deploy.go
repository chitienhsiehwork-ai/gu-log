package pipeline

import (
	"context"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/deploy"
)

// Deploy is pipeline Step 5. It delegates the
// heavy lifting to the deploy package and copies the resulting final ticket
// + filenames back onto the State for the summary report.
//
// Honors s.DryRun (entirely skips deploy), s.FromStepInt (skipped when the
// caller starts later than StepDeploy, which never happens but is kept for
// symmetry with other State methods). Existing-file recovery skips allocation
// and rename, but still validates, builds, commits, and pushes owned changes.
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
		if err := s.prepareExistingPost(); err != nil {
			return err
		}
		s.Log.Info("  Publishing existing file without counter bump or rename")
		res, err := deploy.RunExisting(ctx, deploy.Options{
			Cfg:              s.Cfg,
			Log:              s.Log,
			ActiveFilename:   s.ActiveFilename,
			ActiveENFilename: s.ActiveENFilename,
			Title:            s.Title,
			TicketID:         s.PromptTicketID,
			SkipBuild:        s.SkipBuild,
			SkipPush:         s.SkipPush,
			SkipValidate:     s.SkipValidate,
		})
		if err != nil {
			return deployStepError(err)
		}
		s.Filename = res.Filename
		s.ENFilename = res.ENFilename
		s.ActiveFilename = res.Filename
		s.ActiveENFilename = res.ENFilename
		if res.PromptTicketID != "" {
			s.PromptTicketID = res.PromptTicketID
		}
		s.Log.OK("Step 5: published existing %s", s.PromptTicketID)
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
		return deployStepError(err)
	}

	s.TicketNumber = res.TicketNumber
	s.PromptTicketID = res.PromptTicketID
	s.Filename = res.Filename
	s.ENFilename = res.ENFilename
	s.ActiveFilename = res.Filename
	s.ActiveENFilename = res.ENFilename
	s.Log.OK("Step 5: deployed %s", res.PromptTicketID)
	return nil
}

func deployStepError(err error) error {
	// Map deploy errors to the documented exit codes. The deploy package
	// wraps subprocess errors with stable prefixes.
	code := 1
	msg := err.Error()
	switch {
	case contains(msg, "validate-posts rejected"):
		code = 16
	case contains(msg, "pnpm run build"):
		code = 17
	case contains(msg, "git push"):
		code = 18
	}
	return NewStepError(code, err)
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
