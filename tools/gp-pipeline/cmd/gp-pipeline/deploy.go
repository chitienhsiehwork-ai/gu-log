package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/counter"
	deploypkg "github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/deploy"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/pipeline"
)

type deployReport struct {
	OK         bool   `json:"ok"`
	Step       string `json:"step"`
	TicketID   string `json:"ticketId,omitempty"`
	Filename   string `json:"filename,omitempty"`
	ENFilename string `json:"enFilename,omitempty"`
	DryRun     bool   `json:"dryRun,omitempty"`
	ElapsedMs  int64  `json:"elapsedMs"`
	ErrorCode  int    `json:"errorCode,omitempty"`
	Error      string `json:"error,omitempty"`
}

func newDeployCmd(state *rootState) *cobra.Command {
	var (
		activeFilename   string
		activeENFilename string
		title            string
		dateStamp        string
		authorSlug       string
		titleSlug        string
		prefix           string
		dryRun           bool
		skipBuild        bool
		skipValidate     bool
	)
	cmd := &cobra.Command{
		Use:   "deploy",
		Short: "Allocate and publish a fresh PENDING article",
		Long: `deploy is the standalone allocation path for a fresh PENDING article.
Before any counter or file mutation, it:

  1. Validates CLI inputs, including required --date-stamp, --author-slug,
     and --title-slug filename slots
  2. Enforces canonical taxonomy and matching pending filenames
  3. Validates PENDING ticketId frontmatter in the input files
  4. Refuses pre-existing staged index changes
  5. Runs node scripts/validate-posts.mjs

After those gates pass, it:

  6. Bumps the GP/MP/SD/Lv counter under flock
  7. Renames pending files and replaces PENDING ticketId references
  8. Runs pnpm run build
  9. Stages the MDX files + scripts/article-counter.json
 10. Commits with "Add <TICKET>: <TITLE>" and pushes to the default remote

Use "gp-pipeline run --from-step deploy --file <existing>.mdx" to publish
an already-allocated article without changing its ticket or filename.

--dry-run performs only CLI input preflight: it does not inspect article
frontmatter or the staged index, run the validator, or perform counter, file,
build, commit, or push operations. --skip-build and --skip-validate are
testing-only flags: normal standalone deploy rejects them; dry-run returns
before either stage is reached.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runDeployCmd(cmd.Context(), state, deployCmdOpts{
				ActiveFilename:   activeFilename,
				ActiveENFilename: activeENFilename,
				Title:            title,
				DateStamp:        dateStamp,
				AuthorSlug:       authorSlug,
				TitleSlug:        titleSlug,
				Prefix:           prefix,
				DryRun:           dryRun,
				SkipBuild:        skipBuild,
				SkipValidate:     skipValidate,
			})
		},
	}
	cmd.Flags().StringVar(&activeFilename, "active-file", "", "current pending filename in src/content/posts/ (required)")
	cmd.Flags().StringVar(&activeENFilename, "active-en-file", "", "current en- companion pending filename")
	cmd.Flags().StringVar(&title, "title", "", "article title for the commit message")
	cmd.Flags().StringVar(&dateStamp, "date-stamp", "", "YYYYMMDD for the final filename (required for fresh PENDING deploy)")
	cmd.Flags().StringVar(&authorSlug, "author-slug", "", "sanitised author handle for the final filename (required for fresh PENDING deploy)")
	cmd.Flags().StringVar(&titleSlug, "title-slug", "", "sanitised title for the final filename (required for fresh PENDING deploy)")
	cmd.Flags().StringVar(&prefix, "prefix", "GP", "ticket prefix (GP / MP / SD / Lv)")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "validate CLI inputs only; run no validator or mutations")
	cmd.Flags().BoolVar(&skipBuild, "skip-build", false, "testing only; rejected by normal standalone deploy")
	cmd.Flags().BoolVar(&skipValidate, "skip-validate", false, "testing only; rejected by normal standalone deploy")
	_ = cmd.MarkFlagRequired("active-file")
	// date-stamp / author-slug / title-slug are validated inside deploy.Run
	// (deploy.ValidateFilenameSlots, gu-log #546) rather than as cobra-required
	// flags, so the retired-prefix taxonomy gate in runDeployCmd fires first
	// and returns its actionable "use GP/MP" hint before any slot check.
	return cmd
}

type deployCmdOpts struct {
	ActiveFilename   string
	ActiveENFilename string
	Title            string
	DateStamp        string
	AuthorSlug       string
	TitleSlug        string
	Prefix           string
	DryRun           bool
	SkipBuild        bool
	SkipValidate     bool
}

func runDeployCmd(ctx context.Context, state *rootState, opts deployCmdOpts) error {
	start := time.Now()
	report := deployReport{Step: "deploy", DryRun: opts.DryRun}
	if err := counter.ValidatePrefix(opts.Prefix); err != nil {
		return err
	}
	if err := deploypkg.ValidatePostBasenames(opts.ActiveFilename, opts.ActiveENFilename); err != nil {
		return newExitError(1, err)
	}
	if err := deploypkg.ValidateFilenameSlots(deploypkg.Options{
		DateStamp:  opts.DateStamp,
		AuthorSlug: opts.AuthorSlug,
		TitleSlug:  opts.TitleSlug,
	}); err != nil {
		return newExitError(1, err)
	}

	if opts.DryRun {
		state.log.Warn("deploy: --dry-run, nothing to do")
		report.OK = true
		report.ElapsedMs = time.Since(start).Milliseconds()
		emitDeployReport(state, report)
		return nil
	}

	s := pipeline.NewState()
	s.Cfg = state.cfg
	s.Log = state.log
	s.Counter = counter.New(state.cfg.CounterFile, "")
	s.Prefix = opts.Prefix
	s.ActiveFilename = opts.ActiveFilename
	s.ActiveENFilename = opts.ActiveENFilename
	s.Title = opts.Title
	s.DateStamp = opts.DateStamp
	s.AuthorSlug = opts.AuthorSlug
	s.TitleSlug = opts.TitleSlug

	// The State.Deploy method drives the whole thing, but does not
	// honor --skip-build / --skip-validate. For standalone debugging,
	// call the underlying deploy package directly when those flags are
	// set; otherwise defer to State.Deploy.
	if opts.SkipBuild || opts.SkipValidate {
		return newExitError(1, fmt.Errorf("deploy: --skip-build / --skip-validate are currently only supported inside tests; the standalone subcommand always runs the full sequence. Use `run --dry-run` to exercise everything but push"))
	}

	err := s.Deploy(ctx)
	report.ElapsedMs = time.Since(start).Milliseconds()
	if err != nil {
		var se *pipeline.StepError
		if errors.As(err, &se) {
			report.ErrorCode = se.Code
		} else {
			report.ErrorCode = 1
		}
		report.Error = err.Error()
		emitDeployReport(state, report)
		return newExitError(report.ErrorCode, err)
	}
	report.OK = true
	report.TicketID = s.PromptTicketID
	report.Filename = s.Filename
	report.ENFilename = s.ENFilename
	emitDeployReport(state, report)
	return nil
}

func emitDeployReport(state *rootState, r deployReport) {
	if state.json {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(r)
		return
	}
	if r.OK && !r.DryRun {
		fmt.Println(r.TicketID)
	}
}
