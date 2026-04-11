package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/counter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/pipeline"
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
		Short: "Allocate a ticket ID, rename pending files, validate, build, commit, push",
		Long: `deploy is Step 5 of the pipeline. It:

  1. Bumps the SP/CP/SD/Lv counter under flock
  2. Renames the pending file in src/content/posts/ to the final name
  3. Replaces any PENDING ticketId references in the frontmatter
  4. Runs node scripts/validate-posts.mjs (unless --skip-validate)
  5. Runs npm run build (unless --skip-build)
  6. Stages the two MDX files + scripts/article-counter.json
  7. Commits with "Add <TICKET>: <TITLE>"
  8. Pushes to the default remote (unless --dry-run)

Most callers invoke this through "sp-pipeline run"; the standalone
subcommand is for recovering a partially-deployed article.`,
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
	cmd.Flags().StringVar(&dateStamp, "date-stamp", "", "YYYYMMDD for the final filename")
	cmd.Flags().StringVar(&authorSlug, "author-slug", "", "sanitised author handle for the final filename")
	cmd.Flags().StringVar(&titleSlug, "title-slug", "", "sanitised title for the final filename")
	cmd.Flags().StringVar(&prefix, "prefix", "SP", "ticket prefix (SP / CP / SD / Lv)")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "skip validate, build, and push (for testing)")
	cmd.Flags().BoolVar(&skipBuild, "skip-build", false, "skip npm run build")
	cmd.Flags().BoolVar(&skipValidate, "skip-validate", false, "skip node scripts/validate-posts.mjs")
	_ = cmd.MarkFlagRequired("active-file")
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
