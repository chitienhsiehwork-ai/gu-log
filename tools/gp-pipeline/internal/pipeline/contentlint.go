package pipeline

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/prompts"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/runner"
)

// A GP body has to pass the repo's zh-tw content checks (晶晶體, AI tells,
// pronouns) before the source-distance stamp: the stamp binds the body, so a
// fix that the pre-commit hook forces after stamping means pairing it all over
// again. Refine feeds what the checks flag back to the writer; the stamp step
// refuses a body that still fails them.

const (
	// MaxContentLintFixes caps the refine calls that fix what the content
	// checks flag in one refine.
	MaxContentLintFixes  = 2
	contentLintDraftFile = "lint-draft.mdx"
	contentLintDir       = "content-lint"
)

// contentLintScripts are the zh-tw content checks the pre-commit hook runs on
// a post (scripts/hooks/pre-commit); TestContentLintScriptsMatchPreCommitHook
// keeps the two lists together.
var contentLintScripts = []string{
	"check-pronoun-clarity.mjs",
	"check-jingjing.mjs",
	"check-ai-tells.mjs",
}

// contentLintReport runs the content checks on file and returns what they
// flagged, or "" when every check passes. A check that is missing or cannot
// run stops the step: it never counts as a pass.
func (s *State) contentLintReport(ctx context.Context, file string) (string, error) {
	var report strings.Builder
	for _, name := range contentLintScripts {
		script := filepath.Join(s.Cfg.ScriptsDir, name)
		if _, err := os.Stat(script); err != nil {
			return "", NewStepError(14, fmt.Errorf("content check %s: %w", name, err))
		}
		res, err := runner.RunWithOptions(ctx, runner.Options{
			Name:    "node",
			Args:    []string{script, file},
			WorkDir: s.Cfg.RepoRoot,
		})
		if err == nil {
			continue
		}
		if res == nil || res.ExitCode != 1 {
			return "", NewStepError(14, fmt.Errorf("content check %s could not run: %w", name, err))
		}
		fmt.Fprintf(&report, "### %s\n%s\n\n", name, strings.TrimSpace(string(res.Stdout)+"\n"+string(res.Stderr)))
	}
	return strings.TrimSpace(report.String()), nil
}

// fixContentLint sends what the content checks flag in final.mdx back to
// refine, at most MaxContentLintFixes times, and stops the step when the
// checks still fail after that.
func (s *State) fixContentLint(ctx context.Context) error {
	finalPath := filepath.Join(s.WorkDir, "final.mdx")
	for fix := 1; ; fix++ {
		report, err := s.contentLintReport(ctx, finalPath)
		if err != nil {
			return err
		}
		if report == "" {
			return nil
		}
		evidence := s.keepContentLintReport(report)
		if fix > MaxContentLintFixes {
			return NewStepError(14, fmt.Errorf("refine: final.mdx still fails the content checks after %d fixes; nothing was paired, stamped or deployed. A flagged proper noun needs an accepted-English decision from ShroomDog, not a translation (report: %s)", MaxContentLintFixes, evidence))
		}
		s.Log.Info("  content checks flagged final.mdx; sending the report back to refine (%d/%d)", fix, MaxContentLintFixes)
		if err := s.refineFrom(ctx, contentLintDraftFile, func(ctx context.Context) error {
			return s.runRefine(ctx, prompts.RefineData{Draft: contentLintDraftFile, LintReport: report})
		}); err != nil {
			return err
		}
	}
}

// requireContentLintClean refuses to pair or stamp a body the content checks
// flag. Refine already fixes what they flag; this catches a body that did not
// come out of refine, such as a work dir resumed with --from-step
// source-distance.
func (s *State) requireContentLintClean(ctx context.Context, finalPath string) error {
	report, err := s.contentLintReport(ctx, finalPath)
	if err != nil {
		return err
	}
	if report == "" {
		return nil
	}
	return NewStepError(14, fmt.Errorf("source-distance: final.mdx fails the content checks, so it is not paired or stamped; fix it in the work dir and resume with --from-step source-distance (report: %s)", s.keepContentLintReport(report)))
}

// keepContentLintReport saves a report in the work dir and returns its path.
func (s *State) keepContentLintReport(report string) string {
	dir := filepath.Join(s.WorkDir, contentLintDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		s.Log.Warn("content checks: %v", err)
		return report
	}
	for n := 1; ; n++ {
		path := filepath.Join(dir, fmt.Sprintf("report-%d.txt", n))
		_, err := os.Stat(path)
		if err == nil {
			continue
		}
		if os.IsNotExist(err) {
			err = os.WriteFile(path, []byte(report+"\n"), 0o644)
		}
		if err != nil {
			s.Log.Warn("content checks: %v", err)
			return report
		}
		return path
	}
}
