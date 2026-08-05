package pipeline

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/deploy"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/frontmatter"
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

	if err := s.hydrateTitleFromActiveFile(); err != nil {
		return err
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

// hydrateTitleFromActiveFile fills s.Title from the pending article's own
// frontmatter when nothing upstream set it.
//
// State.Title is documented as "extracted from the draft frontmatter by
// Ralph", which holds for the full `run` pipeline. Standalone `deploy` starts
// after ralph, so Title was always empty there and deploy.Run's
// `Add <ticket>: <title>` template produced a commit subject that stopped at
// the colon. The title is right there in the file being deployed; read it.
//
// A missing or unreadable title is not fatal here — validate-posts runs inside
// deploy and owns that verdict. This only degrades to the previous behaviour.
func (s *State) hydrateTitleFromActiveFile() error {
	if s.Title != "" || s.ActiveFilename == "" {
		return nil
	}
	path := filepath.Join(s.Cfg.PostsDir, s.ActiveFilename)
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("deploy: read %s: %w", path, err)
	}
	f, err := frontmatter.Parse(data)
	if err != nil {
		return fmt.Errorf("deploy: parse %s frontmatter: %w", path, err)
	}
	raw, ok := f.GetScalar("title")
	if !ok {
		s.Log.Warn("  %s has no frontmatter title; commit subject will omit it", s.ActiveFilename)
		return nil
	}
	title, err := decodeYAMLScalar(raw)
	if err != nil || title == "" {
		s.Log.Warn("  %s has an unreadable frontmatter title %q; commit subject will omit it", s.ActiveFilename, raw)
		return nil
	}
	s.Title = title
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
